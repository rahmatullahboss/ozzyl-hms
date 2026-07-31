import { AlertTriangle, CheckCircle2, FlaskConical, PackagePlus, RefreshCw, ShieldAlert } from 'lucide-react';

export type ReagentIssue = {
  id: number;
  reason: string;
  message: string;
  severity: string;
  status: string;
  source_event?: string | null;
  lab_order_id?: number | null;
  lab_order_item_id?: number | null;
  lab_test_id?: number | null;
  created_at?: string | null;
};

export type ReagentReconciliationIssue = {
  lab_order_item_id: number;
  test_name: string;
  status: string;
  status_meaning?: string | null;
  expected_quantity: number;
  consumed_quantity: number;
  consumed_cost: number;
  exception_count: number;
};

function isMissingRecipe(reason: string) {
  return ['missing_test_mapping', 'missing_mapping', 'mapping_missing'].includes(reason);
}

function isStockShortage(reason: string) {
  return ['insufficient_stock', 'missing_stock', 'stock_shortage', 'no_usable_stock'].includes(reason);
}

function isLotProblem(reason: string) {
  return ['qc_failed_lot', 'qc_failed_usable_lot', 'expired_lot', 'blocked_lot', 'lot_not_usable'].includes(reason);
}

export default function ReagentControlIssues({
  exceptions,
  reconciliationRows,
  onOpenRecipes,
  onOpenStock,
  onRetry,
  onReview,
}: {
  exceptions: ReagentIssue[];
  reconciliationRows: ReagentReconciliationIssue[];
  onOpenRecipes: () => void;
  onOpenStock: () => void;
  onRetry: (id: number) => void;
  onReview: (id: number, status: 'resolved' | 'ignored') => void;
}) {
  const openExceptions = exceptions.filter(item => item.status === 'open');
  const missingRecipeCount = openExceptions.filter(item => isMissingRecipe(item.reason)).length;
  const shortageCount = openExceptions.filter(item => isStockShortage(item.reason)).length;
  const lotProblemCount = openExceptions.filter(item => isLotProblem(item.reason)).length;
  const reconciliationCount = reconciliationRows.filter(row => row.status !== 'ok').length;
  const total = openExceptions.length + reconciliationCount;

  return (
    <div
      id="reagent-control-panel-issues"
      role="tabpanel"
      aria-labelledby="reagent-control-tab-issues"
      className="space-y-5"
    >
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
        <h2 className="text-xl font-bold text-[var(--color-text)]">Reagent Issues</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Fix the cause first, then retry the deduction or close the warning with an audit trail.</p>

        {total === 0 ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-emerald-900">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              No reagent issues need action
            </div>
            <p className="mt-1 text-sm">All current deductions and reconciliation checks are clear.</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <div className="flex items-center gap-2"><FlaskConical className="h-4 w-4" aria-hidden="true" /><span className="text-sm font-semibold">Missing recipe</span></div>
              <p className="mt-2 text-2xl font-bold">{missingRecipeCount}</p>
              <button type="button" onClick={onOpenRecipes} className="mt-3 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold shadow-sm">Set up recipe</button>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
              <div className="flex items-center gap-2"><PackagePlus className="h-4 w-4" aria-hidden="true" /><span className="text-sm font-semibold">Stock shortage</span></div>
              <p className="mt-2 text-2xl font-bold">{shortageCount}</p>
              <button type="button" onClick={onOpenStock} className="mt-3 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold shadow-sm">Add stock</button>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-orange-900">
              <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" aria-hidden="true" /><span className="text-sm font-semibold">QC or blocked lot</span></div>
              <p className="mt-2 text-2xl font-bold">{lotProblemCount}</p>
              <button type="button" onClick={onOpenStock} className="mt-3 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold shadow-sm">Review lot</button>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-900">
              <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden="true" /><span className="text-sm font-semibold">Reconciliation mismatch</span></div>
              <p className="mt-2 text-2xl font-bold">{reconciliationCount}</p>
              <p className="mt-3 text-xs">Expected and recorded deduction do not match.</p>
            </div>
          </div>
        )}
      </section>

      {openExceptions.length > 0 && (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
          <h3 className="font-semibold text-[var(--color-text)]">Open deduction warnings</h3>
          <div className="mt-4 space-y-3">
            {openExceptions.map(item => {
              const actionLabel = isMissingRecipe(item.reason)
                ? 'Set up the missing test recipe, then retry.'
                : isStockShortage(item.reason)
                  ? 'Add a usable stock lot, then retry.'
                  : isLotProblem(item.reason)
                    ? 'Review the lot QC, expiry or blocked status, then retry.'
                    : 'Review the source data, correct the cause and retry.';
              return (
                <article key={item.id} className="rounded-xl border border-[var(--color-border)] p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${item.severity === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{item.severity}</span>
                        <span className="text-sm font-semibold text-[var(--color-text)]">{item.message}</span>
                      </div>
                      <p className="mt-2 text-xs text-[var(--color-text-muted)]">{actionLabel}</p>
                      <details className="mt-3 text-xs text-[var(--color-text-muted)]">
                        <summary className="cursor-pointer font-semibold text-[var(--color-text)]">Technical details</summary>
                        <div className="mt-2 space-y-1 rounded-lg bg-[var(--color-bg-secondary)] p-3">
                          <p>Source event: {item.source_event || 'Not recorded'}</p>
                          <p>Order: {item.lab_order_id || '—'} · Item: {item.lab_order_item_id || '—'} · Test: {item.lab_test_id || '—'}</p>
                          <p>Reason code: {item.reason}</p>
                          {item.created_at ? <p>Created: {item.created_at}</p> : null}
                        </div>
                      </details>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      {isMissingRecipe(item.reason) && <button type="button" onClick={onOpenRecipes} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700">Open recipes</button>}
                      {(isStockShortage(item.reason) || isLotProblem(item.reason)) && <button type="button" onClick={onOpenStock} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700">Open stock</button>}
                      <button type="button" aria-label={`Retry deduction for issue ${item.id}`} onClick={() => onRetry(item.id)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry deduction</button>
                      <button type="button" aria-label={`Mark issue ${item.id} resolved`} onClick={() => onReview(item.id, 'resolved')} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">Mark resolved</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {reconciliationCount > 0 && (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
          <h3 className="font-semibold text-[var(--color-text)]">Billing and stock mismatches</h3>
          <div className="mt-4 space-y-3">
            {reconciliationRows.filter(row => row.status !== 'ok').map(row => (
              <div key={row.lab_order_item_id} className="rounded-xl border border-[var(--color-border)] p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-[var(--color-text)]">{row.test_name}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.status_meaning || 'Expected reagent deduction does not match the recorded stock movement.'}</p>
                  </div>
                  <div className="text-sm text-[var(--color-text-muted)]">Expected {row.expected_quantity} · Deducted {row.consumed_quantity}</div>
                </div>
                <details className="mt-3 text-xs text-[var(--color-text-muted)]">
                  <summary className="cursor-pointer font-semibold text-[var(--color-text)]">Technical details</summary>
                  <div className="mt-2 rounded-lg bg-[var(--color-bg-secondary)] p-3">Order item {row.lab_order_item_id} · Cost ৳{Number(row.consumed_cost || 0).toFixed(0)} · Exceptions {row.exception_count}</div>
                </details>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
