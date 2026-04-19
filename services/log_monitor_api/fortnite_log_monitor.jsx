import { useState, useEffect, useRef, useCallback } from "react";

// ── Event Detection Patterns ──
const EVENT_PATTERNS = [
  {
    id: "game_launch",
    pattern: /^Log file open/,
    label: "Fortnite 起動",
    icon: "🚀",
    color: "#00d4ff",
    phase: "launch",
  },
  {
    id: "lobby_enter",
    pattern: /LoadMap:.*\/Game\/Maps\/Frontend/,
    label: "ロビーに入った",
    icon: "🏠",
    color: "#a78bfa",
    phase: "lobby",
  },
  {
    id: "matchmaking_start",
    pattern: /StartMatchmaking - Starting matchmaking to bucket/,
    label: "マッチメイキング開始",
    icon: "🔍",
    color: "#fbbf24",
    phase: "matchmaking",
    extract: (line) => {
      const m = line.match(/playlist_(\w+)/);
      return m ? m[1] : null;
    },
  },
  {
    id: "session_found",
    pattern: /Succesfully Found Session/,
    label: "サーバー発見",
    icon: "🎯",
    color: "#34d399",
    phase: "connecting",
    extract: (line) => {
      const m = line.match(/Session \[Id: ([a-f0-9]+)\]/);
      return m ? m[1].substring(0, 8) + "..." : null;
    },
  },
  {
    id: "map_loaded",
    pattern: /LoadMap complete \/Hera_Map/,
    label: "マップロード完了",
    icon: "🗺️",
    color: "#60a5fa",
    phase: "loading",
  },
  {
    id: "phase_warmup",
    pattern: /HandleGamePhaseChanged.*Setup.*Warmup/,
    label: "ウォームアップ開始",
    icon: "⏳",
    color: "#f97316",
    phase: "warmup",
  },
  {
    id: "phase_aircraft",
    pattern: /HandleGamePhaseChanged.*Warmup.*Aircraft/,
    label: "バトルバス搭乗",
    icon: "🚌",
    color: "#f43f5e",
    phase: "aircraft",
  },
  {
    id: "bus_flying",
    pattern: /PhaseStep.*BusFlying/,
    label: "バス発車！",
    icon: "✈️",
    color: "#ec4899",
    phase: "flying",
  },
  {
    id: "phase_safezones",
    pattern: /HandleGamePhaseChanged.*Aircraft.*SafeZones/,
    label: "試合開始（降下可能）",
    icon: "⚔️",
    color: "#ef4444",
    phase: "ingame",
  },
  {
    id: "storm_forming",
    pattern: /PhaseStep.*StormForming/,
    label: "ストーム収縮中",
    icon: "🌀",
    color: "#8b5cf6",
    phase: "ingame",
  },
  {
    id: "match_end",
    pattern: /ClientSendEndBattleRoyaleMatchForPlayer/,
    label: "試合終了",
    icon: "🏁",
    color: "#10b981",
    phase: "post_match",
  },
  {
    id: "return_lobby",
    pattern: /ReturnToMainMenu\(\)/,
    label: "ロビーに戻った",
    icon: "🔙",
    color: "#a78bfa",
    phase: "lobby",
  },
  {
    id: "game_exit",
    pattern: /^Log file closed/,
    label: "Fortnite 終了",
    icon: "⏹️",
    color: "#6b7280",
    phase: "exit",
  },
];

const PHASE_LABELS = {
  idle: "待機中",
  launch: "起動中",
  lobby: "ロビー",
  matchmaking: "マッチメイキング中",
  connecting: "サーバー接続中",
  loading: "マップロード中",
  warmup: "ウォームアップ",
  aircraft: "バトルバス",
  flying: "バス飛行中",
  ingame: "試合中",
  post_match: "試合終了",
  exit: "終了",
};

const PHASE_COLORS = {
  idle: "#4b5563",
  launch: "#00d4ff",
  lobby: "#a78bfa",
  matchmaking: "#fbbf24",
  connecting: "#34d399",
  loading: "#60a5fa",
  warmup: "#f97316",
  aircraft: "#f43f5e",
  flying: "#ec4899",
  ingame: "#ef4444",
  post_match: "#10b981",
  exit: "#6b7280",
};

