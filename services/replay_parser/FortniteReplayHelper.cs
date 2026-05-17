using Fortnite_Replay_Parser_GUI.Services;
using FortniteReplayReader;
using FortniteReplayReader.Models;
using System.IO;
using System.Net.Http;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;
using Unreal.Core.Models.Enums;

namespace Fortnite_Replay_Parser_GUI
{
    public class FortniteReplayHelper
    {

        // Looking at player data, NPC has TeamIndex 2 and players have 3 or more.
        const int MINIMUM_TEAM_INDEX_FOR_PLAYERS = 3;

        private FortniteReplayReader.Models.FortniteReplay fnReplayData;


        /// <summary>
        /// 指定したリプレイファイルパスからリプレイデータを読み込み、fnReplayDataに格納します。
        /// </summary>
        public FortniteReplayHelper(string fnReplayFilePath)
        {
            var reader = new ReplayReader(parseMode: ParseMode.Full);
            this.fnReplayData = reader.ReadReplay(fnReplayFilePath);
        }

        /// <summary>
        /// リプレイデータオブジェクトを取得します（JSON エクスポート用）。
        /// </summary>
        public FortniteReplay GetReplayData()
        {
            return this.fnReplayData;
        }

        /// <summary>
        /// 数値を順位表記（1st, 2nd, 3rd, ...）の文字列に変換します。
        /// </summary>
        public static string FormNumber(int num)
        {
            if (num <= 0) return num.ToString();
            var sp = "";
            if (num < 10) sp = " ";

            switch (num % 100)
            {
                case 11:
                case 12:
                case 13:
                    return sp + num + "th";
            }

            switch (num % 10)
            {
                case 1:
                    return sp + num + "st";
                case 2:
                    return sp + num + "nd";
                case 3:
                    return sp + num + "rd";
                default:
                    return sp + num + "th";
            }
        }

        /// <summary>
        /// NPCを除外した全プレイヤーのリストを取得します。
        /// </summary>
        public IEnumerable<PlayerData> GetAllPlayersInReplay()
        {
            return GetAllPlayersInReplay_Without_NPCs();
        }

        /// <summary>
        /// NPCを除外した全プレイヤーのリストを取得します（内部用）。
        /// </summary>
        private IEnumerable<PlayerData> GetAllPlayersInReplay_Without_NPCs()
        {
            // Parse Replay File and store it to local member.
            return this.fnReplayData.PlayerData.Where(o => o.TeamIndex >= MINIMUM_TEAM_INDEX_FOR_PLAYERS);
        }

        /// <summary>
        /// リプレイデータをJSON形式で保存します。
        /// </summary>
        public void SaveReplayAsJSON(string replayData_json_path)
        {
            if (string.IsNullOrEmpty(replayData_json_path))
            {
                return;
            }

            try
            {
                using (var sw = new StreamWriter(replayData_json_path, false, System.Text.Encoding.UTF8))
                {
                    var json_options = new JsonSerializerOptions
                    {
                        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
                        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals,
                        WriteIndented = true
                    };
                    var jsonString = JsonSerializer.Serialize(this.fnReplayData, json_options);

                    // JSON データをファイルに書き込み
                    sw.Write(jsonString);
                }
            }
            catch (Exception ex)
            {
                // 必要に応じてログ出力や例外の再スローを行う
                throw new IOException("リプレイデータのJSON保存中にエラーが発生しました。", ex);
            }
        }

        /// <summary>
        /// Fortnite API の SearchCosmeticsByIds を使い、与えられた cosmetics id から表示名を取得します。
        /// （簡易なパーシングを行い、見つからない場合は id を返します）
        /// </summary>
        public async Task<string> GetCosmeticsNameAsync(string cosmeticId, string language = "en")
        {
            if (string.IsNullOrEmpty(cosmeticId)) return "Unknown";

            try
            {
                using var http = new HttpClient() { BaseAddress = new Uri("https://fortnite-api.com/v2/") };
                var api = new FortniteApiClient(http, disposeHttpClient: true);
                var json = await api.SearchCosmeticsByIdsAsync(new List<string> { cosmeticId }, language);
                if (string.IsNullOrEmpty(json)) return cosmeticId;

                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array && data.GetArrayLength() > 0)
                {
                    var item = data[0];
                    return item.GetProperty("name").GetString()??cosmeticId;
                }
            }
            catch
            {
                // APIやパースエラーは無視して id を返す（必要ならログを追加）
            }

            return cosmeticId;
        }

