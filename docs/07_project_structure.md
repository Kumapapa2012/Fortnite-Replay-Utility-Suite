# 07. プロジェクト構成

## 1. 概要・設計方針

統合後のディレクトリ構成を確定する。

### スコープ

- 確定対象: `Integrated_App/` 配下のすべてのディレクトリ
- 既存の `__Individual_Apps/` は**参照用として残す**（削除しない）

### 設計方針

1. **モノレポ**: 統合スコープ全体を 1 つのリポジトリで管理
2. **物理コピー** (Q7 確定 (a)): 既存4アプリのソースは `Integrated_App/services/` 配下に**コピー**し、以後は統合プロジェクト側で改修する
3. **`__Individual_Apps/` は読み取り専用**: 統合作業中の安全網・参照資料として残し、改修は行わない
4. **言語ごとの依存管理は分離**: Python は共通 venv、Node は単独、.NET は単独
5. **シークレットは Git に入れない**: `.env` 系はテンプレートのみコミット、実値は `.gitignore`

---

## 2. モノレポ vs ポリリポ

### 2.1 採用: モノレポ

**理由**:
- 個人開発で 1 名運用
- フロント・バックエンドが密結合（API 仕様変更時に同時改修が必須）
- 起動スクリプト・ドキュメントを単一リポジトリで完結させたい
- リリース単位が「全体ワンセット」

### 2.2 ワークスペース管理

| 言語 | ワークスペース手段 | 配置 |
|---|---|---|
| Python | 共通 venv (`.venv/`) + 各サービスの `requirements.txt` を集約した `services/requirements.txt` | サービス単位ディレクトリで完結 |
| Node | `frontend/package.json` 単独（ワークスペース機能未使用） | `frontend/` |
| .NET | `services/replay_parser/*.sln` 単独 | `services/replay_parser/` |

複雑な monorepo ツール（Nx, Turborepo, Pants 等）は導入しない。個人ツール規模では過剰。

---

## 3. 既存4アプリの取り込み方針

### 3.1 Replay_Parser_GUI（C# / .NET 9）

| 項目 | 内容 |
|---|---|
| 取り込み先 | `Integrated_App/services/replay_parser/` |
| 方法 | `__Individual_Apps/Fortnite_Replay_Parser_GUI/` を全コピー（`.git`, `.vs`, `bin`, `obj` を除く） |
| 改修 | 新規エンドポイント（`/api/result.json`, `/api/replay-to-json`, `/api/upload-from-path`, `/api/health`）を追加 |
| `wwwroot/` | **削除**（統合フロントが代替） |

### 3.2 fortnite_log_monitor

| 項目 | 内容 |
|---|---|
| 取り込み先 | `Integrated_App/services/log_monitor_api/` |
| 方法 | `fortnite_log_monitor.py` を `core.py` にリネームして配置、`api.py` を新規追加 |
| 改修 | CLI エントリポイントは温存（`__main__.py`）、内部の `EventCallbacks` / `OBSController` / `FortniteLogMonitor` クラスを FastAPI から直接利用 |
| `.env` | 値は **Git に入れず**、`.env.example` をコミット。実値はユーザが手動配置 |
| `.jsx` プロトタイプ | 取り込まず（フロント側でゼロから書く、ロジック参考のみ） |

### 3.3 Fortnite_replay_map_project

| 項目 | 内容 |
|---|---|
| 取り込み先 | `Integrated_App/services/map_api/` |
| 方法 | `replay_to_map.py` の純関数（`build_location_entries`, `draw_route`, `z_to_color`）を `core.py` に移植、I/O 部分を捨てる |
| 改修 | `subprocess` で `ReplayToJson.exe` を呼んでいた箇所を、Replay Parser の `POST /api/replay-to-json` 呼び出しに変更 |
| `ReplayToJson/` サブプロジェクト | **取り込まず破棄**（重複解消、`02` §6.1, `03` §4.3） |
| `base_params.json` | `services/map_api/base_params.json` に同梱 |
| 背景マップ画像 | `services/map_api/map_tool/combined_map.webp`。`map_tool/download_and_combine.js`（Node.js 20+）が fortnite.gg から公式タイルを取得して合成する。サービス起動時にバージョン差分検出で自動再合成、`POST /api/map/update` で手動更新も可 |
| `user_params.json` | 廃止（グローバル設定 `userPlayerId` に置換） |

### 3.4 __prepare_upload.py

