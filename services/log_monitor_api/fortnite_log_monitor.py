"""
Fortnite Log Monitor - リアルタイムログ監視スクリプト
=====================================================

FortniteGame.log をリアルタイムで監視し、ゲームイベントを検出します。

使い方:
    python fortnite_log_monitor.py

オプション:
    --log-path    ログファイルのパス（デフォルト: 自動検出）
    --webhook     Discord Webhook URL（指定するとDiscord通知ON）
    --sound       イベント検出時にビープ音を鳴らす
    --csv         イベントログをCSVに保存
    --verbose     検出したログ行の原文も表示
    --obs         OBS WebSocket 連携を有効化（録画自動制御）

設定例:
    # 基本（コンソール表示のみ）
    python fortnite_log_monitor.py

    # Discord通知 + サウンド付き
    python fortnite_log_monitor.py --webhook https://discord.com/api/webhooks/xxx/yyy --sound

    # CSV記録付き
    python fortnite_log_monitor.py --csv match_log.csv

    # OBS録画制御付き（.env に接続情報を記載）
    python fortnite_log_monitor.py --obs

    # ログファイルパスを指定
    python fortnite_log_monitor.py --log-path "C:\\custom\\path\\FortniteGame.log"

依存ライブラリ:
    pip install psutil obsws-python
"""

import os
import re
import sys
import time
import json
import argparse
import csv
import threading
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, Callable

try:
    import psutil
    _PSUTIL_AVAILABLE = True
except ImportError:
    _PSUTIL_AVAILABLE = False


# ─── .env 読み込み ───────────────────────────────────────────

def _load_env_file(path: Optional[str] = None) -> None:
    """スクリプトと同じフォルダの .env を読み込み os.environ に反映する。
    既に環境変数が設定されている場合は上書きしない。"""
    env_path = Path(path) if path else Path(__file__).parent / ".env"
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key not in os.environ:
                    os.environ[key] = value
    except FileNotFoundError:
        pass


# ─── イベント定義 ───────────────────────────────────────────

@dataclass
class EventPattern:
    """検出パターンの定義"""
    event_id: str
    pattern: re.Pattern
    label: str
    icon: str
    phase: str
    extract: Optional[Callable] = None  # ログ行から追加情報を抽出する関数
    cooldown_sec: float = 0.0  # 同一イベントの再発火を抑制する秒数


