# Fortnite Replay Suite

Fortnite のリプレイ解析・マップ表示・ログ監視・録画動画のトリミングを **1 つの Web UI** で行う個人向けツール。Windows ローカル専用。

> 📖 **使い方は [ユーザーガイド](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/) を参照してください。** 初回セットアップ・日常の起動 / 停止・各画面の操作方法・トラブルシュートまで、スクリーンショット付きで 7 章構成で解説しています（リポジトリ内のソースは [`docs/user_guide/`](./docs/user_guide/)）。

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
| .NET SDK | 10.0（Replay Parser 起動用） |
| ffmpeg / ffprobe | PATH に通す。[公式ビルド](https://ffmpeg.org/download.html#build-windows) |
| Node.js | 20+（フロント開発時のみ） |
| Fortnite | `.replay` が生成される状態 |

## セットアップと運用

手順はすべて [ユーザーガイド](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/) に集約しています。エンドユーザはまずそちらを参照してください。

| 章 | 内容 |
|---|---|
| [01. セットアップ](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/01_setup.html) | Python venv / npm install / `config.json` / OBS `.env` |
| [02. 起動と停止](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/02_startup.html) | `manage.ps1` / `start.ps1` / `stop.ps1` / `smoke.py` |
| [03. ダッシュボード & 設定](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/03_dashboard_settings.html) | 設定 4 項目 / OBS 自動検出バッジ |
| [04. マッチとリプレイ](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/04_matches_replays.html) | マッチ一覧・詳細、リプレイマップ |
| [05. 動画トリミング](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/05_videos.html) | 候補抽出 / キーフレーム指定 |
| [06. ログ監視](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/06_logs.html) | SSE によるイベント受信 |
| [07. トラブルシュート](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/07_troubleshoot.html) | 切り分けフロー / ログ場所 |

開発者向けの設計仕様は [`docs/`](./docs/) 配下の `01_overview.md` 〜 `08_e2e_manual.md` を参照してください。本番相当の配信は `npm run build` 済みの `frontend/dist` を Gateway が配信する想定（Phase 6 扱い・未実装）。

## 画面

`:lang` は `ja`（日本語）または `en`（English）。`/` にアクセスすると `/ja/` へ自動リダイレクトされます。

| ルート | 用途 |
|---|---|
| `/` | `/ja/` へリダイレクト |
| `/:lang/` | ダッシュボード（概況 + ログ監視バナー） |
| `/:lang/matches` | マッチ一覧（リプレイと録画動画のペア） |
| `/:lang/matches/:id` | マッチ詳細（リプレイ / 動画 / ログを横断） |
| `/:lang/replays` | リプレイファイル一覧 |
| `/:lang/replays/:id` | リプレイ結果レポート（HTML） |
| `/:lang/replays/:id/map` | リプレイマップ（移動軌跡 PNG） |
| `/:lang/videos` | 録画動画の一覧 + トリミング UI |
| `/:lang/logs` | ログ監視のイベントストリーム（SSE） |
| `/:lang/settings` | フォルダ設定 + Epic 表示名 |

## トラブルシュート（抜粋）

詳細は [docs/06_deployment.md §12](./docs/06_deployment.md#12-トラブルシュート) を参照。

| 症状 | 対処 |
|---|---|
| `/ja/matches` が空 | `/ja/settings` で `demos_dir` / `obs_recording_dir` を確認 → 「再スキャン」 |
| `/ja/videos` の `ffmpeg: not found` | PATH に `ffmpeg.exe` / `ffprobe.exe` を追加して全サービス再起動 |
| `/ja/logs` で「ログファイル(not found)」 | `/ja/settings` で `log_path` を明示 → `scripts/stop.ps1` → `start.ps1` |
| 画面から 503 が頻発 | `python scripts/smoke.py` でどのサービスが落ちているか確認 |

## ディレクトリ構成（概要）

```
Integrated_App/
├── README.md              （English 版）
├── README_ja.md           （← 本ファイル・日本語版）
├── docs/                  設計ドキュメント
├── gateway/               FastAPI Gateway
├── services/
│   ├── _common/           ports, paths, logging, global config
│   ├── replay_parser/     .NET 10 ASP.NET Core Minimal API
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

本リポジトリは [MIT License](./LICENSE) で配布されています（Copyright (c) 2026 kumapapa2012）。AS IS basis での提供であり、**作者は不具合修正・サポートの責務を負いません**。商用利用、改変、部分的な切り出しでの再利用も自由ですが、その際は MIT License の規定に従い著作権表示を保持してください。

学術論文・記事・派生プロダクト等で本ソフトウェアに言及する場合は、リポジトリ右サイドバーの **「Cite this repository」** ボタン（[`CITATION.cff`](./CITATION.cff)）をご利用ください。

サードパーティ依存のライセンスは `services/replay_parser/LICENSE.txt`（および移植元の `__Individual_Apps/*/LICENSE.txt` — ローカル参照）を参照。