| 項目 | 内容 |
|---|---|
| 取り込み先 | `Integrated_App/services/prepare_upload_api/` |
| 方法 | `__prepare_upload.py` の純関数（`parse_timestamp`, `seconds_to_hms`, `find_keyframes`）を `core.py` に移植、対話入力 (`input()`) と `main()` は廃止 |
| 改修 | `/api/candidates`, `/api/keyframes`, `/api/trim`, `/api/health` の 4 エンドポイントを実装 |

### 3.5 `__Individual_Apps/` の扱い

**残す**。理由:
- 統合作業中の動作確認・差分検証に使える
- Git 履歴（特に `Replay_Parser_GUI/.git`, `Fortnite_replay_map_project/.git`）への参照を保つ
- 「困ったら元の動作を確認」できる安全網

`Integrated_App/README.md` または本ドキュメントに「`__Individual_Apps/` は参照用、改修禁止」を明記する。

---

## 4. ディレクトリ構成全体図

```
F:/__kmori_Working/Claude_Code/Fortnite_Replay_Util/
├── __Individual_Apps/                    # 既存4アプリ（参照用、改修禁止）
│   ├── Fortnite_Replay_Parser_GUI/
│   ├── fortnite_log_monitor/
│   ├── Fortnite_replay_map_project/
│   └── __prepare_upload/
│
└── Integrated_App/                       # 統合プロジェクト本体
    ├── README.md                          # プロジェクト概要、起動方法
    ├── docs/                              # 仕様書（本シリーズ）
    │   ├── README.md
    │   ├── 01_overview.md
    │   ├── 02_existing_apps_analysis.md
    │   ├── 03_api_specification.md
    │   ├── 04_gateway_design.md
    │   ├── 05_frontend_design.md
    │   ├── 06_deployment.md
    │   └── 07_project_structure.md
    │
    ├── services/                          # バックエンドサービス群
    │   ├── requirements.txt              # Python 共通依存（5 サービス分を集約）
    │   ├── _common/                       # サービス間で共有するユーティリティ
    │   │   ├── __init__.py
    │   │   ├── config.py                 # ~/.fortnite-suite/config.json 読み込み
    │   │   ├── errors.py                 # 標準エラーレスポンス
    │   │   └── parser_client.py          # Replay Parser 呼び出しクライアント
    │   │
    │   ├── replay_parser/                # .NET (既存をコピー + 改修)
    │   │   ├── Fortnite_Replay_Parser_GUI.sln
    │   │   ├── Fortnite_Replay_Parser_GUI.csproj
    │   │   ├── Program.cs
    │   │   ├── FortniteReplayHelper.cs
    │   │   ├── FortniteApiClient.cs
    │   │   ├── SystemInfoHelper.cs
    │   │   ├── FortniteApiClientTests.cs
    │   │   ├── Templates/
    │   │   │   └── Template_MatchResult.cs
    │   │   ├── Models/                   # 新規: 構造化レスポンス用 DTO
    │   │   │   ├── MatchResult.cs
    │   │   │   ├── PlayerResult.cs
    │   │   │   └── EliminationDto.cs
    │   │   └── Endpoints/                # 新規: 拡張エンドポイントの実装分離
    │   │       ├── ResultJsonEndpoint.cs
    │   │       ├── ReplayToJsonEndpoint.cs
    │   │       ├── UploadFromPathEndpoint.cs
    │   │       └── HealthEndpoint.cs
    │   │
    │   ├── log_monitor_api/              # Python FastAPI ラッパー
    │   │   ├── __init__.py
    │   │   ├── main.py                   # FastAPI app
    │   │   ├── api.py                    # ルート定義
    │   │   ├── core.py                   # 既存 fortnite_log_monitor.py 由来のロジック
    │   │   ├── obs.py                    # OBSController（既存から分離）
    │   │   ├── stream.py                 # SSE 実装
    │   │   ├── ring_buffer.py            # イベント履歴 + backlog 配信
    │   │   ├── lifecycle.py              # 自動 ON/OFF（Fortnite プロセス監視）
    │   │   ├── .env.example
    │   │   └── tests/
    │   │
    │   ├── map_api/                      # Python FastAPI ラッパー
    │   │   ├── __init__.py
    │   │   ├── main.py
    │   │   ├── api.py
    │   │   ├── core.py                   # build_location_entries / draw_route / z_to_color
    │   │   ├── assets/
    │   │   │   ├── map_ja.png
    │   │   │   └── base_params.json
    │   │   └── tests/
    │   │
    │   ├── prepare_upload_api/           # Python FastAPI ラッパー
    │   │   ├── __init__.py
    │   │   ├── main.py
    │   │   ├── api.py
    │   │   ├── core.py                   # find_keyframes / parse_timestamp 等
    │   │   ├── candidates.py             # mtime + replay から候補時刻算出
    │   │   ├── ffmpeg_check.py
    │   │   └── tests/
    │   │
    │   ├── suite_core/                   # 新規: Match Library + 設定
    │   │   ├── __init__.py
    │   │   ├── main.py
    │   │   ├── api.py
    │   │   ├── matches/
    │   │   │   ├── __init__.py
    │   │   │   ├── scanner.py            # Demos / Videos スキャン
    │   │   │   ├── pairing.py            # タイムスタンプ近接ペアリング
    │   │   │   └── cache.py              # メモリキャッシュ
    │   │   ├── config_store.py           # ~/.fortnite-suite/config.json 操作
    │   │   ├── obs_recording_dir.py      # OBS WebSocket → フォールバック
    │   │   └── tests/
    │   │
    │   └── gateway/                      # FastAPI 自作 gateway
    │       ├── __init__.py
    │       ├── main.py
    │       ├── routes.py                 # ROUTES dict
    │       ├── proxy.py                  # 汎用プロキシ
    │       ├── sse.py                    # SSE 専用
    │       ├── static.py                 # StaticFiles + SPA fallback
    │       ├── health.py                 # 全 upstream 集約 /health
    │       └── tests/
    │
    ├── frontend/                          # React + Vite
    │   ├── public/
    │   ├── src/
    │   │   ├── main.tsx
    │   │   ├── App.tsx
    │   │   ├── pages/
    │   │   ├── components/
    │   │   │   ├── ui/                   # shadcn 生成物
    │   │   │   ├── layout/
    │   │   │   └── custom/
    │   │   ├── hooks/
    │   │   ├── api/
    │   │   ├── contexts/
    │   │   ├── types/
    │   │   ├── lib/
    │   │   └── styles/
    │   ├── index.html
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vite.config.ts
    │   ├── tailwind.config.ts
    │   └── components.json               # shadcn 設定
    │
    ├── scripts/                           # 起動・補助スクリプト
    │   ├── healthcheck.py                # 起動時のヘルスチェック polling
    │   ├── kill_by_port.ps1              # ポートで PID を kill
    │   ├── tail_all.ps1                  # 全サービスのログを並行 tail
    │   └── port_check.py                 # 使用ポート衝突診断
    │
    ├── assets/                            # 共通アセット
    │   ├── icon.ico                       # ショートカット用
    │   ├── icon.png
    │   └── config.template.json           # 初回 config.json 雛形
    │
    ├── setup.ps1                          # 初回セットアップ
    ├── start.ps1                          # 日常起動
    ├── stop.ps1                           # 停止
    ├── dev.ps1                            # 開発時（reload + Vite dev）
    │
    ├── logs/                               # 実行時ログ（.gitignore）
    ├── .run/                               # PID / 実行時状態（.gitignore）
    ├── .venv/                              # Python 仮想環境（.gitignore）
    ├── dist/                               # ビルド成果物（.gitignore）
    │   └── replay_parser/                  # dotnet publish 出力
    │
    ├── .gitignore
    ├── .editorconfig
    └── pyproject.toml                     # （任意）プロジェクト全体メタ
```