# 検出パターン一覧（実際のFortniteGame.logから特定済み）
EVENT_PATTERNS: list[EventPattern] = [
    EventPattern(
        event_id="game_launch",
        pattern=re.compile(r"^Log file open"),
        label="Fortnite launched",
        icon="🚀",
        phase="launch",
    ),
    EventPattern(
        event_id="lobby_enter",
        pattern=re.compile(r"LoadMap:.*\/Game\/Maps\/Frontend"),
        label="Entered lobby",
        icon="🏠",
        phase="lobby",
    ),
    EventPattern(
        event_id="matchmaking_start",
        pattern=re.compile(r"StartMatchmaking - Starting matchmaking to bucket"),
        label="Matchmaking started",
        icon="🔍",
        phase="matchmaking",
        extract=lambda line: _extract_playlist(line),
    ),
    EventPattern(
        event_id="session_found",
        pattern=re.compile(r"MatchmakingLog:.*Succesfully Found Session"),
        label="Server found",
        icon="🎯",
        phase="connecting",
        extract=lambda line: _extract_session_id(line),
    ),
    EventPattern(
        event_id="replay_writing",
        pattern=re.compile(r"LogLocalFileReplay: Writing replay to '([^']+)'"),
        label="Replay write started",
        icon="🎬",
        phase="loading",
        extract=lambda line: _extract_replay_dir(line),
        cooldown_sec=10.0,
    ),
    EventPattern(
        event_id="map_loaded",
        pattern=re.compile(r"LoadMap complete \/Hera_Map"),
        label="Map loaded",
        icon="🗺️",
        phase="loading",
    ),
    EventPattern(
        event_id="phase_warmup",
        pattern=re.compile(r"HandleGamePhaseChanged.*Setup.*Warmup"),
        label="Warmup started",
        icon="⏳",
        phase="warmup",
    ),
    EventPattern(
        event_id="phase_aircraft",
        pattern=re.compile(r"HandleGamePhaseChanged.*Warmup.*Aircraft"),
        label="Boarded battle bus",
        icon="🚌",
        phase="aircraft",
    ),
    EventPattern(
        event_id="bus_flying",
        pattern=re.compile(r"PhaseStep.*BusFlying"),
        label="Bus flying",
        icon="✈️",
        phase="flying",
    ),
    EventPattern(
        event_id="phase_safezones",
        pattern=re.compile(r"HandleGamePhaseChanged.*Aircraft.*SafeZones"),
        label="Match started (drop available)",
        icon="⚔️",
        phase="ingame",
    ),
    EventPattern(
        event_id="storm_forming",
        pattern=re.compile(r"PhaseStep.*StormForming"),
        label="Storm forming",
        icon="🌀",
        phase="ingame",
    ),
    EventPattern(
        event_id="storm_holding",
        pattern=re.compile(r"PhaseStep.*StormHolding"),
        label="Storm holding",
        icon="🌀",
        phase="ingame",
    ),
    EventPattern(
        event_id="player_kill",
        pattern=re.compile(r"LogGfeSDK.*Posted Request HLSetVideo"),
        label="Kill!",
        icon="💥",
        phase="ingame",
    ),
    EventPattern(
        event_id="player_death",
        pattern=re.compile(r"LogFortDeathCameraMode.*current view target Controller:(.+)"),
        label="Death",
        icon="💀",
        phase="ingame",
        extract=lambda line: _extract_death_player(line),
    ),
    EventPattern(
        event_id="victory_royale",
        pattern=re.compile(r"LogFortPostScreen.*GetLocalPlayerHasWinningPlacement 1"),
        label="Victory Royale!",
        icon="👑",
        phase="post_match",
        cooldown_sec=60.0,
    ),
    EventPattern(
        event_id="match_end",
        pattern=re.compile(r"ClientSendEndBattleRoyaleMatchForPlayer"),
        label="Match ended",
        icon="🏁",
        phase="post_match",
    ),
    EventPattern(
        event_id="return_lobby",
        pattern=re.compile(r"FortPC::ReturnToMainMenu\(\)"),
        label="Returned to lobby",
        icon="🔙",
        phase="lobby",
    ),
    EventPattern(
        event_id="game_exit",
        pattern=re.compile(r"^Log file closed"),
        label="Fortnite exited",
        icon="⏹️",
        phase="exit",
    ),
]


def _extract_death_player(line: str) -> Optional[str]:
    """死亡したプレイヤー名を抽出"""
    m = re.search(r"current view target Controller:(.+)$", line)
    return m.group(1).strip() if m else None


def _extract_playlist(line: str) -> Optional[str]:
    """プレイリスト名を抽出"""
    m = re.search(r"playlist_(\w+)", line)
    return f"playlist: {m.group(1)}" if m else None


def _extract_session_id(line: str) -> Optional[str]:
    """セッションIDを抽出"""
    m = re.search(r"Session \[Id: ([a-f0-9]+)\]", line)
    return f"session: {m.group(1)[:12]}..." if m else None


def _extract_replay_dir(line: str) -> Optional[str]:
    """リプレイの書き込み先ディレクトリを抽出"""
    m = re.search(r"LogLocalFileReplay: Writing replay to '([^']+)'", line)
    return m.group(1) if m else None


# ─── タイムスタンプ解析 ──────────────────────────────────────

def parse_log_timestamp(line: str) -> Optional[str]:
    """ログ行からタイムスタンプを抽出（JST変換済み）"""
    # [2026.03.21-01.04.44:623] 形式（UTC）
    m = re.search(r"\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d+)\]", line)
    if m:
        h = int(m.group(4)) + 9  # UTC → JST
        if h >= 24:
            h -= 24
        return f"{h:02d}:{m.group(5)}:{m.group(6)}"

    # Log file open, 03/21/26 10:04:01 形式
    m2 = re.search(r"(\d{2}:\d{2}:\d{2})", line)
    return m2.group(1) if m2 else None


