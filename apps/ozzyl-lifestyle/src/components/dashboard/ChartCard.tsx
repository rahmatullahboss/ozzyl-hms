import { ReactNode } from 'react';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}

export default function ChartCard({ title, subtitle, children, action }: ChartCardProps) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h3>
          {subtitle && <p className="text-sm text-[var(--color-text-muted)]">{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
      <div className="h-64">
        {children}
      </div>
    </div>
  );
}
