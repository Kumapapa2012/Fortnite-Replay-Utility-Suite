import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../components/PageHeader";
import { ApiError } from "../lib/api";
import { suiteCoreApi, type SuiteConfig } from "../lib/suiteCore";

const errText = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);

function SourceBadge({ source }: { source: SuiteConfig["obsRecordingDirSource"] }) {
  const { t } = useTranslation();
  const label: Record<SuiteConfig["obsRecordingDirSource"], string> = {
    obs_websocket: t("obsSource.obs_websocket"),
    config_file: t("obsSource.config_file"),
    default: t("obsSource.default"),
  };
  const color: Record<SuiteConfig["obsRecordingDirSource"], string> = {
    obs_websocket: "bg-emerald-500/20 text-emerald-300",
    config_file: "bg-sky-500/20 text-sky-300",
    default: "bg-slate-500/20 text-slate-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] ${color[source]}`}>
      {label[source]}
    </span>
  );
}

export function Settings() {
  const { t } = useTranslation("pages");
  const { t: tc } = useTranslation();
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["suite-config"], queryFn: suiteCoreApi.getConfig });
  const [draft, setDraft] = useState<SuiteConfig | null>(null);

  useEffect(() => {
    if (cfg.data && !draft) setDraft(cfg.data);
  }, [cfg.data, draft]);

  const saveMut = useMutation({
    mutationFn: (payload: Partial<SuiteConfig>) => suiteCoreApi.putConfig(payload),
    onSuccess: (saved) => {
      setDraft(saved);
      qc.setQueryData(["suite-config"], saved);
      qc.invalidateQueries({ queryKey: ["matches"] });
    },
  });

  const onField = (key: keyof SuiteConfig) => (v: string) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: v });
  };

  const onSave = () => {
    if (!cfg.data || !draft) return;
    const diff: Partial<SuiteConfig> = {};
    (["userPlayerId", "demosDir", "obsRecordingDir", "logPath", "replayResultTemplate"] as const).forEach((k) => {
      if (draft[k] !== cfg.data![k]) diff[k] = draft[k] as string;
    });
    if (Object.keys(diff).length === 0) return;
    saveMut.mutate(diff);
  };

  return (
    <div>
      <PageHeader
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
      />
      <div className="p-6 space-y-5 max-w-3xl">
        {cfg.isLoading && (
          <p className="text-sm text-[var(--color-muted)]">{tc("action.loading")}</p>
        )}
        {cfg.error && (
          <p className="text-sm text-rose-300">{errText(cfg.error)}</p>
        )}
        {draft && (
          <>
            <Field
              label={t("settings.fieldPlayerId")}
              hint={t("settings.fieldPlayerIdHint")}
              value={draft.userPlayerId}
              onChange={onField("userPlayerId")}
            />
            <Field
              label={t("settings.fieldReplaysDir")}
              hint={t("settings.fieldReplaysDirHint")}
              value={draft.demosDir}
              onChange={onField("demosDir")}
            />
            <Field
              label={t("settings.fieldObsDir")}
              hint={
                <span>
                  {t("settings.fieldObsDirHint")}{" "}
                  <SourceBadge source={draft.obsRecordingDirSource} />
                </span>
              }
              value={draft.obsRecordingDir}
              onChange={onField("obsRecordingDir")}
            />
            <Field
              label={t("settings.fieldLogPath")}
              hint={t("settings.fieldLogPathHint")}
              value={draft.logPath}
              onChange={onField("logPath")}
            />
            <TextareaField
              label={t("settings.fieldResultTemplate")}
              hint={t("settings.fieldResultTemplateHint")}
              value={draft.replayResultTemplate}
              onChange={onField("replayResultTemplate")}
            />

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={onSave}
                disabled={saveMut.isPending}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-xs text-white disabled:opacity-50"
              >
                {saveMut.isPending ? tc("action.saving") : tc("action.save")}
              </button>
              {saveMut.error && (
                <span className="text-xs text-rose-400">
                  {t("settings.saveFailed", { error: errText(saveMut.error) })}
                </span>
              )}
              {saveMut.isSuccess && !saveMut.isPending && (
                <span className="text-xs text-emerald-400">{tc("action.saved")}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium">{label}</label>
      {hint && <p className="text-[11px] text-[var(--color-muted)]">{hint}</p>}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-mono focus:border-[var(--color-accent)] focus:outline-none"
        spellCheck={false}
      />
    </div>
  );
}

function TextareaField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium">{label}</label>
      {hint && <p className="text-[11px] text-[var(--color-muted)]">{hint}</p>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={16}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-mono leading-relaxed focus:border-[var(--color-accent)] focus:outline-none resize-y"
        spellCheck={false}
      />
    </div>
  );
}
