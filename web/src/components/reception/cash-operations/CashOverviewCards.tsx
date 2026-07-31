import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../../lib/format';

export type CashOverview = {
  sessionId?: number;
  counterId?: number;
  counterName?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  openingCash?: number;
  patientCashCollection?: number;
  refundCashOut?: number;
  doctorPayout?: number;
  expenseCashOut?: number;
  transferOut?: number;
  acceptedTransferIn?: number;
  bankDepositCustody?: number;
  manualCashIn?: number;
  manualCashOut?: number;
  otherDrawerCashOut?: number;
  cashDrop?: number;
  currentDrawerBalance?: number;
  heldRefundCash?: number;
  availableCash?: number;
  sessionStatus?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
};

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return formatCurrency(Number.isFinite(parsed) ? parsed : 0, { fractionDigits: 2 });
}

export default function CashOverviewCards({ overview }: { overview?: CashOverview }) {
  const { t } = useTranslation('cashOperations');
  const sessionStatus = String(overview?.sessionStatus ?? '').toLowerCase();
  const isClosedSession = Boolean(sessionStatus && sessionStatus !== 'active');
  const cards = [
    { label: t('overview.openingCash'), value: overview?.openingCash },
    { label: t('overview.patientCashCollection'), value: overview?.patientCashCollection },
    { label: t('overview.refundCashOut'), value: overview?.refundCashOut },
    { label: t('overview.drawerReceived'), value: overview?.manualCashIn },
    { label: t('overview.drawerSpent'), value: overview?.otherDrawerCashOut },
    { label: t('overview.doctorPayout'), value: overview?.doctorPayout },
    { label: t('overview.pettyCashExpense'), value: overview?.expenseCashOut },
    { label: t('overview.transferOut'), value: overview?.transferOut },
    { label: t('overview.bankDepositCustody'), value: overview?.bankDepositCustody },
    {
      label: isClosedSession ? t('overview.closedDrawerBalance', { defaultValue: 'Closed drawer balance' }) : t('overview.currentDrawerBalance'),
      value: overview?.currentDrawerBalance,
    },
    {
      label: t('overview.pendingRefundReserve', { defaultValue: 'Pending refund reserve' }),
      value: overview?.heldRefundCash,
    },
    {
      label: t('overview.availableDrawerCash', { defaultValue: 'Available drawer cash' }),
      value: overview?.availableCash ?? overview?.currentDrawerBalance,
      emphasis: !isClosedSession,
    },
  ];

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900" aria-labelledby="cash-overview-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t('overview.kicker')}</p>
          <h2 id="cash-overview-title" className="text-lg font-bold text-[var(--color-text-primary)]">
            {isClosedSession ? t('overview.closedTitle', { defaultValue: 'Closed Shift Summary' }) : t('overview.title')}
          </h2>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{isClosedSession ? t('overview.closedShift', { defaultValue: 'Closed shift' }) : t('overview.liveDrawer')}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
            <p className="text-xs text-[var(--color-text-muted)]">{card.label}</p>
            <p className={`mt-1 font-data text-lg font-semibold ${card.emphasis ? 'text-emerald-700' : 'text-[var(--color-text-primary)]'}`}>{money(card.value)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
