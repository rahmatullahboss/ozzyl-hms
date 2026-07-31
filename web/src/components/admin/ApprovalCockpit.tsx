import { Clock } from 'lucide-react';

interface ApprovalCockpitTypeItem {
  type: string;
  label: string;
  count: number;
  percent: number;
}

interface ApprovalCockpitProps {
  totalPending: number;
  todayApproved: number;
  rejectedToday: number;
  pendingPercent: number;
  approvedPercent: number;
  rejectedPercent: number;
  pendingValueLabel: string;
  highRiskCount: number;
  typeBreakdown: ApprovalCockpitTypeItem[];
  sessionProgress: number;
  resolvedCount: number;
  remainingCount: number;
  nextActionLabel: string;
  onReviewQueue: () => void;
  onTypeSelect: (type: string) => void;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export default function ApprovalCockpit({
  totalPending,
  todayApproved,
  rejectedToday,
  pendingPercent,
  approvedPercent,
  rejectedPercent,
  pendingValueLabel,
  highRiskCount,
  typeBreakdown,
  sessionProgress,
  resolvedCount,
  remainingCount,
  nextActionLabel,
  onReviewQueue,
  onTypeSelect,
}: ApprovalCockpitProps) {
  const safePendingPercent = clampPercent(pendingPercent);
  const safeApprovedPercent = clampPercent(approvedPercent);
  const safeRejectedPercent = clampPercent(rejectedPercent);
  const safeSessionProgress = clampPercent(sessionProgress);
  const distribution = typeBreakdown.length > 0
    ? typeBreakdown
    : [{ type: 'standard', label: 'Standard', count: totalPending, percent: 100 }];

  return (
    <div className="grid gap-4 xl:grid-cols-[1.05fr_1.35fr_1fr]">
      <section className="rounded-3xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Approval Status</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Queue health at a glance</p>
          </div>
          <span className="rounded-full bg-[var(--color-primary-light)] px-2 py-1 text-xs font-semibold text-[var(--color-primary)]">{safePendingPercent}% pending</span>
        </div>
        <div className="mt-4 flex items-center gap-5">
          <div
            className="relative h-28 w-28 shrink-0 rounded-full"
            style={{
              background: `conic-gradient(#f59e0b 0 ${safePendingPercent}%, #10b981 ${safePendingPercent}% ${safePendingPercent + safeApprovedPercent}%, #ef4444 ${safePendingPercent + safeApprovedPercent}% ${safePendingPercent + safeApprovedPercent + safeRejectedPercent}%, #e5e7eb ${safePendingPercent + safeApprovedPercent + safeRejectedPercent}% 100%)`,
            }}
          >
            <div className="absolute inset-4 flex items-center justify-center rounded-full bg-white text-center shadow-inner">
              <div>
                <div className="text-xl font-bold text-[var(--color-text-primary)]">{totalPending} req</div>
                <div className="text-[11px] text-[var(--color-text-muted)]">pending</div>
              </div>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400" />Pending</span><span className="font-semibold">{totalPending} queue</span></div>
            <div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" />Approved today</span><span className="font-semibold">{todayApproved} today</span></div>
            <div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500" />Rejected today</span><span className="font-semibold">{rejectedToday} today</span></div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Pending Value</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Financial exposure by approval type</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-[var(--color-text-primary)]">Value {pendingValueLabel}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{highRiskCount} high risk</div>
          </div>
        </div>
        <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
          {distribution.map((item, index) => (
            <div
              key={item.type}
              className={index === 0 ? 'bg-[var(--color-primary)]' : index === 1 ? 'bg-amber-400' : 'bg-slate-400'}
              style={{ width: `${clampPercent(item.percent)}%` }}
            />
          ))}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {distribution.map((item, index) => (
            <button
              key={item.type}
              type="button"
              onClick={() => onTypeSelect(item.type)}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-left transition hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-primary)]">
                <span className={index === 0 ? 'h-2 w-2 rounded-full bg-[var(--color-primary)]' : index === 1 ? 'h-2 w-2 rounded-full bg-amber-400' : 'h-2 w-2 rounded-full bg-slate-400'} />
                {item.label}
              </div>
              <div className="mt-1 text-xs text-[var(--color-text-muted)]">{item.percent}% • {item.count} request{item.count === 1 ? '' : 's'}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">This Session</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Resolved vs remaining</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{safeSessionProgress}%</span>
        </div>
        <div className="mt-6">
          <div className="h-3 rounded-full bg-[var(--color-surface-muted)]"><div className="h-3 rounded-full bg-emerald-500" style={{ width: `${safeSessionProgress}%` }} /></div>
          <div className="mt-3 flex items-center justify-between text-xs text-[var(--color-text-muted)]"><span>{resolvedCount} resolved</span><span>{remainingCount} remaining</span></div>
        </div>
        <div className="mt-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Next best action</div>
          <div className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">{nextActionLabel}</div>
          <button type="button" onClick={onReviewQueue} className="btn-secondary mt-3 w-full justify-center text-sm">
            <Clock className="h-4 w-4" /> Review queue
          </button>
        </div>
      </section>
    </div>
  );
}
