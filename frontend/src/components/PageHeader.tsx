import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between border-b border-[var(--color-border)] px-6 py-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle ? (
          <p className="text-xs text-[var(--color-muted)] mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
