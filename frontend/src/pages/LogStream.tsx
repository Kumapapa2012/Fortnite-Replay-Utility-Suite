import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("pages");
  const { status, events } = useLogMonitor();

  return (
    <div>
      <PageHeader
        title={t("logStream.title")}
        subtitle={t("logStream.subtitle")}
      />
      <div className="p-6 space-y-4">
        <LogMonitorBanner />

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h3 className="text-sm font-medium mb-3">{t("logStream.monitorStatus")}</h3>
          {status && (
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-y-1 gap-x-4 text-xs">
              <dt className="text-[var(--color-muted)]">{t("logStream.logFile")}</dt>
              <dd className="md:col-span-2 truncate font-mono" title={status.logPath ?? ""}>
                {status.logPath ?? t("logStream.unknown")}
              </dd>
              <dt className="text-[var(--color-muted)]">{t("logStream.obs")}</dt>
              <dd className="md:col-span-2">
                {status.obsEnabled
                  ? status.obsConnected
                    ? t("logStream.connected")
                    : `${t("logStream.disconnected")}${status.obsError ? ` (${status.obsError})` : ""}`
                  : t("logStream.disabled")}
              </dd>
              <dt className="text-[var(--color-muted)]">{t("logStream.matchCount")}</dt>
              <dd className="md:col-span-2">{status.matchCount}</dd>
            </dl>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">{t("logStream.eventLog")}</h3>
            <span className="text-xs text-[var(--color-muted)]">
              {t("logStream.events", { count: events.length })}
            </span>
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              {t("logStream.noEvents")}
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-surface)]">
                  <tr className="text-left text-xs text-[var(--color-muted)]">
                    <th className="pb-2 w-24">{t("logStream.colTime")}</th>
                    <th className="pb-2 w-10">‎</th>
                    <th className="pb-2 w-32">{t("logStream.colPhase")}</th>
                    <th className="pb-2">{t("logStream.colLabel")}</th>
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
