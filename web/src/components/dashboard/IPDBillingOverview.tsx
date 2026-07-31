import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BedDouble,
  Banknote,
  CircleDollarSign,
  FileCheck2,
  ReceiptText,
  RefreshCw,
  WalletCards,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatCurrency } from '../../lib/format';
import { safeT } from '../../lib/kpiLabels';
import { IPD_BN_COPY } from '../../pages/admin/widgets/ipdBillingCopy';
import { appendDashboardPeriod, type DashboardPeriod } from './dashboardPeriod';

interface IPDActivityRow {
  billId: number;
  invoiceNo: string | null;
  admissionId: number;
  admissionNo: string | null;
  patientName: string | null;
  patientCode: string | null;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  paymentAmount: number;
  cashAmount: number;
  nonCashAmount: number;
  depositReceivedToday: number;
  totalReceivedToday: number;
  depositApplied: number;
  dueAmount: number;
  status: string | null;
  paymentMethod: string | null;
  serviceNames: string | null;
  itemCount: number;
  occurredAt: string | null;
}

interface IPDBillingStats {
  total_inpatients: number;
  pending_billing: number;
  charges_added_today: number;
  total_charges_today: number;
  gross_billed_today: number;
  final_billed_today: number;
  final_bill_count_today: number;
  payment_collected_today: number;
  payment_receipt_count_today: number;
  cash_collected_today: number;
  non_cash_collected_today: number;
  deposit_received_today: number;
  deposit_receipt_count_today: number;
  deposit_cash_received_today: number;
  deposit_non_cash_received_today: number;
  total_money_received_today: number;
  total_cash_received_today: number;
  total_non_cash_received_today: number;
  deposit_applied_today: number;
  discount_today: number;
  settled_gross_today: number;
  settled_discount_today: number;
  settled_payment_applied_today: number;
  settled_deposit_applied_today: number;
  settled_today: number;
  settled_bill_count_today: number;
  current_provisional_due: number;
  high_due_patients: number;
  package_patients: number;
  today_admissions: number;
  today_discharges: number;
  today_activity: IPDActivityRow[];
  activity?: IPDActivityRow[];
  totalActivityRows?: number;
  page?: number;
  pageSize?: number;
  hasNextPage?: boolean;
}

const EMPTY_STATS: IPDBillingStats = {
  total_inpatients: 0,
  pending_billing: 0,
  charges_added_today: 0,
  total_charges_today: 0,
  gross_billed_today: 0,
  final_billed_today: 0,
  final_bill_count_today: 0,
  payment_collected_today: 0,
  payment_receipt_count_today: 0,
  cash_collected_today: 0,
  non_cash_collected_today: 0,
  deposit_received_today: 0,
  deposit_receipt_count_today: 0,
  deposit_cash_received_today: 0,
  deposit_non_cash_received_today: 0,
  total_money_received_today: 0,
  total_cash_received_today: 0,
  total_non_cash_received_today: 0,
  deposit_applied_today: 0,
  discount_today: 0,
  settled_gross_today: 0,
  settled_discount_today: 0,
  settled_payment_applied_today: 0,
  settled_deposit_applied_today: 0,
  settled_today: 0,
  settled_bill_count_today: 0,
  current_provisional_due: 0,
  high_due_patients: 0,
  package_patients: 0,
  today_admissions: 0,
  today_discharges: 0,
  today_activity: [],
};

function money(value: number): string {
  return formatCurrency(Number(value || 0));
}

