import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { useAuth } from '../../hooks/useAuth';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import ReceptionTopBar from '../../components/reception/ReceptionTopBar';
import CashOverviewCards, { type CashOverview } from '../../components/reception/cash-operations/CashOverviewCards';
import DoctorPayoutWorkspace from '../../components/reception/cash-operations/DoctorPayoutWorkspace';
import PerformerReservePayoutWorkspace from '../../components/reception/cash-operations/PerformerReservePayoutWorkspace';
import ExpensePaymentPanel from '../../components/reception/cash-operations/ExpensePaymentPanel';
import CashTransferPanel from '../../components/reception/cash-operations/CashTransferPanel';
import BankDepositPanel from '../../components/reception/cash-operations/BankDepositPanel';
import CloseShiftPanel from '../../components/reception/cash-operations/CloseShiftPanel';
import RecentCashActivity, { type ActivityScope } from '../../components/reception/cash-operations/RecentCashActivity';

type CashOverviewResponse = { overview: CashOverview };
type CashActivityResponse = { activity: Array<{ id: string; source?: string; createdAt?: string; actorName?: string | null; movementType?: string; referenceType?: string; referenceId?: number | null; amount?: number; description?: string | null }>; session?: { sessionId?: number; counterId?: number; counterName?: string | null; dateFrom?: string | null; dateTo?: string | null } };
type DoctorPayablesResponse = { doctors: Array<{ doctorId: number; doctorName: string; consultationCommission?: number; testCommission?: number; otherCommission?: number; payableAmount?: number; eligibleItemCount?: number; items?: Array<{ accrualId?: number; id?: number; serviceName?: string; sourceLabel?: string; patientName?: string | null; invoiceNo?: string | null; commissionAmount?: number; payableAmount?: number }> }> };
type ActiveCounter = { sessionId: number; counterId?: number; counterName?: string; operatorName?: string };
type ActiveCountersResponse = { activeCounters?: ActiveCounter[] } | ActiveCounter[];
type CounterSessionOption = { sessionId: number; counterId?: number; counterName?: string | null; operatorName?: string | null; status?: string | null; openedAt?: string | null; closedAt?: string | null; openingCash?: number | null };
type CounterSessionsResponse = { sessions?: CounterSessionOption[] };
type MeResponse = { id?: number; name?: string; username?: string; email?: string; role?: string };
type CashOperationSettingsResponse = { settings?: { pettyCashAutoApproveLimit?: number; receiptRequiredLimit?: number } };

type TabKey = 'doctor' | 'expense' | 'transfer' | 'bank' | 'close';

const tabKeys: TabKey[] = ['doctor', 'expense', 'transfer', 'bank', 'close'];
const monitorRoles = new Set(['hospital_admin', 'md', 'director', 'accountant']);
const CASH_OPERATIONS_STALE_MS = 10 * 60_000;
const CASH_OPERATIONS_SETTINGS_STALE_MS = 60 * 60_000;

function normalizeCounters(data: ActiveCountersResponse | undefined): ActiveCounter[] {
  return Array.isArray(data) ? data : data?.activeCounters ?? [];
}

function normalizeSessions(data: CounterSessionsResponse | undefined): CounterSessionOption[] {
  return data?.sessions ?? [];
}

function formatSessionOption(session: CounterSessionOption): string {
  const counter = session.counterName ?? (session.counterId ? `Counter ${session.counterId}` : 'Counter');
  const status = session.status ? ` · ${session.status}` : '';
  const opened = session.openedAt ? ` · ${session.openedAt}` : '';
  return `${counter} · Session ${session.sessionId}${status}${opened}`;
}

