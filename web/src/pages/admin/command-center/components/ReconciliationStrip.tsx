import { AlertTriangle, CheckCircle2, CircleSlash2 } from 'lucide-react';
import { formatCurrency } from '../../../../lib/format';
import type { FinancialReconciliationEnvelope } from '../../../../types/executiveDashboard';

interface Props {
  reconciliation: FinancialReconciliationEnvelope;
}

export default function ReconciliationStrip({ reconciliation }: Props) {
  if (reconciliation.status === 'reconciled') {
    return (
      <div className="flex flex-col gap-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">
        <p className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Reconciled
        </p>
        <p>{reconciliation.detailRowCount.toLocaleString()} detail rows · {reconciliation.detailGrain}</p>
      </div>
    );
  }

  if (reconciliation.status === 'warning') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="alert">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Reconciliation warning
        </p>
        <p className="mt-1 font-data font-semibold">Difference: {formatCurrency(Math.abs(Number(reconciliation.unexplainedDifference ?? 0)))}</p>
        {reconciliation.warnings.map((warning) => <p key={warning} className="mt-1">{warning}</p>)}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200" role="status">
      <p className="flex items-center gap-2 font-semibold">
        <CircleSlash2 className="h-4 w-4" aria-hidden="true" />
        Reconciliation unavailable
      </p>
      {reconciliation.warnings.map((warning) => <p key={warning} className="mt-1">{warning}</p>)}
    </div>
  );
}
