import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { InvoiceInspectorResponse } from '../../types/invoiceInspector';

const money = (value: number) => new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'BDT',
  currencyDisplay: 'code',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0));

type Reconciliation = InvoiceInspectorResponse['reconciliation'];

interface ReconciliationStateProps {
  label: string;
  difference: number;
  status: 'reconciled' | 'warning';
}

function ReconciliationState({ label, difference, status }: ReconciliationStateProps) {
  const reconciled = status === 'reconciled';
  const content = reconciled
    ? `${label} reconciled`
    : `${label} differs by ${money(Math.abs(difference))}`;
  return (
    <div
      role={reconciled ? undefined : 'alert'}
      className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${reconciled
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
        : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}
    >
      {reconciled
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="font-semibold">{content}</span>
    </div>
  );
}

export default function InvoiceReconciliationPanel({ reconciliation }: { reconciliation: Reconciliation }) {
  return (
    <section aria-label="Invoice reconciliation" className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Reconciliation</h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Server-calculated checks compare invoice, settlement, and compensation evidence.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <ReconciliationState label="Invoice" difference={reconciliation.invoice.difference} status={reconciliation.invoice.status} />
        <ReconciliationState label="Settlement" difference={reconciliation.settlement.difference} status={reconciliation.settlement.status} />
        <ReconciliationState label="Compensation" difference={reconciliation.compensation.difference} status={reconciliation.compensation.status} />
      </div>
    </section>
  );
}
