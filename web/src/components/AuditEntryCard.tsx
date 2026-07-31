import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';
import { ACTION_COLORS } from '../lib/auditGroups';
import { formatAuditDateTimeGMT6 } from '../lib/date-utils';
import type { AuditEntry, BillPaymentStatus } from '../lib/auditGroups';

function fmtTime(iso: string, locale: string): string {
  return formatAuditDateTimeGMT6(iso, locale);
}

function fmtAmount(value: number): string {
  return `৳${Math.abs(value).toLocaleString()}`;
}

const PAYMENT_STATUS_STYLES: Record<BillPaymentStatus, { chip: string; labelKey: string }> = {
  paid: {
    chip: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    labelKey: 'audit.paymentStatus.paid',
  },
  partially_paid: {
    chip: 'bg-amber-100 text-amber-700 border-amber-200',
    labelKey: 'audit.paymentStatus.partial',
  },
  open: {
    chip: 'bg-rose-100 text-rose-700 border-rose-200',
    labelKey: 'audit.paymentStatus.unpaid',
  },
  cancelled: {
    chip: 'bg-gray-100 text-gray-600 border-gray-200',
    labelKey: 'audit.paymentStatus.cancelled',
  },
  refunded: {
    chip: 'bg-gray-100 text-gray-600 border-gray-200',
    labelKey: 'audit.paymentStatus.refunded',
  },
  draft: {
    chip: 'bg-gray-100 text-gray-600 border-gray-200',
    labelKey: 'audit.paymentStatus.draft',
  },
  unknown: {
    chip: 'bg-gray-100 text-gray-600 border-gray-200',
    labelKey: 'audit.paymentStatus.unknown',
  },
};

