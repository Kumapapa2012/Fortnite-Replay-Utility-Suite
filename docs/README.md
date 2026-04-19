# Fortnite Replay Suite – ドキュメント索引

> `Integrated_App/docs/` のエントリポイント。設計仕様一式と、実装フェーズのチェックリストをまとめる。

---

## 1. このディレクトリについて

`docs/` は **Fortnite Replay Suite**（4 つの既存アプリを単一 Web アプリに統合するプロジェクト）の**設計仕様**を格納する。
実装コードは含まない。すべての判断根拠・API 定義・画面設計・起動手順がここに集約されており、新規参画者は本書から読み始めることを想定している。

- 本書（README.md）= **索引 + 実装ロードマップ**
- 個別仕様 = `01_overview.md` 〜 `07_project_structure.md`

---

## 2. ドキュメント索引

| # | ファイル | タイトル | 想定読者 | 推奨タイミング |
|---|---|---|---|---|
| 01 | [01_overview.md](./01_overview.md) | プロジェクト概要 | 全員 | **最初に読む** |
| 02 | [02_existing_apps_analysis.md](./02_existing_apps_analysis.md) | 既存 4 アプリの構造分析 | 既存ロジックを引き継ぐ開発者 | サービス担当アサイン後 |
| 03 | [03_api_specification.md](./03_api_specification.md) | REST/SSE API 仕様 | バックエンド・フロント両方 | API 実装着手前 |
| 04 | [04_gateway_design.md](./04_gateway_design.md) | API Gateway 設計 | Gateway 実装担当 | Phase 0 〜 1 |
| 05 | [05_frontend_design.md](./05_frontend_design.md) | フロントエンド設計 | フロント担当 | Phase 1 着手前 |
| 06 | [06_deployment.md](./06_deployment.md) | 起動・停止・開発フロー | 全員（環境構築時） | 初回セットアップ時 |
| 07 | [07_project_structure.md](./07_project_structure.md) | モノレポのディレクトリ構成 | 全員 | Phase 0 着手前 |
| 08 | [08_e2e_manual.md](./08_e2e_manual.md) | 手動 E2E 動作確認シナリオ | 全員（リリース前） | Phase 6 以降 |
| ‐ | **README.md**（本書） | 索引 + 実装ロードマップ | 全員 | 任意のタイミングで参照 |

---

## 3. はじめて読む人へのおすすめルート

| 知りたいこと | 読む順序 |
|---|---|
| プロジェクトの全体像をつかみたい | **01 → 02** |
| API を実装したい（バックエンド担当） | **03 → 04 → 02（該当アプリ）** |
| フロントを実装したい | **05 → 03 → 01 §4（設計判断）** |
| 環境構築したい | **06 → 07** |
| ディレクトリ構成だけ確認したい | **07** |
| 設計判断の理由を知りたい | **01 §4 → リンク先の詳細** |
| 既存アプリの挙動を再確認したい | **02** |

---

## 4. 実装フェーズ優先順位（チェックリスト）

> 各 Phase は前 Phase の完了を厳密には要求しないが、依存順に進めるのが最短経路。
> チェックボックスは進捗管理用にコピーして使うことを想定。

### Phase 0 — 基盤整備 ✅

- [x] `Integrated_App/` 雛形ディレクトリ作成（[07 §3](./07_project_structure.md)）
- [x] `__Individual_Apps/` から `services/` に物理コピー（[07 §2](./07_project_structure.md)）
- [x] Python 共通 venv 作成 (`../venv/`) と `services/requirements.txt` の集約
- [x] `scripts/start.ps1` / `stop.ps1` / `dev.ps1` / `process_manager.py` 雛形作成（[06 §3](./06_deployment.md)）
- [x] `gateway/` 空 FastAPI 実装 + `/health` エンドポイント（[04 §5](./04_gateway_design.md)）
- [x] `.gitignore` 整備（`.env` / `.venv/` / `logs/` / `.run/` / `dist/` 除外）
- [x] 既存 `__Individual_Apps/fortnite_log_monitor/.env` の **OBS_PASSWORD** を新環境に再投入（手動）
- [x] グローバル設定 `~/.fortnite-suite/config.json` の生成スクリプト

**完了の目安:** `start.ps1` で Gateway だけが起動し、`http://localhost:8080/health` が 200 を返す。

---

### Phase 1 — replay_parser 結線（最初に動く UI） ✅

