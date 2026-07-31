import { ReactNode, memo } from 'react';
import { TrendingUp, TrendingDown, Info } from 'lucide-react';

export interface KPICardSubBreakdownItem {
  label: string;
  amount: number;
  direction: 'in' | 'out';
}

export interface KPICardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  /** accent color class for the icon background, e.g. "bg-teal-50 text-teal-600" */
  iconBg?: string;
  trend?: {
    value: number;
    isPositive: boolean;
    label?: string; // e.g. "vs last month"
  };
  loading?: boolean;
  /** Stagger index for entry animation delay (0–7) */
  index?: number;
  onClick?: () => void;
  /** When true, paints the card with the active-state ring. Pair with onClick. */
  active?: boolean;
  ariaLabel?: string;
  detailHint?: string;
  testId?: string;
  /** Compact inline breakdown below the value (e.g. "+৳500 deposit · −৳300 expense"). */
  subBreakdown?: KPICardSubBreakdownItem[];
  /** Tooltip text shown via a small (i) icon next to the title. */
  tooltip?: string;
}

function KPICardBase({
  title,
  value,
  icon,
  iconBg,
  trend,
  loading,
  index = 0,
  onClick,
  active = false,
  ariaLabel,
  detailHint,
  testId,
  subBreakdown,
  tooltip,
}: KPICardProps) {
  /* ── Skeleton with shimmer ── */
  if (loading) {
    return (
      <div className="card min-h-[132px] p-4 sm:p-5" data-testid={testId}>
        <div className="flex items-start justify-between">
          <div className="space-y-3 flex-1">
            <div className="skeleton h-4 w-32 rounded" />
            <div className="skeleton h-9 w-24 rounded" />
            <div className="skeleton h-3 w-20 rounded" />
          </div>
          <div className="skeleton w-12 h-12 rounded-xl ml-4" />
        </div>
      </div>
    );
  }

  const iconClasses = iconBg ?? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]';
  const delay = `${index * 60}ms`;

  const valueText = typeof value === 'number' ? value.toLocaleString() : String(value);

  const clickable = typeof onClick === 'function';
  const className = `card group h-full min-h-[132px] min-w-0 p-4 sm:p-5 animate-fade-in-up ${clickable
    ? `cursor-pointer text-left transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 ${active ? 'ring-2 ring-[var(--color-primary)] shadow-md' : ''}`
    : 'cursor-default'}`;

  // A role="button" wrapper keeps the existing card DOM shape and avoids
  // nesting block card content inside a native button while preserving keyboard access.
  const content = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-4">
        {/* Text */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <p className="line-clamp-2 min-h-[2.25rem] whitespace-normal break-normal text-[0.82rem] font-semibold uppercase tracking-[0.01em] leading-tight text-[var(--color-text-muted)] sm:text-[0.88rem]">
              {title}
            </p>
            {tooltip && (
              <span
                title={tooltip}
                aria-label={tooltip}
                className="inline-flex shrink-0 cursor-help text-slate-400 hover:text-slate-600"
                data-testid={testId ? `${testId}-tooltip` : undefined}
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
          </div>
        </div>

        {/* Icon — hover glow instead of scale to prevent layout shift */}
        {icon && (
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconClasses}
              transition-all duration-200
              group-hover:shadow-[0_0_0_4px_rgba(8,145,178,0.12)]
            `}
          >
            {icon}
          </div>
        )}
      </div>

      <p
        className="mt-3 min-w-0 max-w-full overflow-hidden whitespace-nowrap text-ellipsis font-data text-[clamp(1.45rem,1.65vw,2rem)] font-bold leading-tight tracking-[-0.035em] tabular-nums text-[var(--color-text-primary)]"
        title={valueText}
      >
        {valueText}
      </p>

      {trend && (
        <span className={`mt-3 inline-flex flex-wrap items-center gap-1 text-xs font-medium ${
          trend.isPositive ? 'text-emerald-600' : 'text-red-500'
        }`}>
          {trend.isPositive
            ? <TrendingUp className="w-3.5 h-3.5" />
            : <TrendingDown className="w-3.5 h-3.5" />}
          {Math.abs(trend.value)}%
          {trend.label && <span className="text-[var(--color-text-muted)] font-normal ml-0.5">{trend.label}</span>}
        </span>
      )}

      {subBreakdown && subBreakdown.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] font-medium leading-none" data-testid={testId ? `${testId}-sub-breakdown` : undefined}>
          {subBreakdown.map((item) => {
            const sign = item.direction === 'in' ? '+' : '−';
            const colorClass = item.direction === 'in' ? 'text-emerald-600' : 'text-red-500';
            const formatted = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(item.amount));
            return (
              <span key={item.label} className={colorClass}>
                {sign}৳{formatted} {item.label}
              </span>
            );
          })}
        </div>
      )}

      {detailHint && (
        <span className="mt-3 inline-flex text-xs font-medium text-[var(--color-primary)]">
          {detailHint}
        </span>
      )}

      {/* Subtle accent bottom line on hover */}
      <div className="mt-4 h-0.5 rounded-full bg-gradient-to-r from-[var(--color-primary)] to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </>
  );

  if (clickable) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={className}
        style={{ animationDelay: delay }}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick?.();
          }
        }}
        aria-label={ariaLabel ?? title}
        aria-pressed={active}
        data-testid={testId}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{ animationDelay: delay }}
      data-testid={testId}
    >
      {content}
    </div>
  );
}

export default memo(KPICardBase);
