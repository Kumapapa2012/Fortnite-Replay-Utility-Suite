import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { LogMonitorBanner } from "../components/LogMonitorBanner";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import { useLangPath } from "../hooks/useLangPath";

interface UpstreamHealth {
  status: "ok" | "degraded" | "down";
  port: number;
  error?: string;
}
interface HealthFullResponse {
  status: string;
  upstreams: Record<string, UpstreamHealth>;
}

function StatusDot({ status }: { status: UpstreamHealth["status"] }) {
  const color =
    status === "ok"
      ? "bg-emerald-400"
      : status === "degraded"
        ? "bg-amber-400"
        : "bg-rose-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export function Dashboard() {
  const { t } = useTranslation("pages");
  const { t: tc } = useTranslation();
  const langPath = useLangPath();

  const { data, isLoading, error, refetch, isFetching } =
    useQuery<HealthFullResponse>({
      queryKey: ["health-full"],
      queryFn: () => api.get<HealthFullResponse>("/health/full"),
      refetchInterval: 10_000,
    });

  return (
    <div>
      <PageHeader
        title={t("dashboard.title")}
        subtitle={t("dashboard.subtitle")}
        actions={
          <button
            onClick={() => refetch()}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
          >
            {isFetching ? tc("action.refreshing") : tc("action.refresh")}
          </button>
        }
      />
      <div className="p-6 space-y-4">
        <LogMonitorBanner compact />
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h3 className="text-sm font-medium mb-3">{t("dashboard.serviceStatus")}</h3>
          {isLoading ? (
            <p className="text-sm text-[var(--color-muted)]">{tc("action.loading")}</p>
          ) : error ? (
            <p className="text-sm text-rose-400">{t("dashboard.gatewayError")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-muted)]">
                  <th className="pb-2">{t("dashboard.colService")}</th>
                  <th className="pb-2">{t("dashboard.colPort")}</th>
                  <th className="pb-2">{t("dashboard.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data?.upstreams ?? {}).map(([name, u]) => (
                  <tr key={name} className="border-t border-[var(--color-border)]">
                    <td className="py-2 font-mono text-xs">{name}</td>
                    <td className="py-2 font-mono text-xs">{u.port}</td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-2">
                        <StatusDot status={u.status} />
                        <span className="text-xs">
                          {u.status}
                          {u.error ? ` (${u.error})` : ""}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h3 className="text-sm font-medium mb-2">{t("dashboard.quickLinks")}</h3>
          <ul className="text-sm space-y-1">
            <li>
              <Link className="text-[var(--color-accent)] hover:underline" to={langPath("/replays")}>
                {t("dashboard.viewReplays")}
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
