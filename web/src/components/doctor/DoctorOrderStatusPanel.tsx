import { FlaskConical, Image as ImageIcon } from 'lucide-react';

export interface DoctorOrderStatusItem {
  id: number;
  type: 'lab' | 'imaging';
  label: string;
  orderNo?: string | null;
  invoiceNo?: string | null;
  billingStatus?: string | null;
  status?: string | null;
  total?: number | null;
  orderedAt?: string | null;
  reportReady?: boolean | null;
}

function billingLabel(order: DoctorOrderStatusItem): string {
  if (order.billingStatus === 'paid' || (order.total !== undefined && order.total !== null && Number(order.total) <= 0)) return 'Paid';
  if (order.billingStatus === 'due_approved') return 'Due approved';
  if (order.billingStatus === 'unpaid' || order.billingStatus === 'pending') return 'Billing pending';
  return order.invoiceNo ? 'Bill created' : 'Order created';
}

function billingTone(order: DoctorOrderStatusItem): string {
  const label = billingLabel(order).toLowerCase();
  if (label === 'paid') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (label.includes('pending')) return 'bg-amber-50 text-amber-700 border-amber-100';
  if (label.includes('due')) return 'bg-sky-50 text-sky-700 border-sky-100';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function clinicalStatusLabel(order: DoctorOrderStatusItem): string {
  if (order.reportReady) return 'Report ready';
  const status = String(order.status ?? '').toLowerCase();
  if (!status || status === 'pending') return 'Pending';
  if (status === 'sample_collected') return 'Sample collected';
  if (status === 'in_progress') return 'In progress';
  if (status === 'completed' || status === 'reported') return 'Report ready';
  if (status === 'scanned') return 'Scanned';
  return status.replace(/_/g, ' ');
}

function clinicalStatusTone(order: DoctorOrderStatusItem): string {
  const label = clinicalStatusLabel(order).toLowerCase();
  if (label.includes('ready') || label.includes('completed')) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (label.includes('progress') || label.includes('collected') || label.includes('scanned')) return 'bg-blue-50 text-blue-700 border-blue-100';
  if (label.includes('cancel')) return 'bg-red-50 text-red-700 border-red-100';
  return 'bg-amber-50 text-amber-700 border-amber-100';
}

export function DoctorOrderStatusPanel({
  orders,
  loading = false,
  title = 'Order status',
}: {
  orders: DoctorOrderStatusItem[];
  loading?: boolean;
  title?: string;
}) {
  if (!loading && orders.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</p>
        {loading && <span className="text-[11px] text-[var(--color-text-muted)]">Refreshing…</span>}
      </div>
      <div className="mt-2 space-y-2">
        {orders.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">No order placed yet.</p>
        ) : orders.map((order) => (
          <div key={`${order.type}-${order.id}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]">
                {order.type === 'lab' ? <FlaskConical className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                {order.type === 'lab' ? 'Lab' : 'Imaging'}: {order.label}
              </span>
              {order.orderNo && <span className="font-mono text-[10px] text-[var(--color-text-muted)]">{order.orderNo}</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${billingTone(order)}`}>{billingLabel(order)}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${clinicalStatusTone(order)}`}>{clinicalStatusLabel(order)}</span>
              {order.invoiceNo && <span className="font-mono text-[10px] text-[var(--color-text-muted)]">{order.invoiceNo}</span>}
              {order.orderedAt && <span className="text-[10px] text-[var(--color-text-muted)]">{order.orderedAt}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
