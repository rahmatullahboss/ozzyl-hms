import { AlertCircle, ArrowRight, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useApiQuery } from '../../../hooks/useApiQuery';
import { getTodayGMT6 } from '../../../lib/date-utils';
import { formatCurrency } from '../../../lib/format';
import { queryKeys } from '../../../lib/queryKeys';
import type { ExecutiveDashboardFilters } from '../../../types/executiveDashboard';

interface PaymentMethod {
  key: string;
  name: string;
  amount: number;
  percentage: number;
  count?: number;
  color: string;
}

interface LegacyPaymentMethodRow {
  payment_method: string;
  total_amount?: number;
  net_amount?: number;
}

interface LegacyPaymentBreakdownData {
  by_payment_method: LegacyPaymentMethodRow[];
}

interface RangePaymentMethodRow {
  key: string;
  label: string;
  amount: number;
  count: number;
  percentage: number;
}

interface RangeDepositMethodRow {
  key: string;
  label: string;
  amount: number;
  count: number;
}

interface RangePaymentBreakdownData {
  totalCollection: number;
  transactionCount?: number;
  methods: RangePaymentMethodRow[];
  depositReceipts: number;
  depositTransactionCount?: number;
  depositMethods: RangeDepositMethodRow[];
  depositTreatment?: 'separate_liability_flow';
  reconciliation?: { status?: 'reconciled' | 'warning' | 'unavailable' };
}

type PaymentBreakdownData = LegacyPaymentBreakdownData | RangePaymentBreakdownData;

const METHOD_COLORS: Record<string, string> = {
  cash: '#10b981',
  bkash: '#e2136e',
  nagad: '#f59e0b',
  card: '#6366f1',
  bank_transfer: '#0ea5e9',
  cheque: '#64748b',
  unknown: '#94a3b8',
};

const METHOD_I18N_KEYS: Record<string, string> = {
  cash: 'cash',
  bkash: 'bkash',
  nagad: 'nagad',
  card: 'card',
  bank_transfer: 'bankTransfer',
  cheque: 'cheque',
  unknown: 'unknown',
};

export interface PaymentMethodBreakdownProps {
  filters?: ExecutiveDashboardFilters;
}

function isRangeData(data: PaymentBreakdownData | null | undefined): data is RangePaymentBreakdownData {
  return Boolean(data && 'methods' in data && 'totalCollection' in data);
}

