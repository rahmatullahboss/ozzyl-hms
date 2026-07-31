import { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface KPICardProps {
  title:   string;
  value:   string | number;
  icon?:   ReactNode;
  /** accent color class for the icon background, e.g. "bg-teal-50 text-teal-600" */
  iconBg?: string;
  trend?: {
    value:      number;
    isPositive: boolean;
    label?:     string;   // e.g. "vs last month"
  };
  loading?: boolean;
  /** Stagger index for entry animation delay (0–7) */
  index?: number;
}

export default function KPICard({ title, value, icon, iconBg, trend, loading, index = 0 }: KPICardProps) {

  /* ── Skeleton with shimmer ── */
  if (loading) {
    return (
      <div className="card p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <div className="skeleton h-3.5 w-28 rounded" />
            <div className="skeleton h-8 w-20 rounded mt-3" />
            <div className="skeleton h-3 w-16 rounded" />
          </div>
          <div className="skeleton w-11 h-11 rounded-xl ml-4" />
        </div>
      </div>
    );
  }

  const iconClasses = iconBg ?? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]';
  const delay = `${index * 60}ms`;

  return (
    <div
      className="card p-5 cursor-default group animate-fade-in-up"
      style={{ animationDelay: delay }}
    >
      <div className="flex items-start justify-between gap-3">

        {/* Text */}
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-text-muted)] truncate">{title}</p>
          <p className="mt-2 font-data text-3xl font-bold text-[var(--color-text-primary)] leading-none tracking-tight">
            {value}
          </p>

          {/* Trend */}
          {trend && (
            <span className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${
              trend.isPositive ? 'text-emerald-600' : 'text-red-500'
            }`}>
              {trend.isPositive
                ? <TrendingUp  className="w-3.5 h-3.5" />
                : <TrendingDown className="w-3.5 h-3.5" />}
              {Math.abs(trend.value)}%
              {trend.label && <span className="text-[var(--color-text-muted)] font-normal ml-0.5">{trend.label}</span>}
            </span>
          )}
        </div>

        {/* Icon — hover glow instead of scale to prevent layout shift */}
        {icon && (
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${iconClasses}
              transition-all duration-200
              group-hover:shadow-[0_0_0_4px_rgba(8,145,178,0.12)]
              group-hover:scale-105
            `}
          >
            {icon}
          </div>
        )}
      </div>

      {/* Subtle accent bottom line on hover */}
      <div className="mt-3 h-0.5 rounded-full bg-gradient-to-r from-[var(--color-primary)] to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
}
