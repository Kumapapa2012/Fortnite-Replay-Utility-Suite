const https = require('https');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const VERSION_FILE = path.join(__dirname, '.map_version');

/**
 * 保存されているバージョンをファイルから取得
 */
function loadPreviousVersion() {
  try {
    if (fs.existsSync(VERSION_FILE)) {
      const version = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
      console.log(`✓ Previous version: ${version}`);
      return version;
    }
  } catch (err) {
    console.warn(`⚠ Could not read version file: ${err.message}`);
  }
  return null;
}

/**
 * 取得したバージョンをファイルに保存
 */
function saveVersion(version) {
  try {
    fs.writeFileSync(VERSION_FILE, version, 'utf-8');
    console.log(`✓ Saved version to file: ${version}`);
  } catch (err) {
    console.error(`⚠ Could not save version file: ${err.message}`);
  }
}

/**
 * en.js からマップバージョンを取得
 */
async function getMapVersion() {
  return new Promise((resolve, reject) => {
    https.get('https://fortnite.gg/data/en.js', (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          // グローバルスコープのプロキシを作成
          const handler = {
            get: (target, prop) => {
              if (!(prop in target)) {
                target[prop] = new Proxy({}, handler);
              }
              return target[prop];
            }
          };
          const globalProxy = new Proxy({}, handler);
          
          const window = globalProxy;
          const Spawns = globalProxy;
          const L10N = globalProxy;

          eval(data);

          if (!window.Data || !window.Data.map) {
            reject(new Error('Map version not found in window.Data'));
            return;
          }

          const mapVersion = window.Data.map;
          console.log(`✓ Found map version: ${mapVersion}`);
          resolve(mapVersion);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

/**
 * 単一の WebP 画像をダウンロード
 */
async function downloadImage(mapVersion, x, y, outputDir) {
  return new Promise((resolve, reject) => {
    const filename = `${x}${y}.webp`;
    const filepath = path.join(outputDir, filename);
    const url = `https://fortnite.gg/maps/${mapVersion}/3/${x}/${y}.webp`;

    const file = fs.createWriteStream(filepath);

    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${filename}`));
        return;
      }

      res.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve(filename);
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {}); // ファイルを削除
      reject(err);
    });
  });
}

/**
 * 8x8 のタイル画像を結合
 */
async function combineTiles(mapsDir) {
  const gridSize = 8;
  
  console.log('\nCombining tiles...');

  // 最初のタイルから寸法を取得
  const firstTile = path.join(mapsDir, '00.webp');
  const metadata = await sharp(firstTile).metadata();
  const tileSize = metadata.width;

  console.log(`✓ Tile size: ${tileSize}x${tileSize}`);

  // 結合リストを作成
  const compositeList = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const filename = `${x}${y}.webp`;
      const filepath = path.join(mapsDir, filename);
      
      if (!fs.existsSync(filepath)) {
        throw new Error(`Tile not found: ${filename}`);
      }

      compositeList.push({
        input: filepath,
        left: x * tileSize,
        top: y * tileSize
      });
    }
  }

  // 最終画像の寸法
  const width = tileSize * gridSize;
  const height = tileSize * gridSize;

  console.log(`✓ Creating ${width}x${height} combined image...`);

  // タイルを結合
  const result = await sharp({
    create: {
      width: width,
      height: height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 }
    }
  })
    .composite(compositeList)
    .toFile(path.join(__dirname, 'combined_map.webp'));

  console.log(`✓ Combined map saved: ${result.filename} (${result.size} bytes)`);
}

/**
 * メイン処理
 */
async function main() {
  try {
    console.log('=== Fortnite Map Downloader ===\n');

    // 過去のバージョンを読み込む
    const previousVersion = loadPreviousVersion();

    // 現在のバージョンを取得
    console.log('\nFetching current map version...');
    const currentVersion = await getMapVersion();

    // バージョンを比較
    console.log(`✓ Current version: ${currentVersion}`);
    
    if (previousVersion === currentVersion) {
      console.log('\n✅ Map is up-to-date. No update needed.');
      return;
    }

    console.log('\n⚠ Version changed! Updating map...');

    // 出力ディレクトリを作成
    const outputDir = path.join(__dirname, 'maps');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`✓ Created directory: ${outputDir}`);
    } else {
      // 古いタイルを削除
      console.log('✓ Clearing old tiles...');
      const files = fs.readdirSync(outputDir);
      files.forEach(file => {
        if (file.match(/^\d{2}\.webp$/)) {
          fs.unlinkSync(path.join(outputDir, file));
        }
      });
    }

    // 8x8 = 64 個の画像をダウンロード
    console.log(`\nDownloading 64 map tiles for version ${currentVersion}...`);

    let downloaded = 0;
    let failed = 0;

    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        try {
          await downloadImage(currentVersion, x, y, outputDir);
          downloaded++;
          process.stdout.write(`\rDownloaded: ${downloaded}/64 [${failed} failed]`);
        } catch (err) {
          failed++;
          console.error(`\nError downloading ${x}${y}.webp:`, err.message);
        }
      }
    }

    console.log(`\n✓ Downloaded ${downloaded} images to ${outputDir}`);
    if (failed > 0) {
      console.log(`⚠ ${failed} images failed to download`);
      process.exit(1);
    }

    // タイルを結合
    await combineTiles(outputDir);

    // バージョンをファイルに保存
    saveVersion(currentVersion);

    console.log('\n✅ All done!');
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

main();