- [x] `services/replay_parser/` の .NET アプリが port 12345 で単独起動することを確認
- [x] Gateway に `/api/replay-parser/*` ルート追加（[04 §3](./04_gateway_design.md)）
- [x] `process_manager.py` に replay_parser を spawn 対象として追加
- [x] frontend: プロジェクト雛形作成（Vite + React 19 + Tailwind v4 + shadcn/ui 初期化）（[05 §2](./05_frontend_design.md)）
- [x] frontend: 共通レイアウト（サイドバー・ヘッダー・テーマ切替）
- [x] frontend: **Replay 一覧ページ** (`/replays`)
- [x] frontend: **Replay 詳細ページ** (`/replays/:id`) — 既存 HTML レポートを埋め込み表示
- [x] frontend: TanStack Query の fetcher 層で snake_case ↔ camelCase 変換（[05 §6](./05_frontend_design.md)）
- [x] エラー画面（パース失敗時の原因表示 + `.replay` 自体のダウンロード経路）

**完了の目安:** ブラウザから `.replay` を選び、HTML レポートが表示される。

---

### Phase 2 — log_monitor + SSE（リアルタイム機能） ✅

- [x] `services/log_monitor_api/` に FastAPI ラッパ作成（既存 `fortnite_log_monitor.py` を import）
- [x] `/start` `/stop` `/status` REST エンドポイント実装（[03 §3](./03_api_specification.md)）
- [x] `/events` **SSE エンドポイント**実装（14 phase パターンを送出）
- [x] OBS WebSocket 接続失敗時のリトライ + 状態を `/status` に反映
- [x] Gateway の SSE 中継実装（[04 §4](./04_gateway_design.md)）
- [x] frontend: SSE Context（`EventSourceProvider`）を全画面で配信
- [x] frontend: **ダッシュボードのライブバナー**（match_start / match_end / eliminated 等）
- [x] frontend: **イベントログパネル**（直近 N 件のスクロール表示）
- [x] frontend: OBS 接続失敗時のステータス表示

**完了の目安:** Fortnite を起動して試合を始めると、ブラウザにフェーズ通知が即時表示され、OBS 録画が自動 Start/Stop する。

---

### Phase 3 — map_api 統合（ReplayToJson 重複の解消含む） ✅

- [x] `services/replay_parser/` に **JSON エクスポート endpoint** を追加（[03 §2](./03_api_specification.md)）
- [x] `Fortnite_replay_map_project/ReplayToJson.exe` の依存を撤去（旧 exe を呼ばなくする）
- [x] `services/map_api/` 実装 — Pillow による軌跡投影（[02 §4](./02_existing_apps_analysis.md)）
- [x] map_api は replay_parser の JSON エンドポイントを内部で叩く構成に
- [x] Gateway に `/api/map/*` ルート追加
- [x] `assets/` にマップ背景画像を配置（権利関係の確認）
- [x] frontend: **Map ページ** (`/replays/:id/map`) — 生成画像表示・ダウンロード
- [x] frontend: Z 軸グラデーション凡例の表示

**完了の目安:** Replay 詳細から「Map を見る」をクリックして、軌跡画像がブラウザに表示される。

---

### Phase 4 — prepare_upload_api（動画前処理） ✅

- [x] `services/prepare_upload_api/` 実装 — ffprobe で尺取得、ffmpeg でトリミング（[02 §5](./02_existing_apps_analysis.md)）
- [x] 動画一覧 API（OBS 録画フォルダの探索は suite_core 側に集約、prepare_upload は path を受ける）
- [x] サムネイル生成 endpoint（ffmpeg で任意 offset のフレーム抽出）
- [x] frontend: **動画一覧ページ** — サムネ + メタデータ
- [x] frontend: **トリミング UI** — 候補ボタン + I フレーム吸着
- [x] frontend: トリミング後 mp4 のパス表示（`-codec copy` による即時出力）
- [ ] ~~非同期ジョブ + 進捗ポーリング~~ — `-codec copy` が十分高速なため不要と判断

**完了の目安:** UI から動画を選び、開始/終了を指定して「トリミング」を押すと、`dist/` に切り出し済み mp4 が出力されダウンロードできる。

---

### Phase 5 — Match Library（横断機能の仕上げ） ✅

- [x] `services/suite_core/` 実装
  - [x] `.replay` ファイル一覧の収集
  - [x] OBS 録画動画一覧の収集（ffprobe で尺を取得、duration キャッシュ付き）
  - [x] **タイムスタンプによるペアリングロジック**（[03 §6](./03_api_specification.md)）
  - [x] グローバル設定 (`~/.fortnite-suite/config.json`) の読み書き
  - [x] OBS WebSocket `GetRecordDirectory` で起動時に録画フォルダ自動検出