def parse_log_datetime(line: str) -> Optional[datetime]:
    """ログ行から datetime を返す（UTC→JST変換済み）。タイムスタンプがない行は None。"""
    # [2026.03.21-01.04.44:623] 形式（UTC）
    m = re.search(r"\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):\d+\]", line)
    if m:
        from datetime import timedelta
        dt_utc = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)),
                          int(m.group(4)), int(m.group(5)), int(m.group(6)))
        return dt_utc + timedelta(hours=9)  # UTC → JST

    # Log file open, 03/21/26 10:04:01 形式（ローカル時刻 = JST）
    m2 = re.search(r"(\d{2})/(\d{2})/(\d{2}) (\d{2}):(\d{2}):(\d{2})", line)
    if m2:
        return datetime(2000 + int(m2.group(3)), int(m2.group(1)), int(m2.group(2)),
                        int(m2.group(4)), int(m2.group(5)), int(m2.group(6)))

    return None


# ─── イベント検出結果 ────────────────────────────────────────

@dataclass
class DetectedEvent:
    """検出されたイベント"""
    event_id: str
    label: str
    icon: str
    phase: str
    timestamp: str        # ログ内タイムスタンプ
    detected_at: str      # 検出時刻（実時刻）
    extra: Optional[str]  # 追加情報
    raw_line: str         # 元のログ行


# ─── OBS リプレイバッファ制御 ────────────────────────────────

class OBSController:
    """OBS WebSocket を通じたリプレイバッファ保存制御。

    OBS は常時リプレイバッファで録画しているものとする。
    スクリプトは SaveReplayBuffer を呼ぶだけで録画の開始・停止は行わない。
    """

    def __init__(self, host: str, port: int, password: str, save_delay: float = 10.0,
                 post_save_callback: Optional[Callable] = None):
        self.host = host
        self.port = port
        self.password = password
        self.save_delay = save_delay
        self._post_save_callback = post_save_callback
        self._client = None
        self._save_timer: Optional[threading.Timer] = None

    def connect(self) -> bool:
        """OBS WebSocket に接続する。"""
        try:
            import obsws_python as obs
            self._client = obs.ReqClient(
                host=self.host, port=self.port, password=self.password
            )
            print(f"  ✅ OBS connected ({self.host}:{self.port})")
            return True
        except Exception as e:
            print(f"  ⚠ OBS connection failed: {e}")
            self._client = None
            return False

    def save_replay(self) -> None:
        """リプレイバッファを即座に保存する。"""
        if not self._client:
            return
        try:
            self._client.save_replay_buffer()
            print("  [OBS] 💾 Replay buffer saved")
            if self._post_save_callback:
                try:
                    self._post_save_callback()
                except Exception as cb_e:
                    print(f"  [OBS] ⚠ post_save_callback error: {cb_e}")
        except Exception as e:
            print(f"  [OBS] ⚠ Replay buffer save error: {e}")

    def schedule_save(self) -> None:
        """save_delay 秒後にリプレイバッファを保存する。既存タイマーはキャンセルする。"""
        self.cancel_save()
        print(f"  [OBS] ⏱️  Replay buffer save scheduled in {self.save_delay:.0f}s")
        self._save_timer = threading.Timer(self.save_delay, self.save_replay)
        self._save_timer.daemon = True
        self._save_timer.start()

    def cancel_save(self) -> None:
        """スケジュール済みの保存タイマーをキャンセルする。"""
        if self._save_timer and self._save_timer.is_alive():
            self._save_timer.cancel()
            self._save_timer = None

    def is_connected(self) -> bool:
        """OBS WebSocket が現在接続中かどうかを確認する。"""
        if not self._client:
            return False
        try:
            # GetVersion は軽量な ping 代わりのリクエスト
            self._client.get_version()
            return True
        except Exception:
            return False

    def reconnect(self) -> bool:
        """切断後に再接続を試みる。"""
        self.cancel_save()
        if self._client:
            try:
                self._client.disconnect()
            except Exception:
                pass
            self._client = None
        return self.connect()

    def close(self) -> None:
        """タイマーをキャンセルし、WebSocket 接続を切断する。"""
        self.cancel_save()
        if self._client:
            try:
                self._client.disconnect()
            except Exception:
                pass


# ─── コールバック（通知・記録） ───────────────────────────────