---

## 5. 各サービスの内部構成

### 5.1 services/replay_parser/ (.NET)

既存ファイル群はそのまま、追加分は `Models/` と `Endpoints/` に分離する設計。

```
replay_parser/
├── Fortnite_Replay_Parser_GUI.sln
├── Fortnite_Replay_Parser_GUI.csproj
├── Program.cs                  # 既存 + 新エンドポイント登録（最小変更）
├── FortniteReplayHelper.cs     # 既存（テンプレート出力用ロジック）
├── FortniteApiClient.cs        # 既存
├── SystemInfoHelper.cs         # 既存
├── Templates/
├── Models/                     # 新規: 構造化レスポンス DTO
└── Endpoints/                  # 新規: 拡張エンドポイント別ファイル
```

`Program.cs` の改修最小化のため、新エンドポイントは extension method (`MapResultJson(this WebApplication app)` 等) として `Endpoints/` 配下に切り出す。

### 5.2 services/log_monitor_api/ (Python)

```
log_monitor_api/
├── main.py            # uvicorn entrypoint, app = FastAPI(...)
├── api.py             # ルート: /status /events /aggregate /stream /health
├── core.py            # FortniteLogMonitor / EVENT_PATTERNS / DetectedEvent
├── obs.py             # OBSController
├── stream.py          # SSE generator
├── ring_buffer.py     # 直近 200 件保持 + backlog 配信
├── lifecycle.py       # Fortnite プロセス検出 → 自動 ON/OFF
├── .env.example       # OBS_HOST 等のテンプレート（実値は Git 外）
└── tests/
```

