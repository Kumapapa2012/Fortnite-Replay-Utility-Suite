namespace Fortnite_Replay_Parser_GUI;

public record EliminationEntry(
    string Nth,
    string Time,
    string PlayerName,
    string CosmeticsName,
    string HumanOrBot
);

public record ResultData(
    string StartedAt,
    string EndedAt,
    string Duration,
    int TotalPlayers,
    int HumanPlayers,
    int BotPlayers,
    string PlayerName,
    string CosmeticsName,
    string HumanOrBot,
    bool IsWinner,
    bool IsEliminated,
    int Placement,
    string PlacementDisplay,
    int EliminationCount,
    EliminationEntry[] Eliminations,
    string? EliminatedByPlayerName,
    string? EliminatedByCosmeticsName,
    string? EliminatedByHumanOrBot,
    string? EliminatedByTime,
    string Os,
    string Cpu,
    string Memory,
    string AvailableMemory,
    string Gpu,
    string Resolution
);