class EventCallbacks:
    """イベント検出時に実行されるコールバック群"""

    def __init__(
        self,
        enable_sound: bool = False,
        discord_webhook: Optional[str] = None,
        csv_path: Optional[str] = None,
        verbose: bool = False,
        custom_callbacks: Optional[list[Callable]] = None,
        obs: Optional[OBSController] = None,
    ):
        self.enable_sound = enable_sound
        self.discord_webhook = discord_webhook
        self.verbose = verbose
        self.custom_callbacks = custom_callbacks or []
        self.obs = obs

        # CSV初期化
        self._csv_writer = None
        self._csv_file = None
        if csv_path:
            self._csv_file = open(csv_path, "a", newline="", encoding="utf-8")
            self._csv_writer = csv.writer(self._csv_file)
            if os.path.getsize(csv_path) == 0:
                self._csv_writer.writerow([
                    "detected_at", "log_timestamp", "event_id",
                    "label", "phase", "extra", "raw_line"
                ])

    def on_event(self, event: DetectedEvent):
        """イベント検出時のメイン処理"""
        self._console_output(event)

        if self.enable_sound:
            self._beep(event)

        if self.discord_webhook:
            self._send_discord(event)

        if self._csv_writer:
            self._write_csv(event)

        if self.obs:
            self._handle_obs(event)

        for cb in self.custom_callbacks:
            try:
                cb(event)
            except Exception as e:
                print(f"  ⚠ Custom callback error: {e}")

    def _handle_obs(self, event: DetectedEvent) -> None:
        """OBS リプレイバッファ保存制御"""
        if event.event_id == "phase_warmup":
            # 待機島（ウォームアップ）開始 → 即座に保存
            self.obs.save_replay()
        elif event.event_id == "return_lobby":
            # ロビーに戻った → save_delay 秒後に保存
            self.obs.schedule_save()

    def _console_output(self, event: DetectedEvent):
        """コンソール出力"""
        # 色付き出力（ANSIカラー）
        colors = {
            "launch": "\033[96m",      # シアン
            "lobby": "\033[95m",       # マゼンタ
            "matchmaking": "\033[93m", # 黄色
            "connecting": "\033[92m",  # 緑
            "loading": "\033[94m",     # 青
            "warmup": "\033[33m",      # オレンジ
            "aircraft": "\033[91m",    # 赤
            "flying": "\033[35m",      # マゼンタ
            "ingame": "\033[31m",      # 赤
            "post_match": "\033[32m",  # 緑
            "exit": "\033[90m",        # グレー
        }
        reset = "\033[0m"
        color = colors.get(event.phase, "\033[0m")

        ts = event.timestamp or "??:??:??"
        extra_str = f" ({event.extra})" if event.extra else ""
        print(f"  {color}{event.icon} [{ts}] {event.label}{extra_str}{reset}")

        if self.verbose and event.raw_line:
            truncated = event.raw_line[:150] + "..." if len(event.raw_line) > 150 else event.raw_line
            print(f"    \033[90m└─ {truncated}{reset}")

    def _beep(self, event: DetectedEvent):
        """ビープ音"""
        # 重要イベントのみ鳴らす
        important = {
            "matchmaking_start", "phase_safezones",
            "match_end", "return_lobby", "game_exit"
        }
        if event.event_id in important:
            try:
                if sys.platform == "win32":
                    import winsound
                    freq = 800 if event.event_id == "phase_safezones" else 600
                    winsound.Beep(freq, 200)
                else:
                    print("\a", end="", flush=True)
            except Exception:
                pass

    def _send_discord(self, event: DetectedEvent):
        """Discord Webhook通知"""
        try:
            import urllib.request

            phase_colors = {
                "launch": 0x00D4FF,
                "lobby": 0xA78BFA,
                "matchmaking": 0xFBBF24,
                "connecting": 0x34D399,
                "loading": 0x60A5FA,
                "warmup": 0xF97316,
                "aircraft": 0xF43F5E,
                "flying": 0xEC4899,
                "ingame": 0xEF4444,
                "post_match": 0x10B981,
                "exit": 0x6B7280,
            }

            embed = {
                "title": f"{event.icon} {event.label}",
                "color": phase_colors.get(event.phase, 0x6B7280),
                "fields": [
                    {"name": "Phase", "value": event.phase, "inline": True},
                    {"name": "Time", "value": event.timestamp or "N/A", "inline": True},
                ],
                "timestamp": datetime.utcnow().isoformat(),
            }
            if event.extra:
                embed["fields"].append(
                    {"name": "Details", "value": event.extra, "inline": False}
                )

            payload = json.dumps({"embeds": [embed]}).encode("utf-8")
            req = urllib.request.Request(
                self.discord_webhook,
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception as e:
            print(f"  ⚠ Discord notification failed: {e}")

    def _write_csv(self, event: DetectedEvent):
        """CSV記録"""
        self._csv_writer.writerow([
            event.detected_at, event.timestamp, event.event_id,
            event.label, event.phase, event.extra or "",
            event.raw_line[:200] if event.raw_line else "",
        ])
        self._csv_file.flush()

    def close(self):
        """リソース解放"""
        if self._csv_file:
            self._csv_file.close()
        if self.obs:
            self.obs.close()


# ─── ログ監視エンジン ────────────────────────────────────────

class FortniteLogMonitor:
    """Fortniteログファイルのリアルタイム監視"""

    def __init__(self, log_path: str, callbacks: EventCallbacks):
        self.log_path = Path(log_path)
        self.callbacks = callbacks
        self.current_phase = "idle"
        self.match_count = 0
        self.events: list[DetectedEvent] = []
        self._running = False
        self.start_time: datetime = datetime.now()  # スクリプト起動時刻（JST）
        self._last_fired: dict[str, datetime] = {}  # クールダウン管理

    def _detect_event(self, line: str) -> Optional[DetectedEvent]:
        """1行のログからイベントを検出"""
        for ep in EVENT_PATTERNS:
            if ep.pattern.search(line):
                # クールダウン中なら抑制
                if ep.cooldown_sec > 0:
                    last = self._last_fired.get(ep.event_id)
                    if last and (datetime.now() - last).total_seconds() < ep.cooldown_sec:
                        return None
                self._last_fired[ep.event_id] = datetime.now()
                ts = parse_log_timestamp(line)
                extra = ep.extract(line) if ep.extract else None
                return DetectedEvent(
                    event_id=ep.event_id,
                    label=ep.label,
                    icon=ep.icon,
                    phase=ep.phase,
                    timestamp=ts or "",
                    detected_at=datetime.now().strftime("%H:%M:%S"),
                    extra=extra,
                    raw_line=line.strip(),
                )
        return None

    def _process_line(self, line: str):
        """1行を処理"""
        event = self._detect_event(line)
        if event:
            self.current_phase = event.phase
            self.events.append(event)

            if event.event_id == "matchmaking_start":
                self.match_count += 1

            self.callbacks.on_event(event)

    def scan_existing(self):
        """既存のログファイルを一括スキャン（起動時の初回読み込み）。
        スクリプト起動時刻（self.start_time）より前のエントリはスキップする。"""
        if not self.log_path.exists():
            return

        print(f"\n  📂 Scanning existing log: {self.log_path}")
        print(f"  ⏱️  Entries from {self.start_time.strftime('%H:%M:%S')} onwards")
        print(f"  {'─' * 50}")

        skipped = 0
        with open(self.log_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                dt = parse_log_datetime(line)
                if dt is not None and dt < self.start_time:
                    skipped += 1
                    continue
                self._process_line(line)

        print(f"  {'─' * 50}")
        print(f"  📊 Scan complete: {len(self.events)} events detected, {self.match_count} matches")
        if skipped:
            print(f"  ⏭  Skipped {skipped} entries before start time")
        print()

    def watch(self, poll_interval: float = 0.5):
        """
        ログファイルをリアルタイム監視（tail -f 方式）

        Fortnite の再起動によるログファイルのリセット・削除に対応するため、
        外側ループ（セッション単位）と内側ループ（tail -f）の二重構造になっている。
        再帰呼び出しは行わない。

        Args:
            poll_interval: ポーリング間隔（秒）
        """
        self._running = True

        print(f"\n  👁️  Real-time monitoring started")
        print(f"  📄 {self.log_path}")
        print(f"  ⏱️  Poll interval: {poll_interval}s")
        print(f"  🛑 Stop: Ctrl+C")
        print(f"  {'─' * 50}\n")

        # 外側ループ: Fortnite の起動サイクル単位で繰り返す
        while self._running:

            # Fortnite プロセスが起動するまで待機
            if not is_fortnite_running():
                while self._running and not is_fortnite_running():
                    time.sleep(2)
                if not self._running:
                    break
                print(f"  ✅ Fortnite is running\n")

            # ログファイルが出現するまで待機
            while self._running and not self.log_path.exists():
                print(f"  ⏳ Waiting for log file... ({self.log_path})")
                time.sleep(2)

            if not self._running:
                break

            # 内側ループ: ファイルを tail -f で追跡
            with open(self.log_path, "r", encoding="utf-8", errors="replace") as f:
                f.seek(0, 2)  # 末尾から監視開始（既存ログはスキップ）

                while self._running:
                    line = f.readline()
                    if line:
                        self._process_line(line)
                        continue

                    # 新しい行がない場合の処理
                    try:
                        current_pos = f.tell()
                        file_size = self.log_path.stat().st_size
                        if file_size < current_pos:
                            # ファイルが短くなった = ログがリセットされた（稀なケース）
                            print("\n  🔄 Log file reset detected (Fortnite restart)\n")
                            f.seek(0)
                            self.current_phase = "idle"
                            continue
                    except FileNotFoundError:
                        # ファイルが削除された = Fortnite が再起動した
                        print("\n  🔄 Log file deleted (Fortnite restart detected)")
                        self.current_phase = "idle"
                        break  # 内側ループを抜けて外側ループの先頭へ

                    # Fortnite プロセスが終了していれば内側ループを抜ける
                    if not is_fortnite_running():
                        print("\n  ⏹️  Fortnite exited. Waiting for restart...")
                        self.current_phase = "idle"
                        break  # 外側ループの先頭に戻り、次の起動を待つ

                    time.sleep(poll_interval)

    def stop(self):
        """監視を停止"""
        self._running = False


# ─── Fortnite プロセス検出 ───────────────────────────────────

_FORTNITE_EXE = "FortniteClient-Win64-Shipping.exe"


def is_fortnite_running() -> bool:
    """Fortnite プロセスが実行中かどうかを返す。psutil がない場合は常に True。"""
    if not _PSUTIL_AVAILABLE:
        return True
    return any(p.name() == _FORTNITE_EXE for p in psutil.process_iter(["name"]))


# ─── ログファイルパスの自動検出 ──────────────────────────────

def find_fortnite_log() -> Optional[str]:
    """Fortniteのログファイルパスを自動検出"""
    if sys.platform == "win32":
        local_appdata = os.environ.get("LOCALAPPDATA", "")
        if local_appdata:
            path = Path(local_appdata) / "FortniteGame" / "Saved" / "Logs" / "FortniteGame.log"
            if path.exists():
                return str(path)

            # ログフォルダ自体が存在するか（Fortnite未起動でもフォルダはある場合）
            log_dir = Path(local_appdata) / "FortniteGame" / "Saved" / "Logs"
            if log_dir.exists():
                return str(path)  # ファイルはまだないが、パスは正しい

    # macOS / Linux（Wine等）
    home = Path.home()
    candidates = [
        home / "Library" / "Application Support" / "FortniteGame" / "Saved" / "Logs" / "FortniteGame.log",
        home / ".wine" / "drive_c" / "users" / os.getlogin() / "AppData" / "Local" / "FortniteGame" / "Saved" / "Logs" / "FortniteGame.log",
    ]
    for p in candidates:
        if p.exists():
            return str(p)

    return None


def _default_log_path() -> str:
    """ログファイルが未検出のときに使うデフォルトパス（watch() がファイル出現を待機する）。"""
    if sys.platform == "win32":
        local_appdata = os.environ.get("LOCALAPPDATA", "")
        if local_appdata:
            return str(
                Path(local_appdata) / "FortniteGame" / "Saved" / "Logs" / "FortniteGame.log"
            )
    return str(Path.home() / "AppData" / "Local" / "FortniteGame" / "Saved" / "Logs" / "FortniteGame.log")


# ─── セッションサマリー ──────────────────────────────────────

def print_session_summary(monitor: FortniteLogMonitor):
    """セッションのサマリーを表示"""
    print(f"\n  {'═' * 50}")
    print(f"  📊 Session Summary")
    print(f"  {'─' * 50}")
    print(f"  Matches:      {monitor.match_count}")
    print(f"  Events:       {len(monitor.events)}")
    print(f"  Last phase:   {monitor.current_phase}")

    if monitor.events:
        print(f"\n  Event history:")
        for ev in monitor.events:
            extra = f" ({ev.extra})" if ev.extra else ""
            print(f"    {ev.icon} [{ev.timestamp or '??:??:??'}] {ev.label}{extra}")

    print(f"  {'═' * 50}\n")


# ─── メイン ──────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Fortnite Log Monitor - Real-time log monitoring",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python fortnite_log_monitor.py                          # console output only
  python fortnite_log_monitor.py --sound                  # with beep sounds
  python fortnite_log_monitor.py --webhook URL            # Discord notifications
  python fortnite_log_monitor.py --csv matches.csv        # CSV logging
  python fortnite_log_monitor.py --obs                    # OBS recording control
  python fortnite_log_monitor.py --scan-only              # scan existing log only
        """,
    )
    parser.add_argument(
        "--log-path",
        help="Path to FortniteGame.log (default: auto-detect)",
    )
    parser.add_argument(
        "--webhook",
        help="Discord Webhook URL",
    )
    parser.add_argument(
        "--sound",
        action="store_true",
        help="Play a beep sound on event detection",
    )
    parser.add_argument(
        "--csv",
        help="Record events to a CSV file",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Also print the raw matched log line",
    )
    parser.add_argument(
        "--scan-only",
        action="store_true",
        help="Scan existing log only (no real-time monitoring)",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=0.5,
        help="Polling interval in seconds (default: 0.5)",
    )
    parser.add_argument(
        "--obs",
        action="store_true",
        help="Enable OBS WebSocket integration (reads credentials from .env)",
    )

    args = parser.parse_args()

    # ── .env 読み込み ──
    _load_env_file()

    # ── ヘッダー ──
    print()
    print("  ┌─────────────────────────────────────────┐")
    print("  │     🎮 Fortnite Log Monitor v1.0        │")
    print("  │     Real-time log monitoring script      │")
    print("  └─────────────────────────────────────────┘")

    # ── ログパス解決 ──
    log_path = args.log_path
    if not log_path:
        log_path = find_fortnite_log()
        if log_path:
            print(f"\n  ✅ Log file found: {log_path}")
        else:
            print("\n  ❌ Log file not found.")
            print("  Specify the path with --log-path.")
            print("  Default path: %LOCALAPPDATA%\\FortniteGame\\Saved\\Logs\\FortniteGame.log")
            sys.exit(1)

    # ── OBS セットアップ ──
    obs_controller = None
    if args.obs:
        host = os.environ.get("OBS_HOST", "localhost")
        port = int(os.environ.get("OBS_PORT", "4455"))
        password = os.environ.get("OBS_PASSWORD", "")
        save_delay = float(os.environ.get("OBS_SAVE_DELAY", "10"))
        obs_controller = OBSController(host, port, password, save_delay)
        if not obs_controller.connect():
            print("  ⚠ OBS connection failed. Continuing without OBS integration.")
            obs_controller = None

    # ── コールバック設定 ──
    callbacks = EventCallbacks(
        enable_sound=args.sound,
        discord_webhook=args.webhook,
        csv_path=args.csv,
        verbose=args.verbose,
        obs=obs_controller,
    )

    # ── モニター起動 ──
    monitor = FortniteLogMonitor(log_path, callbacks)

    try:
        if args.scan_only:
            monitor.scan_existing()
            print_session_summary(monitor)
        else:
            # まず既存ログをスキャンして現在の状態を把握
            monitor.scan_existing()
            # リアルタイム監視開始
            monitor.watch(poll_interval=args.poll_interval)
    except KeyboardInterrupt:
        print("\n\n  🛑 Monitoring stopped")
        print_session_summary(monitor)
    finally:
        callbacks.close()


if __name__ == "__main__":
    main()


# ─── カスタムコールバックの使用例（別スクリプトから使う場合）──

"""
from fortnite_log_monitor import FortniteLogMonitor, EventCallbacks, DetectedEvent

# カスタムコールバック関数
def on_match_start(event: DetectedEvent):
    if event.event_id == "phase_safezones":
        print("★ 試合が始まりました！OBSシーン切り替え等をここで実行")
        # os.system("obs-cli scene switch Gaming")

def on_match_end(event: DetectedEvent):
    if event.event_id == "match_end":
        print("★ 試合が終わりました！")

# セットアップ
callbacks = EventCallbacks(
    enable_sound=True,
    custom_callbacks=[on_match_start, on_match_end],
)

monitor = FortniteLogMonitor(
    log_path=r"C:\\Users\\YOU\\AppData\\Local\\FortniteGame\\Saved\\Logs\\FortniteGame.log",
    callbacks=callbacks,
)

# 監視開始
monitor.watch()
"""
