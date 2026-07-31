import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams, useParams } from 'react-router';
import { getPermissionsForRole } from '@shared/authz';
import { Banknote, CreditCard, LogIn, Plus, Receipt, Search, Trash2, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { useAuth } from '../hooks/useAuth';
import { useCurrentUserAccess } from '../hooks/useCurrentUserAccess';
import ReceptionTopBar from '../components/reception/ReceptionTopBar';
import { formatDoctorName } from '../lib/doctor-display';
import HospitalCombobox, { type HospitalOption } from '../components/HospitalCombobox';
import DoctorCombobox, { type DoctorOption as DoctorComboboxOption } from '../components/DoctorCombobox';
import { formatPatientIdentityText } from '../lib/patientIdentity';
import { resolveBillingInvoiceSubmissionMode } from '../lib/billingInvoiceMode';
import { shouldRotateInvoiceAttemptKey } from '../lib/invoiceIdempotency';
import { normalizeExternalTransactionId, requiresPaymentReference } from '../lib/paymentReference';
import DiscountAllocationEditor, {
  createDefaultDiscountAllocations,
  getDiscountAllocationPayload,
  hasBalancedDiscountAllocations,
  resolveDoctorWaiverPreviewStatus,
  type DiscountAllocationReason,
  type DiscountAllocationRow,
} from '../components/reception/DiscountAllocationEditor';

type ReferredByType = 'self' | 'hospital' | 'doctor';

const COUNTER_SEARCH_DEBOUNCE_MS = 600;
const COUNTER_SEARCH_STALE_MS = 60_000;
const COUNTER_MASTER_STALE_MS = 30 * 60_000;

type Role = 'hospital_admin' | 'reception' | string;

type DenominationKey = 'note1000' | 'note500' | 'note200' | 'note100' | 'note50' | 'note20' | 'note10' | 'note5' | 'note2' | 'note1';
type DenominationPayload = Record<DenominationKey, number>;
const CASH_DENOMINATIONS: Array<{ note: number; key: DenominationKey }> = [
  { note: 1000, key: 'note1000' },
  { note: 500, key: 'note500' },
  { note: 200, key: 'note200' },
  { note: 100, key: 'note100' },
  { note: 50, key: 'note50' },
  { note: 20, key: 'note20' },
  { note: 10, key: 'note10' },
  { note: 5, key: 'note5' },
  { note: 2, key: 'note2' },
  { note: 1, key: 'note1' },
];

function emptyDenominations(): Record<DenominationKey, string> {
  return {
    note1000: '',
    note500: '',
    note200: '',
    note100: '',
    note50: '',
    note20: '',
    note10: '',
    note5: '',
    note2: '',
    note1: '',
  };
}

function buildDenominationPayload(values: Record<DenominationKey, string>): DenominationPayload {
  return CASH_DENOMINATIONS.reduce((payload, row) => {
    payload[row.key] = Math.max(0, Math.round(Number(values[row.key] || 0)));
    return payload;
  }, {} as DenominationPayload);
}


interface PatientOption {
  id: number;
  name: string;
  patient_code?: string | null;
  mobile?: string | null;
  age?: number | string | null;
  date_of_birth?: string | null;
}

interface DoctorOption {
  id: number;
  name: string;
  specialty?: string | null;
  department?: string | null;
  consultation_fee?: number | null;
}

interface VisitOption {
  id: number;
  visit_no?: string | null;
  visit_type?: string | null;
  visit_date?: string | null;
  doctor_id?: number | null;
  doctor_name?: string | null;
  status?: string | null;
}

interface Scheme {
  id: number;
  scheme_name: string;
  scheme_code?: string | null;
  scheme_type?: string | null;
  default_discount_percent?: number | null;
  default_price_category_id?: number | null;
  default_discount_source?: string | null;
  max_discount_amount_per_bill?: number | null;
  max_discount_amount_per_month?: number | null;
  max_discount_amount_per_year?: number | null;
  requires_reference?: boolean;
  is_auto_apply?: boolean;
}

interface DoctorWaiverPreviewResponse {
  doctorId: number;
  eligibleCommissionAmount: number;
  performerReserveAmount: number;
  protectedCommissionAmount: number;
  maximumDoctorWaiverAmount: number;
  doctorWaiverAmount: number;
  payableCommissionAmount: number;
  hospitalFundedAmount: number;
}

interface DoctorWaiverPreviewRequest {
  doctorId: number;
  totalDiscount: number;
  items: Array<{
    itemCategory: string;
    description?: string | null;
    lineTotal: number;
    grossLineTotal: number;
    quantity: number;
    referenceId?: number | null;
  }>;
}

interface SchemePreviewResponse {
  eligible: boolean;
  scheme_id: number | null;
  scheme_name: string | null;
  scheme_code?: string | null;
  scheme_type?: string | null;
  discount_mode: 'percent';
  discount_value: number;
  default_price_category_id?: number | null;
  max_amount_per_bill: number;
  max_amount_per_month?: number;
  max_amount_per_year?: number;
  cap_remaining_month?: number | null;
  cap_remaining_year?: number | null;
  suggested_discount: number;
  allocation_type: string;
  requires_approval: boolean;
  requires_reference: boolean;
  requires_member: boolean;
  matched_member_id?: number | null;
  matched_member_code?: string | null;
  matched_member_name?: string | null;
  service_category?: string | null;
  blockers: string[];
  requested_discount?: number | null;
  applied_discount?: number;
}

interface PriceCategory {
  id: number;
  category_name: string;
  is_default?: boolean;
}

interface ServiceDepartment {
  id: number;
  department_name: string;
  department_code?: string | null;
}

interface BillingCounter {
  id: number;
  counterName?: string;
  counter_name?: string;
  counterCode?: string | null;
  counter_code?: string | null;
  counterType?: string | null;
  counter_type?: string | null;
  location?: string | null;
}

interface HandoverRecipient {
  id: number;
  name: string;
  email?: string | null;
  role: string;
}

interface ActiveCounterSession {
  id: number;
  counterId: number;
  counterName: string;
  counterCode?: string | null;
  counterType: string;
  openingCash: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  heldRefundCash?: number;
  availableCash?: number;
  expectedCashHidden?: boolean;
  cashVisibilityMode?: string;
  appointmentCash?: number;
  testCash?: number;
  discountTotal?: number;
  freeAppointmentCount?: number;
  doctorPayableTotal?: number;
  commissionPayableTotal?: number;
  openedAt: string;
}

interface ActiveCounterResponse {
  active: boolean;
  session: ActiveCounterSession | null;
}

interface ActiveCounterListSession {
  id: number;
  session_no: string;
  employee_id: number;
  cashier_name: string;
  cashier_role: string;
  counter_name: string;
  counter_code: string | null;
  counter_type: string;
  opened_at: string;
}

interface AppointmentBenefitDraft {
  schemeCode: string;
  memberCode: string;
  preview: SchemePreviewResponse | null;
}

interface PendingAppointmentCharge {
  appointment_id: number;
  appt_no?: string | null;
  token_no?: number | null;
  appt_date: string;
  appt_time?: string | null;
  appointment_status: string;
  billing_status: string;
  appointment_fee?: number | null;
  patient_id: number;
  patient_name: string;
  patient_code?: string | null;
  patient_mobile?: string | null;
  doctor_id?: number | null;
  doctor_name?: string | null;
  doctor_specialty?: string | null;
  pending_amount: number;
  pending_item_count: number;
}

interface PendingBill {
  bill_id: number;
  invoice_no?: string | null;
  patient_id: number;
  patient_name: string;
  patient_code?: string | null;
  patient_mobile?: string | null;
  total_amount: number;
  paid_amount: number;
  pending_amount: number;
  status: string;
  created_at: string;
  bill_date?: string | null;
  service_summary?: string | null;
  visit_no?: string | null;
  doctor_name?: string | null;
  item_count: number;
}

interface ServiceItem {
  id: number;
  item_name: string;
  item_code?: string | null;
  department_name?: string | null;
  price: number;
  tax_applicable?: number | boolean | null;
  tax_percent?: number | null;
  allow_discount?: number | boolean | null;
  allow_multiple_qty?: number | boolean | null;
  is_lab_catalog?: number;
  performerPayoutRule?: null | {
    rateType: 'flat' | 'percent';
    rateValue: number;
    displayAmount: number;
    effectiveFrom: string;
  };
}

interface CounterLine {
  sourceType: 'service_item' | 'doctor';
  serviceItem?: ServiceItem;
  doctor?: DoctorOption;
  quantity: number;
  discountAmount: number;
  discountPercent: number;
  discountMode: 'flat' | 'percent';
  performerDoctorId: string;
  prescriberDoctorId: string;
  remarks: string;
}

interface CounterInvoiceResponse {
  message: string;
  billId?: number;
  invoiceNo?: string;
  requestedMode?: 'provisional' | 'paid' | 'credit';
  mode: 'provisional' | 'paid' | 'credit';
  modeAdjusted?: boolean;
  modeAdjustmentReason?: string | null;
  total: number;
  paidAmount?: number;
  depositDeducted?: number;
  dueAmount?: number;
  status?: string;
}

interface DepositBalanceResponse {
  patient_id: number;
  total_deposits: number;
  total_refunds: number;
  total_adjustments: number;
  balance: number;
}

interface BankDepositRequest {
  id: number;
  requestNo: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'resolved' | string;
  proposedBankName?: string | null;
  approvedBankName?: string | null;
  referenceNo?: string | null;
  requestedAt: string;
  rejectedReason?: string | null;
  resolutionType?: string | null;
}

const money = (value: number) => new Intl.NumberFormat('en-BD', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
}).format(value || 0);

