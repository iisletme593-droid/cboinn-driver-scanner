import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0f1626] p-4 flex flex-col gap-1 min-w-0">
      <div className="text-[12px] font-medium text-white/55 truncate">{label}</div>
      <div className="text-2xl font-bold leading-tight" style={{ color: accent ?? '#fff' }}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-white/40 truncate">{hint}</div>}
    </div>
  );
}
