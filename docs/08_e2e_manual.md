# 08. 手動 E2E 動作確認シナリオ

> Phase 6 の「E2E 動作確認シナリオ」相当。新しいマシン・新しいブランチで一通り触って回帰を検出するための**チェックリスト**。所要 15〜20 分。
>
> 自動テストではなく**目視確認**が前提。スクリーンショットを残す必要はないが、**NG が出た箇所は 06 §12 トラブルシュートに追記する**こと。

---

## 0. 前提

- [ ] Windows 11 + Python 3.11+ + .NET 9 SDK + ffmpeg/ffprobe (`PATH`) + Node.js 20+
- [ ] `services/requirements.txt` を `../venv` に install 済み
- [ ] `frontend/` で `npm install` 済み
- [ ] `~/.fortnite-suite/config.json` が存在（無ければ `python scripts/init_config.py`）
- [ ] Fortnite が過去に 1 試合以上行われ、`demos_dir` に `.replay` が 1 つ以上ある

**テスト対象サービス数: 6**（Gateway + replay_parser + log_monitor_api + map_api + prepare_upload_api + suite_core）

---

## 1. 起動シーケンス

### 1.1 全サービス起動

```powershell
pwsh scripts/start.ps1
```

- [ ] 出力に 6 サービス分の起動行（PID）が出る
- [ ] `logs/` に各サービスの `*.stdout.log` / `*.err.log` が作成される
- [ ] `.run/` に各サービスの PID ファイルが作成される

### 1.2 疎通確認

```powershell
python scripts/smoke.py
```

- [ ] 全 6 行が `[OK ]`、終了コード 0
- [ ] `--direct` モードでも全 `[OK ]`（各サービスが自身のポートに bind できている）

### 1.3 フロント起動（開発時）

```powershell
cd frontend; npm run dev
```

- [ ] `http://localhost:5173` を開く
- [ ] 左サイドバーに 6 リンク（ダッシュボード / マッチ / リプレイ / 動画 / ログ / 設定）
- [ ] コンソールに赤いエラーが出ていない（Vite HMR の黄色 warning は可）

---

## 2. 設定ページ（/settings）

- [ ] `~/.fortnite-suite/config.json` の 4 項目が読み込まれている
- [ ] OBS 録画フォルダの**取得元バッジ**が表示される
  - OBS 起動中: `OBS WebSocket`
  - OBS 停止中: `既定値` or `設定ファイル`
- [ ] `user_player_id` を編集して「保存」→ 「保存しました。」表示 → リロードしても保持
- [ ] 存在しないパスを `demos_dir` に入力して保存 → エラー（422 or 400）が `保存失敗:` に出る

---

## 3. リプレイ系（/replays）

### 3.1 一覧

- [ ] `/replays` を開く → `demos_dir` 配下の `.replay` が並ぶ
- [ ] ファイル名・更新日時・サイズが表示される

### 3.2 詳細（マッチ結果テキスト）

- [ ] 任意のリプレイをクリック → `/replays/:id` に遷移
- [ ] iframe 内にプレーンテキストのマッチ結果（Scriban テンプレート出力）が表示され、改行・空白が保持されている
  - `ReplayDetail.tsx` が `textToPreDoc()` で `<pre>` ラップしている。改行が崩れていたら退行
- [ ] プレイヤードロップダウンは ダークモードで黒背景 + 白文字（`color-scheme: dark` + 明示的 `background-color` が効いているか）
- [ ] 初回は数秒かかる（.NET parser 呼び出し）、2 回目以降は即時（キャッシュ）

### 3.3 マップ

- [ ] 詳細ページから「Map を見る」 → `/replays/:id/map`
- [ ] 背景画像の上に移動軌跡 PNG が重なって表示される
- [ ] Z 軸（高度）グラデーションの凡例が出る
- [ ] 画像保存リンクから PNG をダウンロードできる

---

## 4. マッチライブラリ（/matches）

### 4.1 一覧

- [ ] `/matches` を開く → Replay + Video のペアカードが新しい順に並ぶ
- [ ] 各カードの Badge:
  - Replay のみ: `Replay` バッジ（緑）+ `Video`（灰）
  - 両方あり: `Replay`（緑）+ `Video`（緑）
  - Video のみ: `Replay`（灰）+ `Video`（緑）
- [ ] 右上「再スキャン」ボタン → ローディング → 件数が更新される

### 4.2 詳細

- [ ] カードをクリック → `/matches/:id`
- [ ] 「試合情報」セクションに開始時刻・長さ・人間/Bot 数が出る
  - 人間/Bot 数は replay_parser の JSON を後読みするため、1〜2 秒遅れて埋まる
- [ ] 「📼 リプレイ」セクションに `.replay` のパスと「HTML レポートを開く」ボタン
  - クリック → `/replays/:sessionId` にナビゲート