        /// <summary>
        /// マッチ結果をフロントエンドで Mustache レンダリングするための構造化データを返します。
        /// </summary>
        public async Task<ResultData> BuildResultDataAsync(PlayerData? player, int offset)
        {
            var replayData = this.fnReplayData;

            var startTime = replayData.GameData.UtcTimeStartedMatch.HasValue
                ? replayData.GameData.UtcTimeStartedMatch.Value.ToLocalTime()
                : DateTime.Now;
            var startedAt = $"{startTime}";
            var endedAt = $"{startTime.AddMilliseconds(Convert.ToInt32(replayData.Info.LengthInMs))}";
            var matchLength = TimeSpan.FromMilliseconds(replayData.Info.LengthInMs);
            var duration = $"{(int)matchLength.TotalMinutes:D2}:{matchLength.Seconds:D2}";

            var playersExceptNpcs = GetAllPlayersInReplay_Without_NPCs();
            var totalPlayers = playersExceptNpcs.Count();
            var humanPlayers = playersExceptNpcs.Count(o => !o.IsBot);
            var botPlayers = totalPlayers - humanPlayers;

            var os = SystemInfoHelper.GetOS();
            var cpu = SystemInfoHelper.GetCPU();
            var memory = SystemInfoHelper.GetMemory();
            var availableMemory = SystemInfoHelper.GetAvailableMemory();
            var gpu = SystemInfoHelper.GetGPU();
            var resolution = SystemInfoHelper.GetResolution();

            if (player == null || player.PlayerId == null)
            {
                return new ResultData(
                    StartedAt: startedAt, EndedAt: endedAt, Duration: duration,
                    TotalPlayers: totalPlayers, HumanPlayers: humanPlayers, BotPlayers: botPlayers,
                    PlayerName: "", CosmeticsName: "", HumanOrBot: "",
                    IsWinner: false, IsEliminated: false,
                    Placement: 0, PlacementDisplay: "",
                    EliminationCount: 0, Eliminations: [],
                    EliminatedByPlayerName: null, EliminatedByCosmeticsName: null,
                    EliminatedByHumanOrBot: null, EliminatedByTime: null,
                    Os: os, Cpu: cpu, Memory: memory, AvailableMemory: availableMemory,
                    Gpu: gpu, Resolution: resolution
                );
            }

            var cosmeticsName = await GetCosmeticsNameAsync(player.Cosmetics?.Character ?? "Unknown", "ja");
            var humanOrBot = player.IsBot ? "bot" : "human";

            var eliminations = await Task.WhenAll(
                replayData.Eliminations
                    .Where(c => c.Eliminator == player.PlayerId.ToUpper())
                    .Select(async (elim, idx) =>
                    {
                        var killed = replayData.PlayerData.FirstOrDefault(d => d.PlayerId == elim.EliminatedInfo.Id.ToUpper());
                        var killedCosmetics = await GetCosmeticsNameAsync(killed?.Cosmetics?.Character ?? "Unknown", "ja");
                        return new EliminationEntry(
                            Nth: FormNumber(idx + 1),
                            Time: DateTime.ParseExact(elim.Time, "mm:ss", null).AddSeconds(offset).ToString("mm:ss"),
                            PlayerName: killed?.PlayerName ?? "Unknown",
                            CosmeticsName: killedCosmetics,
                            HumanOrBot: (killed?.IsBot ?? false) ? "bot" : "human"
                        );
                    })
                    .ToList()
            );

            var eliminatedElim = replayData.Eliminations
                .FirstOrDefault(c => c.Eliminated == player.PlayerId.ToUpper());

            bool isEliminated = eliminatedElim != null;
            string? eliminatedByPlayerName = null;
            string? eliminatedByCosmeticsName = null;
            string? eliminatedByHumanOrBot = null;
            string? eliminatedByTime = null;

            if (eliminatedElim != null)
            {
                var eliminator = replayData.PlayerData.FirstOrDefault(d => d.PlayerId == eliminatedElim.EliminatorInfo.Id.ToUpper());
                eliminatedByCosmeticsName = await GetCosmeticsNameAsync(eliminator?.Cosmetics?.Character ?? "Unknown", "ja");
                eliminatedByPlayerName = eliminator?.PlayerName ?? "Unknown";
                eliminatedByHumanOrBot = (eliminator?.IsBot ?? false) ? "bot" : "human";
                eliminatedByTime = DateTime.ParseExact(eliminatedElim.Time, "mm:ss", null).AddSeconds(offset).ToString("mm:ss");
            }

            return new ResultData(
                StartedAt: startedAt, EndedAt: endedAt, Duration: duration,
                TotalPlayers: totalPlayers, HumanPlayers: humanPlayers, BotPlayers: botPlayers,
                PlayerName: player.PlayerName, CosmeticsName: cosmeticsName, HumanOrBot: humanOrBot,
                IsWinner: !isEliminated && player.Placement == 1,
                IsEliminated: isEliminated,
                Placement: player.Placement ?? 0, PlacementDisplay: FormNumber(player.Placement ?? 0),
                EliminationCount: eliminations.Length, Eliminations: eliminations,
                EliminatedByPlayerName: eliminatedByPlayerName,
                EliminatedByCosmeticsName: eliminatedByCosmeticsName,
                EliminatedByHumanOrBot: eliminatedByHumanOrBot,
                EliminatedByTime: eliminatedByTime,
                Os: os, Cpu: cpu, Memory: memory, AvailableMemory: availableMemory,
                Gpu: gpu, Resolution: resolution
            );
        }
    }
}