// ── Timestamp parser ──
function parseTimestamp(line) {
  // Format: [2026.03.21-01.04.44:623]
  const m = line.match(/\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d+)\]/);
  if (m) {
    return `${parseInt(m[4]) + 9}:${m[5]}:${m[6]}`; // UTC+9
  }
  // Format: Log file open, 03/21/26 10:04:01
  const m2 = line.match(/(\d{2}:\d{2}:\d{2})/);
  return m2 ? m2[1] : "";
}

// ── Demo log lines (from the actual Fortnite log) ──
const DEMO_LINES = [
  { delay: 0, line: "Log file open, 03/21/26 10:04:01" },
  { delay: 1500, line: "[2026.03.21-01.04.17:611][665]LogLoad: LoadMap: /Game/Maps/Frontend?Name=Player" },
  { delay: 6000, line: "[2026.03.21-01.04.44:623][150]LogMatchmakingServiceClient: StartMatchmaking - Starting matchmaking to bucket: '51188288:1:ASIA:playlist_nobuildbr_solo'" },
  { delay: 9000, line: "[2026.03.21-01.04.58:727][766]MatchmakingLog: [3070] Succesfully Found Session [Id: 0a3e1924a947416c97a221349a147cdf]. Local user number: 0. Ping: 9999ms" },
  { delay: 11000, line: "[2026.03.21-01.05.07:210][503]LogGlobalStatus: virtual UEngine::LoadMap Load map complete /Hera_Map/Maps/Hera_Terrain" },
  { delay: 13000, line: "[2026.03.21-01.05.10:943][537]LogBattleRoyaleGamePhaseLogic: HandleGamePhaseChanged. OldPhase = EAthenaGamePhase::Setup. NewPhase = EAthenaGamePhase::Warmup" },
  { delay: 18000, line: "[2026.03.21-01.05.54:969][811]LogBattleRoyaleGamePhaseLogic: HandleGamePhaseChanged. OldPhase = EAthenaGamePhase::Warmup. NewPhase = EAthenaGamePhase::Aircraft" },
  { delay: 20000, line: "[2026.03.21-01.06.26:422][722]LogBattleRoyaleGamePhaseLogic: UpdateGamePhaseStep. Phase = EAthenaGamePhase::Aircraft. PhaseStep = EAthenaGamePhaseStep::BusFlying" },
  { delay: 21000, line: "[2026.03.21-01.06.26:464][726]LogBattleRoyaleGamePhaseLogic: HandleGamePhaseChanged. OldPhase = EAthenaGamePhase::Aircraft. NewPhase = EAthenaGamePhase::SafeZones" },
  { delay: 26000, line: "[2026.03.21-01.07.26:482][411]LogBattleRoyaleGamePhaseLogic: UpdateGamePhaseStep. Phase = EAthenaGamePhase::SafeZones. PhaseStep = EAthenaGamePhaseStep::StormForming" },
  { delay: 35000, line: "[2026.03.21-01.09.57:547][705]LogFort: ClientSendEndBattleRoyaleMatchForPlayer_Implementation: 0" },
  { delay: 37000, line: "[2026.03.21-01.10.04:077][245]LogMatchmakingServiceClient: StartMatchmaking - Starting matchmaking to bucket: '51188288:1:ASIA:playlist_nobuildbr_solo'" },
  { delay: 40000, line: "[2026.03.21-01.10.21:117][838]MatchmakingLog: [3070] Succesfully Found Session [Id: d1c31b6954ec41dea44748fa0090157a]. Local user number: 0. Ping: 9999ms" },
  { delay: 42000, line: "[2026.03.21-01.10.29:281][373]LogGlobalStatus: virtual UEngine::LoadMap Load map complete /Hera_Map/Maps/Hera_Terrain" },
  { delay: 44000, line: "[2026.03.21-01.10.32:787][408]LogBattleRoyaleGamePhaseLogic: HandleGamePhaseChanged. OldPhase = EAthenaGamePhase::Setup. NewPhase = EAthenaGamePhase::Warmup" },
  { delay: 48000, line: "[2026.03.21-01.11.01:801][ 26]LogBattleRoyaleGamePhaseLogic: HandleGamePhaseChanged. OldPhase = EAthenaGamePhase::Warmup. NewPhase = EAthenaGamePhase::Aircraft" },
  { delay: 50000, line: "[2026.03.21-01.11.33:571][741]LogBattleRoyaleGamePhaseLogic: UpdateGamePhaseStep. Phase = EAthenaGamePhase::Aircraft. PhaseStep = EAthenaGamePhaseStep::BusFlying" },
  { delay: 51000, line: "[2026.03.21-01.11.33:581][742]LogBattleRoyaleGamePhaseLogic: HandleGamePhaseChanged. OldPhase = EAthenaGamePhase::Aircraft. NewPhase = EAthenaGamePhase::SafeZones" },
  { delay: 58000, line: "[2026.03.21-01.12.44:411][340]LogFort: ClientSendEndBattleRoyaleMatchForPlayer_Implementation: 0" },
  { delay: 62000, line: "[2026.03.21-01.13.03:247][ 89]LogOnlineGame: FortPC::ReturnToMainMenu(), Reason=[]" },
  { delay: 66000, line: "[2026.03.21-01.13.29:016][954]Log file closed, 03/21/26 10:13:29" },
];

