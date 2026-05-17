using System.Collections.Concurrent;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;
using Fortnite_Replay_Parser_GUI;

var builder = WebApplication.CreateBuilder(args);

// SystemInfoHelper の初期化（PowerShell Get-ComputerInfo をバックグラウンドで実行）
SystemInfoHelper.InitializeAsync();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

// --- CORS (dev only: Vite on 5173 + Gateway on 8080) ---
// 本番ではフロントは Gateway 経由で配信するため Gateway 側オリジンのみで十分だが、
// 開発時の直接疎通用に localhost:5173 も許可する。
app.Use(async (ctx, next) =>
{
    var origin = ctx.Request.Headers["Origin"].ToString();
    if (origin == "http://localhost:5173" || origin == "http://127.0.0.1:5173" ||
        origin == "http://localhost:8080" || origin == "http://127.0.0.1:8080")
    {
        ctx.Response.Headers["Access-Control-Allow-Origin"] = origin;
        ctx.Response.Headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS";
        ctx.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
    }
    if (ctx.Request.Method == "OPTIONS")
    {
        ctx.Response.StatusCode = 204;
        return;
    }
    await next();
});

// --- セッション管理 ---
// アップロードされたリプレイデータをセッション ID で管理する
var sessions = new ConcurrentDictionary<string, ReplaySession>();

// --- /health: Gateway の集約ヘルスチェック用 ---
app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    service = "replay_parser",
    ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
}));

// --- GET /api/replays: 設定されたリプレイディレクトリ内の .replay を一覧 ---
// replays.dir は ~/.fortnite-suite/config.json > replays.dir から読む。
// 未設定の場合は Fortnite のデフォルトパスにフォールバック。
app.MapGet("/api/replays", () =>
{
    string dir = ResolveReplaysDir();
    if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir))
    {
        return Results.Ok(new { dir, replays = Array.Empty<object>() });
    }

    var files = new DirectoryInfo(dir)
        .GetFiles("*.replay", SearchOption.TopDirectoryOnly)
        .OrderByDescending(f => f.LastWriteTime)
        .Select(f => new
        {
            fileName = f.Name,
            fullPath = f.FullName,
            sizeBytes = f.Length,
            modifiedAt = f.LastWriteTime.ToString("o")
        })
        .ToList();

    return Results.Ok(new { dir, replays = files });
});

// --- POST /api/replays/parse: ディスク上の .replay をパースしてセッションを作る ---
// Body: { "fullPath": "C:\\path\\to\\xxx.replay" }
// Security: パスは replays.dir 配下に限定（ディレクトリトラバーサル防止）。
app.MapPost("/api/replays/parse", async (ParseFromDiskRequest req) =>
{
    if (string.IsNullOrWhiteSpace(req.FullPath))
    {
        return Results.BadRequest(new { error = "fullPath が空です。" });
    }

    string dir = ResolveReplaysDir();
    string normalized;
    try
    {
        normalized = Path.GetFullPath(req.FullPath);
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = $"パス解決に失敗: {ex.Message}" });
    }

    if (!string.IsNullOrEmpty(dir))
    {
        string normalizedDir = Path.GetFullPath(dir);
        if (!normalized.StartsWith(normalizedDir, StringComparison.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new { error = "replays.dir 外のパスは指定できません。" });
        }
    }
    if (!File.Exists(normalized))
    {
        return Results.NotFound(new { error = "ファイルが見つかりません。" });
    }

    try
    {
        // ディスク上のファイルを直接解析（コピーせず、tempFilePath は空扱い）
        var helper = new FortniteReplayHelper(normalized);
        var players = helper.GetAllPlayersInReplay()
            .OrderBy(p => p.PlayerName)
            .Select((p, idx) => new
            {
                index = idx,
                label = $"{p.PlayerName}: {p.PlayerId} - {(p.IsBot ? "bot" : "human")}",
                playerId = p.PlayerId,
                playerName = p.PlayerName,
                isBot = p.IsBot
            })
            .ToList();

        var sessionId = Guid.NewGuid().ToString("N");
        // tempFilePath を空にして、DELETE 時にディスク上の元ファイルを削除しないようにする
        sessions[sessionId] = new ReplaySession(helper, string.Empty);

        return Results.Ok(new
        {
            sessionId,
            players,
            fileName = Path.GetFileName(normalized),
            fullPath = normalized
        });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = $"リプレイファイルの読み込みに失敗しました: {ex.Message}" });
    }
});

// POST /api/upload — .replay ファイルをアップロードし、プレイヤー一覧を返す
app.MapPost("/api/upload", async (HttpRequest request) =>
{
    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("replayFile");
    if (file == null || file.Length == 0)
    {
        return Results.BadRequest(new { error = "replayFile が指定されていません。" });
    }

    // アップロードされたファイルを一時ファイルに保存
    var tempPath = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid()}.replay");
    try
    {
        using (var stream = new FileStream(tempPath, FileMode.Create))
        {
            await file.CopyToAsync(stream);
        }

        var helper = new FortniteReplayHelper(tempPath);
        var players = helper.GetAllPlayersInReplay()
            .OrderBy(p => p.PlayerName)
            .Select((p, idx) => new
            {
                index = idx,
                label = $"{p.PlayerName}: {p.PlayerId} - {(p.IsBot ? "bot" : "human")}",
                playerId = p.PlayerId,
                playerName = p.PlayerName,
                isBot = p.IsBot
            })
            .ToList();

        var sessionId = Guid.NewGuid().ToString("N");
        sessions[sessionId] = new ReplaySession(helper, tempPath);

        return Results.Ok(new { sessionId, players });
    }
    catch (Exception ex)
    {
        // 失敗した場合、一時ファイルを削除
        if (File.Exists(tempPath)) File.Delete(tempPath);
        return Results.BadRequest(new { error = $"リプレイファイルの読み込みに失敗しました: {ex.Message}" });
    }
});