export default function PaymentMethodBreakdown({ filters }: PaymentMethodBreakdownProps = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { slug = '' } = useParams<{ slug: string }>();
  const date = filters?.endDate ?? getTodayGMT6();
  const queryKey = filters
    ? [...queryKeys.admin.paymentBreakdown(), filters.startDate, filters.endDate]
    : queryKeys.admin.paymentBreakdown();
  const queryPath = filters
    ? `/api/dashboard/payment-methods?startDate=${encodeURIComponent(filters.startDate)}&endDate=${encodeURIComponent(filters.endDate)}`
    : `/api/reports/daily-collection?date=${date}`;

  const { data, isLoading, isError, refetch } = useApiQuery<PaymentBreakdownData>(
    queryKey,
    queryPath,
    undefined,
  );

  if (isError) {
    return (
      <div className="card p-5" role="alert" aria-live="assertive">
        <div className="mb-3 flex items-center gap-2 text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <p className="text-sm font-medium">{t('adminDashboard.errors.loadFailed')}</p>
        </div>
        <button
          type="button"
          onClick={() => { void refetch(); }}
          className="cursor-pointer rounded text-xs text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-300"
        >
          {t('adminDashboard.errors.retry')}
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="card p-5">
        <div className="skeleton mb-4 h-4 w-32" />
        <div className="skeleton h-40 w-full rounded-lg" />
      </div>
    );
  }

  const rangeData = filters && isRangeData(data) ? data : null;
  const legacyRows = !filters && data && 'by_payment_method' in data ? data.by_payment_method : [];
  const legacyTotal = legacyRows.reduce(
    (sum, row) => sum + Number(row.net_amount ?? row.total_amount ?? 0),
    0,
  );
  const total = rangeData ? Number(rangeData.totalCollection ?? 0) : legacyTotal;
  const methods: PaymentMethod[] = rangeData
    ? (rangeData.methods ?? []).map((method) => ({
      key: method.key,
      name: method.label,
      amount: Number(method.amount ?? 0),
      percentage: Number(method.percentage ?? 0),
      count: Number(method.count ?? 0),
      color: METHOD_COLORS[method.key] ?? METHOD_COLORS.unknown,
    }))
    : legacyRows.map((row) => {
      const key = String(row.payment_method || 'unknown').toLowerCase();
      const amount = Number(row.net_amount ?? row.total_amount ?? 0);
      const i18nKey = METHOD_I18N_KEYS[key];
      return {
        key,
        name: i18nKey ? t(`adminDashboard.paymentMethods.${i18nKey}`) : key.replace(/_/g, ' '),
        amount,
        percentage: legacyTotal > 0 ? Number(((amount / legacyTotal) * 100).toFixed(1)) : 0,
        color: METHOD_COLORS[key] ?? METHOD_COLORS.unknown,
      };
    });

  const openMethod = (method: PaymentMethod) => {
    if (!filters) return;
    navigate(
      `/h/${slug}/cash/collections?from=${encodeURIComponent(filters.startDate)}&to=${encodeURIComponent(filters.endDate)}&paymentMethod=${encodeURIComponent(method.key)}#daily-collection-snapshot`,
    );
  };

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Wallet className="h-5 w-5 text-blue-500" aria-hidden="true" />
        <h3 className="font-semibold text-[var(--color-text-primary)]">{t('adminDashboard.paymentMethods.title')}</h3>
      </div>

      {filters ? (
        <p className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">
          {filters.startDate} – {filters.endDate} · payment date
        </p>
      ) : null}

      {filters ? <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Operational collection</p> : null}
      <div className="mb-4 mt-1 font-data text-2xl font-bold text-[var(--color-text-primary)]">
        {formatCurrency(total)}
      </div>

      {methods.length === 0 ? (
        <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">{t('adminDashboard.paymentMethods.noData')}</div>
      ) : (
        <div className="space-y-3">
          <div className="flex h-3 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
            {methods.map((method) => (
              <div
                key={method.key}
                style={{ width: `${method.percentage}%`, backgroundColor: method.color }}
                className="transition-all motion-reduce:transition-none"
              />
            ))}
          </div>

          <div className="space-y-2">
            {methods.map((method) => {
              const content = (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: method.color }} aria-hidden="true" />
                    <span className="truncate text-[var(--color-text)]">{method.name}</span>
                    {method.count !== undefined ? <span className="text-xs text-[var(--color-text-muted)]">{method.count} rows</span> : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-data text-[var(--color-text-primary)]">{formatCurrency(method.amount, { fractionDigits: 0 })}</span>
                    <span className="w-12 text-right text-xs text-[var(--color-text-muted)]">{method.percentage}%</span>
                    {filters ? <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-muted)]" aria-hidden="true" /> : null}
                  </div>
                </>
              );
              return filters ? (
                <button
                  key={method.key}
                  type="button"
                  aria-label={`Open ${method.name} payment details`}
                  onClick={() => openMethod(method)}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 text-left text-sm transition-colors hover:bg-[var(--color-bg-secondary)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  {content}
                </button>
              ) : (
                <div key={method.key} className="flex items-center justify-between gap-3 text-sm">{content}</div>
              );
            })}
          </div>
        </div>
      )}

      {rangeData && Number(rangeData.depositReceipts ?? 0) > 0 ? (
        <div className="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Patient deposits — separate liability flow
          </p>
          <p className="mt-1 font-data text-lg font-bold text-[var(--color-text-primary)]">
            {formatCurrency(Number(rangeData.depositReceipts ?? 0))}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Deposits are shown separately and are not included in operational collection or recognised income.
          </p>
        </div>
      ) : null}
    </div>
  );
}