- [ ] 「🎬 録画動画」セクション（Video がある場合のみ）
  - サムネイル画像が表示される
  - 「動画ページで開く」→ `/videos` にナビゲート

---

## 5. 動画ページ（/videos）

### 5.1 ヘッダ / 動画一覧

- [ ] ページヘッダに `ffmpeg: OK (N-xxxxx)` / `ffprobe: OK (...)` バッジ
  - ffmpeg 未検出時: `FAIL` 赤バッジ + エラーメッセージ
- [ ] 一覧テーブルに mp4/mkv/mov が並ぶ（ファイル名・尺・サイズ・更新日時）

### 5.2 リプレイ選択 → 動画絞り込み → 候補

> Phase 6 で Videos 画面を **リプレイ起点** に反転済み。まず `.replay` を選ぶ、次に対応する動画を選ぶ、という順序。

- [ ] `/videos` を開く → §1: リプレイ選択（新しい順）
- [ ] リプレイを選択 → §2: 自動で `POST /api/prepare-upload/videos-for-replay` が走り、録画フォルダから「その試合を含みうる動画」だけが一覧される
  - ヘッダに `リプレイバッファ 25分` 等の表示。試合時間が長い場合は `duration フィルタ スキップ` の注記
  - 除外された動画は `<details>` で理由つき確認できる
- [ ] 動画を選択 → §3:「オフセット候補を計算」ボタン
- [ ] ボタンクリック → `POST /api/prepare-upload/candidates` → `試合開始` / `Kill #1 @mm:ss 相手名` / `Death ← 相手名` / `試合終了` が並ぶ
  - `config.user_player_id`（`player.epic_display_name`）が設定されていれば、自分が Killer か Victim の試合イベントだけに絞り込まれる
  - 候補が空の場合: 動画と Replay のタイムスタンプが重ならない → メッセージで案内
- [ ] 候補ボタンをクリック → 該当 offset のサムネイルが表示される

### 5.3 キーフレーム + トリミング

- [ ] 候補選択後、「I フレーム検索」→ `±10 秒` の I フレーム候補ボタンが並ぶ
- [ ] 任意の I フレームを選び「トリミング実行」
- [ ] 数秒〜十数秒後（尺による）、出力パスが表示される
- [ ] 出力ファイルがエクスプローラで再生できる（映像と音声が揃っている）

---

## 6. ログ監視（/logs）

### 6.1 状態表示

- [ ] 右上のトグルが OFF で開始
- [ ] `log_path` が未検出なら「ログファイル(未検出)」バナー
- [ ] トグル ON → サービス側で tail 開始、数秒以内にイベントが流れ始める
  - Fortnite 停止中は何も流れない（正常）

### 6.2 SSE 受信（Fortnite 起動中のみ）

- [ ] ロビー投入で `match_start`、試合終了で `match_end` イベントが DOM に追加される
- [ ] トグル OFF → `EventSource` が close、ブラウザ Network タブで `/api/log-monitor/events` が `finished` になる

---

## 7. ダッシュボード（/）

- [ ] 各サービスの稼働状況カードが緑 = 全て reachable
- [ ] ログ監視バナー（Phase 2 実装分）が現れる（ログ監視 ON 時）
- [ ] サイドバーのテーマ切替（下部）で light ↔ dark が切り替わる

---

## 8. 停止シーケンス

```powershell
pwsh scripts/stop.ps1
```

- [ ] 6 サービス分の stop 行 + `.run/*.pid` が削除される
- [ ] `pwsh scripts/status.ps1` で全て `not running`
- [ ] 再度 `python scripts/smoke.py` → 全 `[FAIL]`（Connection refused）

---

## 9. 障害時の挙動確認（任意）

> 壊れた状態でも UI が落ちないか／エラーが出るかを確認する。本番前に軽く。

| シナリオ | 期待挙動 |
|---|---|
| `prepare_upload_api` だけ止める | `/videos` 開いたら「Prepare Upload に接続できません」系の通知、他ページは正常 |
| `~/.fortnite-suite/config.json` を空 `{}` にする | `/settings` で既定値が表示され、保存可能 |
| `ffmpeg.exe` の PATH を外して再起動 | `/videos` ヘッダに `FAIL` バッジ、トリミングボタン disabled |
| `obs_recording_dir` に存在しないパス | `/matches` は Replay のみで埋まる、Video は 0 件 |
| リプレイファイルを途中で削除して `/replays/:id` | 500 + エラーメッセージ、他ページは正常 |

---

## 10. 記録

- テスト実施日 / 実施者 / 所要時間を `logs/e2e_YYYY-MM-DD.md` に残す（任意）
- NG があれば [06 §12](./06_deployment.md#12-トラブルシュート) に症状と対処を追記
- 新規機能の E2E 観点は本ファイルに追記する（実装と E2E チェックは同一 PR で更新）