// POST /api/result — 選択したプレイヤーとオフセットでマッチ結果データを返す（フロントエンドで Mustache レンダリング）
app.MapPost("/api/result", async (ParseRequest req) =>
{
    if (!sessions.TryGetValue(req.SessionId, out var session))
    {
        return Results.NotFound(new { error = "セッションが見つかりません。リプレイファイルを再度アップロードしてください。" });
    }

    var players = session.Helper.GetAllPlayersInReplay()
        .OrderBy(p => p.PlayerName)
        .ToList();

    FortniteReplayReader.Models.PlayerData? selectedPlayer = null;
    if (req.PlayerIndex >= 0 && req.PlayerIndex < players.Count)
    {
        selectedPlayer = players[req.PlayerIndex];
    }

    var data = await session.Helper.BuildResultDataAsync(selectedPlayer, req.Offset);
    return Results.Ok(data);
});

// POST /api/replay-to-json — サーバ間呼び出し用。ディスク上の .replay を JSON フルダンプで返す。
// Body: { "replayPath": "C:\\...\\UnsavedReplay-....replay" }
// セッションを作らない（map_api / suite_core 向け）。
app.MapPost("/api/replay-to-json", async (HttpRequest request) =>
{
    ReplayToJsonRequest? req;
    try
    {
        req = await JsonSerializer.DeserializeAsync<ReplayToJsonRequest>(
            request.Body,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = $"JSON 解析に失敗: {ex.Message}" });
    }
    if (req == null || string.IsNullOrWhiteSpace(req.ReplayPath))
    {
        return Results.BadRequest(new { error = "replayPath が空です。" });
    }

    string dir = ResolveReplaysDir();
    string normalized;
    try
    {
        normalized = Path.GetFullPath(req.ReplayPath);
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = $"パス解決に失敗: {ex.Message}" });
    }

    if (!string.IsNullOrEmpty(dir))
    {
        string normalizedDir = Path.GetFullPath(dir);
        if (!normalized.StartsWith(normalizedDir, StringComparison.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new { error = "replays.dir 外のパスは指定できません。" });
        }
    }
    if (!File.Exists(normalized))
    {
        return Results.NotFound(new { error = "ファイルが見つかりません。" });
    }

    try
    {
        var helper = new FortniteReplayHelper(normalized);
        var replayData = helper.GetReplayData();
        var jsonOptions = new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
            NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals,
        };
        var jsonBytes = JsonSerializer.SerializeToUtf8Bytes(replayData, jsonOptions);
        return Results.File(jsonBytes, "application/json");
    }
    catch (Exception ex)
    {
        return Results.UnprocessableEntity(new { error = $"リプレイファイルの読み込みに失敗しました: {ex.Message}" });
    }
});

// GET /api/export/{sessionId} — リプレイデータの JSON エクスポート（ダウンロード）
app.MapGet("/api/export/{sessionId}", (string sessionId) =>
{
    if (!sessions.TryGetValue(sessionId, out var session))
    {
        return Results.NotFound(new { error = "セッションが見つかりません。" });
    }

    var jsonOptions = new JsonSerializerOptions
    {
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals,
        WriteIndented = true
    };
    var jsonBytes = JsonSerializer.SerializeToUtf8Bytes(session.Helper.GetReplayData(), jsonOptions);

    return Results.File(jsonBytes, "application/json", "replay.json");
});

// DELETE /api/session/{sessionId} — セッションを削除してリソースを解放
app.MapDelete("/api/session/{sessionId}", (string sessionId) =>
{
    if (sessions.TryRemove(sessionId, out var session))
    {
        // tempFilePath が空の場合はディスク上の元ファイルなので削除しない
        if (!string.IsNullOrEmpty(session.TempFilePath) && File.Exists(session.TempFilePath))
        {
            File.Delete(session.TempFilePath);
        }
    }
    return Results.Ok();
});

app.Run($"http://localhost:12345");

// --- ヘルパ関数 ---

// ~/.fortnite-suite/config.json から replays.dir を解決する。
// 未設定なら Windows のデフォルトパスを返す。
static string ResolveReplaysDir()
{
    try
    {
        string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string configPath = Path.Combine(home, ".fortnite-suite", "config.json");
        if (File.Exists(configPath))
        {
            using var fs = File.OpenRead(configPath);
            using var doc = JsonDocument.Parse(fs);
            if (doc.RootElement.TryGetProperty("replays", out var replays)
                && replays.TryGetProperty("dir", out var dirProp))
            {
                string? configured = dirProp.GetString();
                if (!string.IsNullOrWhiteSpace(configured))
                {
                    return configured;
                }
            }
        }
    }
    catch
    {
        // 設定読込失敗時はデフォルトにフォールバック
    }
    // Fortnite のデフォルトリプレイ保存先（Windows）
    string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    return Path.Combine(localAppData, "FortniteGame", "Saved", "Demos");
}

// --- 内部型定義 ---

record ReplaySession(FortniteReplayHelper Helper, string TempFilePath);

record ParseRequest(string SessionId, int PlayerIndex, int Offset);

record ParseFromDiskRequest(string FullPath);

record ReplayToJsonRequest(string ReplayPath);
