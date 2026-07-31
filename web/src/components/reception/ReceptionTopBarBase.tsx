import { useEffect, useMemo, useState } from 'react';
import { Banknote, Bell, CheckCircle2, LogOut, Search, UserPlus, X, Siren } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { getRoleBasePath } from '../../lib/handover';
import { logout, useAuth } from '../../hooks/useAuth';
import { useCurrentUserAccess } from '../../hooks/useCurrentUserAccess';
import { api, ApiClientError } from '../../lib/apiClient';
import ReceptionPatientDrawer from './ReceptionPatientDrawer';
import { getPermissionsForRole } from '@shared/authz';

const TOPBAR_SEARCH_DEBOUNCE_MS = 600;
const TOPBAR_SEARCH_STALE_MS = 60_000;
// Counter ownership changes during handover/take-over, so keep this short to avoid stale session IDs.
const TOPBAR_COUNTER_STALE_MS = 30_000;

type PatientOption = {
  id: number;
  name: string;
  patient_code?: string | null;
  mobile?: string | null;
  age?: number | null;
  gender?: string | null;
};

type GlobalPatientOption = {
  id: number;
  uhid: string;
  primary_name: string;
  primary_phone?: string | null;
  primary_email?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  linked_patient_id?: number | null;
};

type ActiveCounterResponse = {
  active: boolean;
  session?: {
    id?: number;
    counterName?: string;
    counterCode?: string | null;
    expectedCash?: number;
    heldRefundCash?: number;
    availableCash?: number;
  } | null;
};

type HandoverRecipient = { id: number; name: string; email?: string | null; role?: string | null };
type PendingHandover = {
  id: number;
  handover_amount: number;
  due_amount?: number | null;
  created_at?: string | null;
  handover_by_name?: string | null;
  counter_name?: string | null;
  counter_code?: string | null;
};

type SessionMovement = {
  id: number;
  movementType: string;
  amount: number;
  description: string;
  createdAt: string;
};

type AllCountersResponse = {
  counters: Array<{
    id: number;
    counter_name: string;
    counter_code: string | null;
    counter_type: string | null;
    location: string | null;
    active_session: {
      id: number;
      employee_id: number;
      employee_name: string | null;
      employee_role: string | null;
      opening_cash: number;
      expected_cash: number;
      opened_at: string | null;
      session_no: string | null;
    } | null;
  }>;
};

type TakeOverResponse = {
  message: string;
  session: {
    id: number;
    sessionNo: string;
    counterId: number;
    counterName: string;
    counterCode: string | null;
    counterType: string;
    openingCash: number;
  };
};

type AcceptHandoverResponse = {
  mode?: 'added_to_existing_session' | 'started_new_session';
};

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-IN');
}

function formatAgeLabel(age: unknown) {
  const numericAge = Number(age);
  if (!Number.isFinite(numericAge) || numericAge < 0) return null;
  return `${Math.floor(numericAge)} yrs`;
}

function calculateAgeFromDateOfBirth(dateOfBirth?: string | null) {
  if (!dateOfBirth) return null;
  const birthDate = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return age >= 0 && age <= 130 ? age : null;
}