- [x] Gateway に `/api/suite/*` ルート追加
- [x] frontend: **Matches 一覧ページ** (`/matches`) — Match 単位のカード表示
- [x] frontend: **Match 詳細ページ** (`/matches/:id`) — リプレイ・動画を統合表示 + replay_summary 後読み
- [x] frontend: 横断ナビゲーション（Match → Replay / Video）
- [x] frontend: 設定ページ（プレイヤー名・4 パス・OBS 取得元バッジ）

**完了の目安:** Matches ページから 1 試合を選ぶと、HTML レポート・マップ画像・録画動画・試合中ログがすべて 1 画面で確認できる。

---

### Phase 6 — 仕上げ

- [x] **ログ集約**の最終形（`logs/<service>.log` の RotatingFileHandler、5MB × 3 backup）
- [x] **トラブルシュート文書**を [06 §12](./06_deployment.md#12-トラブルシュート) に追記（§12.6〜12.9 で実運用事象を反映）
- [x] **E2E 動作確認シナリオ**を作成（[08_e2e_manual.md](./08_e2e_manual.md)）
- [x] **README**（`Integrated_App/README.md`）にユーザ向け起動手順を整備
- [x] `scripts/smoke.py` ヘルスチェックヘルパ（Gateway 経由 / `--direct` 両対応）
- [ ] パッケージング（必要なら exe 化や zip 配布） — 本人運用のため未対応
- [x] `__Individual_Apps/` は「読み取り専用リファレンス」と README に明記済み

**完了の目安:** 新しいマシンで `start.ps1` 一発で全機能が動作することを、初見の人が再現できる。

---

## 5. 各フェーズの想定工数感（粗）

> あくまで開発者 1 名稼働での目安。並行化・既存ロジックの理解度で大きく変動する。

| Phase | 規模感 | 主な変動要因 |
|---|---|---|
| Phase 0 | 小 | PowerShell / venv 経験の有無 |
| Phase 1 | 中 | フロント雛形の習熟度（Vite + Tailwind v4 + shadcn/ui） |
| Phase 2 | 中〜大 | SSE 実装と OBS 接続のデバッグに時間が取られがち |
| Phase 3 | 中 | ReplayToJson 統合の影響範囲確認 |
| Phase 4 | 中 | ffmpeg 引数のチューニング・UI のスライダ実装 |
| Phase 5 | 大 | Match ペアリングロジックのエッジケース対応 |
| Phase 6 | 小〜中 | 実運用フィードバック量による |

---

## 6. ドキュメント更新ルール

ドキュメントが実装と乖離するとプロジェクトの寿命が縮む。以下のルールを守ること。

| トリガ | 必ず更新するドキュメント |
|---|---|
| 設計判断が変わった | **01 §4 設計判断サマリ** + 該当詳細ドキュメント（両方） |
| 新規サービスを追加した | **03（API）** + **04（Gateway ルート）** + **07（ディレクトリ）** |
| ポート割り当てを変えた | **01 §5.5** + **03** + **04** + **06** |
| API のリクエスト/レスポンス形式を変えた | **03** + **05（フロント側 fetcher）** |
| 起動手順を変えた | **06** |
| 用語が増えた／意味が変わった | **01 §9 用語集** |
| 既存アプリのロジックに踏み込んで変更した | **02** の該当節 |

> 実装 PR には「**docs 更新の有無**」を必ずチェックリストに含めること。

---

## 7. 既知の TODO / 未決事項

| 項目 | 状況 | 備考 |
|---|---|---|
| マップ背景画像の権利確認 | 未対応 | Phase 3 着手前に決着が必要 |
| Fortnite アップデート時の `FortniteReplayReader` 追従方針 | 暫定案あり（[01 §8.4](./01_overview.md)） | 致命破損時の UI フォールバック実装は Phase 1 で対応 |
| OBS 録画フォルダ自動検出のフォールバック詳細 | Phase 4 で確定 | OBS WebSocket `GetRecordDirectory` → config 読み | 
| パッケージング方式（exe 化 / zip / インストーラ） | 未決 | Phase 6 で判断 |
| マルチユーザ対応 | **非ゴール**（[01 §2.4](./01_overview.md)） | 将来要望が出たら別プロジェクトで検討 |

---

> **Tip:** 本リポジトリは現時点では git 管理外（`Integrated_App/` を新規構築中）。Phase 0 完了後に `git init` を行い、`.gitignore` を必ず先にコミットして秘匿情報の混入を防ぐこと。