`api.py` は薄く、ロジックは既存 CLI 由来のクラスを `core.py` から呼ぶだけ。

### 5.3 services/map_api/ (Python)

```
map_api/
├── app/
│   ├── main.py        # FastAPI: /api/players /api/render /api/map-version /api/map/update /health
│   └── renderer.py    # extract_player_list / render_route (PIL)
├── base_params.json   # world→pixel 変換パラメータ
└── map_tool/
    ├── download_and_combine.js  # Node.js: fortnite.gg から公式タイル取得 + 合成
    ├── combined_map.webp        # 実行時生成（起動時 / 手動更新で再生成）
    ├── .map_version             # ローカルに保持している map version
    ├── package.json
    └── node_modules/            # npm install 済みの依存
```

`map_tool/` はパッケージ内同梱。Node.js 20+ と `npm install` が必要。マップ画像は著作権保護のためリポジトリにコミットせず、起動時に fortnite.gg から取得する運用。

### 5.4 services/prepare_upload_api/ (Python)

```
prepare_upload_api/
├── main.py
├── api.py             # /candidates /keyframes /trim /health
├── core.py            # find_keyframes / parse_timestamp / seconds_to_hms / ffmpeg 呼び出し
├── candidates.py      # 動画 mtime + replay から候補時刻算出
├── ffmpeg_check.py    # 起動時の ffmpeg/ffprobe 検出
└── tests/
```

`candidates.py` は Replay Parser の `/api/replay-to-json` を呼ぶため `_common/parser_client.py` を利用。

### 5.5 services/suite_core/ (Python)

```
suite_core/
├── main.py
├── api.py                       # /matches /matches/{id} /matches/refresh /config /health
├── matches/
│   ├── scanner.py               # demos_dir / obs_recording_dir をスキャン
│   ├── pairing.py               # タイムスタンプ近接ペアリング
│   └── cache.py                 # メモリキャッシュ + 5 分バックグラウンド refresh
├── config_store.py              # ~/.fortnite-suite/config.json の R/W、バリデーション
├── obs_recording_dir.py         # OBS WebSocket GetRecordDirectory → フォールバック
└── tests/
```

### 5.6 services/gateway/ (Python)

```
gateway/
├── main.py
├── routes.py                    # ROUTES dict
├── proxy.py                     # 汎用プロキシ（GET/POST/PUT/DELETE）
├── sse.py                       # /api/log/stream 専用
├── static.py                    # StaticFiles + SPA fallback
├── health.py                    # /health
└── tests/
```

`04` で確定した設計を実装単位に分解。

### 5.7 frontend/ (React + Vite)

`05` §14 で確定したディレクトリ構成をそのまま採用。再掲は省略。

---

## 6. 依存管理

### 6.1 Python: 共通 venv

すべての Python サービスを 1 つの venv で動かす:

```
Integrated_App/.venv/
```

依存は `services/requirements.txt` に集約:

```txt
# services/requirements.txt
fastapi>=0.110
uvicorn[standard]>=0.27
httpx>=0.27
pydantic>=2.6
psutil>=5.9
obsws-python>=1.6
Pillow>=10.0
python-dotenv>=1.0       # （任意、現状は自前 _load_env_file）
```

メリット:
- venv は 1 つだけ → ストレージ・ビルド時間効率
- サービス間共通の `_common/` モジュールが自然に import できる
- `pip freeze` 結果が単一

デメリット（許容）:
- バージョン競合時に全サービス影響 → 個人ツール規模で許容

開発依存（pytest 等）は `requirements-dev.txt` に分離。

### 6.2 Node: frontend/ 単独

`frontend/package.json` のみ。npm workspaces は使わない（フロントが 1 つだけのため）。

### 6.3 .NET: services/replay_parser/ 単独

既存の `*.csproj` をそのまま。ソリューションファイル `*.sln` も保持。

