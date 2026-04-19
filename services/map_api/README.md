# map_api

Fortnite リプレイの移動軌跡をマップ画像に描画する FastAPI サービス。Integrated_App から HTTP 経由で呼ばれます。

| 項目 | 値 |
|---|---|
| ポート | 8001 |
| エンドポイント | `POST /api/map/render` ほか（[Gateway 経由のルート](../../docs/03_api_specification.md) 参照） |
| 入力 | リクエストボディの `playerId` + リプレイ JSON |
| 出力 | PNG（移動軌跡を描画したマップ画像）|
| 配置先 | `app/main.py`（FastAPI） / `app/renderer.py`（描画ロジック）|

## ファイル構成

```
map_api/
├── app/                   # FastAPI サービス本体
│   ├── main.py
│   └── renderer.py        # build_location_entries / draw_route 等
├── base_params.json       # マップ画像サイズ・座標変換パラメータ
├── map_ja.png             # 日本語版マップ画像
└── map_tool/              # 起動時に最新マップを取得・合成する Node ツール
    └── download_and_combine.js
```

## サービスとしての player_id

`player_id` は **HTTP リクエストボディから受け取ります**（`app/main.py:71` の `playerId` フィールド）。サービス側で固定の設定ファイルを読むことはありません。

統合アプリでは `suite_core` が `~/.fortnite-suite/config.json` の `user_player_id` を保持し、API 呼び出し時に `playerId` として `map_api` に渡します。設計経緯は [docs/01_overview.md D-08](../../docs/01_overview.md) / [docs/07_project_structure.md §4](../../docs/07_project_structure.md) 参照。

## base_params.json

マップ画像のサイズ・ワールド座標 → ピクセル座標の変換パラメータ。サービス起動時に読み込まれます。

```json
{
  "map_image": {
    "path": "map_tool/combined_map.webp",
    "width": 2048,
    "height": 2048
  },
  "world_to_pixel": {
    "scale_x": 0.00682888,
    "scale_y": 0.00673428,
    "world_origin_on_map": { "x": 964, "y": 1014 }
  }
}
```

変換式:
```
pixel_x = scale_x * world_x + world_origin_on_map.x
pixel_y = scale_y * world_y + world_origin_on_map.y
```

シーズン更新等で座標系が変わった場合のみ調整します。

## 描画ルール

- **色**: Z 値（高度）に応じてグラデーション
  - 青 = Z 最小（地上付近）
  - 緑 = Z 平均
  - 赤 = Z 最大（スカイダイブ中など）
- **点**: 通常 2px、始点・終点のみ 10px
- **線**: 前後の点を 1px の線で接続

## 旧 CLI 経路について

統合前は `replay_to_map.py`（Python）+ `ReplayToJson/`（.NET）の CLI ペアで動いていました。統合作業で機能はすべて `app/renderer.py` と `services/replay_parser/`（.NET）に移植済みのため、本リポジトリでは削除しています。経緯は [docs/02_existing_apps_analysis.md](../../docs/02_existing_apps_analysis.md) 参照。
