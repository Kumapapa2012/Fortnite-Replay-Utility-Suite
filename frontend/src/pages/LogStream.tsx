import { PageHeader } from "../components/PageHeader";
import { LogMonitorBanner } from "../components/LogMonitorBanner";
import { useLogMonitor } from "../contexts/LogMonitorContext";
import type { StreamedEvent } from "../lib/logMonitor";

function EventRow({ ev }: { ev: StreamedEvent }) {
  if (ev.type === "system") {
    return (
      <tr className="border-t border-[var(--color-border)]">
        <td className="py-1.5 font-mono text-xs text-[var(--color-muted)]">
          {ev.detectedAt}
        </td>
        <td className="py-1.5 text-center">⚙️</td>
        <td className="py-1.5 text-xs text-[var(--color-muted)]">[{ev.kind}]</td>
        <td className="py-1.5 text-xs">{ev.message}</td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-[var(--color-border)]">
      <td className="py-1.5 font-mono text-xs text-[var(--color-muted)]">
        {ev.detectedAt}
      </td>
      <td className="py-1.5 text-center">{ev.icon}</td>
      <td className="py-1.5 text-xs font-mono text-[var(--color-muted)]">
        {ev.phase}
      </td>
      <td className="py-1.5 text-xs">{ev.label}</td>
    </tr>
  );
}

export function LogStream() {
  const { status, events } = useLogMonitor();

  return (
    <div>
      <PageHeader
        title="ログ"
        subtitle="Fortnite ログを監視してリアルタイムにイベント検出"
      />
      <div className="p-6 space-y-4">
        <LogMonitorBanner />

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h3 className="text-sm font-medium mb-3">監視状態</h3>
          {status && (
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-y-1 gap-x-4 text-xs">
              <dt className="text-[var(--color-muted)]">ログファイル</dt>
              <dd className="md:col-span-2 truncate font-mono" title={status.logPath ?? ""}>
                {status.logPath ?? "(未検出)"}
              </dd>
              <dt className="text-[var(--color-muted)]">OBS</dt>
              <dd className="md:col-span-2">
                {status.obsEnabled
                  ? status.obsConnected
                    ? "接続済み"
                    : `未接続${status.obsError ? ` (${status.obsError})` : ""}`
                  : "無効"}
              </dd>
              <dt className="text-[var(--color-muted)]">マッチ数</dt>
              <dd className="md:col-span-2">{status.matchCount}</dd>
            </dl>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">イベントログ</h3>
            <span className="text-xs text-[var(--color-muted)]">{events.length} 件</span>
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              イベントはまだありません。Fortnite を起動すると表示されます。
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-surface)]">
                  <tr className="text-left text-xs text-[var(--color-muted)]">
                    <th className="pb-2 w-24">時刻</th>
                    <th className="pb-2 w-10">‎</th>
                    <th className="pb-2 w-32">フェーズ</th>
                    <th className="pb-2">ラベル</th>
                  </tr>
                </thead>
                <tbody>
                  {[...events].reverse().map((ev, i) => (
                    <EventRow key={`${ev.detectedAt}-${i}`} ev={ev} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