export default function AuditEntryCard({
  entry,
  onClick,
  dense = false,
}: {
  entry: AuditEntry;
  onClick?: () => void;
  dense?: boolean;
}) {
  const { t, i18n } = useTranslation('dashboard');
  const badgeClass = ACTION_COLORS[entry.action] ?? 'bg-gray-100 text-gray-700';
  const user = entry.user_name ?? t('userFallback', { defaultValue: `User #${entry.user_id ?? '?'}` });
  const recordId = entry.entity_id ? `#${entry.entity_id}` : '—';
  const locale = i18n?.language ?? 'en';
  const showOperatorIcon = !!entry.user_name;

  const isCashAmount = entry.groupKey === 'cash' && typeof entry.amount === 'number' && Number.isFinite(entry.amount);
  const amountSign = entry.amountSign ?? 'in';
  const amountBadgeClass =
    amountSign === 'out'
      ? 'bg-red-100 text-red-700 border-red-200'
      : 'bg-emerald-100 text-emerald-700 border-emerald-200';

  const isBillEntity = entry.entity === 'bills' || entry.entity === 'billing';
  const payment = isBillEntity ? entry.paymentStatus ?? 'unknown' : 'unknown';
  const showPaymentChip = isBillEntity && payment !== 'unknown';
  const paymentStyle = PAYMENT_STATUS_STYLES[payment] ?? PAYMENT_STATUS_STYLES.unknown;
  const paymentLabel = t(paymentStyle.labelKey, {
    defaultValue:
      payment === 'paid' ? 'Paid'
        : payment === 'partially_paid' ? 'Partial'
        : payment === 'open' ? 'Unpaid'
        : payment === 'cancelled' ? 'Cancelled'
        : payment === 'refunded' ? 'Refunded'
        : payment === 'draft' ? 'Draft'
        : '—',
  });

  const paidValue = entry.paymentPaid;
  const dueValue = entry.paymentDue;
  const totalValue = entry.paymentTotal;
  const hasPaid = typeof paidValue === 'number' && Number.isFinite(paidValue);
  const hasDue = typeof dueValue === 'number' && Number.isFinite(dueValue);
  const hasTotal = typeof totalValue === 'number' && Number.isFinite(totalValue);
  const showPaymentBreakdown = showPaymentChip && (hasPaid || hasDue || hasTotal);

  const content = (
    <div
      className={`flex items-center gap-3 ${dense ? 'py-2 px-3' : 'p-3'} hover:bg-[var(--color-bg)] transition rounded-lg`}
    >
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${badgeClass}`}>
        {entry.actionLabel}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate flex items-center gap-1.5">
          {showOperatorIcon && <User className="w-3 h-3 text-[var(--color-text-muted)] shrink-0" aria-hidden="true" />}
          <span className="font-semibold text-[var(--color-text-primary)]">{user}</span>
          <span className="text-[var(--color-text-muted)]"> · </span>
          <span className="text-[var(--color-text-muted)]">{entry.entityLabel}</span>
          <span className="text-[var(--color-text-muted)]"> </span>
          <span className="text-[var(--color-text-muted)]">{recordId}</span>
        </p>
        {showPaymentBreakdown && payment === 'partially_paid' ? (
          <p className="text-xs text-[var(--color-text-muted)] truncate" data-testid="audit-payment-breakdown">
            {hasPaid && (
              <span className="font-semibold text-emerald-700">{t('audit.paymentPaid', { defaultValue: 'Paid' })}: {fmtAmount(paidValue!)}</span>
            )}
            {hasPaid && hasDue && <span className="mx-1.5">·</span>}
            {hasDue && (
              <span className="font-semibold text-rose-700">{t('audit.paymentDue', { defaultValue: 'Due' })}: {fmtAmount(dueValue!)}</span>
            )}
            {hasTotal && totalValue! > 0 && (
              <span className="mx-1.5 text-[var(--color-text-muted)]">/ {t('audit.paymentTotal', { defaultValue: 'Total' })}: {fmtAmount(totalValue!)}</span>
            )}
          </p>
        ) : showPaymentBreakdown && payment === 'paid' ? (
          <p className="text-xs text-[var(--color-text-muted)] truncate" data-testid="audit-payment-breakdown">
            {hasTotal && totalValue! > 0 ? (
              <span className="font-semibold text-emerald-700">{fmtAmount(totalValue!)} {t('audit.paymentReceived', { defaultValue: 'paid in full' })}</span>
            ) : hasPaid ? (
              <span className="font-semibold text-emerald-700">{fmtAmount(paidValue!)} {t('audit.paymentReceived', { defaultValue: 'paid in full' })}</span>
            ) : null}
          </p>
        ) : showPaymentBreakdown && payment === 'open' ? (
          <p className="text-xs text-[var(--color-text-muted)] truncate" data-testid="audit-payment-breakdown">
            {hasDue ? (
              <span className="font-semibold text-rose-700">{t('audit.paymentDue', { defaultValue: 'Due' })}: {fmtAmount(dueValue!)}</span>
            ) : hasTotal ? (
              <span className="font-semibold text-rose-700">{t('audit.paymentDue', { defaultValue: 'Due' })}: {fmtAmount(totalValue!)}</span>
            ) : null}
            {hasTotal && totalValue! > 0 && (
              <span className="mx-1.5 text-[var(--color-text-muted)]">/ {t('audit.paymentTotal', { defaultValue: 'Total' })}: {fmtAmount(totalValue!)}</span>
            )}
          </p>
        ) : entry.details && entry.details !== 'No extra details' ? (
          <p className="text-xs text-[var(--color-text-muted)] truncate">{entry.details}</p>
        ) : null}
      </div>
      {isCashAmount && (
        <span
          data-testid="audit-amount-badge"
          className={`px-2 py-0.5 rounded-md border text-sm font-bold font-data shrink-0 ${amountBadgeClass}`}
          aria-label={amountSign === 'out' ? t('audit.cashOut', { defaultValue: 'Cash out' }) : t('audit.cashIn', { defaultValue: 'Cash in' })}
        >
          ৳{amountSign === 'out' ? '-' : '+'}{Math.abs(entry.amount!).toLocaleString()}
        </span>
      )}
      {showPaymentChip && (
        <span
          data-testid="audit-payment-chip"
          data-payment-status={payment}
          className={`px-2 py-0.5 rounded-md border text-sm font-bold font-data shrink-0 ${paymentStyle.chip} ${payment === 'paid' ? 'text-base px-2.5 py-1' : ''}`}
          aria-label={t('audit.paymentStatusAria', { defaultValue: 'Payment status' }) + ': ' + paymentLabel}
          title={paymentLabel}
        >
          {paymentLabel}
        </span>
      )}
      <span className="text-xs text-[var(--color-text-muted)] font-data shrink-0">
        {fmtTime(entry.created_at, locale)}
      </span>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        {content}
      </button>
    );
  }
  return content;
}