### 6.4 グローバルツール

`PATH` 上に存在することを前提とする外部ツール:

| ツール | 必須/任意 | 検出方法 |
|---|---|---|
| `dotnet` (9.x) | 必須（Parser ビルド） | `setup.ps1` で `dotnet --version` |
| `python` (3.11+) | 必須 | `setup.ps1` で `python --version` |
| `node` (20+) | 必須 | `setup.ps1` で `node --version` |
| `ffmpeg` / `ffprobe` | 任意 | `prepare_upload_api` 起動時 + `setup.ps1` で警告 |

リポジトリ内には同梱しない（バイナリサイズ・ライセンス考慮）。

---

## 7. 設定 / 環境ファイル / シークレット

### 7.1 ~/.fortnite-suite/config.json

実行時設定。**ユーザのホームディレクトリ配下**に置き、Git 管理外。

```
~/.fortnite-suite/
└── config.json    # user_player_id, demos_dir, obs_recording_dir, log_path
```

雛形は `Integrated_App/assets/config.template.json` から `setup.ps1` がコピー。

### 7.2 services/log_monitor_api/.env

OBS WebSocket 接続情報。**実値は Git に入れない**。

| ファイル | コミット | 内容 |
|---|---|---|
| `.env.example` | ✓ | キー名のみ + コメント |
| `.env` | ✗（`.gitignore`） | 実値（OBS_PASSWORD 等） |

`setup.ps1` で `.env.example` から `.env` をコピーし、対話入力で OBS_PASSWORD を埋める。

### 7.3 .gitignore 方針

Integrated_App/.gitignore（抜粋）:

```gitignore
# 実行時生成物
logs/
.run/
.venv/
dist/

# Node
frontend/node_modules/
frontend/dist/

# .NET
services/replay_parser/bin/
services/replay_parser/obj/
services/replay_parser/.vs/

# Python
__pycache__/
*.pyc
.pytest_cache/
.mypy_cache/
.ruff_cache/

# Secrets
**/.env
!**/.env.example

# IDE
.idea/
.vscode/

# Test artifacts
**/test_output/
```

### 7.4 secrets の取り扱い

| 項目 | 取り扱い |
|---|---|
| OBS_PASSWORD | `.env`（Git 外）、`setup.ps1` 対話入力 or 既存 `__Individual_Apps/.../.env` から手動コピー |
| Discord Webhook URL | `.env` 配置、Git 外 |
| user_player_id | `~/.fortnite-suite/config.json`、Git 外 |

GitHub 公開する場合（将来）は **`__Individual_Apps/fortnite_log_monitor/.env`（既に実 OBS_PASSWORD がコミットされている）の取り扱いに注意**。Integrated_App 移行時は実値を取り除いてから push する旨を README に明記。

---

## 8. 名前空間とパッケージ命名

### 8.1 Python パッケージ名

| サービス | パッケージ名 | import 例 |
|---|---|---|
| Suite Core | `suite_core` | `from suite_core.config_store import load_config` |
| Log Monitor | `log_monitor_api` | `from log_monitor_api.core import FortniteLogMonitor` |
| Map | `map_api` | `from map_api.core import draw_route` |
| Prepare Upload | `prepare_upload_api` | `from prepare_upload_api.candidates import compute_candidates` |
| Gateway | `gateway` | `from gateway.routes import ROUTES` |
| 共通 | `_common` | `from _common.config import get_config` |

実行時:
```bash
cd services
python -m uvicorn suite_core.main:app --port 8000
python -m uvicorn log_monitor_api.main:app --port 8001
# ...
```

`services/` 配下に CWD を置くことで、各サービスが互いに相対 import 可能。

### 8.2 .NET アセンブリ名

既存の `Fortnite_Replay_Parser_GUI` をそのまま温存（変更コストが大きいわりに利益なし）。

### 8.3 共通 import 構造

`_common` モジュールは 5 サービスすべてから利用される共通基盤:

```python
# services/_common/parser_client.py（擬似コード）
import httpx

class ParserClient:
    def __init__(self, base_url: str = "http://127.0.0.1:12345"):
        self._client = httpx.AsyncClient(base_url=base_url, timeout=120)

    async def replay_to_json(self, replay_path: str) -> dict:
        r = await self._client.post("/api/replay-to-json", json={"replay_path": replay_path})
        r.raise_for_status()
        return r.json()
```

→ Map / Suite Core / Prepare Upload が共通利用。