function todayInDhaka(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export default function CashOperationsPage() {
  const { t } = useTranslation('cashOperations');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isMonitoringRole = monitorRoles.has(user?.role ?? '')
    || (user?.permissions ?? []).includes('accounting:read')
    || (user?.permissions ?? []).includes('accounting:write')
    || (user?.permissions ?? []).includes('audit:read')
    || (user?.permissions ?? []).includes('billing.counter.management_cash.read')
    || (user?.permissions ?? []).includes('billing.counter.management_cash.receive');
  const [activeTab, setActiveTab] = useState<TabKey>('doctor');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedCounterId, setSelectedCounterId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [payoutFrom, setPayoutFrom] = useState(() => todayInDhaka());
  const [payoutTo, setPayoutTo] = useState(() => todayInDhaka());
  const [expenseLimitInput, setExpenseLimitInput] = useState("");

  const { data: countersData } = useApiQuery<ActiveCountersResponse>(
    ['cashOperations', 'monitoring', 'activeCounters'],
    '/api/dashboard/active-counters',
    { enabled: isMonitoringRole, staleTime: CASH_OPERATIONS_STALE_MS },
  );
  const sessionsQuery = useMemo(() => {
    const params = new URLSearchParams({ limit: '30' });
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (isMonitoringRole && selectedCounterId) params.set('counterId', selectedCounterId);
    return params.toString();
  }, [dateFrom, dateTo, isMonitoringRole, selectedCounterId]);
  const sessionsQueryResult = useApiQuery<CounterSessionsResponse>(
    ['cashOperations', 'sessions', dateFrom, dateTo, isMonitoringRole ? selectedCounterId : 'own'],
    `/api/cash-operations/sessions?${sessionsQuery}`,
    { staleTime: CASH_OPERATIONS_STALE_MS },
  );
  const sessionsData = sessionsQueryResult.data;
  const counters = normalizeCounters(countersData);
  const sessions = normalizeSessions(sessionsData);
  const monitorFilters = useMemo(() => {
    const filters: Record<string, string> = {};
    if (selectedSessionId) filters.counterSessionId = selectedSessionId;
    if (isMonitoringRole && !selectedSessionId && selectedCounterId) filters.counterId = selectedCounterId;
    if (dateFrom) filters.from = dateFrom;
    if (dateTo) filters.to = dateTo;
    return filters;
  }, [dateFrom, dateTo, isMonitoringRole, selectedCounterId, selectedSessionId]);
  const querySuffix = useMemo(() => new URLSearchParams(monitorFilters).toString(), [monitorFilters]);
  const overviewUrl = `/api/cash-operations/overview${querySuffix ? `?${querySuffix}` : ''}`;
  const activityUrl = `/api/cash-operations/activity?limit=50${querySuffix ? `&${querySuffix}` : ''}`;
  const requiresSessionForDateRange = !isMonitoringRole && Boolean(dateFrom || dateTo) && !selectedSessionId;
  const hasResolvedCashOperationScope = Boolean(selectedSessionId) || (isMonitoringRole && Boolean(selectedCounterId));
  const canLoadCashOperationData = !requiresSessionForDateRange && hasResolvedCashOperationScope;

  const { data: overviewData } = useApiQuery<CashOverviewResponse>(
    queryKeys.cashOperations.overview(monitorFilters),
    overviewUrl,
    { enabled: canLoadCashOperationData, staleTime: CASH_OPERATIONS_STALE_MS },
  );
  const { data: activityData } = useApiQuery<CashActivityResponse>(
    queryKeys.cashOperations.activity({ limit: 50, ...monitorFilters }),
    activityUrl,
    { enabled: canLoadCashOperationData, staleTime: CASH_OPERATIONS_STALE_MS },
  );
  const payoutRangeValid = Boolean(payoutFrom && payoutTo && payoutFrom <= payoutTo);
  const payoutQuery = new URLSearchParams({ from: payoutFrom, to: payoutTo }).toString();
  const { data: doctorPayablesData } = useApiQuery<DoctorPayablesResponse>(
    ['doctor-payouts', 'payables', payoutFrom, payoutTo],
    `/api/payment-methods/doctor-payouts/payables?${payoutQuery}`,
    { enabled: payoutRangeValid, staleTime: CASH_OPERATIONS_STALE_MS },
  );
  const { data: currentUserData } = useApiQuery<MeResponse>(
    ['users', 'me'],
    '/api/users/me',
    { staleTime: CASH_OPERATIONS_SETTINGS_STALE_MS },
  );
  const { data: settingsData } = useApiQuery<CashOperationSettingsResponse>(
    ['cashOperations', 'settings'],
    '/api/cash-operations/settings',
    { enabled: isMonitoringRole, staleTime: CASH_OPERATIONS_SETTINGS_STALE_MS },
  );
  const settingsMutation = useApiMutation<{ success: boolean }, { pettyCashAutoApproveLimit: number }>(
    'patch',
    '/api/cash-operations/settings',
    {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cashOperations', 'settings'] }),
      onError: (error) => alert(error.message || 'Failed to save cash settings'),
    },
  );

  const activeSessionId = overviewData?.overview?.sessionId ?? null;
  const savedApprovalThreshold = settingsData?.settings?.pettyCashAutoApproveLimit ?? 1000;
  useEffect(() => {
    setExpenseLimitInput(String(savedApprovalThreshold));
  }, [savedApprovalThreshold]);

  useEffect(() => {
    if (dateFrom || dateTo) {
      if (selectedSessionId && !sessions.some((session) => String(session.sessionId) === selectedSessionId)) {
        setSelectedSessionId('');
      }
      return;
    }
    if (selectedSessionId && sessions.some((session) => String(session.sessionId) === selectedSessionId)) return;
    if (selectedSessionId && sessions.length === 0) {
      setSelectedSessionId('');
      return;
    }
    if (activeSessionId) return;
    const latestSession = sessions[0];
    setSelectedSessionId(latestSession?.sessionId ? String(latestSession.sessionId) : '');
  }, [activeSessionId, dateFrom, dateTo, selectedSessionId, sessions]);
  const currentDrawerBalance = overviewData?.overview?.currentDrawerBalance ?? 0;
  const heldRefundCash = overviewData?.overview?.heldRefundCash ?? 0;
  const availableDrawerCash = overviewData?.overview?.availableCash ?? currentDrawerBalance;
  const effectiveRole = user?.role ?? 'reception';
  const showReceptionTopBar = effectiveRole === 'reception' || effectiveRole === 'receptionist';
  const userRecord = user as Record<string, unknown> | null | undefined;
  const hospitalName = String(userRecord?.hospitalName ?? userRecord?.tenantName ?? userRecord?.hospital_name ?? 'Hospital Cash Operations');
  const generatedBy = String(currentUserData?.name ?? currentUserData?.username ?? userRecord?.name ?? userRecord?.username ?? `User ${user?.userId ?? ''}`.trim() ?? 'Reception');
  const printScopeByTab: Record<TabKey, ActivityScope> = {
    doctor: 'doctorPayouts',
    expense: 'expenses',
    transfer: 'cashTransfers',
    bank: 'bankDeposits',
    close: 'shiftSummary',
  };

  return (
    <DashboardLayout role={effectiveRole}>
    <div className="mx-auto max-w-screen-2xl space-y-4">
      {showReceptionTopBar ? <ReceptionTopBar role="reception" /> : null}
      <main className="space-y-4">
      <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t('page.kicker')}</p>
            <h1 className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">{t('page.title')}</h1>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t('page.subtitle')}</p>
          </div>
          <span className="rounded-full bg-[var(--color-bg-secondary)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">
            {isMonitoringRole ? t('page.monitoringMode') : t('page.cashierMode')}
          </span>
        </div>

        {true ? (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
            <p className="text-sm text-[var(--color-text-muted)]">{isMonitoringRole ? t('page.monitoringHint') : 'Select your current or closed counter session before printing cash activity.'}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                Counter Session
                <select aria-label="Counter Session" className="input mt-1" value={selectedSessionId} onChange={(event) => { setSelectedSessionId(event.target.value); if (event.target.value) setSelectedCounterId(''); }}>
                  <option value="">{activeSessionId ? t('page.useActiveSession') : 'Select session'}</option>
                  {sessions.map((session) => (
                    <option key={session.sessionId} value={session.sessionId}>{formatSessionOption(session)}</option>
                  ))}
                </select>
                {(dateFrom || dateTo) && sessions.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">No counter session found for selected date.</p>
                ) : null}
              </label>
              {isMonitoringRole ? (
                <label className="text-sm font-medium text-[var(--color-text-primary)]">
                  {t('page.counter')}
                  <select className="input mt-1" value={selectedCounterId} onChange={(event) => { setSelectedCounterId(event.target.value); if (event.target.value) setSelectedSessionId(''); }}>
                    <option value="">{t('page.selectCounter')}</option>
                    {counters.filter((counter) => counter.counterId).map((counter) => (
                      <option key={counter.counterId} value={counter.counterId}>{counter.counterName ?? t('page.counterFallback', { counterId: counter.counterId })}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('page.dateFrom')}
                <input aria-label="From date" className="input mt-1" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setSelectedSessionId(''); }} />
              </label>
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('page.dateTo')}
                <input aria-label="To date" className="input mt-1" type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setSelectedSessionId(''); }} />
              </label>
            </div>
          </div>
        ) : null}

        {isMonitoringRole ? (
          <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                Expense approval threshold (BDT)
                <input
                  aria-label="Expense approval threshold"
                  className="input mt-1 w-52"
                  type="number"
                  min="0"
                  value={expenseLimitInput}
                  onChange={(event) => setExpenseLimitInput(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={settingsMutation.isPending}
                onClick={() => {
                  const value = Number(expenseLimitInput);
                  if (!Number.isFinite(value) || value < 0) {
                    alert('Enter a valid approval threshold.');
                    return;
                  }
                  settingsMutation.mutate({ pettyCashAutoApproveLimit: value });
                }}
              >
                {settingsMutation.isPending ? 'Saving…' : 'Save threshold'}
              </button>
              <p className="text-xs text-[var(--color-text-muted)]">
                Expenses above this amount will stay pending for admin/MD approval. Receipt upload stays optional.
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <CashOverviewCards overview={overviewData?.overview} />

      <div className="rounded-xl border border-[var(--color-border)] bg-white p-2 shadow-sm dark:bg-slate-900" role="tablist" aria-label={t('page.tabsLabel')}>
        <div className="flex flex-wrap gap-2">
          {tabKeys.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeTab === key}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${activeTab === key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]'}`}
              onClick={() => setActiveTab(key)}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {activeTab === 'doctor' ? (
            <>
              <PerformerReservePayoutWorkspace
                sessionId={activeSessionId}
                availableCash={availableDrawerCash}
                dateFrom={payoutFrom}
                dateTo={payoutTo}
                dateRangeError={payoutRangeValid ? null : 'From date cannot be after To date.'}
                onDateRangeChange={(from, to) => {
                  setPayoutFrom(from);
                  setPayoutTo(to);
                }}
              />
              <DoctorPayoutWorkspace
                doctors={doctorPayablesData?.doctors ?? []}
                sessionId={activeSessionId}
                dateFrom={payoutFrom}
                dateTo={payoutTo}
                dateRangeError={payoutRangeValid ? null : 'From date cannot be after To date.'}
                availableCash={availableDrawerCash}
                onDateRangeChange={(from, to) => {
                  setPayoutFrom(from);
                  setPayoutTo(to);
                }}
              />
            </>
          ) : null}
          {activeTab === 'expense' ? <ExpensePaymentPanel /> : null}
          {activeTab === 'transfer' ? <CashTransferPanel sessionId={activeSessionId} availableCash={availableDrawerCash} /> : null}
          {activeTab === 'bank' ? <BankDepositPanel sessionId={activeSessionId} availableCash={availableDrawerCash} /> : null}
          {activeTab === 'close' ? (
            <CloseShiftPanel
              sessionId={activeSessionId}
              expectedCash={currentDrawerBalance}
              heldRefundCash={heldRefundCash}
              availableCash={availableDrawerCash}
            />
          ) : null}
        </div>
        <RecentCashActivity
          activity={activityData?.activity ?? []}
          overview={overviewData?.overview}
          hospitalName={hospitalName}
          generatedBy={generatedBy}
          dateFrom={dateFrom || activityData?.session?.dateFrom || undefined}
          dateTo={dateTo || activityData?.session?.dateTo || undefined}
          queryFilters={monitorFilters}
          defaultScope={printScopeByTab[activeTab]}
        />
      </section>
      </main>
    </div>
    </DashboardLayout>
  );
}
