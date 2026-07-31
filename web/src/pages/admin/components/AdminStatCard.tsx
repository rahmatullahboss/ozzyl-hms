import type { ReactNode } from 'react';

type Tone = 'default' | 'blue' | 'amber' | 'green' | 'red' | 'purple' | 'cyan';

interface AdminStatCardProps {
  label: ReactNode;
  value: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}

const toneClasses: Record<Tone, string> = {
  default: 'text-[var(--color-text-primary)]',
  blue: 'text-blue-600',
  amber: 'text-amber-600',
  green: 'text-emerald-600',
  red: 'text-red-600',
  purple: 'text-purple-600',
  cyan: 'text-cyan-600',
};

export default function AdminStatCard({ label, value, tone = 'default', icon }: AdminStatCardProps) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-[var(--color-text-muted)]">{label}</p>
        {icon && <span className="shrink-0 text-[var(--color-text-muted)]">{icon}</span>}
      </div>
      <p className={`mt-2 font-data text-2xl font-bold leading-tight ${toneClasses[tone]}`}>{value}</p>
    </div>
  );
}