function newBankDepositAttemptKey() {
  return `topbar-bank-deposit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const DEFAULT_EXPENSE_CATEGORIES = [
  { value: 'Tea / Snacks', labelKey: 'teaSnacks', defaultLabel: 'Tea/snacks' },
  { value: 'Stationery', labelKey: 'stationery', defaultLabel: 'Stationery' },
  { value: 'Transport / Rickshaw', labelKey: 'transportRickshaw', defaultLabel: 'Transport/rickshaw' },
  { value: 'Maintenance', labelKey: 'maintenance', defaultLabel: 'Maintenance' },
  { value: 'Cleaning', labelKey: 'cleaning', defaultLabel: 'Cleaning' },
  { value: 'Other', labelKey: 'other', defaultLabel: 'Other' },
];

export default function ReceptionTopBar({
  role = 'reception',
  onCreatePatient,
  onQuickAdmit,
  quickAdmitPending = false,
  onManageIpdBilling,
  initialShiftModalOpen = false,
}: {
  role?: string;
  onCreatePatient?: (searchTerm: string, options?: { familyMobile?: string; guardianName?: string }) => void;
  onQuickAdmit?: () => void;
  quickAdmitPending?: boolean;
  onManageIpdBilling?: (admission: { patientId: number; admissionId: number }) => void;
  initialShiftModalOpen?: boolean;
}) {
  const { t } = useTranslation(['billing', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const currentUserAccess = useCurrentUserAccess(Boolean(user));
  const effectivePermissions = useMemo(() => {
    const livePermissions = currentUserAccess.data?.effective_permissions;
    if (livePermissions) return livePermissions;
    const explicitPermissions = user?.permissions ?? [];
    return explicitPermissions.length > 0
      ? explicitPermissions
      : getPermissionsForRole(user?.role ?? role);
  }, [currentUserAccess.data?.effective_permissions, role, user?.permissions, user?.role]);
  const canTakeOverCounter = effectivePermissions.includes('*')
    || effectivePermissions.includes('billing.counter.takeover');
  const basePath = getRoleBasePath(slug, role);
  const [search, setSearch] = useState('');
  const [drawerPatientId, setDrawerPatientId] = useState<number | null>(null);
  const [shiftModalOpen, setShiftModalOpen] = useState(initialShiftModalOpen);
  const [physicalCash, setPhysicalCash] = useState('');
  const [handoverTo, setHandoverTo] = useState('');
  const [handoverRemarks, setHandoverRemarks] = useState('');
  const [acceptCash, setAcceptCash] = useState('');
  const [acceptRemarks, setAcceptRemarks] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [cashMovementAmount, setCashMovementAmount] = useState('');
  const [cashMovementType, setCashMovementType] = useState<'cash_in' | 'cash_out'>('cash_out');
  const [cashMovementReason, setCashMovementReason] = useState('');
  const [bankDepositAmount, setBankDepositAmount] = useState('');
  const [bankDepositBankName, setBankDepositBankName] = useState('');
  const [bankDepositNote, setBankDepositNote] = useState('');
  const [bankDepositAttemptKey, setBankDepositAttemptKey] = useState(() => newBankDepositAttemptKey());
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('');
  const [expensePaidTo, setExpensePaidTo] = useState('');
  const [expenseNote, setExpenseNote] = useState('');
  const [counterDropdownOpen, setCounterDropdownOpen] = useState(false);
  const [takeOverModalOpen, setTakeOverModalOpen] = useState(false);
  const [takeOverTarget, setTakeOverTarget] = useState<AllCountersResponse['counters'][0] | null>(null);
  const trimmedSearch = search.trim();
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(trimmedSearch), TOPBAR_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmedSearch]);

  useEffect(() => {
    if (!shiftModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShiftModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shiftModalOpen]);

  useEffect(() => {
    if (!counterDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-counter-dropdown]')) {
        setCounterDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCounterDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [counterDropdownOpen]);

  useEffect(() => {
    if (!takeOverModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setTakeOverModalOpen(false);
        setTakeOverTarget(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [takeOverModalOpen]);

  const { data: patientsData } = useApiQuery<{ patients: PatientOption[] }>(
    ['reception', 'top-search', debouncedSearch],
    `/api/patients?search=${encodeURIComponent(debouncedSearch)}&limit=8`,
    { enabled: debouncedSearch.length >= 2, staleTime: TOPBAR_SEARCH_STALE_MS },
  );
  const { data: globalPatientsData } = useApiQuery<{ results: GlobalPatientOption[] }>(
    ['reception', 'top-global-search', debouncedSearch],
    `/api/patients/global-search?q=${encodeURIComponent(debouncedSearch)}`,
    { enabled: /^\d{11}$/.test(debouncedSearch), staleTime: TOPBAR_SEARCH_STALE_MS },
  );
  const { data: activeCounterData } = useApiQuery<ActiveCounterResponse>(
    ['billing-counter', 'active-session', 'topbar'],
    '/api/billing-counter/sessions/active',
    { staleTime: TOPBAR_COUNTER_STALE_MS },
  );
  const { data: handoverRecipientsData } = useApiQuery<{ recipients: HandoverRecipient[] }>(
    ['billing-counter', 'handover-recipients', 'topbar'],
    '/api/billing-counter/handover-recipients',
    { enabled: shiftModalOpen, staleTime: 60_000 },
  );
  const { data: pendingHandoversData } = useApiQuery<{ handovers: PendingHandover[] }>(
    ['billing-counter', 'pending-handovers', 'me'],
    '/api/billing-counter/handovers/pending',
    { staleTime: TOPBAR_COUNTER_STALE_MS },
  );

  const { data: allCountersData, isLoading: allCountersLoading } = useApiQuery<AllCountersResponse>(
    ['billing-counter', 'all-with-counters'],
    '/api/billing-counter/sessions/all-with-counters',
    { staleTime: TOPBAR_COUNTER_STALE_MS },
  );

  const ownCounterFromStatus = (allCountersData?.counters ?? []).find((counter) =>
    counter.active_session && String(counter.active_session.employee_id) === String(user?.userId ?? '')
  ) ?? null;
  const inferredActiveSession = ownCounterFromStatus?.active_session
    ? {
      id: ownCounterFromStatus.active_session.id,
      counterName: ownCounterFromStatus.counter_name,
      counterCode: ownCounterFromStatus.counter_code,
      expectedCash: ownCounterFromStatus.active_session.expected_cash,
      heldRefundCash: 0,
      availableCash: ownCounterFromStatus.active_session.expected_cash,
    }
    : null;
  const activeCounter = activeCounterData?.session ?? inferredActiveSession;
  const hasActiveCounter = Boolean(activeCounterData?.active || inferredActiveSession);

  const { data: sessionMovementsData } = useApiQuery<{ movements: SessionMovement[] }>(
    ['billing-counter', 'session-movements', activeCounter?.id],
    `/api/billing-counter/sessions/${activeCounter?.id}/movements`,
    { enabled: shiftModalOpen && !!activeCounter?.id, staleTime: TOPBAR_COUNTER_STALE_MS },
  );

  const searchResults = useMemo(() => (patientsData?.patients ?? []).slice(0, 6), [patientsData?.patients]);
  const globalResults = useMemo(() => {
    if (searchResults.length > 0) return [];
    return (globalPatientsData?.results ?? []).slice(0, 6);
  }, [globalPatientsData?.results, searchResults.length]);
  const hasSearchResults = searchResults.length > 0 || globalResults.length > 0;
  const openCreatePatient = (searchTerm: string, options?: { familyMobile?: string; guardianName?: string }) => {
    if (onCreatePatient) {
      onCreatePatient(searchTerm, options);
      return;
    }
    const params = new URLSearchParams();
    params.set('newPatient', searchTerm);
    if (options?.familyMobile) params.set('familyMobile', options.familyMobile);
    if (options?.guardianName) params.set('guardianName', options.guardianName);
    window.location.href = `${basePath}/dashboard?${params.toString()}`;
  };
  const expectedCash = Number(activeCounter?.expectedCash ?? 0);
  const heldRefundCash = Number(activeCounter?.heldRefundCash ?? 0);
  const availableCash = Number(activeCounter?.availableCash ?? Math.max(0, expectedCash - heldRefundCash));
  const declaredCash = physicalCash === '' ? availableCash : Number(physicalCash);
  const variance = declaredCash - availableCash;
  const bankDepositNumericAmount = Number(bankDepositAmount);
  const bankDepositAmountExceedsCash = bankDepositAmount !== '' && bankDepositNumericAmount > availableCash;
  const expenseNumericAmount = Number(expenseAmount);
  const expenseAmountExceedsCash = expenseAmount !== '' && expenseNumericAmount > availableCash;
  const trimmedExpensePaidTo = expensePaidTo.trim();
  const trimmedExpenseNote = expenseNote.trim();
  const expenseFormInvalid =
    !hasActiveCounter ||
    expenseAmount === '' ||
    !Number.isFinite(expenseNumericAmount) ||
    expenseNumericAmount <= 0 ||
    expenseCategory === '' ||
    (trimmedExpensePaidTo === '' && trimmedExpenseNote === '');
  const expenseAmountOverCash = expenseAmount !== '' && expenseNumericAmount > availableCash;
  const pendingHandover = pendingHandoversData?.handovers?.[0] ?? null;
  const pendingHandoverExpected = pendingHandover
    ? Math.max(0, Number(pendingHandover.handover_amount ?? 0) - Number(pendingHandover.due_amount ?? 0))
    : 0;
  const openBillingCounterActivation = (counterId?: number) => {
    navigate(`${basePath}/billing-counter${counterId ? `?counterId=${counterId}` : ''}`);
  };
  const closeCounter = useApiMutation<unknown, { closingCash: number; handoverTo: number; handoverAmount: number; remarks?: string }>(
    'post',
    () => `/api/billing-counter/sessions/${activeCounter?.id ?? 0}/close`,
    {
      onSuccess: () => {
        toast.success(t('shiftHandoverInitiated', { defaultValue: 'Shift handover initiated' }));
        void api
          .post<{ message: string }>('/api/auth/logout', {})
          .catch((error) => {
            if (!(error instanceof ApiClientError)) {
              console.warn('Logout request failed:', error);
            }
          })
          .finally(() => {
            logout();
            window.location.href = `/h/${slug}/login`;
          });
      },
      onError: (error) => toast.error(error.message || t('failedHandoverShift', { defaultValue: 'Failed to handover shift' })),
    },
  );
  const acceptHandover = useApiMutation<AcceptHandoverResponse, { handoverId: number; receivedAmount: number; remarks?: string; disputeReason?: string }>(
    'post',
    (vars) => `/api/billing-counter/handovers/${vars.handoverId}/accept`,
    {
      onSuccess: (response) => {
        const successMessage = response?.mode === 'added_to_existing_session'
          ? t('handoverAddedToCurrentDrawer', { defaultValue: 'Handover added to current drawer' })
          : disputeReason.trim()
            ? t('handoverAcceptedWithDispute', { defaultValue: 'Handover accepted with dispute' })
            : t('shiftStartedFromHandover', { defaultValue: 'Shift started' });
        toast.success(successMessage);
        // Stash the just-accepted handover amount so the activate form on the billing
        // counter page can pre-fill the opening cash. The backend also has a safety
        // net that pre-fills from the same handover if the frontend misses it.
        try {
          if (pendingHandover) {
            const expected = Math.max(0, Number(pendingHandover.handover_amount ?? 0) - Number(pendingHandover.due_amount ?? 0));
            sessionStorage.setItem(
              `hms.${slug}.acceptedHandover`,
              JSON.stringify({ handoverId: pendingHandover.id, expectedAmount: expected, acceptedAt: Date.now() }),
            );
          }
        } catch {
          // sessionStorage may be unavailable; backend safety net still applies.
        }
        setAcceptCash('');
        setAcceptRemarks('');
        setDisputeReason('');
        queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
      },
      onError: (error) => toast.error(error.message || t('failedAcceptHandover', { defaultValue: 'Failed to accept handover' })),
    },
  );
  const recordCashMovement = useApiMutation<unknown, { amount: number; movementType: 'cash_in' | 'cash_out'; reason: string }>(
    'post',
    () => `/api/billing-counter/sessions/${activeCounter?.id}/cash-movement`,
    {
      onSuccess: () => {
        toast.success(t('cashMovementRecorded', { defaultValue: 'Cash movement recorded' }));
        setCashMovementAmount('');
        setCashMovementReason('');
        queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
        queryClient.invalidateQueries({ queryKey: ['reception'] });
      },
      onError: (error) => toast.error(error.message || t('failedRecordCashMovement', { defaultValue: 'Failed to record cash movement' })),
    },
  );
  const createBankDepositRequest = useApiMutation<unknown, { amount: number; proposedBankName?: string; note?: string; idempotencyKey: string }>(
    'post',
    () => `/api/billing-counter/sessions/${activeCounter?.id}/bank-deposit-requests`,
    {
      onSuccess: () => {
        toast.success(t('bankDepositRequestCreated', { defaultValue: 'Bank deposit request created' }));
        setBankDepositAmount('');
        setBankDepositBankName('');
        setBankDepositNote('');
        setBankDepositAttemptKey(newBankDepositAttemptKey());
        queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
        queryClient.invalidateQueries({ queryKey: ['reception'] });
      },
      onError: (error) => toast.error(error.message || t('failedCreateBankDepositRequest', { defaultValue: 'Failed to create bank deposit request' })),
    },
  );
  const createExpensePayment = useApiMutation<unknown, { date: string; category: string; amount: number; description?: string }>(
    'post',
    '/api/expenses',
    {
      onSuccess: () => {
        toast.success(t('expensePaymentRecorded', { defaultValue: 'Expense payment recorded' }));
        setExpenseAmount('');
        setExpenseCategory('');
        setExpensePaidTo('');
        setExpenseNote('');
        queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
        queryClient.invalidateQueries({ queryKey: ['reception'] });
      },
      onError: (error) => toast.error(error.message || t('failedRecordExpensePayment', { defaultValue: 'Failed to record expense payment' })),
    },
  );
  const takeOverCounter = useApiMutation<TakeOverResponse, { sessionId: number }>(
    'post',
    (vars) => `/api/billing-counter/sessions/${vars.sessionId}/take-over`,
    {
      onSuccess: () => {
        toast.success(t('counterTakenOver', { defaultValue: 'Counter taken over successfully' }));
        setTakeOverModalOpen(false);
        setTakeOverTarget(null);
        setCounterDropdownOpen(false);
        queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
        queryClient.invalidateQueries({ queryKey: ['reception'] });
      },
      onError: (error) => toast.error(error.message || t('failedTakeOver', { defaultValue: 'Failed to take over counter' })),
    },
  );

  const { mutate: createSupportTicket, isPending: isSupportPending } = useApiMutation<any, any>(
    'post',
    '/api/helpdesk/tickets',
    {
      onSuccess: () => toast.success(t('supportAlertSent', { defaultValue: 'Support alert sent to floor team' })),
      onError: (error: any) => toast.error(error.message || t('supportAlertFailed', { defaultValue: 'Failed to send support alert' })),
    }
  );

  const handleSupportAlert = () => {
    createSupportTicket({
      title: 'Reception Support Request',
      description: 'Urgent support requested at the Reception desk.',
      category: 'security',
      priority: 'high',
      source: 'web',
    });
  };

  const linkGlobalPatient = useApiMutation<{ patientId: number; patient?: PatientOption }, { uhid: string }>(
    'post',
    '/api/patients/link-global',
    {
      onSuccess: (data) => {
        toast.success(t('patientLinkedToHospital', { defaultValue: 'Patient linked to this hospital' }));
        queryClient.invalidateQueries({ queryKey: ['patients'] });
        queryClient.invalidateQueries({ queryKey: ['reception'] });
        if (data.patientId) setDrawerPatientId(Number(data.patientId));
        setSearch('');
      },
      onError: (error) => toast.error(error.message || t('failedLinkPatient', { defaultValue: 'Failed to link patient' })),
    },
  );

  return (
    <>
      <div className="sticky top-0 z-10 overflow-visible rounded-xl border border-[var(--color-border)] bg-white/95 p-3 shadow-sm backdrop-blur dark:bg-slate-900/95">
        <div className="grid gap-2 sm:gap-3 lg:grid-cols-[minmax(260px,1fr)_auto] lg:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
            <input
              type="search"
              name="reception-patient-search"
              autoComplete="off"
              aria-label={t('searchPatientPlaceholder', { defaultValue: "Search Patient (Phone/ID) or Type 'EMR' for Emergency..." })}
              className="input h-12 pl-9 pr-10 text-base"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  if (search.trim().toUpperCase() === 'EMR') {
                    event.preventDefault();
                    onQuickAdmit?.();
                    setSearch('');
                    return;
                  }
                  if (searchResults[0]?.id) {
                    setDrawerPatientId(searchResults[0].id);
                    setSearch('');
                  }
                }
              }}
              placeholder={t('searchPatientPlaceholder', { defaultValue: "Search Patient (Phone/ID) or Type 'EMR' for Emergency..." })}
            />
            {onQuickAdmit && (
              <button
                type="button"
                onClick={() => { onQuickAdmit(); setSearch(''); }}
                disabled={quickAdmitPending}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-red-500 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
                title={t('emergencyQuickAdmit', { defaultValue: 'Emergency Quick Admit' })}
                aria-label={t('emergencyQuickAdmit', { defaultValue: 'Emergency Quick Admit' })}
              >
                <Siren className="h-4 w-4 animate-pulse" aria-hidden="true" />
              </button>
            )}
            {trimmedSearch.length >= 2 ? (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[min(60vh,26rem)] overflow-y-auto overflow-x-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-xl dark:bg-slate-900" role="listbox" aria-label={t('patientSearchResults', { defaultValue: 'Patient search results' })}>
                {searchResults.length > 0 ? (
                  <>
                    <div className="bg-[var(--color-bg-secondary)] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t('thisHospital', { defaultValue: 'This Hospital' })}</div>
                    {searchResults.map((patient) => {
                      const ageLabel = formatAgeLabel(patient.age);
                      return (
                        <div
                          key={patient.id}
                          className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3 text-sm last:border-b-0 hover:bg-[var(--color-bg-secondary)]"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setDrawerPatientId(patient.id);
                              setSearch('');
                            }}
                            aria-label={t('openPatientRecord', { defaultValue: 'Open patient record for {{name}}', name: patient.name })}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="min-w-0 truncate font-medium">{patient.name}</span>
                              {ageLabel ? (
                                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  {ageLabel}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-xs text-[var(--color-text-muted)]">{patient.patient_code ?? `#${patient.id}`} {patient.mobile ? `- ${patient.mobile}` : ''}</span>
                          </button>
                          {patient.mobile ? (
                            <button
                              type="button"
                              onClick={() => {
                                openCreatePatient(patient.mobile ?? trimmedSearch, { familyMobile: patient.mobile ?? undefined, guardianName: patient.name });
                                setSearch('');
                              }}
                              aria-label={t('addFamilyMemberFor', { defaultValue: 'Add family member for {{name}}', name: patient.name })}
                              className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                            >
                              {t('addFamily', { defaultValue: 'Add family' })}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </>
                ) : null}
                {globalResults.length > 0 ? (
                  <>
                    <div className="border-t border-blue-100 bg-blue-50 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:bg-blue-950">{t('globalRegistry', { defaultValue: 'Global Registry' })}</div>
                    {globalResults.map((patient) => {
                      const ageLabel = formatAgeLabel(calculateAgeFromDateOfBirth(patient.date_of_birth));
                      return (
                        <div
                          key={patient.uhid}
                          className="flex w-full items-center justify-between gap-3 border-b border-blue-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-blue-50 dark:hover:bg-blue-950"
                        >
                          <button
                            type="button"
                            disabled={linkGlobalPatient.isPending}
                            onClick={() => {
                              if (patient.linked_patient_id) {
                                setDrawerPatientId(Number(patient.linked_patient_id));
                                setSearch('');
                                return;
                              }
                              linkGlobalPatient.mutate({ uhid: patient.uhid });
                            }}
                            aria-label={patient.linked_patient_id
                              ? t('openLinkedPatientRecord', { defaultValue: 'Open linked patient record for {{name}}', name: patient.primary_name })
                              : t('linkGlobalPatientRecord', { defaultValue: 'Link global patient record for {{name}}', name: patient.primary_name })}
                            className="min-w-0 flex-1 text-left disabled:opacity-60"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="min-w-0 truncate font-medium text-blue-900 dark:text-blue-200">{patient.primary_name}</span>
                              {ageLabel ? (
                                <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                                  {ageLabel}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-xs text-blue-600 dark:text-blue-300">{patient.primary_phone ?? 'No phone'} - {patient.uhid}</span>
                          </button>
                          <div className="flex shrink-0 items-center gap-2">
                            {patient.primary_phone ? (
                              <button
                                type="button"
                                onClick={() => {
                                  openCreatePatient(patient.primary_phone ?? trimmedSearch, { familyMobile: patient.primary_phone ?? undefined, guardianName: patient.primary_name });
                                  setSearch('');
                                }}
                                aria-label={t('addFamilyMemberFor', { defaultValue: 'Add family member for {{name}}', name: patient.primary_name })}
                                className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                              >
                                {t('addFamily', { defaultValue: 'Add family' })}
                              </button>
                            ) : null}
                            <span className="rounded bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                              {patient.linked_patient_id ? t('open', { defaultValue: 'Open' }) : t('link', { defaultValue: 'Link' })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : null}
                {!hasSearchResults ? (
                  <button
                    type="button"
                      onClick={() => {
                        openCreatePatient(trimmedSearch);
                        setSearch('');
                      }}
                      aria-label={t('addNewPatientFor', { defaultValue: 'Add new patient for "{{searchTerm}}"', searchTerm: trimmedSearch })}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-[var(--color-primary)] hover:bg-blue-50"
                    >
                      <UserPlus className="h-4 w-4" aria-hidden="true" />
                    {t('addNewPatientFor', { defaultValue: 'Add new patient for "{{searchTerm}}"', searchTerm: trimmedSearch })}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" data-counter-dropdown>
              <button
                type="button"
                onClick={() => setCounterDropdownOpen(!counterDropdownOpen)}
                className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium ${hasActiveCounter ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
              >
                <Banknote className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {hasActiveCounter
                    ? t('shiftActive', { defaultValue: 'Shift Active: ৳{{amount}}', amount: money(activeCounter?.availableCash ?? activeCounter?.expectedCash) })
                    : t('openCounter', { defaultValue: 'Open counter' })}
                </span>
              </button>

              {counterDropdownOpen ? (
                <div className="absolute left-0 top-full z-40 mt-2 w-[calc(100vw-4rem)] max-w-[20rem] max-h-[min(60vh,24rem)] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white shadow-xl sm:left-auto sm:right-0 sm:w-80 dark:bg-slate-900">
                  <div className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-2.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                      {t('counterStatus', { defaultValue: 'Counter Status' })}
                    </div>
                  </div>
                  {allCountersLoading ? (
                    <div className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
                      {t('loading', { ns: 'common', defaultValue: 'Loading…' })}
                    </div>
                  ) : (allCountersData?.counters ?? []).length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
                      {t('noCounters', { defaultValue: 'No counters configured' })}
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--color-border)]">
                      {(allCountersData?.counters ?? []).map((counter) => {
                        const isActive = counter.active_session != null;
                        const isOwnSession = isActive && (
                          activeCounter?.id === counter.active_session?.id
                          || String(counter.active_session?.employee_id ?? '') === String(user?.userId ?? '')
                        );
                        return (
                          <div key={counter.id} className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`inline-block h-2 w-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                                {counter.counter_name}
                                {counter.counter_code ? <span className="ml-1 text-xs text-[var(--color-text-muted)]">({counter.counter_code})</span> : null}
                              </span>
                            </div>
                            {isActive && counter.active_session ? (
                              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-muted)]">
                                  <span className="font-medium text-[var(--color-text-primary)]">{counter.active_session.employee_name}</span>
                                  <span className="mx-1.5">·</span>
                                  <span className="font-data font-semibold text-emerald-700">৳{money(counter.active_session.expected_cash)}</span>
                                </div>
                                {isOwnSession ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                      {t('yours', { defaultValue: 'Yours' })}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigate(`${basePath}/cash-operations`);
                                        setCounterDropdownOpen(false);
                                      }}
                                      className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                                    >
                                      {t('cashOperations', { defaultValue: 'Cash Operations' })}
                                    </button>
                                  </div>
                                ) : canTakeOverCounter ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTakeOverTarget(counter);
                                      setTakeOverModalOpen(true);
                                      setCounterDropdownOpen(false);
                                    }}
                                    className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
                                  >
                                    {t('takeOver', { defaultValue: 'Take Over' })}
                                  </button>
                                ) : (
                                  <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                    {t('active', { defaultValue: 'Active' })}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs text-[var(--color-text-muted)]">{t('inactive', { defaultValue: 'Inactive' })}</span>
                                {hasActiveCounter ? null : (
	                                  <button
	                                    type="button"
	                                    onClick={() => {
	                                      openBillingCounterActivation(counter.id);
	                                      setCounterDropdownOpen(false);
	                                    }}
                                    className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                                  >
                                    {t('openCounter', { defaultValue: 'Open counter' })}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Support Alert Button */}
            <button
              type="button"
              disabled={isSupportPending}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-800 disabled:opacity-50"
              onClick={handleSupportAlert}
            >
                <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t('support', { defaultValue: 'Support' })}</span>
            </button>

            {onQuickAdmit && (
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                onClick={() => { onQuickAdmit(); }}
                disabled={quickAdmitPending}
              >
                  <Siren className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" />
                <span className="truncate">{t('emergency', { defaultValue: 'Emergency' })}</span>
              </button>
            )}

            <button
              type="button"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
              onClick={() => {
                if (confirm(t('logoutConfirm', { defaultValue: 'Logout now?' }))) {
                  // Drop the HttpOnly refresh cookie + blacklist the
                  // access token before clearing in-memory state. The
                  // apiFetch wrapper sends credentials: 'include'.
                  void api
                    .post<{ message: string }>('/api/auth/logout', {})
                    .catch((error) => {
                      if (!(error instanceof ApiClientError)) {
                        console.warn('Logout request failed:', error);
                      }
                    })
                    .finally(() => {
                      logout();
                      window.location.href = `/h/${slug}/login`;
                    });
                }
              }}
            >
                <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t('logout', { defaultValue: 'Logout' })}</span>
            </button>
          </div>
        </div>
      </div>
      <ReceptionPatientDrawer
        patientId={drawerPatientId}
        basePath={basePath}
        onClose={() => setDrawerPatientId(null)}
        onManageIpdBilling={onManageIpdBilling}
      />
      {shiftModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="reception-shift-handover-title">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] p-5">
              <div>
                <h2 id="reception-shift-handover-title" className="text-xl font-semibold">{t('shiftHandoverTitle', { defaultValue: 'Shift Handover' })}</h2>
                <p className="text-sm text-[var(--color-text-muted)]">{t('shiftHandoverDesc', { defaultValue: 'Close active counter and hand cash to next user. Manual amount-only handovers are disabled.' })}</p>
              </div>
              <button type="button" className="btn-ghost p-1.5" onClick={() => setShiftModalOpen(false)} aria-label={t('closeShiftHandover', { defaultValue: 'Close shift handover' })}>
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              {!activeCounter ? (
                <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{t('noActiveShift', { defaultValue: 'No active shift found. Open a billing counter before handover.' })}</div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                      <div className="text-xs text-[var(--color-text-muted)]">Expected drawer cash</div>
                      <div className="font-data text-xl font-semibold text-[var(--color-text-primary)]">৳{money(expectedCash)}</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-3">
                      <div className="text-xs text-amber-700">Pending refund reserve</div>
                      <div className="font-data text-xl font-semibold text-amber-900">৳{money(heldRefundCash)}</div>
                    </div>
                    <div className="rounded-lg bg-emerald-50 p-3">
                      <div className="text-xs text-emerald-700">Available handover cash</div>
                      <div className="font-data text-xl font-semibold text-emerald-900">৳{money(availableCash)}</div>
                    </div>
                    <div>
                      <label className="label">Available cash counted *</label>
                      <input aria-label="Available cash counted for handover" className="input" type="number" min={0} name="physicalCash" value={physicalCash} onChange={(event) => setPhysicalCash(event.target.value)} placeholder={String(availableCash)} />
                    </div>
                  </div>
                  {variance !== 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="text-sm font-semibold text-amber-900">{t('varianceAmount', { defaultValue: 'Variance {{amount}}', amount: formatSignedMoney(variance) })}</div>
                      <label className="label mt-2">{t('varianceReasonRequired', { defaultValue: 'Shortage / excess reason *' })}</label>
                        <textarea className="input min-h-20" name="handoverVarianceReason" value={handoverRemarks} onChange={(event) => setHandoverRemarks(event.target.value)} placeholder={t('explainMismatch', { defaultValue: 'Explain the mismatch before handover.' })} />
                    </div>
                  ) : null}
                  <div>
                    <label className="label" htmlFor="reception-handover-to">{t('handoverToRequired', { defaultValue: 'Handover To *' })}</label>
                      <select id="reception-handover-to" className="input" name="handoverTo" value={handoverTo} onChange={(event) => setHandoverTo(event.target.value)}>
                      <option value="">{t('selectNextRecipient', { defaultValue: 'Select next receptionist/admin' })}</option>
                      {(handoverRecipientsData?.recipients ?? []).map((user) => (
                        <option key={user.id} value={user.id}>{user.name} {user.role ? `- ${user.role}` : ''}</option>
                      ))}
                    </select>
                  </div>
                  {variance === 0 ? (
                    <div>
                      <label className="label">{t('remarks', { defaultValue: 'Remarks' })}</label>
                        <input className="input" name="handoverRemarks" value={handoverRemarks} onChange={(event) => setHandoverRemarks(event.target.value)} placeholder={t('handoverNotePlaceholder', { defaultValue: 'Optional handover note' })} />
                    </div>
                  ) : null}
                  <div className="flex justify-end gap-3">
                      <button type="button" className="btn-secondary" onClick={() => setShiftModalOpen(false)}>{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button>
                    <button
                      className="btn-primary"
                      disabled={closeCounter.isPending || !handoverTo || (variance !== 0 && !handoverRemarks.trim())}
                      onClick={() => closeCounter.mutate({
                        closingCash: declaredCash,
                        handoverAmount: declaredCash,
                        handoverTo: Number(handoverTo),
                        remarks: handoverRemarks.trim() || undefined,
                      })}
                    >
                        {closeCounter.isPending ? t('submitting', { ns: 'common', defaultValue: 'Submitting…' }) : t('initiateShiftHandover', { defaultValue: 'Initiate Handover & Logout' })}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {pendingHandover ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="reception-pending-handover-title">
            <div className="mb-4 flex items-start gap-3">
              <CheckCircle2 className="mt-1 h-6 w-6 text-emerald-600" aria-hidden="true" />
              <div>
                <h2 id="reception-pending-handover-title" className="text-2xl font-semibold">{t('pendingForMe', { defaultValue: 'Pending Handover' })}</h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {t('pendingHandoverDetails', {
                    defaultValue: '{{user}} handed over {{amount}}{{counter}}. Count cash before starting shift.',
                    user: pendingHandover.handover_by_name ?? t('previousUser', { defaultValue: 'Previous user' }),
                    amount: formatBDT(pendingHandoverExpected),
                    counter: pendingHandover.counter_name ? t('fromCounter', { defaultValue: ' from {{counterName}}', counterName: pendingHandover.counter_name }) : '',
                  })}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-emerald-50 p-4">
                <div className="text-xs text-emerald-700">{t('systemCash', { defaultValue: 'Expected cash' })}</div>
                <div className="font-data text-2xl font-semibold text-emerald-900">{formatBDT(pendingHandoverExpected)}</div>
              </div>
              <div>
                <label className="label">{t('cashCountedRequired', { defaultValue: 'Cash counted *' })}</label>
                <input className="input" type="number" min={0} name="acceptCash" value={acceptCash} onChange={(event) => setAcceptCash(event.target.value)} placeholder={String(pendingHandoverExpected)} />
              </div>
            </div>
            {hasActiveCounter ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {t('activeDrawerHandoverReceiveWarning', {
                  defaultValue: 'You already have an active counter drawer. This handover will be added as drawer cash received, not opening cash.',
                })}
              </div>
            ) : null}
            {acceptCash !== '' && Number(acceptCash) !== pendingHandoverExpected ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="text-sm font-semibold text-red-800">{t('mismatchAmount', { defaultValue: 'Mismatch {{amount}}', amount: formatSignedMoney(Number(acceptCash) - pendingHandoverExpected) })}</div>
                <label className="label mt-2">{t('disputeNoteRequired', { defaultValue: 'Dispute / shortage note *' })}</label>
                  <textarea className="input min-h-20" name="handoverDisputeReason" value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} />
              </div>
            ) : null}
            <div className="mt-3">
              <label className="label">{t('acceptanceRemarks', { defaultValue: 'Acceptance remarks' })}</label>
                <input className="input" name="acceptanceRemarks" value={acceptRemarks} onChange={(event) => setAcceptRemarks(event.target.value)} placeholder={t('optionalNote', { defaultValue: 'Optional note' })} />
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                className="btn-primary"
                disabled={acceptHandover.isPending || acceptCash === '' || (Number(acceptCash) !== pendingHandoverExpected && !disputeReason.trim())}
                onClick={() => acceptHandover.mutate({
                  handoverId: pendingHandover.id,
                  receivedAmount: Number(acceptCash),
                  remarks: acceptRemarks.trim() || undefined,
                  disputeReason: disputeReason.trim() || undefined,
                })}
              >
                {acceptHandover.isPending
                  ? t(hasActiveCounter ? 'addingToDrawer' : 'acceptingCash', { ns: 'common', defaultValue: hasActiveCounter ? 'Adding…' : 'Accepting…' })
                  : hasActiveCounter
                    ? t('acceptAndAddToCurrentDrawer', { defaultValue: 'গ্রহণ করে বর্তমান ড্রয়ারে যোগ করুন' })
                    : Number(acceptCash) !== pendingHandoverExpected
                      ? t('acceptCashWithDispute', { defaultValue: 'Accept cash with dispute' })
                      : t('acceptCashOnly', { defaultValue: 'Accept cash only' })}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {takeOverModalOpen && takeOverTarget && takeOverTarget.active_session ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="takeover-title">
            <div className="flex items-start justify-between">
              <h2 id="takeover-title" className="text-xl font-semibold">{t('confirmTakeOver', { defaultValue: 'Confirm Take Over' })}</h2>
              <button type="button" className="btn-ghost p-1.5" onClick={() => { setTakeOverModalOpen(false); setTakeOverTarget(null); }} aria-label={t('closeTakeOver', { defaultValue: 'Close take over dialog' })}>
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              {t('takeOverDescription', {
                defaultValue: '{{counter}} — {{user}} currently active with ৳{{amount}}. You will start a new session with this amount as opening cash.',
                counter: takeOverTarget.counter_name,
                user: takeOverTarget.active_session.employee_name ?? t('unknown', { defaultValue: 'Unknown' }),
                amount: money(takeOverTarget.active_session.expected_cash),
              })}
            </p>
            {activeCounterData?.active ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {t('existingSessionWarning', {
                  defaultValue: 'You already have an active session on {{counter}}. It will need to be closed first.',
                  counter: activeCounterData.session?.counterName ?? '',
                })}
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setTakeOverModalOpen(false); setTakeOverTarget(null); }}
              >
                {t('cancel', { ns: 'common', defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={takeOverCounter.isPending || !!activeCounterData?.active}
                onClick={() => takeOverCounter.mutate({ sessionId: takeOverTarget.active_session!.id })}
              >
                {takeOverCounter.isPending
                  ? t('takingOver', { defaultValue: 'Taking over…' })
                  : t('confirmTakeOverButton', { defaultValue: 'Confirm Take Over' })}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function formatBDT(value: number) {
  return `৳${Number(value ?? 0).toLocaleString('en-IN')}`;
}

function formatSignedMoney(value: number) {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatBDT(value)}`;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
