import type { ElementType } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: number;
  icon: ElementType;
  trend?: 'up' | 'down' | 'same';
}

export function KpiCard({ label, value, icon: Icon, trend }: KpiCardProps) {
  return (
    <div className="card p-4 flex items-center gap-4 border-l-4 border-l-[var(--color-primary)]">
      <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-[var(--color-primary)]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-2xl font-bold text-[var(--color-text)]">{value}</div>
        <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{label}</div>
      </div>
      {trend && (
        <div className={`text-xs flex items-center gap-0.5 ${trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-500' : 'text-gray-400'}`}>
          {trend === 'up' ? <TrendingUp className="w-3.5 h-3.5" /> : trend === 'down' ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
        </div>
      )}
    </div>
  );
}
