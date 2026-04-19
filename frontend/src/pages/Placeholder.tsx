import { PageHeader } from "../components/PageHeader";

export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <PageHeader title={title} subtitle={`${phase} で実装予定`} />
      <div className="p-6 text-sm text-[var(--color-muted)]">
        この画面は {phase} で実装されます。
      </div>
    </div>
  );
}