function statusLabel(value: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

interface IPDBillingOverviewProps {
  period: DashboardPeriod;
  queryKeyScope: string;
  pageSize?: number;
  onInvoiceOpen?: (billId: number) => void;
}

function normalizeStats(data?: Partial<IPDBillingStats>): IPDBillingStats {
  const normalized = { ...EMPTY_STATS, ...(data ?? {}) } as IPDBillingStats;
  for (const key of Object.keys(EMPTY_STATS) as Array<keyof IPDBillingStats>) {
    if (key === 'today_activity') continue;
    const value = normalized[key];
    if (typeof value === 'number' && Number.isFinite(value)) continue;
    if (typeof EMPTY_STATS[key] === 'number') {
      (normalized as unknown as Record<string, unknown>)[key] = 0;
    }
  }
  normalized.today_activity = Array.isArray(data?.activity)
    ? data.activity
    : Array.isArray(data?.today_activity)
      ? data.today_activity
      : [];
  if (!Number.isFinite(Number(data?.charges_added_today)) && Number.isFinite(Number(data?.total_charges_today))) {
    normalized.charges_added_today = Number(data?.total_charges_today);
  }
  return normalized;
}

export default function IPDBillingOverview({ period, queryKeyScope, pageSize = 20, onInvoiceOpen }: IPDBillingOverviewProps) {
  const { t, i18n } = useTranslation('tenantAdmin');
  const isBangla = String(i18n?.language ?? '').toLowerCase().startsWith('bn');
  const text = (key: string, fallback: string) => safeT(t, key, isBangla ? (IPD_BN_COPY[key] ?? fallback) : fallback);
  const navigate = useNavigate();
  const { slug = '' } = useParams<{ slug: string }>();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [period.startDate, period.endDate]);
  const statsPath = appendDashboardPeriod(`/api/ip-billing/stats?page=${page}&pageSize=${pageSize}`, period);
  const { data, isLoading, isError, refetch } = useApiQuery<Partial<IPDBillingStats>>(
    [queryKeyScope, 'ipd-billing-overview', period.startDate, period.endDate, page, pageSize],
    statsPath,
    { refetchInterval: 30_000 },
  );
  const stats = normalizeStats(data);
  const ipdBillingPath = `/h/${slug}/ip-billing`;

  const cards = [
    {
      title: text('adminDashboard.ipdBilling.chargesAddedToday', 'Charges added in selected period'),
      value: stats.charges_added_today ?? stats.total_charges_today,
      detail: text('adminDashboard.ipdBilling.chargesAddedDetail', 'Admission-linked charges entered in the selected period; this is not cash received.'),
      icon: <ReceiptText className="h-5 w-5" aria-hidden="true" />,
      iconClass: 'bg-cyan-50 text-cyan-700',
    },
    {
      title: text('adminDashboard.ipdBilling.finalBillsToday', 'Final IPD bills in selected period'),
      value: stats.final_billed_today,
      detail: text('adminDashboard.ipdBilling.finalBillsDetail', `${stats.final_bill_count_today} finalized bill(s); amount shown is after discount.`),
      icon: <FileCheck2 className="h-5 w-5" aria-hidden="true" />,
      iconClass: 'bg-indigo-50 text-indigo-700',
    },
    {
      title: text('adminDashboard.ipdBilling.collectionReceivedToday', 'Total IPD money received in selected period'),
      value: stats.total_money_received_today,
      detail: isBangla
        ? `বিল পেমেন্ট ${money(stats.payment_collected_today)} · নতুন ডিপোজিট ${money(stats.deposit_received_today)} · নগদ ${money(stats.total_cash_received_today)} · নন-ক্যাশ ${money(stats.total_non_cash_received_today)}`
        : `Bill payments ${money(stats.payment_collected_today)} · new deposits ${money(stats.deposit_received_today)} · cash ${money(stats.total_cash_received_today)} · non-cash ${money(stats.total_non_cash_received_today)}`,
      icon: <Banknote className="h-5 w-5" aria-hidden="true" />,
      iconClass: 'bg-emerald-50 text-emerald-700',
    },
    {
      title: text('adminDashboard.ipdBilling.currentProvisionalDue', 'Provisional due as of period end'),
      value: stats.current_provisional_due,
      detail: text('adminDashboard.ipdBilling.currentProvisionalDueDetail', `${stats.pending_billing} admitted patient(s) have active provisional charges.`),
      icon: <WalletCards className="h-5 w-5" aria-hidden="true" />,
      iconClass: 'bg-amber-50 text-amber-700',
    },
  ];

  const reconciliation = [
    { label: text('adminDashboard.ipdBilling.grossBill', 'Gross bill'), value: stats.settled_gross_today, sign: '' },
    { label: text('adminDashboard.ipdBilling.discount', 'Discount'), value: stats.settled_discount_today, sign: '−' },
    { label: text('adminDashboard.ipdBilling.netBill', 'Net bill'), value: stats.settled_today, sign: '=' },
    { label: text('adminDashboard.ipdBilling.paymentReceived', 'Payments applied'), value: stats.settled_payment_applied_today, sign: '' },
    { label: text('adminDashboard.ipdBilling.depositApplied', 'Deposit applied'), value: stats.settled_deposit_applied_today, sign: '+' },
    { label: text('adminDashboard.ipdBilling.settledAmount', 'Settled amount'), value: stats.settled_today, sign: '=' },
  ];

  return (
    <section className="card p-4 sm:p-5" data-testid="ipd-billing-overview">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">
            {text('adminDashboard.ipdBilling.eyebrow', 'Inpatient finance')}
          </p>
          <h2 className="section-title mt-1">
            {isBangla ? `IPD আর্থিক সারসংক্ষেপ — ${period.label}` : `IPD finance — ${period.label}`}
          </h2>
          <p className="section-subtitle mt-1">
            {text('adminDashboard.ipdBilling.subtitle', 'Charges, finalized bills, direct payments, new deposits, and deposit adjustments are shown separately so cash inflow and settlement stay clear.')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(ipdBillingPath)}
          className="btn-secondary shrink-0 text-xs"
          aria-label={text('adminDashboard.ipdBilling.openAria', 'Open IPD billing workspace')}
        >
          {text('adminDashboard.ipdBilling.open', 'Open IPD billing')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {isError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
          <p className="text-sm font-medium text-red-800">
            {text('adminDashboard.ipdBilling.loadFailed', 'Unable to load IPD finance summary.')}
          </p>
          <button type="button" onClick={() => refetch()} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {text('adminDashboard.errors.retry', 'Retry')}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <div key={card.title} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{card.title}</p>
                    <p className="mt-2 font-data text-2xl font-bold text-[var(--color-text-primary)]">
                      {isLoading ? '—' : money(card.value)}
                    </p>
                  </div>
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.iconClass}`}>
                    {card.icon}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">{card.detail}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="section-title">
                  {text('adminDashboard.ipdBilling.reconciliationTitle', 'Selected-period IPD settlement reconciliation')}
                </h3>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {text('adminDashboard.ipdBilling.reconciliationHelp', 'Gross bill minus discount equals net bill; payments received plus deposit applied explains the settled amount.')}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <CircleDollarSign className="h-4 w-4" aria-hidden="true" />
                {text('adminDashboard.ipdBilling.settledBills', `${stats.settled_bill_count_today} settled bill(s)`)}
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {reconciliation.map((item) => (
                <div key={item.label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {item.sign ? <span className="mr-1" aria-hidden="true">{item.sign}</span> : null}
                    <span>{item.label}</span>
                  </p>
                  <p className="mt-1 font-data text-base font-bold text-[var(--color-text-primary)]">{isLoading ? '—' : money(item.value)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              [text('adminDashboard.ipdBilling.currentlyAdmitted', 'Admitted as of period end'), stats.total_inpatients, <BedDouble key="bed" className="h-4 w-4 text-cyan-700" aria-hidden="true" />],
              [text('adminDashboard.ipdBilling.admissionsToday', 'Admissions in selected period'), stats.today_admissions, null],
              [text('adminDashboard.ipdBilling.dischargesToday', 'Discharges in selected period'), stats.today_discharges, null],
              [text('adminDashboard.ipdBilling.pendingBilling', 'Pending billing'), stats.pending_billing, null],
              [text('adminDashboard.ipdBilling.highDuePatients', 'High-due patients'), stats.high_due_patients, null],
              [text('adminDashboard.ipdBilling.packagePatients', 'Package patients'), stats.package_patients, null],
            ].map(([label, value, icon]) => (
              <div key={String(label)}>
                <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
                <p className="mt-1 flex items-center gap-1 font-data text-lg font-bold text-[var(--color-text-primary)]">
                  {icon}{isLoading ? '—' : Number(value).toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]">
            <div className="border-b border-[var(--color-border)] p-4">
              <h3 className="section-title">{text('adminDashboard.ipdBilling.activityTitle', 'Selected-period IPD financial activity')}</h3>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {text('adminDashboard.ipdBilling.activityHelp', 'Invoices, direct payments, new deposits, and deposit adjustments from the selected period are shown even when an invoice has not been created yet.')}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{text('adminDashboard.ipdBilling.invoiceAdmission', 'Invoice / Admission')}</th>
                    <th>{text('adminDashboard.ipdBilling.patient', 'Patient')}</th>
                    <th>{text('adminDashboard.ipdBilling.items', 'Items')}</th>
                    <th>{text('adminDashboard.ipdBilling.gross', 'Gross')}</th>
                    <th>{text('adminDashboard.ipdBilling.discount', 'Discount')}</th>
                    <th>{text('adminDashboard.ipdBilling.net', 'Net')}</th>
                    <th>{text('adminDashboard.ipdBilling.deposit', 'Deposit applied')}</th>
                    <th>{text('adminDashboard.ipdBilling.paidToday', 'Money received in selected period')}</th>
                    <th>{text('adminDashboard.ipdBilling.due', 'Due')}</th>
                    <th>{text('adminDashboard.ipdBilling.status', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.today_activity.length ? stats.today_activity.map((row) => {
                    const hasInvoice = Boolean(row.invoiceNo || row.billId);
                    return (
                    <tr key={`${row.billId || 'deposit'}-${row.admissionId}`}>
                      <td className="whitespace-nowrap text-sm">
                        {row.billId > 0 && onInvoiceOpen ? (
                          <button
                            type="button"
                            className="min-h-11 font-data font-semibold text-[var(--color-primary)] underline-offset-2 hover:underline"
                            aria-label={`Open invoice ${row.invoiceNo || row.billId}`}
                            onClick={() => onInvoiceOpen(row.billId)}
                          >
                            {row.invoiceNo || `Bill #${row.billId}`}
                          </button>
                        ) : (
                          <div className="font-data font-semibold text-[var(--color-text-primary)]">
                            {hasInvoice
                              ? (row.invoiceNo || `Bill #${row.billId}`)
                              : text('adminDashboard.ipdBilling.depositReceivedActivity', 'Deposit received')}
                          </div>
                        )}
                        {!hasInvoice ? (
                          <div className="text-xs font-medium text-amber-700">
                            {text('adminDashboard.ipdBilling.invoicePending', 'Invoice not created yet')}
                          </div>
                        ) : null}
                        <div className="text-xs text-[var(--color-text-muted)]">{row.admissionNo || `Admission #${row.admissionId}`}</div>
                      </td>
                      <td className="min-w-40 text-sm">
                        <div className="font-medium text-[var(--color-text-primary)]">{row.patientName || '—'}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{row.patientCode || '—'}</div>
                      </td>
                      <td className="max-w-64 text-sm text-[var(--color-text-secondary)]">
                        {hasInvoice ? (
                          <>
                            <div className="line-clamp-2">{row.serviceNames || '—'}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">{row.itemCount.toLocaleString()} item(s)</div>
                          </>
                        ) : (
                          <div className="font-medium text-emerald-700">
                            {text('adminDashboard.ipdBilling.depositReceivedActivity', 'Deposit received')}
                          </div>
                        )}
                      </td>
                      <td className="font-data text-sm">{hasInvoice ? money(row.grossAmount) : '—'}</td>
                      <td className="font-data text-sm text-amber-700">{hasInvoice ? money(row.discountAmount) : '—'}</td>
                      <td className="font-data text-sm font-semibold">{hasInvoice ? money(row.netAmount) : '—'}</td>
                      <td className="font-data text-sm text-indigo-700">{hasInvoice ? money(row.depositApplied) : '—'}</td>
                      <td className="min-w-48 font-data text-sm text-emerald-700">
                        <div className="font-semibold">
                          {text('adminDashboard.ipdBilling.totalReceivedLine', 'Total received')} {money(row.totalReceivedToday)}
                        </div>
                        <div className="mt-1 text-[0.68rem] font-normal text-[var(--color-text-muted)]">
                          {text('adminDashboard.ipdBilling.billPaymentLine', 'Bill payment')} {money(row.paymentAmount)}
                        </div>
                        <div className="text-[0.68rem] font-normal text-[var(--color-text-muted)]">
                          {text('adminDashboard.ipdBilling.newDepositLine', 'New deposit')} {money(row.depositReceivedToday)}
                        </div>
                        {row.paymentMethod ? (
                          <div className="text-[0.68rem] font-normal text-[var(--color-text-muted)]">{row.paymentMethod}</div>
                        ) : null}
                      </td>
                      <td className="font-data text-sm text-red-700">{hasInvoice ? money(row.dueAmount) : '—'}</td>
                      <td>
                        <span className="badge badge-secondary">
                          {row.status === 'deposit_received'
                            ? text('adminDashboard.ipdBilling.depositReceivedActivity', 'Deposit received')
                            : statusLabel(row.status)}
                        </span>
                      </td>
                    </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                        {text('adminDashboard.ipdBilling.noActivity', 'No IPD financial activity found for selected period.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3">
              <p className="text-xs text-[var(--color-text-muted)]">
                {Number(stats.totalActivityRows ?? stats.today_activity.length).toLocaleString()} activity row(s) · page {page}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  aria-label="Previous IPD activity page"
                  disabled={page <= 1 || isLoading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  aria-label="Next IPD activity page"
                  disabled={!stats.hasNextPage || isLoading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