function toNumber(value: string | number | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function lineUnitPrice(line: CounterLine) {
  return line.sourceType === 'doctor'
    ? Number(line.doctor?.consultation_fee ?? 0)
    : Number(line.serviceItem?.price ?? 0);
}

function lineLabel(line: CounterLine) {
  return line.sourceType === 'doctor'
    ? `Consultation - ${formatDoctorName(line.doctor?.name)}`
    : line.serviceItem?.item_name ?? '';
}

function lineDepartment(line: CounterLine) {
  return line.sourceType === 'doctor'
    ? line.doctor?.department || line.doctor?.specialty || 'Doctor'
    : line.serviceItem?.department_name || 'General';
}

function lineTotal(line: CounterLine) {
  const gross = lineUnitPrice(line) * line.quantity;
  const discountFromPercent = line.discountMode === 'percent' ? Math.round(gross * line.discountPercent / 100) : 0;
  const discount = Math.min(line.discountMode === 'percent' ? discountFromPercent : line.discountAmount, gross);
  const taxable = line.sourceType === 'service_item'
    && (line.serviceItem?.tax_applicable === 1 || line.serviceItem?.tax_applicable === true);
  const tax = taxable ? Math.round(((gross - discount) * Number(line.serviceItem?.tax_percent || 0)) / 100) : 0;
  return Math.max(0, gross - discount + tax);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function previewCategoryForLine(line: CounterLine): string {
  if (line.sourceType === 'doctor') return 'doctor_visit';
  const text = `${line.serviceItem?.department_name ?? ''} ${line.serviceItem?.item_name ?? ''}`.toLowerCase();
  return /lab|pathology|diagnostic|radiology|imaging|x-?ray|usg|ultra|ecg|cbc/.test(text) ? 'test' : 'other';
}

function canDiscountLine(line: CounterLine) {
  if (line.sourceType === 'doctor') return true;
  return line.serviceItem?.allow_discount !== 0 && line.serviceItem?.allow_discount !== false;
}

function reasonForDiscountSource(source?: string | null) {
  switch (source) {
    case 'charity_discount': return 'poor_patient_charity';
    case 'management_discount': return 'management_approved';
    case 'staff_benefit_discount':
    case 'vip_benefit_discount':
    case 'owner_benefit_discount':
    case 'shareholder_benefit_discount':
    case 'corporate_contract_discount':
    case 'campaign_discount':
    case 'rounding_adjustment':
    case 'doctor_commission_waiver':
    case 'reference_discount':
      return source;
    default:
      return 'normal_hospital_discount';
  }
}

function discountSourceLabel(source?: string | null) {
  switch (source) {
    case 'charity_discount': return 'Charity';
    case 'doctor_commission_waiver': return 'Doctor waiver';
    case 'management_discount': return 'Management';
    case 'reference_discount': return 'Reference';
    case 'staff_benefit_discount': return 'Staff benefit';
    case 'vip_benefit_discount': return 'VIP benefit';
    case 'owner_benefit_discount': return 'Owner benefit';
    case 'shareholder_benefit_discount': return 'Shareholder benefit';
    case 'corporate_contract_discount': return 'Corporate contract';
    case 'campaign_discount': return 'Campaign';
    case 'rounding_adjustment': return 'Rounding';
    default: return 'Hospital discount';
  }
}

function distributeFlatDiscount(lines: CounterLine[], requestedAmount: number): CounterLine[] {
  const eligible = lines
    .map((line, index) => ({ line, index, gross: lineUnitPrice(line) * line.quantity }))
    .filter((row) => row.gross > 0 && canDiscountLine(row.line));
  const eligibleGross = eligible.reduce((sum, row) => sum + row.gross, 0);
  const amount = Math.min(roundMoney(requestedAmount), roundMoney(eligibleGross));
  if (amount <= 0 || eligible.length === 0) return lines;

  let allocated = 0;
  const discountByIndex = new Map<number, number>();
  eligible.forEach((row, position) => {
    const discount = position === eligible.length - 1
      ? roundMoney(amount - allocated)
      : Math.min(row.gross, roundMoney((amount * row.gross) / eligibleGross));
    allocated = roundMoney(allocated + discount);
    discountByIndex.set(row.index, Math.max(0, Math.min(row.gross, discount)));
  });

  return lines.map((line, index) => discountByIndex.has(index)
    ? { ...line, discountMode: 'flat', discountAmount: discountByIndex.get(index) ?? 0, discountPercent: 0 }
    : line);
}

function labelPatient(patient: PatientOption) {
  return `${patient.name} (${formatPatientIdentityText(patient)})`;
}

function newInvoiceAttemptKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `billing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newAppointmentPaymentAttemptKey(appointmentId: number): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `appointment-pay-${appointmentId}-${suffix}`;
}

function newBankDepositAttemptKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `bank-deposit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function BillingCounterPage({ role = 'hospital_admin' }: { role?: Role }) {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const currentUserAccess = useCurrentUserAccess(Boolean(user));
  const { slug = '' } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const urlCounterId = searchParams.get('counterId');
  const normalizedRole = role === 'receptionist' ? 'reception' : role;
  const effectivePermissions = useMemo(() => {
    const livePermissions = currentUserAccess.data?.effective_permissions;
    if (livePermissions) return livePermissions;
    const explicitPermissions = user?.permissions ?? [];
    return explicitPermissions.length > 0
      ? explicitPermissions
      : getPermissionsForRole(user?.role ?? normalizedRole);
  }, [currentUserAccess.data?.effective_permissions, normalizedRole, user?.permissions, user?.role]);
  const canTakeOverCounter = effectivePermissions.includes('*')
    || effectivePermissions.includes('billing.counter.takeover');
  const showAdvancedBillingControls = true;
  const canApplyDiscount = ['hospital_admin', 'md', 'director', 'accountant', 'reception'].includes(normalizedRole);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientSearchDebounced, setPatientSearchDebounced] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [visitId, setVisitId] = useState('');
  const [createWalkInVisit, setCreateWalkInVisit] = useState(true);
  const [schemeId, setSchemeId] = useState('');
  const [schemeCodeInput, setSchemeCodeInput] = useState('');
  const [memberCodeInput, setMemberCodeInput] = useState('');
  const [schemePreview, setSchemePreview] = useState<SchemePreviewResponse | null>(null);
  const [priceCategoryId, setPriceCategoryId] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [serviceSearchDebounced, setServiceSearchDebounced] = useState('');
  const [catalogGroup, setCatalogGroup] = useState<'all' | 'pathology' | 'radiology' | 'services'>('pathology');
  const [doctorSearch, setDoctorSearch] = useState('');
  const [doctorSearchDebounced, setDoctorSearchDebounced] = useState('');
  const [billMode, setBillMode] = useState<'provisional' | 'paid' | 'credit'>('paid');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paidAmount, setPaidAmount] = useState('');
  const [depositDeducted, setDepositDeducted] = useState('');
  const [externalTransactionId, setExternalTransactionId] = useState('');
  const [invoiceAttemptKey, setInvoiceAttemptKey] = useState(() => newInvoiceAttemptKey());
  const [selectedCounterId, setSelectedCounterId] = useState(() => urlCounterId ?? '');
  // Pre-fill opening cash from a recently accepted handover (set by the TopBar's
  // handover accept flow). The backend has a safety net too — this just improves UX.
  const [openingCash, setOpeningCash] = useState<string>(() => {
    try {
      const raw = sessionStorage.getItem(`hms.${slug}.acceptedHandover`);
      if (!raw) return '0';
      const parsed = JSON.parse(raw) as { expectedAmount?: number; acceptedAt?: number };
      // Only honour a stashed handover if it was accepted in the last 5 minutes.
      if (parsed?.acceptedAt && Date.now() - parsed.acceptedAt < 5 * 60 * 1000 && typeof parsed.expectedAmount === 'number') {
        return String(parsed.expectedAmount);
      }
    } catch {
      // Ignore — fall back to '0' below.
    }
    return '0';
  });
  const [openingDenominations, setOpeningDenominations] = useState<Record<DenominationKey, string>>(() => emptyDenominations());
  const [closingCash, setClosingCash] = useState('');
  const [handoverTo, setHandoverTo] = useState('');
  const [handoverAmount, setHandoverAmount] = useState('');
  const [pendingBillFilter, setPendingBillFilter] = useState<'today' | 'past'>('today');
  const [pendingBillPage, setPendingBillPage] = useState(1);
  const [pendingCollectionsView, setPendingCollectionsView] = useState('appointments');
  const [appointmentBenefitDrafts, setAppointmentBenefitDrafts] = useState<Record<number, AppointmentBenefitDraft>>({});
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [chargeTab, setChargeTab] = useState('pathology');
  const [counterRemarks, setCounterRemarks] = useState('');
  const [takeOverTarget, setTakeOverTarget] = useState<ActiveCounterListSession | null>(null);
  const [lines, setLines] = useState<CounterLine[]>([]);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [bankDepositAmount, setBankDepositAmount] = useState('');
  const [bankDepositBankName, setBankDepositBankName] = useState('');
  const [bankDepositNote, setBankDepositNote] = useState('');
  const [bankDepositAttemptKey, setBankDepositAttemptKey] = useState(() => newBankDepositAttemptKey());
  const [discountByName, setDiscountByName] = useState('');
  const [discountAllocationEnabled, setDiscountAllocationEnabled] = useState(false);
  const [discountAllocationRows, setDiscountAllocationRows] = useState<DiscountAllocationRow[]>([]);
  const [discountSourceIntent, setDiscountSourceIntent] = useState<DiscountAllocationReason | null>(null);
  const [doctorWaiverQuote, setDoctorWaiverQuote] = useState<DoctorWaiverPreviewResponse | null>(null);
  const [doctorAvailableWaiverAmount, setDoctorAvailableWaiverAmount] = useState(0);
  const [doctorWaiverVerifiedPreviewKey, setDoctorWaiverVerifiedPreviewKey] = useState<string | null>(null);
  const [referredByType, setReferredByType] = useState<ReferredByType>('self');
  const [referredByHospital, setReferredByHospital] = useState<HospitalOption | null>(null);
  const [referredByDoctor, setReferredByDoctor] = useState<DoctorComboboxOption | null>(null);

  const clearBillingReferralState = useCallback(() => {
    setReferredByType('self');
    setReferredByHospital(null);
    setReferredByDoctor(null);
    setDiscountSourceIntent(null);
    setDoctorWaiverQuote(null);
    setDoctorAvailableWaiverAmount(0);
    setDoctorWaiverVerifiedPreviewKey(null);
    setDiscountAllocationRows((current) => current.filter((row) => row.reason !== 'doctor_commission_waiver'));
    setLines((current) => current.map((line) => ({ ...line, prescriberDoctorId: '' })));
  }, []);

  const selectBillingPatient = useCallback((patient: PatientOption) => {
    setSelectedPatient(patient);
    setPatientSearch(labelPatient(patient));
    setVisitId('');
    setCreateWalkInVisit(true);
    setDepositDeducted('');
    clearBillingReferralState();
  }, [clearBillingReferralState]);

  useEffect(() => {
    const timer = window.setTimeout(() => setPatientSearchDebounced(patientSearch.trim()), COUNTER_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [patientSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setServiceSearchDebounced(serviceSearch.trim()), COUNTER_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [serviceSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDoctorSearchDebounced(doctorSearch.trim()), COUNTER_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [doctorSearch]);

  // Clear the stashed accepted handover after we've pre-populated once, so a
  // subsequent navigation to this page doesn't keep re-using the same value.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`hms.${slug}.acceptedHandover`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { acceptedAt?: number };
      if (parsed?.acceptedAt && Date.now() - parsed.acceptedAt < 5 * 60 * 1000) {
        sessionStorage.removeItem(`hms.${slug}.acceptedHandover`);
      }
    } catch {
      // Ignore — defensive cleanup.
    }
    // Run once on mount; the openingCash initial value already consumed the stash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: patientsData } = useApiQuery<{ patients: PatientOption[] }>(
    ['billing-counter', 'patients', patientSearchDebounced],
    `/api/patients?search=${encodeURIComponent(patientSearchDebounced)}&limit=8`,
    { enabled: patientSearchDebounced.length >= 2, staleTime: COUNTER_SEARCH_STALE_MS },
  );

  const urlPatientId = searchParams.get('patientId');
  const { data: urlPatientData } = useApiQuery<{ patient: PatientOption }>(
    ['billing-counter', 'url-patient', urlPatientId],
    `/api/reception/patients/${urlPatientId}/context`,
    { enabled: Boolean(urlPatientId) && !selectedPatient },
  );

  useEffect(() => {
    if (urlPatientData?.patient && !selectedPatient) {
      selectBillingPatient(urlPatientData.patient);
    }
  }, [selectedPatient, selectBillingPatient, urlPatientData?.patient]);

  const { data: visitsData } = useApiQuery<{ visits: VisitOption[] }>(
    ['billing-counter', 'visits', selectedPatient?.id ?? null],
    selectedPatient ? `/api/visits?patientId=${selectedPatient.id}` : '/api/visits?patientId=0',
    { enabled: Boolean(selectedPatient), staleTime: COUNTER_SEARCH_STALE_MS },
  );

  const { data: depositBalanceData, isFetching: depositBalanceLoading } = useApiQuery<DepositBalanceResponse>(
    ['billing-counter', 'deposit-balance', selectedPatient?.id ?? null],
    selectedPatient ? `/api/deposits/balance/${selectedPatient.id}` : '/api/deposits/balance/0',
    { enabled: Boolean(selectedPatient), staleTime: COUNTER_SEARCH_STALE_MS },
  );

  const { data: doctorsData } = useApiQuery<{ doctors: DoctorOption[] }>(
    ['billing-counter', 'doctors', doctorSearchDebounced],
    `/api/doctors?search=${encodeURIComponent(doctorSearchDebounced)}`,
    { staleTime: COUNTER_SEARCH_STALE_MS },
  );

  const { data: schemesData } = useApiQuery<{ data: Scheme[] }>(
    ['billing-counter', 'schemes'],
    '/api/billing-master/schemes',
    { staleTime: COUNTER_MASTER_STALE_MS },
  );

  const { data: priceCategoriesData } = useApiQuery<{ data: PriceCategory[] }>(
    ['billing-counter', 'price-categories'],
    '/api/billing-master/price-categories',
    { staleTime: COUNTER_MASTER_STALE_MS },
  );

  const { data: serviceDepartmentsData } = useApiQuery<{ departments: ServiceDepartment[] }>(
    ['billing-counter', 'service-departments'],
    '/api/reception/service-departments',
    { staleTime: COUNTER_MASTER_STALE_MS },
  );

  const { data: countersData } = useApiQuery<{ data: BillingCounter[] }>(
    ['billing-counter', 'counters'],
    '/api/billing-master/counters',
    { staleTime: COUNTER_MASTER_STALE_MS },
  );

  const { data: activeCounterData } = useApiQuery<ActiveCounterResponse>(
    ['billing-counter', 'active-session'],
    '/api/billing-counter/sessions/active',
    { staleTime: 30_000 },
  );
  const activeSession = activeCounterData?.session ?? null;

  useEffect(() => {
    if (!activeSession && urlCounterId && selectedCounterId !== urlCounterId) {
      setSelectedCounterId(urlCounterId);
    }
  }, [activeSession, selectedCounterId, urlCounterId]);

  const { data: allActiveSessionsData } = useApiQuery<{ sessions: ActiveCounterListSession[] }>(
    ['billing-counter', 'active-all-sessions'],
    '/api/billing-counter/sessions/active-all',
    { enabled: !activeSession, staleTime: 30_000 },
  );
  const otherActiveSessions = allActiveSessionsData?.sessions ?? [];

  const { data: handoverRecipientsData } = useApiQuery<{ recipients: HandoverRecipient[] }>(
    ['billing-counter', 'handover-recipients'],
    '/api/billing-counter/handover-recipients',
    { enabled: Boolean(activeSession), staleTime: COUNTER_MASTER_STALE_MS },
  );

  const { data: bankDepositRequestsData } = useApiQuery<{ requests: BankDepositRequest[] }>(
    ['billing-counter', 'bank-deposit-requests', activeSession?.id ?? null],
    '/api/billing-counter/bank-deposit-requests?mine=true',
    { enabled: Boolean(activeSession), staleTime: 30_000 },
  );

  const { data: pendingAppointmentsData } = useApiQuery<{ data: PendingAppointmentCharge[]; date: string }>(
    ['billing-counter', 'pending-appointments'],
    '/api/billing-counter/pending-appointment-charges?limit=12',
    { enabled: Boolean(activeSession), staleTime: 30_000 },
  );

  const pendingBillDateParam = pendingBillFilter === 'today' ? `&date=${new Date().toISOString().split('T')[0]}` : '';
  const { data: pendingBillsData } = useApiQuery<{ data: PendingBill[]; date: string | null; pagination?: { page: number; limit: number; total: number; pages: number } }>(
    ['billing-counter', 'pending-bills', pendingBillFilter, pendingBillPage],
    `/api/billing-counter/pending-bills?limit=12${pendingBillDateParam}&page=${pendingBillPage}`,
    { enabled: Boolean(activeSession), staleTime: 30_000 },
  );

  const selectedDepartmentIds = useMemo(() => {
    const departments = serviceDepartmentsData?.departments ?? [];
    const match = (dept: ServiceDepartment) => {
      const text = `${dept.department_code ?? ''} ${dept.department_name ?? ''}`.toLowerCase();
      if (catalogGroup === 'pathology') return text.includes('lab') || text.includes('pathology');
      if (catalogGroup === 'radiology') return text.includes('rad') || text.includes('x-ray') || text.includes('xray') || text.includes('usg') || text.includes('ultra');
      if (catalogGroup === 'services') return text.includes('proc') || text.includes('service') || text.includes('nursing') || text.includes('minor') || text.includes('hospital');
      return false;
    };
    return departments.filter(match).map((dept) => dept.id);
  }, [catalogGroup, serviceDepartmentsData?.departments]);

  const selectedDepartmentId = selectedDepartmentIds[0];
  const servicePath = `/api/billing-counter/service-items?search=${encodeURIComponent(serviceSearchDebounced)}&limit=12${priceCategoryId ? `&price_category_id=${priceCategoryId}` : ''}${selectedDepartmentId ? `&department_id=${selectedDepartmentId}` : ''}`;
  const { data: servicesData, isFetching: servicesLoading } = useApiQuery<{ data: ServiceItem[] }>(
    ['billing-counter', 'services', serviceSearchDebounced, priceCategoryId, selectedDepartmentId, catalogGroup],
    servicePath,
    { enabled: serviceSearchDebounced.length >= 2 || Boolean(priceCategoryId) || catalogGroup !== 'all', staleTime: COUNTER_SEARCH_STALE_MS },
  );

  const selectedServiceItemIds = useMemo(() => [...new Set(lines.flatMap((line) => line.sourceType === 'service_item' && line.serviceItem?.id ? [line.serviceItem.id] : []))], [lines]);
  const performerRulesPath = selectedServiceItemIds.length > 0
    ? `/api/billing-counter/performer-payout-rules?service_item_ids=${selectedServiceItemIds.join(',')}`
    : '/api/billing-counter/performer-payout-rules?service_item_ids=0';
  const { data: performerRulesData } = useApiQuery<{ data: Array<{
    billingServiceItemId: number;
    rateType: 'flat' | 'percent';
    rateValue: number;
    displayAmount: number;
    effectiveFrom: string;
  }> }>(
    ['billing-counter', 'performer-payout-rules', selectedServiceItemIds.join(',')],
    performerRulesPath,
    { enabled: selectedServiceItemIds.length > 0, staleTime: COUNTER_SEARCH_STALE_MS },
  );
  const selectedServicesRefreshPath = selectedServiceItemIds.length > 0
    ? `/api/billing-counter/service-items?ids=${selectedServiceItemIds.join(',')}&limit=50${priceCategoryId ? `&price_category_id=${priceCategoryId}` : ''}`
    : '/api/billing-counter/service-items?ids=0';
  const { data: selectedServicesRefreshData } = useApiQuery<{ data: ServiceItem[] }>(
    ['billing-counter', 'selected-services-refresh', selectedServiceItemIds.join(','), priceCategoryId],
    selectedServicesRefreshPath,
    { enabled: selectedServiceItemIds.length > 0, staleTime: COUNTER_SEARCH_STALE_MS },
  );

  useEffect(() => {
    if (selectedServiceItemIds.length === 0) return;
    const ruleByServiceItemId = new Map(
      (performerRulesData?.data ?? []).map((rule) => [Number(rule.billingServiceItemId), rule]),
    );
    setLines((current) => current.map((line) => {
      if (line.sourceType !== 'service_item' || !line.serviceItem?.id) return line;
      const performerPayoutRule = ruleByServiceItemId.get(Number(line.serviceItem.id)) ?? null;
      const currentRule = line.serviceItem.performerPayoutRule ?? null;
      const unchanged = JSON.stringify(currentRule) === JSON.stringify(performerPayoutRule);
      const performerDoctorId = performerPayoutRule ? '' : line.performerDoctorId;
      if (unchanged && performerDoctorId === line.performerDoctorId) return line;
      return {
        ...line,
        performerDoctorId,
        serviceItem: { ...line.serviceItem, performerPayoutRule },
      };
    }));
  }, [performerRulesData?.data, selectedServiceItemIds.length]);

  useEffect(() => {
    const refreshed = selectedServicesRefreshData?.data ?? [];
    if (refreshed.length === 0) return;
    const byId = new Map(refreshed.map((item) => [Number(item.id), item]));
    setLines((current) => current.map((line) => {
      if (line.sourceType !== 'service_item' || !line.serviceItem?.id) return line;
      const refreshedItem = byId.get(Number(line.serviceItem.id));
      if (!refreshedItem) return line;
      if (Number(refreshedItem.price) === Number(line.serviceItem.price) && refreshedItem.allow_discount === line.serviceItem.allow_discount) return line;
      return { ...line, serviceItem: { ...line.serviceItem, ...refreshedItem } };
    }));
  }, [selectedServicesRefreshData?.data]);

  const doctorOptions = doctorsData?.doctors ?? [];
  const referringDoctorId = referredByType === 'doctor' && referredByDoctor ? Number(referredByDoctor.id) : null;
  const selectedScheme = (schemesData?.data ?? []).find((scheme) => String(scheme.id) === schemeId) ?? null;
  const selectedPriceCategory = (priceCategoriesData?.data ?? []).find((category) => String(category.id) === priceCategoryId) ?? null;
  const handoverRecipients = handoverRecipientsData?.recipients ?? [];
  const bankDepositRequests = bankDepositRequestsData?.requests ?? [];
  const bankDepositAmountNumber = toNumber(bankDepositAmount);
  const activeExpectedCash = Number(activeSession?.expectedCash ?? 0);
  const activeHeldRefundCash = Number(activeSession?.heldRefundCash ?? 0);
  const activeAvailableCash = Number(activeSession?.availableCash ?? Math.max(0, activeExpectedCash - activeHeldRefundCash));
  const bankDepositExceedsCash = Boolean(activeSession) && bankDepositAmountNumber > activeAvailableCash;
  const isBlindClose = activeSession?.expectedCashHidden === true;
  const declaredClosingCash = activeSession
    ? (closingCash === '' ? (isBlindClose ? 0 : activeAvailableCash) : toNumber(closingCash))
    : 0;
  const closingVariance = activeSession && !isBlindClose
    ? declaredClosingCash - activeAvailableCash
    : 0;
  const handoverAmountPreview = handoverAmount === '' ? declaredClosingCash : toNumber(handoverAmount);
  const handoverDuePreview = Math.max(0, declaredClosingCash - handoverAmountPreview);
  const counterOptions = (countersData?.data ?? []).filter((counter) => {
    const type = counter.counterType ?? counter.counter_type ?? 'billing';
    return ['billing', 'opd', 'ipd', 'lab', 'emergency', 'other'].includes(type);
  });
  const allDoctorOptions = useMemo(() => {
    const map = new Map<number, DoctorOption>();
    for (const doctor of doctorOptions) map.set(doctor.id, doctor);
    for (const line of lines) {
      if (line.doctor) map.set(line.doctor.id, line.doctor);
    }
    return [...map.values()];
  }, [doctorOptions, lines]);
  const selectedDepositBalance = Math.max(0, Number(depositBalanceData?.balance ?? 0));

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + lineUnitPrice(line) * line.quantity, 0);
    const discount = lines.reduce((sum, line) => {
      const gross = lineUnitPrice(line) * line.quantity;
      const discountFromPercent = line.discountMode === 'percent' ? Math.round(gross * line.discountPercent / 100) : 0;
      return sum + Math.min(line.discountMode === 'percent' ? discountFromPercent : line.discountAmount, gross);
    }, 0);
    const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
    const requestedDeposit = Math.min(toNumber(depositDeducted), total, selectedDepositBalance);
    const submissionMode = resolveBillingInvoiceSubmissionMode({
      selectedMode: billMode,
      total,
      paidAmount: toNumber(paidAmount),
      depositDeducted: requestedDeposit,
    });
    const deposit = Math.min(submissionMode.depositDeducted, total, selectedDepositBalance);
    const paid = Math.min(submissionMode.paidAmount, Math.max(0, total - deposit));
    const due = submissionMode.effectiveMode === 'provisional' ? total : Math.max(0, total - deposit - paid);
    return {
      subtotal,
      discount,
      total,
      paid,
      deposit,
      due,
      effectiveMode: submissionMode.effectiveMode,
      adjustedToCredit: submissionMode.adjustedToCredit,
    };
  }, [billMode, depositDeducted, lines, paidAmount, selectedDepositBalance]);

  const requiresDiscountByName = totals.subtotal > 0 && totals.discount > 0 && (totals.discount / totals.subtotal) * 100 > 20;
  const maxDepositDeduction = Math.min(selectedDepositBalance, totals.total);
  const selectedSchemeSummary = schemePreview?.eligible && schemePreview.scheme_name
    ? `${schemePreview.scheme_name} · ৳${money(Number(schemePreview.suggested_discount ?? 0))} suggested`
    : selectedScheme
      ? selectedScheme.scheme_name
      : selectedPriceCategory
        ? `${selectedPriceCategory.category_name} price`
        : 'General / default';
  const suggestedSchemeDiscount = Math.min(Number(schemePreview?.suggested_discount ?? 0), totals.subtotal);
  const doctorWaiverPreviewRequest = useMemo<DoctorWaiverPreviewRequest | null>(() => {
    if (!referringDoctorId || lines.length === 0 || schemePreview?.eligible) return null;
    return {
      doctorId: referringDoctorId,
      totalDiscount: 0,
      items: lines.map((line) => ({
        itemCategory: previewCategoryForLine(line),
        description: lineLabel(line),
        lineTotal: lineTotal(line),
        grossLineTotal: lineUnitPrice(line) * line.quantity,
        quantity: line.quantity,
        referenceId: line.sourceType === 'service_item' ? line.serviceItem?.id ?? null : line.doctor?.id ?? null,
      })),
    };
  }, [lines, referringDoctorId, schemePreview?.eligible]);
  const doctorWaiverPreviewKey = useMemo(
    () => doctorWaiverPreviewRequest ? JSON.stringify(doctorWaiverPreviewRequest) : null,
    [doctorWaiverPreviewRequest],
  );
  const doctorWaiverPreviewMutation = useApiMutation<DoctorWaiverPreviewResponse, DoctorWaiverPreviewRequest>(
    'post',
    '/api/discounts/doctor-waiver-preview',
    {
      onSuccess: (preview, variables) => {
        setDoctorWaiverQuote(preview);
        setDoctorAvailableWaiverAmount(Number(preview.maximumDoctorWaiverAmount ?? preview.doctorWaiverAmount ?? 0));
        setDoctorWaiverVerifiedPreviewKey(JSON.stringify(variables));
      },
      onError: () => {
        setDoctorWaiverQuote(null);
        setDoctorAvailableWaiverAmount(0);
        setDoctorWaiverVerifiedPreviewKey(null);
      },
    },
  );
  const hasDoctorWaiverAllocation = !schemePreview?.eligible
    && discountAllocationRows.some((row) => row.reason === 'doctor_commission_waiver');
  const doctorWaiverPreviewStatus = resolveDoctorWaiverPreviewStatus({
    hasDoctorWaiverAllocation,
    previewKey: doctorWaiverPreviewKey,
    verifiedPreviewKey: doctorWaiverVerifiedPreviewKey,
    mutationPending: doctorWaiverPreviewMutation.isPending,
    mutationFailed: doctorWaiverPreviewMutation.isError,
  });
  const doctorWaiverPreviewPending = doctorWaiverPreviewStatus.pending;
  const doctorWaiverPreviewFailed = doctorWaiverPreviewStatus.failed;
  const doctorWaiverPaymentBlocked = doctorWaiverPreviewStatus.paymentBlocked;

  useEffect(() => {
    if (totals.discount > 0) return;
    if (discountAllocationEnabled) setDiscountAllocationEnabled(false);
    if (discountAllocationRows.length > 0) setDiscountAllocationRows([]);
    if (discountSourceIntent !== null) setDiscountSourceIntent(null);
  }, [discountAllocationEnabled, discountAllocationRows.length, discountSourceIntent, totals.discount]);

  useEffect(() => {
    if (!doctorWaiverPreviewRequest || !doctorWaiverPreviewKey) {
      if (doctorWaiverQuote !== null) setDoctorWaiverQuote(null);
      if (doctorAvailableWaiverAmount !== 0) setDoctorAvailableWaiverAmount(0);
      if (doctorWaiverVerifiedPreviewKey !== null) setDoctorWaiverVerifiedPreviewKey(null);
      return;
    }
    if (doctorWaiverVerifiedPreviewKey === doctorWaiverPreviewKey) return;
    if (doctorWaiverPreviewMutation.isPending || doctorWaiverPreviewMutation.isError) return;
    setDoctorWaiverQuote(null);
    setDoctorAvailableWaiverAmount(0);
    doctorWaiverPreviewMutation.mutate(doctorWaiverPreviewRequest);
  }, [
    doctorAvailableWaiverAmount,
    doctorWaiverPreviewKey,
    doctorWaiverPreviewMutation.isError,
    doctorWaiverPreviewMutation.isPending,
    doctorWaiverPreviewRequest,
    doctorWaiverQuote,
    doctorWaiverVerifiedPreviewKey,
  ]);

  useEffect(() => {
    if (!selectedPatient && depositDeducted !== '') {
      setDepositDeducted('');
      return;
    }
    if (depositDeducted === '') return;
    const requested = toNumber(depositDeducted);
    if (requested > maxDepositDeduction) {
      setDepositDeducted(String(maxDepositDeduction));
    }
  }, [depositDeducted, maxDepositDeduction, selectedPatient]);

  useEffect(() => {
    const defaultPriceCategoryId = schemePreview?.eligible ? schemePreview.default_price_category_id : null;
    if (defaultPriceCategoryId && !priceCategoryId && lines.length === 0) {
      setPriceCategoryId(String(defaultPriceCategoryId));
    }
  }, [lines.length, priceCategoryId, schemePreview?.eligible, schemePreview?.default_price_category_id]);

  const checkSchemePreview = useApiMutation<SchemePreviewResponse, {
    patient_id?: number;
    scheme_id?: number;
    scheme_code?: string;
    member_code?: string;
    service_category?: string;
    subtotal: number;
  }>('post', '/api/billing-master/apply-scheme-preview', {
    onSuccess: (preview) => {
      setSchemePreview(preview);
      if (preview.scheme_id) setSchemeId(String(preview.scheme_id));
      if (preview.default_price_category_id && !priceCategoryId) setPriceCategoryId(String(preview.default_price_category_id));
      if (preview.eligible) toast.success(`Eligible: ${preview.scheme_name ?? 'scheme'} benefit`);
      else toast.error(preview.blockers?.[0] ?? 'Scheme is not eligible.');
    },
    onError: (error) => toast.error(error.message),
  });

  const createInvoice = useApiMutation<CounterInvoiceResponse, unknown>('post', '/api/billing-counter/invoices', {
    onSuccess: (res) => {
      const invoiceLabel = res.invoiceNo ?? t('counter.invoice', { defaultValue: 'Invoice' });
      if (res.mode === 'credit') {
        toast.success(`Credit / Pay later ${invoiceLabel} created · Due ৳${money(Number(res.dueAmount ?? res.total))}`);
      } else if (res.status === 'partially_paid') {
        toast.success(`${invoiceLabel} created · Paid ৳${money(Number(res.paidAmount ?? 0))} · Due ৳${money(Number(res.dueAmount ?? 0))}`);
      } else if (res.mode === 'provisional') {
        toast.success(res.message);
      } else {
        toast.success(res.invoiceNo ? t('counter.invoiceCreated', { invoiceNo: res.invoiceNo }) : res.message);
      }
      if (res.billId) {
        window.open(`/h/${slug}/billing/${res.billId}/print`, '_blank');
      }
      setLines([]);
      setPaidAmount('');
      setDepositDeducted('');
      setExternalTransactionId('');
      setSchemePreview(null);
      setMemberCodeInput('');
      setDiscountAllocationEnabled(false);
      setDiscountAllocationRows([]);
      setDiscountSourceIntent(null);
      setDoctorWaiverQuote(null);
      setDoctorAvailableWaiverAmount(0);
      setDoctorWaiverVerifiedPreviewKey(null);
      setInvoiceAttemptKey(newInvoiceAttemptKey());
      setReferredByType('self');
      setReferredByHospital(null);
      setReferredByDoctor(null);
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      queryClient.invalidateQueries({ queryKey: ['billing-counter', 'deposit-balance'] });
    },
    onError: (error) => {
      if (shouldRotateInvoiceAttemptKey(error)) {
        setInvoiceAttemptKey(newInvoiceAttemptKey());
      }
      toast.error(error.message);
    },
  });

  const activateCounter = useApiMutation<{ message: string }, unknown>('post', '/api/billing-counter/sessions/activate', {
    onSuccess: (res) => {
      toast.success(res.message);
      setCounterRemarks('');
      setOpeningDenominations(emptyDenominations());
      queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const takeOverCounter = useApiMutation<{ message: string }, { sessionId: number }>(
    'post',
    (vars) => `/api/billing-counter/sessions/${vars.sessionId}/take-over`,
    {
      onSuccess: (res) => {
        toast.success(res.message || t('counter.counterTakenOver', { defaultValue: 'Counter taken over successfully' }));
        setTakeOverTarget(null);
        setSelectedCounterId('');
        queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
        queryClient.invalidateQueries({ queryKey: ['reception'] });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const closeCounter = useApiMutation<{ message: string; expectedCash?: number; variance?: number; blindClose?: boolean }, unknown>(
    'post',
    () => `/api/billing-counter/sessions/${activeSession?.id ?? 0}/close`,
    {
      onSuccess: (res) => {
        if (res.blindClose) {
          toast.success(res.message || 'Counter closed');
        } else {
          toast.success(t('counter.toast.counterClosedVariance', { message: res.message, variance: money(res.variance ?? 0) }));
        }
        setClosingCash('');
        setHandoverAmount('');
        setHandoverTo('');
        setCounterRemarks('');
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const cashWithdraw = useApiMutation<
    { success: boolean; movementType: string; amount: number; reason: string },
    { amount: number; movementType: 'cash_in' | 'cash_out'; reason: string }
  >(
    'post',
    () => `/api/billing-counter/sessions/${activeSession?.id ?? 0}/cash-movement`,
    {
      onSuccess: () => {
        toast.success(t('counter.toast.cashMovementRecorded'));
        setWithdrawAmount('');
        setWithdrawReason('');
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const requestBankDeposit = useApiMutation<
    { request: BankDepositRequest; message?: string },
    { amount: number; proposedBankName?: string; note?: string; idempotencyKey: string }
  >(
    'post',
    () => `/api/billing-counter/sessions/${activeSession?.id ?? 0}/bank-deposit-requests`,
    {
      onSuccess: (res) => {
        toast.success(res.message ?? t('counter.toast.bankDepositRequested', { defaultValue: 'Bank deposit request sent to finance' }));
        setBankDepositAmount('');
        setBankDepositBankName('');
        setBankDepositNote('');
        setBankDepositAttemptKey(newBankDepositAttemptKey());
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'bank-deposit-requests'] });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const payPendingAppointment = useApiMutation<
    { invoiceNo?: string; receiptNo?: string; total?: number },
    {
      id: number;
      paymentMethod: string;
      idempotencyKey: string;
      schemeApplication?: { schemeId?: number; schemeCode?: string; memberCode?: string; memberId?: number; serviceCategory?: string; allocationType?: string; suggestedDiscount?: number };
    }
  >(
    'post',
    (vars) => `/api/appointments/${vars.id}/pay-now`,
    {
      onSuccess: (res) => {
        toast.success(res.invoiceNo ? t('counter.toast.appointmentPaidInvoice', { invoiceNo: res.invoiceNo }) : t('counter.toast.appointmentPaid'));
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        queryClient.invalidateQueries({ queryKey: ['billing'] });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const checkAppointmentSchemePreview = useApiMutation<
    SchemePreviewResponse,
    { appointmentId: number; patientId: number; scheme_code?: string; member_code?: string; service_category?: string; subtotal: number }
  >(
    'post',
    '/api/billing-master/apply-scheme-preview',
    {
      onSuccess: (preview, variables) => {
        setAppointmentBenefitDrafts((current) => ({
          ...current,
          [variables.appointmentId]: {
            schemeCode: current[variables.appointmentId]?.schemeCode ?? variables.scheme_code ?? '',
            memberCode: current[variables.appointmentId]?.memberCode ?? variables.member_code ?? '',
            preview,
          },
        }));
        if (preview.eligible) toast.success(`Eligible: ${preview.scheme_name ?? 'scheme'} benefit`);
        else toast.error(preview.blockers?.[0] ?? 'Scheme is not eligible.');
      },
      onError: (error) => toast.error(error.message || 'Failed to check appointment benefit'),
    },
  );

  const payPendingBill = useApiMutation<
    { receiptNo?: string; status?: string },
    { billId: number; amount: number; type: 'current' | 'due'; paymentMethod: string; idempotencyKey?: string }
  >(
    'post',
    '/api/billing/pay',
    {
      onSuccess: (res) => {
        toast.success(res.receiptNo ? t('counter.toast.paymentRecordedReceipt', { receiptNo: res.receiptNo }) : t('counter.toast.paymentRecorded'));
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        queryClient.invalidateQueries({ queryKey: ['billing'] });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const addServiceItem = (item: ServiceItem) => {
    setLines((current) => {
      const existing = current.find((line) => line.sourceType === 'service_item' && line.serviceItem?.id === item.id);
      if (existing) {
        return current.map((line) => line.sourceType === 'service_item' && line.serviceItem?.id === item.id
          ? { ...line, quantity: line.quantity + 1 }
          : line);
      }
      return [...current, {
        sourceType: 'service_item',
        serviceItem: item,
        quantity: 1,
        discountAmount: 0,
        discountPercent: 0,
        discountMode: 'flat' as const,
        performerDoctorId: '',
        prescriberDoctorId: referredByType === 'doctor' && referredByDoctor ? String(referredByDoctor.id) : '',
        remarks: '',
      }];
    });
  };

  const addDoctorConsultation = (doctor: DoctorOption) => {
    if (Number(doctor.consultation_fee ?? 0) <= 0) {
      toast.error(t('counter.toast.consultationFeeNotConfigured'));
      return;
    }
    setLines((current) => {
      if (current.some((line) => line.sourceType === 'doctor' && line.doctor?.id === doctor.id)) return current;
      return [...current, {
        sourceType: 'doctor',
        doctor,
        quantity: 1,
        discountAmount: 0,
        discountPercent: 0,
        discountMode: 'flat' as const,
        performerDoctorId: String(doctor.id),
        prescriberDoctorId: referredByType === 'doctor' && referredByDoctor ? String(referredByDoctor.id) : '',
        remarks: '',
      }];
    });
  };

  const updateLine = (index: number, patch: Partial<CounterLine>) => {
    setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  };

  const removeLine = (index: number) => {
    setLines((current) => current.filter((_, i) => i !== index));
  };

  const submitSchemeCheck = () => {
    const selectedSchemeCode = selectedScheme?.scheme_code?.trim() || schemeCodeInput.trim();
    const memberCode = memberCodeInput.trim();
    if (!schemeId && !selectedSchemeCode && !memberCode) {
      toast.error('Select a scheme or enter a scheme/member code.');
      return;
    }
    if (totals.subtotal <= 0) {
      toast.error(t('counter.addCatalogItemFirst'));
      return;
    }
    checkSchemePreview.mutate({
      patient_id: selectedPatient?.id,
      scheme_id: schemeId ? Number(schemeId) : undefined,
      scheme_code: selectedSchemeCode || undefined,
      member_code: memberCode || undefined,
      service_category: chargeTab === 'doctor' ? 'doctor_visit' : chargeTab,
      subtotal: totals.subtotal,
    });
  };

  const applySuggestedSchemeDiscount = () => {
    if (!schemePreview?.eligible || suggestedSchemeDiscount <= 0) {
      toast.error(schemePreview?.blockers?.[0] || 'No eligible scheme discount to apply.');
      return;
    }
    setLines((current) => distributeFlatDiscount(current, suggestedSchemeDiscount));
    if (schemePreview.requires_reference && !discountByName.trim()) {
      setDiscountByName(schemePreview.matched_member_name || schemePreview.matched_member_code || schemePreview.scheme_name || 'Scheme benefit');
    }
    toast.success(`Applied ${schemePreview.scheme_name ?? selectedScheme?.scheme_name ?? 'scheme'} discount`);
  };

  const handleBillModeChange = (mode: 'provisional' | 'paid' | 'credit') => {
    setBillMode(mode);
    if (mode !== 'paid') {
      setPaidAmount('');
      setDepositDeducted('');
      setExternalTransactionId('');
    }
  };

  const submit = () => {
    if (!activeSession) {
      toast.error(t('counter.toast.activateCounterFirst'));
      return;
    }
    if (!selectedPatient) {
      toast.error(t('counter.selectPatientFirst'));
      return;
    }
    if (!visitId && !createWalkInVisit) {
      toast.error(t('counter.selectVisitFirst'));
      return;
    }
    if (lines.length === 0) {
      toast.error(t('counter.addCatalogItemFirst'));
      return;
    }
    if (requiresDiscountByName && !discountByName.trim()) {
      toast.error(t('counter.toast.discountByNameRequired', { defaultValue: 'Discount referred by name is required when discount is above 20%.' }));
      return;
    }
    if (referredByType === 'hospital' && !referredByHospital) {
      toast.error(t('counter.referredByHospitalRequired', { defaultValue: 'Please select a referral hospital.' }));
      return;
    }
    if (referredByType === 'doctor' && !referredByDoctor) {
      toast.error(t('counter.referredByDoctorRequired', { defaultValue: 'Please select a referring doctor.' }));
      return;
    }
    if (doctorWaiverPreviewPending) {
      toast.error('Doctor waiver verification is still in progress.');
      return;
    }
    if (doctorWaiverPreviewFailed) {
      toast.error('Doctor waiver could not be verified. Select Doctor waiver again to retry.');
      return;
    }
    if (doctorWaiverPaymentBlocked) {
      toast.error('Doctor waiver must be verified before payment.');
      return;
    }
    if (!schemePreview?.eligible && totals.discount > 0 && discountAllocationEnabled
      && !hasBalancedDiscountAllocations(totals.discount, discountAllocationRows)) {
      toast.error('Discount source amounts must match the total discount.');
      return;
    }
    if (!schemePreview?.eligible
      && discountAllocationRows.some((row) => row.reason === 'doctor_commission_waiver')
      && !referringDoctorId) {
      toast.error('Select the referring doctor before applying Doctor Waiver.');
      return;
    }
    if (requiresPaymentReference(paymentMethod, totals.paid) && !externalTransactionId.trim()) {
      toast.error('Transaction/reference number is required for non-cash payments.');
      return;
    }

    createInvoice.mutate({
      patientId: selectedPatient.id,
      visitId: visitId ? Number(visitId) : undefined,
      createWalkInVisit: !visitId && createWalkInVisit,
      schemeId: schemeId ? Number(schemeId) : undefined,
      priceCategoryId: priceCategoryId ? Number(priceCategoryId) : undefined,
      referringDoctorId: referringDoctorId ?? undefined,
      referredByType,
      referredByHospitalId: referredByType === 'hospital' && referredByHospital ? referredByHospital.id : undefined,
      idempotencyKey: invoiceAttemptKey,
      billMode,
      discountByName: discountByName.trim() || undefined,
      discountSourceIntent: schemePreview?.eligible && totals.discount > 0
        ? reasonForDiscountSource(schemePreview.allocation_type)
        : discountSourceIntent ?? undefined,
      schemeApplication: schemePreview?.eligible && totals.discount > 0 ? {
        schemeId: schemePreview.scheme_id ?? (schemeId ? Number(schemeId) : undefined),
        schemeCode: (schemePreview.scheme_code ?? schemeCodeInput.trim()) || undefined,
        memberCode: (schemePreview.matched_member_code ?? memberCodeInput.trim()) || undefined,
        memberId: schemePreview.matched_member_id ?? undefined,
        serviceCategory: schemePreview.service_category ?? undefined,
        allocationType: reasonForDiscountSource(schemePreview.allocation_type),
        suggestedDiscount: schemePreview.suggested_discount,
      } : undefined,
      discountAllocations: schemePreview?.eligible && totals.discount > 0
        ? [{ reason: reasonForDiscountSource(schemePreview.allocation_type), amount: totals.discount, note: 'Scheme: ' + (schemePreview.scheme_name ?? 'Benefit') }]
        : getDiscountAllocationPayload(totals.discount, discountAllocationEnabled, discountAllocationRows),
      items: lines.map((line) => ({
        serviceItemId: line.sourceType === 'service_item' ? line.serviceItem?.id : undefined,
        doctorId: line.sourceType === 'doctor' ? line.doctor?.id : undefined,
        quantity: line.quantity,
        discountAmount: canApplyDiscount && line.discountMode === 'flat' ? line.discountAmount : 0,
        discountPercent: canApplyDiscount && line.discountMode === 'percent' ? line.discountPercent : 0,
        performerDoctorId: line.serviceItem?.performerPayoutRule ? undefined : line.performerDoctorId ? Number(line.performerDoctorId) : undefined,
        prescriberDoctorId: line.prescriberDoctorId ? Number(line.prescriberDoctorId) : undefined,
        remarks: line.remarks || undefined,
      })),
      payment: {
        paymentMethod,
        paidAmount: totals.paid,
        depositDeducted: totals.deposit,
        creditAmount: totals.effectiveMode === 'credit' ? totals.total : totals.due,
        externalTransactionId: totals.effectiveMode === 'paid'
          ? normalizeExternalTransactionId(paymentMethod, totals.paid, externalTransactionId)
          : undefined,
      },
    });
  };

  const openingDenominationPayload = useMemo(() => buildDenominationPayload(openingDenominations), [openingDenominations]);
  const openingDenominationTotal = useMemo(
    () => CASH_DENOMINATIONS.reduce((sum, row) => sum + openingDenominationPayload[row.key] * row.note, 0),
    [openingDenominationPayload],
  );
  const hasOpeningDenominations = CASH_DENOMINATIONS.some((row) => openingDenominationPayload[row.key] > 0);
  const openingCashAmount = toNumber(openingCash);
  const openingDenominationsMatchCash = !hasOpeningDenominations || openingDenominationTotal === openingCashAmount;

  const selectedVisitContext = visitId
    ? visitsData?.visits?.find((visit) => String(visit.id) === visitId)
    : null;

  const submitActivateCounter = () => {
    if (!selectedCounterId) {
      toast.error(t('counter.toast.selectCounterFirst'));
      return;
    }
    if (!openingDenominationsMatchCash) {
      toast.error('Opening denomination total must match opening cash.');
      return;
    }
    activateCounter.mutate({
      counterId: Number(selectedCounterId),
      openingCash: openingCashAmount,
      openingDenominations: hasOpeningDenominations ? openingDenominationPayload : undefined,
      remarks: counterRemarks.trim() || undefined,
    });
  };

  const submitBankDepositRequest = () => {
    if (!activeSession) return;
    if (bankDepositAmountNumber <= 0) {
      toast.error('Bank deposit amount is required.');
      return;
    }
    if (bankDepositExceedsCash) {
      toast.error('Bank deposit amount cannot exceed available drawer cash after refund reserves.');
      return;
    }
    requestBankDeposit.mutate({
      amount: bankDepositAmountNumber,
      proposedBankName: bankDepositBankName.trim() || undefined,
      note: bankDepositNote.trim() || undefined,
      idempotencyKey: bankDepositAttemptKey,
    });
  };

  const submitCloseCounter = () => {
    if (!activeSession) return;
    const closeAmount = declaredClosingCash;
    const requestedHandoverAmount = handoverAmount === '' ? undefined : toNumber(handoverAmount);
    const finalHandoverAmount = requestedHandoverAmount ?? closeAmount;
    if (finalHandoverAmount > closeAmount) {
      toast.error(t('counter.toast.handoverExceedsClosing'));
      return;
    }
    if (closeAmount > 0 && !handoverTo) {
      toast.error(t('counter.toast.selectHandoverRecipient'));
      return;
    }
    if (closingVariance !== 0 && !counterRemarks.trim() && !isBlindClose) {
      toast.error(t('counter.toast.varianceRemarksRequired'));
      return;
    }
    closeCounter.mutate({
      closingCash: closeAmount,
      handoverTo: handoverTo ? Number(handoverTo) : undefined,
      handoverAmount: requestedHandoverAmount,
      remarks: counterRemarks.trim() || undefined,
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">
        {normalizedRole === 'reception' ? <ReceptionTopBar role={role} /> : null}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-[var(--color-text)]">
                {normalizedRole === 'reception' ? t('counter.heading.serviceLabBilling') : t('counter.title', { defaultValue: 'Billing Counter' })}
              </h1>
              {normalizedRole === 'reception' ? <span className="badge badge-success">{t('counter.heading.labServicesPayment')}</span> : null}
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">
              {normalizedRole === 'reception'
                ? t('counter.subtitleReception')
                : t('counter.subtitle', { defaultValue: 'Create paid, credit, or provisional bills from patient context and server-side prices.' })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm dark:bg-slate-800">
              <Receipt className="h-4 w-4 text-[var(--color-primary)]" />
              {t('counter.serverSourcedPrices', { defaultValue: 'Server-sourced prices only' })}
            </div>
          </div>
        </div>

        {normalizedRole === 'reception' ? (
          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-blue-800">
              <div className="text-sm font-semibold">{t('counter.heading.step1')}</div>
              <div className="mt-1 text-xs">{t('counter.info.step1Desc')}</div>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-amber-800">
              <div className="text-sm font-semibold">{t('counter.heading.step2')}</div>
              <div className="mt-1 text-xs">{t('counter.info.step2Desc')}</div>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-emerald-800">
              <div className="text-sm font-semibold">{t('counter.heading.step3')}</div>
              <div className="mt-1 text-xs">{t('counter.info.step3Desc')}</div>
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900">
          {activeSession ? (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="flex items-start gap-3">
                  <div className="mt-1 rounded-2xl bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200">
                    <Receipt className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                      {t('counter.activeCounter', { defaultValue: 'Active counter' })}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                      {activeSession.counterName}{activeSession.counterCode ? ` (${activeSession.counterCode})` : ''}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      {activeSession.counterType.toUpperCase()} · {t('counter.opened', { defaultValue: 'Opened' })} {activeSession.openedAt}
                    </p>
                  </div>
                </div>
                <Link
                  to={`/h/${slug}/reception/cash-operations`}
                  className="btn-secondary justify-center"
                >
                  {t('counter.cashOperations', { defaultValue: 'Cash Operations' })}
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-4 dark:border-blue-900 dark:bg-blue-950/30">
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Expected drawer cash</p>
                  <p className="mt-1 font-data text-2xl font-semibold text-blue-950 dark:text-blue-50">
                    {activeSession.expectedCashHidden ? t('counter.hidden', { defaultValue: 'Hidden' }) : `৳${money(activeExpectedCash)}`}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-4 dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Pending refund reserve</p>
                  <p className="mt-1 font-data text-2xl font-semibold text-amber-950 dark:text-amber-50">
                    {activeSession.expectedCashHidden ? t('counter.hidden', { defaultValue: 'Hidden' }) : `৳${money(activeHeldRefundCash)}`}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Available drawer cash</p>
                  <p className="mt-1 font-data text-2xl font-semibold text-emerald-950 dark:text-emerald-50">
                    {activeSession.expectedCashHidden ? t('counter.hidden', { defaultValue: 'Hidden' }) : `৳${money(activeAvailableCash)}`}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                  <p className="text-xs text-[var(--color-text-muted)]">{t('counter.stat.appointment')}</p>
                  <p className="mt-1 font-data text-xl font-semibold text-[var(--color-text-primary)]">৳{money(Number(activeSession.appointmentCash ?? 0))}</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                  <p className="text-xs text-[var(--color-text-muted)]">{t('counter.stat.test')}</p>
                  <p className="mt-1 font-data text-xl font-semibold text-[var(--color-text-primary)]">৳{money(Number(activeSession.testCash ?? 0))}</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                  <p className="text-xs text-[var(--color-text-muted)]">{t('counter.stat.opening')}</p>
                  <p className="mt-1 font-data text-xl font-semibold text-[var(--color-text-primary)]">৳{money(Number(activeSession.openingCash ?? 0))}</p>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                <div className="grid gap-3 md:grid-cols-[180px_1fr_1fr_auto] md:items-end">
                  <div>
                    <label className="label">Bank deposit amount</label>
                    <input className="input" type="number" min="0" value={bankDepositAmount} onChange={(event) => setBankDepositAmount(event.target.value)} />
                  </div>
                  <div>
                    <label className="label">Bank name</label>
                    <input className="input" value={bankDepositBankName} onChange={(event) => setBankDepositBankName(event.target.value)} placeholder="Optional" />
                  </div>
                  <div>
                    <label className="label">Deposit note</label>
                    <input className="input" value={bankDepositNote} onChange={(event) => setBankDepositNote(event.target.value)} placeholder="Optional" />
                  </div>
                  <button type="button" className="btn-secondary justify-center" disabled={requestBankDeposit.isPending || bankDepositAmountNumber <= 0 || bankDepositExceedsCash} onClick={submitBankDepositRequest}>
                    Request Deposit
                  </button>
                </div>
                {bankDepositExceedsCash ? <p className="mt-2 text-xs text-red-600">Bank deposit amount cannot exceed expected cash.</p> : null}
                {bankDepositRequests.length > 0 ? <p className="mt-2 text-xs text-[var(--color-text-muted)]">{bankDepositRequests.length} bank deposit request(s) pending or recently reviewed.</p> : null}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
                <h2 className="font-semibold">{t('counter.activateCounter', { defaultValue: 'Activate counter' })}</h2>
                <p className="mt-1 text-sm opacity-80">{t('counter.activateCounterHint', { defaultValue: 'Start a counter first. Billing, cash payment and invoice print will unlock after activation.' })}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_180px_1fr_auto] md:items-end">
                <div>
                  <label className="label">{t('counter.selectCounter', { defaultValue: 'Select billing counter' })}</label>
                  <select className="input" value={selectedCounterId} onChange={(e) => setSelectedCounterId(e.target.value)}>
                    <option value="">{t('counter.selectCounter', { defaultValue: 'Select billing counter' })}</option>
                    {counterOptions.map((counter) => {
                      const name = counter.counterName ?? counter.counter_name ?? `Counter #${counter.id}`;
                      const code = counter.counterCode ?? counter.counter_code;
                      const type = counter.counterType ?? counter.counter_type ?? 'billing';
                      return <option key={counter.id} value={counter.id}>{name}{code ? ` (${code})` : ''} - {type}</option>;
                    })}
                  </select>
                </div>
                <div>
                  <label className="label">{t('counter.openingCash', { defaultValue: 'Opening cash' })}</label>
                  <input className="input" type="number" min="0" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
                </div>
                <div>
                  <label className="label">{t('remarks', { defaultValue: 'Remarks' })}</label>
                  <input className="input" value={counterRemarks} onChange={(e) => setCounterRemarks(e.target.value)} placeholder={t('optional', { defaultValue: 'Optional' })} />
                </div>
                <button type="button" className="btn-primary justify-center" onClick={submitActivateCounter} disabled={activateCounter.isPending || !selectedCounterId}>
                  <LogIn className="h-4 w-4" />
                  {t('counter.activate', { defaultValue: 'Activate' })}
                </button>
              </div>
              {otherActiveSessions.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-white p-3 dark:border-amber-800 dark:bg-slate-900">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    {t('counter.otherActiveSessions', { defaultValue: 'Other Active Counters' })}
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {otherActiveSessions.map((s) => {
                      const isOwnSession = String(s.employee_id) === String(user?.userId ?? '');
                      return (
                        <div key={s.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-[var(--color-text)]">{s.counter_name}{s.counter_code ? ` (${s.counter_code})` : ''}</div>
                              <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{s.cashier_name} · {s.opened_at}</div>
                            </div>
                            {isOwnSession ? (
                              <span className="shrink-0 rounded bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                                {t('counter.yours', { defaultValue: 'Yours' })}
                              </span>
                            ) : canTakeOverCounter ? (
                              <button
                                type="button"
                                className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                                disabled={takeOverCounter.isPending}
                                onClick={() => setTakeOverTarget(s)}
                              >
                                {t('counter.takeOver', { defaultValue: 'Take Over' })}
                              </button>
                            ) : (
                              <span className="shrink-0 rounded bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">
                                {t('counter.active', { defaultValue: 'Active' })}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {activeSession ? (
          <>
        <section className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t('counter.pendingCollections', { defaultValue: 'Pending Collections' })}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                {t('counter.collectDueCash', { defaultValue: 'Collect due cash quickly' })}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {t('counter.pendingCollectionsDesc', { defaultValue: 'Appointment fees and generated bills are grouped in one simple card.' })}
              </p>
            </div>
            <div className="flex rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-1">
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${pendingCollectionsView === 'appointments' ? 'bg-white text-[var(--color-primary)] shadow-sm dark:bg-slate-800' : 'text-[var(--color-text-muted)]'}`}
                onClick={() => setPendingCollectionsView('appointments')}
              >
                {t('counter.appointmentDue', { defaultValue: 'Appointment' })} ({pendingAppointmentsData?.data?.length ?? 0})
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${pendingCollectionsView === 'bills' ? 'bg-white text-[var(--color-primary)] shadow-sm dark:bg-slate-800' : 'text-[var(--color-text-muted)]'}`}
                onClick={() => setPendingCollectionsView('bills')}
              >
                {t('counter.billDue', { defaultValue: 'Bills' })} ({pendingBillsData?.pagination?.total ?? pendingBillsData?.data?.length ?? 0})
              </button>
            </div>
          </div>

          {pendingCollectionsView === 'appointments' ? (
            <div className="mt-4">
              {(pendingAppointmentsData?.data?.length ?? 0) === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-muted)]">
                  {t('counter.noPendingAppointmentCharges', { defaultValue: 'No pending appointment consultation charge for today.' })}
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {pendingAppointmentsData?.data?.map((charge) => (
                    <div key={charge.appointment_id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[var(--color-text-primary)]">
                            {charge.patient_name}
                            {charge.patient_code ? <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">{charge.patient_code}</span> : null}
                          </div>
                          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                            {charge.doctor_name ?? t('counter.info.doctorNotAssigned')}{charge.doctor_specialty ? ` · ${charge.doctor_specialty}` : ''}{charge.appt_time ? ` · ${charge.appt_time}` : ''}
                          </div>
                        </div>
                        <div className="text-right font-data text-lg font-semibold text-[var(--color-primary)]">৳{money(Number(charge.pending_amount ?? 0))}</div>
                      </div>
                      {(() => {
                        const appointmentId = Number(charge.appointment_id);
                        const draft = appointmentBenefitDrafts[appointmentId] ?? { schemeCode: '', memberCode: '', preview: null };
                        const preview = draft.preview;
                        const suggested = Math.min(Number(preview?.suggested_discount ?? 0), Number(charge.pending_amount ?? 0));
                        return (
                          <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-white p-3 text-xs dark:bg-slate-800">
                            <div className="mb-2 font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Scheme / Benefit</div>
                            <div className="grid gap-2 sm:grid-cols-3">
                              <input className="input h-8 bg-white text-xs" value={draft.schemeCode} onChange={(event) => setAppointmentBenefitDrafts((current) => ({ ...current, [appointmentId]: { ...(current[appointmentId] ?? { schemeCode: '', memberCode: '', preview: null }), schemeCode: event.target.value, preview: null } }))} placeholder="Scheme code" />
                              <input className="input h-8 bg-white text-xs" value={draft.memberCode} onChange={(event) => setAppointmentBenefitDrafts((current) => ({ ...current, [appointmentId]: { ...(current[appointmentId] ?? { schemeCode: '', memberCode: '', preview: null }), memberCode: event.target.value, preview: null } }))} placeholder="Member code" />
                              <button type="button" className="btn-secondary h-8 justify-center px-2 text-xs" disabled={checkAppointmentSchemePreview.isPending || (!draft.schemeCode.trim() && !draft.memberCode.trim())} onClick={() => checkAppointmentSchemePreview.mutate({ appointmentId, patientId: Number(charge.patient_id), scheme_code: draft.schemeCode.trim() || undefined, member_code: draft.memberCode.trim() || undefined, service_category: 'appointment_payment', subtotal: Number(charge.pending_amount ?? 0) })}>{checkAppointmentSchemePreview.isPending ? 'Checking…' : 'Check'}</button>
                            </div>
                            <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">{preview?.eligible ? `${preview.scheme_name ?? 'Scheme'} · suggested ৳${money(suggested)}` : preview?.blockers?.join(', ') || 'Optional: leave empty for normal appointment payment.'}</div>
                          </div>
                        );
                      })()}
                      <button
                        type="button"
                        className="btn-primary mt-3 w-full justify-center"
                        disabled={!activeSession || payPendingAppointment.isPending}
                        onClick={() => {
                          const appointmentId = Number(charge.appointment_id);
                          const preview = appointmentBenefitDrafts[appointmentId]?.preview;
                          const draft = appointmentBenefitDrafts[appointmentId];
                          payPendingAppointment.mutate({
                            id: appointmentId,
                            paymentMethod: 'cash',
                            idempotencyKey: newAppointmentPaymentAttemptKey(appointmentId),
                            schemeApplication: preview?.eligible && Number(preview.suggested_discount ?? 0) > 0 ? {
                              schemeId: preview.scheme_id ?? undefined,
                              schemeCode: (preview.scheme_code ?? draft?.schemeCode?.trim()) || undefined,
                              memberCode: (preview.matched_member_code ?? draft?.memberCode?.trim()) || undefined,
                              memberId: preview.matched_member_id ?? undefined,
                              serviceCategory: preview.service_category ?? 'appointment_payment',
                              allocationType: reasonForDiscountSource(preview.allocation_type),
                              suggestedDiscount: preview.suggested_discount,
                            } : undefined,
                          });
                        }}
                        title={!activeSession ? t('counter.info.activateCounterFirst') : undefined}
                      >
                        <CreditCard className="h-4 w-4" />
                        {t('counter.payCash', { defaultValue: 'Pay cash' })}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex justify-end">
                <div className="flex rounded-lg border border-[var(--color-border)] p-0.5">
                  <button
                    type="button"
                    className={`rounded px-3 py-1 text-xs font-medium transition-colors ${pendingBillFilter === 'today' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'}`}
                    onClick={() => { setPendingBillFilter('today'); setPendingBillPage(1); }}
                  >
                    {t('counter.tab.today')}
                  </button>
                  <button
                    type="button"
                    className={`rounded px-3 py-1 text-xs font-medium transition-colors ${pendingBillFilter === 'past' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'}`}
                    onClick={() => { setPendingBillFilter('past'); setPendingBillPage(1); }}
                  >
                    {t('counter.tab.past')}
                  </button>
                </div>
              </div>
              {(pendingBillsData?.data?.length ?? 0) === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-muted)]">
                  {t('counter.noPendingBills', { defaultValue: 'No pending generated bills.' })}
                </div>
              ) : (
                <>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {pendingBillsData?.data?.map((bill) => (
                      <div key={bill.bill_id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-[var(--color-text-primary)]">
                              {bill.patient_name}
                              {bill.patient_code ? <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">{bill.patient_code}</span> : null}
                            </div>
                            <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                              {bill.invoice_no ?? `INV-${bill.bill_id}`} · {bill.item_count} item(s) · {bill.status}
                            </div>
                            <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                              {bill.service_summary ?? t('counter.info.serviceBill')}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-data text-lg font-semibold text-red-600">৳{money(Number(bill.pending_amount ?? 0))}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">৳{money(Number(bill.paid_amount ?? 0))} / ৳{money(Number(bill.total_amount ?? 0))}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-primary mt-3 w-full justify-center"
                          disabled={!activeSession || payPendingBill.isPending}
                          onClick={() => payPendingBill.mutate({
                            billId: Number(bill.bill_id),
                            amount: Number(bill.pending_amount ?? 0),
                            type: 'due',
                            paymentMethod: 'cash',
                            idempotencyKey: `billing-counter-due-${bill.bill_id}-${crypto.randomUUID()}`,
                          })}
                          title={!activeSession ? t('counter.info.activateCounterFirst') : undefined}
                        >
                          <CreditCard className="h-4 w-4" />
                          {t('counter.payCash', { defaultValue: 'Pay cash' })}
                        </button>
                      </div>
                    ))}
                  </div>
                  {pendingBillsData?.pagination && pendingBillsData.pagination.pages > 1 ? (
                    <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] px-4 py-3">
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {t('counter.page.info', { page: pendingBillsData.pagination.page, pages: pendingBillsData.pagination.pages, total: pendingBillsData.pagination.total })}
                      </div>
                      <div className="flex gap-1">
                        <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={pendingBillsData.pagination.page <= 1} onClick={() => setPendingBillPage((p) => p - 1)}>{t('counter.page.prev')}</button>
                        <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={pendingBillsData.pagination.page >= pendingBillsData.pagination.pages} onClick={() => setPendingBillPage((p) => p + 1)}>{t('counter.page.next')}</button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </section>

        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <section className="card p-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <label className="label">{t('patient', { defaultValue: 'Patient' })}</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--color-text-muted)]" />
                    <input
                      className="input pl-9"
                      value={selectedPatient ? labelPatient(selectedPatient) : patientSearch}
                      onChange={(e) => {
                        setSelectedPatient(null);
                        setVisitId('');
                        setCreateWalkInVisit(true);
                        setPatientSearch(e.target.value);
                        setDepositDeducted('');
                      }}
                      placeholder={t('searchPatientPlaceholder', { defaultValue: 'Search by name, code, or mobile' })}
                    />
                    {!selectedPatient && (patientsData?.patients?.length ?? 0) > 0 && (
                      <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--color-border)] bg-white shadow-lg dark:bg-slate-800">
                        {patientsData?.patients.map((patient) => (
                          <button
                            key={patient.id}
                            type="button"
                            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-surface)]"
                            onClick={() => {
                              selectBillingPatient(patient);
                              setPatientSearch('');
                            }}
                          >
                            <UserRound className="h-4 w-4 text-[var(--color-primary)]" />
                            <span>
                              <span className="block font-medium">{patient.name}</span>
                              <span className="text-xs text-[var(--color-text-muted)]">{formatPatientIdentityText(patient, t('counter.noCode'))}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="label">{t('counter.visitContext', { defaultValue: 'Visit context' })}</label>
                  <select
                    className="input"
                    value={visitId}
                    disabled={!selectedPatient}
                    onChange={(e) => {
                      setVisitId(e.target.value);
                      setCreateWalkInVisit(!e.target.value);
                      const selected = visitsData?.visits?.find((visit) => String(visit.id) === e.target.value);
                      if (selected?.doctor_id) {
                        setReferredByType('doctor');
                        setReferredByHospital(null);
                        setReferredByDoctor({ id: selected.doctor_id, name: selected.doctor_name ?? '' });
                        setLines((current) => current.map((line) => ({
                          ...line,
                          prescriberDoctorId: String(selected.doctor_id),
                        })));
                      } else {
                        clearBillingReferralState();
                      }
                    }}
                  >
                    <option value="">{t('counter.createWalkInVisit', { defaultValue: 'Create walk-in OPD visit' })}</option>
                    {visitsData?.visits?.map((visit) => (
                      <option key={visit.id} value={visit.id}>
                        {visit.visit_no ?? `Visit #${visit.id}`} - {visit.visit_type ?? 'opd'}{visit.doctor_name ? ` - ${visit.doctor_name}` : ''}{visit.visit_date ? ` - ${visit.visit_date}` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                    {visitId ? t('counter.existingVisitSelected', { defaultValue: 'Existing visit selected.' }) : t('counter.walkInVisitHint', { defaultValue: 'Leave this as walk-in when the patient does not already have a visit.' })}
                  </div>
                </div>
              </div>

              {showAdvancedBillingControls && <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
                <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setShowAdvancedOptions((value) => !value)}>
                  <span>
                    <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Scheme / Benefit</span>
                    <span className="block text-sm font-medium text-[var(--color-text-primary)]">{selectedSchemeSummary}</span>
                  </span>
                  <span className="text-xs font-medium text-[var(--color-primary)]">Advanced</span>
                </button>
              </div>}

              {showAdvancedBillingControls && showAdvancedOptions && <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                  <label className="label">{t('scheme', { defaultValue: 'Scheme' })}</label>
                  <select className="input" value={schemeId} onChange={(e) => { setSchemeId(e.target.value); setSchemePreview(null); }}>
                    <option value="">{t('counter.generalNone', { defaultValue: 'General / none' })}</option>
                    {schemesData?.data?.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.scheme_name}{scheme.scheme_code ? ` (${scheme.scheme_code})` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Scheme / card code</label>
                  <input className="input" value={schemeCodeInput} onChange={(e) => { setSchemeCodeInput(e.target.value); setSchemePreview(null); }} placeholder="Optional scheme code" />
                </div>
                <div>
                  <label className="label">Member code</label>
                  <input className="input" value={memberCodeInput} onChange={(e) => { setMemberCodeInput(e.target.value); setSchemePreview(null); }} placeholder="Staff/VIP/member card" />
                </div>
                <div>
                  <label className="label">{t('priceCategory', { defaultValue: 'Price category' })}</label>
                  <select className="input" value={priceCategoryId} onChange={(e) => setPriceCategoryId(e.target.value)}>
                    <option value="">{t('counter.defaultCatalogPrice', { defaultValue: 'Default catalog price' })}</option>
                    {priceCategoriesData?.data?.map((category) => (
                      <option key={category.id} value={category.id}>{category.category_name}{category.is_default ? ' (default)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button type="button" className="btn-secondary w-full justify-center" disabled={checkSchemePreview.isPending || totals.subtotal <= 0} onClick={submitSchemeCheck}>
                    {checkSchemePreview.isPending ? 'Checking…' : 'Check benefit'}
                  </button>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-white p-3 text-sm dark:bg-slate-800 md:col-span-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{schemePreview?.eligible ? 'Eligible benefit' : 'No benefit applied yet'}</div>
                      <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {schemePreview?.eligible
                          ? `${discountSourceLabel(schemePreview.allocation_type)} · ${schemePreview.discount_value}% · cap ৳${money(schemePreview.max_amount_per_bill || suggestedSchemeDiscount)}`
                          : schemePreview?.blockers?.join(', ') || 'Select a scheme/member code, add charges, then check eligibility.'}
                      </div>
                      {schemePreview?.matched_member_code || schemePreview?.matched_member_name ? (
                        <div className="mt-1 text-xs text-[var(--color-text-muted)]">Member: {schemePreview.matched_member_name ?? schemePreview.matched_member_code}</div>
                      ) : null}
                      {schemePreview?.requires_approval ? <div className="mt-1 text-xs text-amber-600">Approval required by scheme policy.</div> : null}
                    </div>
                    <button type="button" className="btn-secondary px-3 text-xs" disabled={!schemePreview?.eligible || suggestedSchemeDiscount <= 0 || lines.length === 0} onClick={applySuggestedSchemeDiscount}>Apply ৳{money(suggestedSchemeDiscount)}</button>
                  </div>
                </div>
              </div>}
            </section>

            <section className="card p-4">
              <h2 className="font-semibold">{t('counter.referredBy', { defaultValue: 'Referred by' })}</h2>
              <p className="mb-3 text-sm text-[var(--color-text-muted)]">
                {t('counter.referredByDesc', { defaultValue: 'Choose who referred this patient. Hospital or doctor is required for external referrals.' })}
              </p>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('counter.referredBy', { defaultValue: 'Referred by' })}>
                  {([
                    ['self', t('counter.referredBySelf', { defaultValue: 'Self' })],
                    ['hospital', t('counter.referredByHospital', { defaultValue: 'Hospital' })],
                    ['doctor', t('counter.referredByDoctor', { defaultValue: 'Doctor' })],
                  ] as const).map(([value, label]) => (
                    <label
                      key={value}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                        referredByType === value
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                          : 'border-[var(--color-border)] bg-white dark:bg-slate-800'
                      }`}
                    >
                      <input
                        type="radio"
                        name="referred-by-type"
                        value={value}
                        checked={referredByType === value}
                        onChange={() => {
                          setReferredByType(value);
                          if (value !== 'hospital') setReferredByHospital(null);
                          if (value !== 'doctor') {
                            setReferredByDoctor(null);
                            setDoctorAvailableWaiverAmount(0);
                            setDoctorWaiverVerifiedPreviewKey(null);
                            setDiscountAllocationRows((current) => current.filter((row) => row.reason !== 'doctor_commission_waiver'));
                            setLines((current) => current.map((line) => ({ ...line, prescriberDoctorId: '' })));
                          }
                        }}
                        className="sr-only"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {referredByType === 'hospital' && (
                  <div>
                    <label className="label">{t('counter.selectHospital', { defaultValue: 'Select hospital' })}</label>
                    <HospitalCombobox
                      value={referredByHospital}
                      onChange={setReferredByHospital}
                      placeholder={t('counter.searchHospital', { defaultValue: 'Search referral hospital…' })}
                    />
                  </div>
                )}
                {referredByType === 'doctor' && (
                  <div>
                    <label className="label">{t('counter.selectDoctor', { defaultValue: 'Select doctor' })}</label>
                    <DoctorCombobox
                      value={referredByDoctor}
                      onChange={(doctor) => {
                        setReferredByDoctor(doctor);
                        setLines((current) => current.map((line) => ({
                          ...line,
                          prescriberDoctorId: doctor ? String(doctor.id) : '',
                        })));
                      }}
                      placeholder={t('counter.searchDoctor', { defaultValue: 'Search doctor by name' })}
                    />
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    {t('counter.stepAddCharges', { defaultValue: '2. Add charges' })}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                    {t('counter.addChargeTitle', { defaultValue: 'Choose doctor, test or service' })}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    {t('counter.addChargeDesc', { defaultValue: 'Search and tap an item card. The bill summary will update automatically.' })}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost justify-center text-sm"
                  onClick={() => setShowAdvancedOptions((value) => !value)}
                >
                  {showAdvancedOptions ? t('counter.hideAdvanced', { defaultValue: 'Hide advanced' }) : t('counter.showAdvanced', { defaultValue: 'Advanced options' })}
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                {([
                  ['doctor', t('counter.doctorConsultation', { defaultValue: 'Doctor consultation' })],
                  ['pathology', t('counter.tab.pathology')],
                  ['radiology', t('counter.tab.radiology')],
                  ['services', t('counter.tab.hospitalServices')],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setChargeTab(key);
                      if (key !== 'doctor') setCatalogGroup(key);
                    }}
                    className={`rounded-xl border px-3 py-3 text-sm font-semibold ${chargeTab === key ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white shadow-sm' : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {chargeTab === 'doctor' ? (
                <div className="mt-4">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--color-text-muted)]" />
                    <input className="input pl-9" value={doctorSearch} onChange={(e) => setDoctorSearch(e.target.value)} placeholder={t('counter.searchDoctor', { defaultValue: 'Search doctor by name' })} />
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {doctorOptions.map((doctor) => (
                      <button
                        key={doctor.id}
                        type="button"
                        onClick={() => addDoctorConsultation(doctor)}
                        className="flex w-full items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-left transition hover:border-[var(--color-primary)] hover:bg-white dark:hover:bg-slate-800"
                      >
                        <span>
                          <span className="block font-semibold text-[var(--color-text-primary)]">{doctor.name}</span>
                          <span className="text-xs text-[var(--color-text-muted)]">{doctor.specialty || doctor.department || t('doctor')}</span>
                        </span>
                        <span className="font-data text-lg font-semibold text-[var(--color-primary)]">৳{money(Number(doctor.consultation_fee ?? 0))}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-4">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--color-text-muted)]" />
                    <input className="input pl-9" value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} placeholder={t('counter.searchCatalogPlaceholder', { defaultValue: 'CBC, X-ray, bed charge...' })} />
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {servicesLoading && <div className="text-sm text-[var(--color-text-muted)]">{t('counter.loadingCatalog', { defaultValue: 'Loading catalog...' })}</div>}
                    {servicesData?.data?.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addServiceItem(item)}
                        className="flex w-full items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-left transition hover:border-[var(--color-primary)] hover:bg-white dark:hover:bg-slate-800"
                      >
                        <span>
                          <span className="block font-semibold text-[var(--color-text-primary)]">{item.item_name}</span>
                          <span className="text-xs text-[var(--color-text-muted)]">{item.department_name ?? t('counter.general')} {item.item_code ? `· ${item.item_code}` : ''}</span>
                        </span>
                        <span className="font-data text-lg font-semibold text-[var(--color-primary)]">৳{money(Number(item.price))}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="card overflow-hidden">
              <div className="border-b border-[var(--color-border)] p-4">
                <h2 className="font-semibold">{t('counter.billLines', { defaultValue: 'Bill lines' })}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('counter.item', { defaultValue: 'Item' })}</th>
                      <th className="w-24">{t('counter.qty', { defaultValue: 'Qty' })}</th>
                      <th className="w-32">{t('counter.price', { defaultValue: 'Price' })}</th>
                      <th className="w-32">{t('discount', { defaultValue: 'Discount' })}</th>
                      <th className="w-44">{t('counter.performer', { defaultValue: 'Performer' })}</th>
                      <th className="w-44">{t('counter.prescriber', { defaultValue: 'Prescriber' })}</th>
                      <th className="w-32 text-right">{t('total', { defaultValue: 'Total' })}</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr><td colSpan={8} className="py-8 text-center text-[var(--color-text-muted)]">{t('counter.noServiceItems', { defaultValue: 'No billable item added yet.' })}</td></tr>
                    ) : lines.map((line, index) => {
                      const allowMultiple = line.sourceType === 'service_item'
                        ? line.serviceItem?.allow_multiple_qty !== 0 && line.serviceItem?.allow_multiple_qty !== false
                        : false;
                      const allowDiscount = line.sourceType === 'service_item'
                        ? line.serviceItem?.allow_discount !== 0 && line.serviceItem?.allow_discount !== false
                        : true;
                      return (
                        <tr key={`${line.sourceType}-${line.serviceItem?.id ?? line.doctor?.id}`}>
                          <td>
                            <div className="font-medium">{lineLabel(line)}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">{lineDepartment(line)}</div>
                          </td>
                          <td>
                            <input
                              className="input h-9"
                              type="number"
                              min="1"
                              value={line.quantity}
                              disabled={!allowMultiple}
                              onChange={(e) => updateLine(index, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                            />
                          </td>
                          <td className="font-data">৳{money(lineUnitPrice(line))}</td>
                          <td>
                            {canApplyDiscount ? (
                              <div className="flex items-center gap-1">
                                {line.discountMode === 'percent' ? (
                                  <div className="flex items-center gap-1 w-full">
                                    <input
                                      className="input h-9 w-16"
                                      type="number"
                                      min="0"
                                      max="100"
                                      value={line.discountPercent}
                                      disabled={!allowDiscount}
                                      onChange={(e) => updateLine(index, { discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                                    />
                                    <span className="text-xs text-[var(--color-text-muted)]">%</span>
                                  </div>
                                ) : (
                                  <input
                                    className="input h-9"
                                    type="number"
                                    min="0"
                                    value={line.discountAmount}
                                    disabled={!allowDiscount}
                                    onChange={(e) => updateLine(index, { discountAmount: Math.max(0, Number(e.target.value) || 0) })}
                                  />
                                )}
                                <button
                                  type="button"
                                  className={`text-[10px] px-1 py-0.5 rounded ${line.discountMode === 'percent' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'} hover:bg-blue-200`}
                                  disabled={!allowDiscount}
                                  onClick={() => updateLine(index, { discountMode: line.discountMode === 'percent' ? 'flat' : 'percent', discountAmount: 0, discountPercent: 0 })}
                                  title={line.discountMode === 'percent' ? 'Switch to flat amount' : 'Switch to percentage'}
                                >
                                  {line.discountMode === 'percent' ? '%' : '৳'}
                                </button>
                              </div>
                            ) : (
                              <span className="text-sm text-[var(--color-text-muted)]">-</span>
                            )}
                          </td>
                          <td>
                            {line.serviceItem?.performerPayoutRule ? (
                              <div className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                                <div className="font-semibold">Automatic performer reserve</div>
                                <div>৳{money(line.serviceItem.performerPayoutRule.displayAmount)} auto-reserved per unit</div>
                              </div>
                            ) : (
                              <select className="input h-9" value={line.performerDoctorId} onChange={(e) => updateLine(index, { performerDoctorId: e.target.value })}>
                                <option value="">{t('optional', { defaultValue: 'Optional' })}</option>
                                {allDoctorOptions.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
                              </select>
                            )}
                          </td>
                          <td>
                            <select
                              className="input h-9"
                              value={line.prescriberDoctorId}
                              disabled={referredByType !== 'doctor' || !referredByDoctor}
                              onChange={(e) => updateLine(index, { prescriberDoctorId: e.target.value })}
                            >
                              <option value="">{referredByType === 'doctor' && referredByDoctor ? t('optional', { defaultValue: 'Optional' }) : 'Select doctor referral first'}</option>
                              {allDoctorOptions.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
                            </select>
                          </td>
                          <td className="text-right font-data font-semibold">৳{money(lineTotal(line))}</td>
                          <td>
                            <button type="button" onClick={() => removeLine(index)} className="btn-ghost p-1.5 text-red-500" aria-label="Remove line">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            {showAdvancedBillingControls && <section className="card p-4">
              <h2 className="mb-3 font-semibold">{t('counter.billMode', { defaultValue: 'Bill mode' })}</h2>
              <div className="grid grid-cols-3 gap-2">
                {(['paid', 'provisional', 'credit'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleBillModeChange(mode)}
                    className={`rounded-lg border px-3 py-2 text-sm capitalize ${billMode === mode ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)] bg-white dark:bg-slate-800'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </section>}

            <section className="card p-4">
              <div className="mb-3 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-[var(--color-primary)]" />
                <h2 className="font-semibold">{t('payment', { defaultValue: 'Payment' })}</h2>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="label">{t('method', { defaultValue: 'Method' })}</label>
                  <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={billMode !== 'paid'}>
                    <option value="cash">{t('cash', { defaultValue: 'Cash' })}</option>
                    <option value="bkash">{t('bkash', { defaultValue: 'bKash' })}</option>
                    <option value="nagad">{t('nagad', { defaultValue: 'Nagad' })}</option>
                    <option value="card">{t('card', { defaultValue: 'Card' })}</option>
                    <option value="bank">{t('bank', { defaultValue: 'Bank' })}</option>
                    <option value="bank_transfer">{t('bankTransfer', { defaultValue: 'Bank transfer' })}</option>
                    <option value="cheque">{t('cheque', { defaultValue: 'Cheque' })}</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('paidAmount', { defaultValue: 'Paid amount' })}</label>
                  <div className="flex gap-2">
                    <input className="input" type="number" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} disabled={billMode !== 'paid'} />
                    {billMode === 'paid' && toNumber(paidAmount) < Math.max(0, totals.total - totals.deposit) && (
                      <button
                        type="button"
                        className="btn-secondary shrink-0 px-3"
                        onClick={() => setPaidAmount(String(Math.max(0, totals.total - totals.deposit)))}
                        aria-label={t('counter.fillFull', { defaultValue: 'Fill full' })}
                      >
                        {t('counter.fillFull', { defaultValue: 'Fill full' })}
                      </button>
                    )}
                  </div>
                </div>
                {showAdvancedBillingControls && <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="label mb-0">{t('counter.depositDeduction', { defaultValue: 'Deposit deduction' })}</label>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {selectedPatient
                        ? depositBalanceLoading
                          ? t('loading', { defaultValue: 'Loading...' })
                          : t('counter.info.availableDeposit', { amount: money(selectedDepositBalance) })
                        : t('counter.selectPatientFirst', { defaultValue: 'Select patient first' })}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="input"
                      type="number"
                      min="0"
                      max={maxDepositDeduction}
                      value={depositDeducted}
                      onChange={(e) => {
                        const requested = Math.max(0, Number(e.target.value) || 0);
                        setDepositDeducted(String(Math.min(requested, maxDepositDeduction)));
                      }}
                      placeholder={selectedDepositBalance > 0 ? t('counter.placeholder.maxDeposit', { amount: money(maxDepositDeduction) }) : '0'}
                      disabled={billMode !== 'paid' || !selectedPatient || selectedDepositBalance <= 0 || totals.total <= 0}
                    />
                    <button
                      type="button"
                      className="btn-secondary shrink-0 px-3"
                      disabled={billMode !== 'paid' || !selectedPatient || maxDepositDeduction <= 0}
                      onClick={() => {
                        setDepositDeducted(String(maxDepositDeduction));
                        if (billMode === 'paid') setPaidAmount(String(Math.max(0, totals.total - maxDepositDeduction)));
                      }}
                    >
                      {t('counter.btn.useMax')}
                    </button>
                  </div>
                  {selectedPatient && selectedDepositBalance > 0 ? (
                    <div className="mt-1 text-xs text-emerald-700">
                      {t('counter.info.depositAdjusted', { amount: money(Math.max(0, selectedDepositBalance - totals.deposit)) })}
                    </div>
                  ) : null}
                </div>}
                {showAdvancedBillingControls && <div>
                  <label className="label">{t('counter.transactionReference', { defaultValue: 'Transaction reference' })}</label>
                  <input className="input" value={externalTransactionId} onChange={(e) => setExternalTransactionId(e.target.value)} placeholder={t('optional', { defaultValue: 'Optional' })} disabled={billMode !== 'paid'} />
                </div>}
              </div>
            </section>

            <section className="card p-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>{t('subtotal', { defaultValue: 'Subtotal' })}</span><span className="font-data">৳{money(totals.subtotal)}</span></div>
                <div className="flex justify-between"><span>{t('discount', { defaultValue: 'Discount' })}</span><span className="font-data">৳{money(totals.discount)}</span></div>
	                {totals.discount > 0 && (
	                  <div>
	                    <label className="label">{t('counter.discountByName', { defaultValue: 'Discount referred by' })}{requiresDiscountByName ? ' *' : ''}</label>
	                    <input
	                      className="input"
	                      value={discountByName}
	                      onChange={(e) => setDiscountByName(e.target.value)}
	                      placeholder={requiresDiscountByName
	                        ? t('counter.discountByNameRequiredPlaceholder', { defaultValue: 'Required for discounts above 20%' })
	                        : t('counter.discountByNamePlaceholder', { defaultValue: 'Name of person who referred (optional)' })}
	                    />
	                  </div>
	                )}
                {totals.discount > 0 && !schemePreview?.eligible ? (
                  <DiscountAllocationEditor
                    totalDiscount={totals.discount}
                    enabled={discountAllocationEnabled}
                    rows={discountAllocationRows}
                    compact
                    context={{
                      selectedDoctorId: referringDoctorId,
                      doctorAvailableWaiverAmount,
                      eligibleCommissionAmount: doctorWaiverQuote?.eligibleCommissionAmount,
                      performerReserveAmount: doctorWaiverQuote?.performerReserveAmount,
                      protectedCommissionAmount: doctorWaiverQuote?.protectedCommissionAmount,
                      payableCommissionAmount: doctorWaiverQuote?.payableCommissionAmount,
                      doctorWaiverLoading: doctorWaiverPreviewPending,
                      doctorWaiverPreviewFailed,
                    }}
                    onEnabledChange={(enabled) => {
                      setDiscountAllocationEnabled(enabled);
                      if (enabled && discountAllocationRows.length === 0) {
                        setDiscountAllocationRows(createDefaultDiscountAllocations(totals.discount, {
                          selectedDoctorId: referringDoctorId,
                          doctorAvailableWaiverAmount,
                          doctorWaiverLoading: doctorWaiverPreviewPending,
                          doctorWaiverPreviewFailed,
                        }));
                      }
                    }}
                    onRowsChange={setDiscountAllocationRows}
                    onQuickSourceSelected={(reason) => {
                      setDiscountSourceIntent(reason);
                      if (reason === 'doctor_commission_waiver' && doctorWaiverPreviewMutation.isError) {
                        setDoctorWaiverVerifiedPreviewKey(null);
                        doctorWaiverPreviewMutation.reset();
                      }
                    }}
                  />
                ) : null}
                <div className="flex justify-between"><span>{t('deposit', { defaultValue: 'Deposit' })}</span><span className="font-data">৳{money(totals.deposit)}</span></div>
                <div className="flex justify-between"><span>{t('paid', { defaultValue: 'Paid' })}</span><span className="font-data">৳{money(totals.paid)}</span></div>
                <div className="border-t border-[var(--color-border)] pt-3">
                  <div className="flex justify-between text-lg font-semibold">
                    <span>{t('total', { defaultValue: 'Total' })}</span>
                    <span className="font-data">৳{money(totals.total)}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-sm text-[var(--color-text-muted)]">
                    <span>{t('due', { defaultValue: 'Due' })}</span>
                    <span className="font-data">৳{money(totals.due)}</span>
                  </div>
                </div>
              </div>
              <button type="button" onClick={submit} disabled={createInvoice.isPending || doctorWaiverPaymentBlocked || !activeSession} className="btn-primary mt-3 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50">
                {createInvoice.isPending ? <Banknote className="h-4 w-4 animate-pulse" /> : <Plus className="h-4 w-4" />}
                {billMode === 'provisional' ? t('counter.createProvisional', { defaultValue: 'Create provisional bill' }) : t('counter.createInvoice', { defaultValue: 'Create invoice' })}
              </button>
            </section>
          </aside>
        </div>
          </>
        ) : (
          <section className="card p-6 text-center">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Counter activation required</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Open a counter to unlock this workspace.</p>
          </section>
        )}
      </div>

      {takeOverTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="billing-counter-takeover-title">
            <h2 id="billing-counter-takeover-title" className="text-xl font-semibold text-[var(--color-text-primary)]">
              {t('counter.confirmTakeOver', { defaultValue: 'Confirm Take Over' })}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              {t('counter.confirmTakeOverDesc', { defaultValue: 'This will close the current active session and open the counter under your account. The cash handover amount will be calculated by the server and audited automatically.' })}
            </p>
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
              <div className="font-semibold">{takeOverTarget.counter_name}{takeOverTarget.counter_code ? ` (${takeOverTarget.counter_code})` : ''}</div>
              <div className="mt-1 text-xs opacity-80">{takeOverTarget.cashier_name} · {takeOverTarget.opened_at}</div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={takeOverCounter.isPending}
                onClick={() => setTakeOverTarget(null)}
              >
                {t('cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={takeOverCounter.isPending}
                onClick={() => takeOverCounter.mutate({ sessionId: takeOverTarget.id })}
              >
                {takeOverCounter.isPending ? t('counter.takingOver', { defaultValue: 'Taking over…' }) : t('counter.takeOver', { defaultValue: 'Take Over' })}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
