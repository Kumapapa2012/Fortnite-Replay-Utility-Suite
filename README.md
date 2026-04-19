# Fortnite Replay Suite

Fortnite のリプレイ解析・マップ表示・ログ監視・録画動画のトリミングを **1 つの Web UI** で行う個人向けツール。Windows ローカル専用。

内部では 6 プロセスが連携します（Gateway + 5 バックエンドサービス + Vite フロント）。

```
┌───────────────┐     ┌──────────────────────────────────────────┐
│ Browser       │────▶│ Gateway :8080 ── reverse proxy           │
│ (Vite :5173   │     │   /api/replay-parser/* → Parser :12345   │
│  or dist/)    │     │   /api/log-monitor/*   → LogMon  :8000   │
└───────────────┘     │   /api/map/*           → Map     :8001   │
                      │   /api/prepare-upload/* → Upload :8002   │
                      │   /api/suite/*         → Core    :8003   │
                      └──────────────────────────────────────────┘
```

## 前提

| 要件 | バージョン / 備考 |
|---|---|
| OS | Windows 11 |
| Python | 3.14（または 3.11 以降） |
| .NET SDK | 9.0（Replay Parser 起動用） |
| ffmpeg / ffprobe | PATH に通す。[公式ビルド](https://ffmpeg.org/download.html#build-windows) |
| Node.js | 20+（フロント開発時のみ） |
| Fortnite | `.replay` が生成される状態 |

## 初回セットアップ

```powershell
# 1) Python venv を作る（リポジトリ親ディレクトリに作る想定）
python -m venv ../venv
../venv/Scripts/python -m pip install -r services/requirements.txt

# 2) フロントの依存を入れる
cd frontend
npm install
cd ..

# 3) 設定ファイルを生成（空 config を作るだけ）
python scripts/init_config.py
```

生成先: `~/.fortnite-suite/config.json`
デフォルトは起動時に埋まるため、まずは空のままで OK。

## 日常の起動 / 停止

**推奨: 統合スクリプト `manage.ps1` で一度に実行**

```powershell
# 全バックエンドを起動 + 状態確認 + 疎通テスト
pwsh scripts/manage.ps1

# バックエンド + Vite フロント開発サーバーを起動
pwsh scripts/manage.ps1 -Dev

# 特定サービスだけ起動
pwsh scripts/manage.ps1 -Service gateway -Service suite_core

# 全停止
pwsh scripts/manage.ps1 -Stop

# 特定サービスだけ停止
pwsh scripts/manage.ps1 -Stop -Service log_monitor_api
```

> 内部では `start.ps1` → `status.ps1` → `smoke.py` を順番に実行するため、個別に呼ぶ必要がありません。

**個別実行が必要な場合:**

```powershell
pwsh scripts/start.ps1
pwsh scripts/status.ps1
python scripts/smoke.py
pwsh scripts/stop.ps1
```

> ※ `-Dev` フラグを使えば Vite も自動起動されるため、別途 `cd frontend; npm run dev` を実行する必要がありません。

本番相当では `npm run build` 済みの `frontend/dist` を Gateway が配信する想定（未実装・Phase 6 扱い）。

## 画面

| ルート | 用途 |
|---|---|
| `/` | ダッシュボード（概況 + ログ監視バナー） |
| `/matches` | マッチ一覧（リプレイと録画動画のペア） |
| `/matches/:id` | マッチ詳細（リプレイ / 動画 / ログを横断） |
| `/replays` | リプレイファイル一覧 |
| `/replays/:id` | リプレイ結果レポート（HTML） |
| `/replays/:id/map` | リプレイマップ（移動軌跡 PNG） |
| `/videos` | 録画動画の一覧 + トリミング UI |
| `/logs` | ログ監視のイベントストリーム（SSE） |
| `/settings` | フォルダ設定 + Epic 表示名 |

## トラブルシュート（抜粋）

詳細は [docs/06_deployment.md §12](./docs/06_deployment.md#12-トラブルシュート) を参照。

| 症状 | 対処 |
|---|---|
| `/matches` が空 | `/settings` で `demos_dir` / `obs_recording_dir` を確認 → 「再スキャン」 |
| `/videos` の `ffmpeg: 未検出` | PATH に `ffmpeg.exe` / `ffprobe.exe` を追加して全サービス再起動 |
| `/logs` で「ログファイル(未検出)」 | `/settings` で `log_path` を明示 → `scripts/stop.ps1` → `start.ps1` |
| 画面から 503 が頻発 | `python scripts/smoke.py` でどのサービスが落ちているか確認 |

## ディレクトリ構成（概要）

```
Integrated_App/
├── README.md              （← 本ファイル）
├── docs/                  設計ドキュメント
├── gateway/               FastAPI Gateway
├── services/
│   ├── _common/           ports, paths, logging, global config
│   ├── replay_parser/     .NET 9 ASP.NET Core Minimal API
│   ├── log_monitor_api/   Fortnite ログ監視 + SSE
│   ├── map_api/           移動軌跡 PNG レンダリング
│   ├── prepare_upload_api/ ffmpeg/ffprobe 駆動の動画処理
│   └── suite_core/        マッチペアリング + グローバル設定
├── frontend/              React + Vite + Tailwind
├── scripts/               PowerShell + process_manager
├── logs/                  ランタイムログ（rotation あり）
└── .run/                  PID ファイル（stop が掃除）
```

## `../__Individual_Apps/` について（GitHub 公開版では同梱なし）

本スイートの元になった 4 つの独立 CLI が、ローカルでは親ディレクトリ `../__Individual_Apps/` に置かれています。これらは **読み取り専用のリファレンス**（移植元）であり、Integrated_App 側のコードからは参照していません — 各ロジックは `services/*/app/` に移植済みです。

> **注意**: GitHub に公開しているのは `Integrated_App/` 配下のみです。`__Individual_Apps/` は本リポジトリには含まれていません。`docs/01_overview.md` / `docs/02_existing_apps_analysis.md` / `docs/07_project_structure.md` 等の設計ドキュメントに登場する `__Individual_Apps/` への参照は、**統合作業時の経緯を残すアーカイブ的記述**として読んでください。同様に `services/suite_core/app/obs_discovery.py` 内の legacy フォールバックパスも、ローカル開発環境互換のために残してあるだけで、本リポジトリ単体での動作には影響しません（正規パス `services/log_monitor_api/.env` が優先されます）。

## ライセンス / 著作権

個人利用。サードパーティ依存のライセンスは `services/replay_parser/LICENSE.txt`（および移植元の `__Individual_Apps/*/LICENSE.txt` — ローカル参照）を参照。