// ── Scan noise for raw log feed ──
const NOISE_LINES = [
  "LogStreaming: Display: FlushAsyncLoading: 0 QueuedPackages",
  "LogOnlineTitleFile: MCP: firing queued config update",
  "LogFortSignificance: Display: Set Athena AI Pawn movement budget",
  "LogConfig: Set CVar [[Fort.Scalability.AthenaPlayerBudget]]",
  "LogPakFile: Display: Mounted IoStore container",
  "LogGameFeatures: Display: Game feature transitioned successfully",
  "LogParty: Verbose: previous party matchmaking regionID",
  "LogEOSSDK: LogEOSRTC: RTCAudioLogicRecord",
  "LogHttp: Processing request",
  "LogNet: UChannel packet received",
];

function PulsingDot({ color, size = 10 }) {
  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size }}>
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          backgroundColor: color,
          animation: "pulse-ring 1.5s ease-out infinite",
        }}
      />
      <span
        style={{
          position: "relative",
          display: "block",
          width: size,
          height: size,
          borderRadius: "50%",
          backgroundColor: color,
        }}
      />
    </span>
  );
}

export default function FortniteLogMonitor() {
  const [events, setEvents] = useState([]);
  const [currentPhase, setCurrentPhase] = useState("idle");
  const [matchCount, setMatchCount] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [rawLines, setRawLines] = useState([]);
  const [showRawLog, setShowRawLog] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timeoutsRef = useRef([]);
  const noiseRef = useRef(null);
  const eventListRef = useRef(null);
  const rawLogRef = useRef(null);

  const clearDemo = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    if (noiseRef.current) clearInterval(noiseRef.current);
  }, []);

  const processLine = useCallback((line) => {
    for (const ep of EVENT_PATTERNS) {
      if (ep.pattern.test(line)) {
        const timestamp = parseTimestamp(line);
        const extra = ep.extract ? ep.extract(line) : null;
        const event = {
          id: Date.now() + Math.random(),
          eventId: ep.id,
          label: ep.label,
          icon: ep.icon,
          color: ep.color,
          timestamp,
          extra,
          raw: line.length > 120 ? line.substring(0, 120) + "..." : line,
        };

        setEvents((prev) => [event, ...prev]);
        setCurrentPhase(ep.phase);

        if (ep.id === "matchmaking_start") {
          setMatchCount((prev) => prev + 1);
        }
        return true;
      }
    }
    return false;
  }, []);

  const startDemo = useCallback(() => {
    clearDemo();
    setEvents([]);
    setCurrentPhase("idle");
    setMatchCount(0);
    setRawLines([]);
    setIsRunning(true);

    DEMO_LINES.forEach(({ delay, line }) => {
      const t = setTimeout(() => {
        processLine(line);
        setRawLines((prev) => {
          const next = [{ text: line, isEvent: true, ts: Date.now() }, ...prev];
          return next.slice(0, 100);
        });
      }, delay / speed);
      timeoutsRef.current.push(t);
    });

    // Add noise lines
    noiseRef.current = setInterval(() => {
      const noise = NOISE_LINES[Math.floor(Math.random() * NOISE_LINES.length)];
      const ts = `[2026.03.21-01.${String(Math.floor(Math.random() * 14)).padStart(2, "0")}.${String(Math.floor(Math.random() * 60)).padStart(2, "0")}:${String(Math.floor(Math.random() * 999)).padStart(3, "0")}]`;
      setRawLines((prev) => {
        const next = [{ text: `${ts} ${noise}`, isEvent: false, ts: Date.now() }, ...prev];
        return next.slice(0, 100);
      });
    }, 800 / speed);

    const endTimeout = setTimeout(() => {
      setIsRunning(false);
      clearInterval(noiseRef.current);
    }, 68000 / speed);
    timeoutsRef.current.push(endTimeout);
  }, [clearDemo, processLine, speed]);

  useEffect(() => {
    return () => clearDemo();
  }, [clearDemo]);

  useEffect(() => {
    if (eventListRef.current) {
      eventListRef.current.scrollTop = 0;
    }
  }, [events]);

  const phaseColor = PHASE_COLORS[currentPhase] || "#4b5563";
  const phaseLabel = PHASE_LABELS[currentPhase] || "不明";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        color: "#e2e8f0",
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
        padding: "24px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Noto+Sans+JP:wght@300;400;500;700&display=swap');

        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        @keyframes slide-in {
          from { transform: translateX(-20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 20px rgba(var(--glow-rgb), 0.15); }
          50% { box-shadow: 0 0 40px rgba(var(--glow-rgb), 0.3); }
        }
        @keyframes scan-line {
          0% { top: 0; }
          100% { top: 100%; }
        }
        .event-item { animation: slide-in 0.3s ease-out; }
        .status-card {
          animation: glow-pulse 3s ease-in-out infinite;
        }
        .raw-line-event { color: #fbbf24; }
        .raw-line-noise { color: #4b5563; }
        * { font-family: 'JetBrains Mono', 'Noto Sans JP', monospace; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #111118; }
        ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #3a3a4a; }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>
          <span style={{ color: "#00d4ff" }}>FN</span>
          <span style={{ color: "#6b7280" }}>::</span>
          <span style={{ color: "#e2e8f0" }}>LogMonitor</span>
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 11, color: "#6b7280" }}>速度</span>
          {[1, 2, 5].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                border: speed === s ? "1px solid #00d4ff" : "1px solid #2a2a3a",
                background: speed === s ? "#00d4ff15" : "transparent",
                color: speed === s ? "#00d4ff" : "#6b7280",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {s}x
            </button>
          ))}
          <button
            onClick={() => setShowRawLog(!showRawLog)}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: showRawLog ? "1px solid #fbbf24" : "1px solid #2a2a3a",
              background: showRawLog ? "#fbbf2415" : "transparent",
              color: showRawLog ? "#fbbf24" : "#6b7280",
              fontSize: 11,
              cursor: "pointer",
              marginLeft: 8,
            }}
          >
            RAW LOG
          </button>
          <button
            onClick={isRunning ? () => { clearDemo(); setIsRunning(false); } : startDemo}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              background: isRunning
                ? "linear-gradient(135deg, #ef4444, #dc2626)"
                : "linear-gradient(135deg, #00d4ff, #0099cc)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              marginLeft: 8,
            }}
          >
            {isRunning ? "⏹ 停止" : "▶ デモ再生"}
          </button>
        </div>
      </div>

      {/* Status Bar */}
      <div
        className="status-card"
        style={{
          "--glow-rgb": currentPhase === "ingame" ? "239,68,68" : currentPhase === "lobby" ? "167,139,250" : "0,212,255",
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "16px 24px",
          borderRadius: 12,
          background: `linear-gradient(135deg, ${phaseColor}08, ${phaseColor}15)`,
          border: `1px solid ${phaseColor}30`,
          marginBottom: 20,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Scan line effect */}
        {isRunning && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              height: 1,
              background: `linear-gradient(90deg, transparent, ${phaseColor}40, transparent)`,
              animation: "scan-line 3s linear infinite",
            }}
          />
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isRunning && <PulsingDot color={phaseColor} size={12} />}
          <span style={{ fontSize: 22, fontWeight: 700, color: phaseColor }}>
            {phaseLabel}
          </span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 32 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              試合数
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#e2e8f0" }}>
              {matchCount}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              検出イベント
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#e2e8f0" }}>
              {events.length}
            </div>
          </div>
        </div>
      </div>

      {/* Phase Timeline */}
      <div
        style={{
          display: "flex",
          gap: 2,
          marginBottom: 20,
          padding: "12px 16px",
          borderRadius: 8,
          background: "#111118",
          border: "1px solid #1e1e2e",
          overflowX: "auto",
        }}
      >
        {["launch", "lobby", "matchmaking", "connecting", "loading", "warmup", "aircraft", "ingame", "post_match"].map(
          (phase) => {
            const isActive = currentPhase === phase;
            const isPast = (() => {
              const order = ["idle", "launch", "lobby", "matchmaking", "connecting", "loading", "warmup", "aircraft", "flying", "ingame", "post_match", "exit"];
              return order.indexOf(currentPhase) > order.indexOf(phase);
            })();
            const c = PHASE_COLORS[phase];
            return (
              <div
                key={phase}
                style={{
                  flex: 1,
                  minWidth: 60,
                  padding: "6px 4px",
                  borderRadius: 4,
                  textAlign: "center",
                  fontSize: 9,
                  fontWeight: isActive ? 700 : 400,
                  color: isActive ? c : isPast ? `${c}90` : "#3a3a4a",
                  background: isActive ? `${c}20` : "transparent",
                  border: isActive ? `1px solid ${c}40` : "1px solid transparent",
                  transition: "all 0.3s",
                  whiteSpace: "nowrap",
                }}
              >
                {PHASE_LABELS[phase]}
              </div>
            );
          }
        )}
      </div>

      <div style={{ display: "flex", gap: 16, height: showRawLog ? 520 : "auto" }}>
        {/* Event List */}
        <div
          ref={eventListRef}
          style={{
            flex: 1,
            background: "#111118",
            borderRadius: 12,
            border: "1px solid #1e1e2e",
            padding: 16,
            overflowY: "auto",
            maxHeight: showRawLog ? 520 : 450,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            検出イベント
          </div>

          {events.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#3a3a4a" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📡</div>
              <div style={{ fontSize: 13 }}>「デモ再生」で監視を開始</div>
              <div style={{ fontSize: 11, marginTop: 8, color: "#2a2a3a" }}>
                実際のログファイルを監視する Python スクリプトも生成可能
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {events.map((ev, i) => (
                <div
                  key={ev.id}
                  className="event-item"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: i === 0 ? `${ev.color}10` : "transparent",
                    border: i === 0 ? `1px solid ${ev.color}25` : "1px solid transparent",
                    transition: "all 0.3s",
                  }}
                >
                  <span style={{ fontSize: 18, minWidth: 28, textAlign: "center" }}>
                    {ev.icon}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: ev.color }}>
                      {ev.label}
                    </div>
                    {ev.extra && (
                      <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
                        {ev.extra}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#4b5563", fontVariantNumeric: "tabular-nums" }}>
                    {ev.timestamp}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Raw Log */}
        {showRawLog && (
          <div
            ref={rawLogRef}
            style={{
              flex: 1,
              background: "#0d0d12",
              borderRadius: 12,
              border: "1px solid #1e1e2e",
              padding: 16,
              overflowY: "auto",
              maxHeight: 520,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "#6b7280",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 12,
                fontWeight: 600,
              }}
            >
              RAW LOG STREAM
            </div>
            <div style={{ fontSize: 10, lineHeight: 1.8 }}>
              {rawLines.map((rl, i) => (
                <div
                  key={rl.ts + i}
                  className={rl.isEvent ? "raw-line-event" : "raw-line-noise"}
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    animation: i === 0 ? "slide-in 0.2s ease-out" : undefined,
                  }}
                >
                  {rl.isEvent ? "▸ " : "  "}
                  {rl.text.length > 120 ? rl.text.substring(0, 120) + "…" : rl.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pattern Reference */}
      <div
        style={{
          marginTop: 20,
          padding: 16,
          borderRadius: 12,
          background: "#111118",
          border: "1px solid #1e1e2e",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 12,
            fontWeight: 600,
          }}
        >
          検出パターン一覧
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {EVENT_PATTERNS.map((ep) => (
            <div
              key={ep.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 20,
                border: `1px solid ${ep.color}30`,
                background: `${ep.color}08`,
                fontSize: 11,
              }}
            >
              <span>{ep.icon}</span>
              <span style={{ color: ep.color }}>{ep.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Python Script Reference */}
      <div
        style={{
          marginTop: 16,
          padding: "12px 16px",
          borderRadius: 8,
          background: "#0d0d12",
          border: "1px solid #1a1a2a",
          fontSize: 10,
          color: "#4b5563",
          lineHeight: 1.6,
        }}
      >
        💡 このダッシュボードはデモ再生モードです。実際のリアルタイム監視には Python スクリプト（tail -f 方式）を使用します。
        <br />
        ログファイルパス: <span style={{ color: "#6b7280" }}>%LOCALAPPDATA%\FortniteGame\Saved\Logs\FortniteGame.log</span>
      </div>
    </div>
  );
}