---

## 9. ドキュメント / スクリプト / アセット配置

### 9.1 docs/

仕様書 8 ファイル（本シリーズ）。`docs/README.md` がインデックス + 実装フェーズ優先順位（`08_README` 相当を兼ねる）。

### 9.2 scripts/

| ファイル | 言語 | 用途 |
|---|---|---|
| `healthcheck.py` | Python | start.ps1 から呼ばれる、全サービスの /health polling |
| `kill_by_port.ps1` | PowerShell | フォールバック停止 |
| `tail_all.ps1` | PowerShell | 全ログを並行 tail（開発時） |
| `port_check.py` | Python | 起動前の使用ポート衝突診断 |

### 9.3 assets/

| ファイル | 用途 |
|---|---|
| `icon.ico` | デスクトップショートカット用 |
| `icon.png` | フロントの favicon 元素材 |
| `config.template.json` | 初回 `~/.fortnite-suite/config.json` 雛形 |

注: 背景マップは **`services/map_api/map_tool/combined_map.webp`** に生成される（`assets/` の共通配置にしない）。著作権考慮のためリポジトリにコミットせず、`map_tool/download_and_combine.js` が fortnite.gg から取得して合成する。Map サービス単独で完結できるようにするため。

---

## 10. ビルド成果物・キャッシュ・実行時ファイルの配置

### 10.1 ビルド成果物・キャッシュ

| ディレクトリ | 内容 | Git |
|---|---|---|
| `dist/replay_parser/` | `dotnet publish` 出力 | 無視 |
| `frontend/dist/` | `npm run build` 出力 | 無視 |
| `frontend/node_modules/` | npm 依存 | 無視 |
| `.venv/` | Python 仮想環境 | 無視 |
| `services/replay_parser/bin/`, `obj/` | .NET 中間生成物 | 無視 |
| `**/__pycache__/` | Python バイトコード | 無視 |

### 10.2 実行時ファイル

| ディレクトリ | 内容 | Git |
|---|---|---|
| `logs/` | 各サービスの stdout/stderr | 無視 |
| `.run/pids.json` | start.ps1 が記録した PID 一覧 | 無視 |

### 10.3 サーバ側テンポラリ

| 用途 | 配置 |
|---|---|
| Replay Parser のアップロード一時ファイル | `Path.GetTempPath()`（既存挙動維持、`_common/` の規約には従わない） |
| Prepare Upload の出力 | 既定: `<入力動画と同フォルダ>/upload.mp4`、API リクエストで上書き可 |
| Map API の中間 JSON | **作成しない**（メモリ内で完結、`02` §4.8 L3） |

---

## 11. 将来拡張時の追加場所

| 拡張内容 | 追加場所 |
|---|---|
| 新サービス追加（例: `stats_api`） | `services/stats_api/` を追加 + `gateway/routes.py` の ROUTES に追記 + `services/requirements.txt` に依存追加 + `start.ps1` に起動行追加 |
| 新フロントページ | `frontend/src/pages/<name>/` を追加 + `App.tsx` のルートに追記 + サイドバーに項目追加 |
| 共有ライブラリ化 | `services/_common/` 配下に追加。サービス横断で利用される純関数・クライアントの置き場所 |
| 新フロントコンポーネント | `frontend/src/components/custom/` または `pages/<page>/` 配下 |
| 新ドキュメント | `docs/` 配下、命名規則 `NN_<topic>.md`（NN = 連番） |

新サービス追加チェックリスト（README 等にも記載予定）:

- [ ] `services/<name>/` ディレクトリ作成
- [ ] `main.py`, `api.py` 雛形作成
- [ ] `services/requirements.txt` に依存追加
- [ ] `gateway/routes.py` に prefix 追加
- [ ] `start.ps1` に起動行追加
- [ ] `scripts/healthcheck.py` の TARGETS に追加
- [ ] `frontend/src/api/<name>.ts` でクライアント追加
- [ ] `docs/03_api_specification.md` にエンドポイント追記

---

## 12. 完成後のディレクトリツリー（リファレンス）

§4 のツリーを正準とする。新規追加・改名時は本ドキュメントを必ず更新する。

更新責任:
- 新サービス追加時: 追加した PR/コミットで本ドキュメントの §4・§5 を更新
- ディレクトリ改名時: 本ドキュメント全章および `06_deployment.md` の起動コマンドを併せて更新

---

（本ドキュメントここまで）
