import { useState, useMemo, useRef, useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Receipt, Plus, Users, CheckCircle2, X, Printer, Search, Hash,
  Stethoscope, FlaskConical, Syringe, Bed, ArrowRight, Calendar,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Package, TrendingUp, CreditCard, UserPlus, Ticket, Banknote, Minus,
  AlertTriangle, UserCheck, ListChecks, Trash2, FileText, LogIn, LogOut, Repeat, Droplets, Ambulance, UserRound,
  Sparkles, Wrench, Bookmark,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { getIpdRunningBillPrintPath, getRoleBasePath } from '../lib/handover';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6 } from '../lib/date-utils';
import { normalizeExternalTransactionId, requiresPaymentReference } from '../lib/paymentReference';
import { calculateAgePartsFromDateOfBirth, estimateDateOfBirthFromAgeParts, formatAgeFromDateOfBirth } from '../lib/age';
import { formatPatientAgeLabel, formatPatientIdentityText } from '../lib/patientIdentity';
import ReceptionTopBar from '../components/reception/ReceptionTopBar';
import ReceptionPatientDrawer from '../components/reception/ReceptionPatientDrawer';
import { api, ApiClientError } from '../lib/apiClient';
import { ProvisionalBillingModal, getIpdProvisionalDisplayTotal } from '../components/reception/ProvisionalBillingModal';
import TokenReservationPanel from '../components/reception/TokenReservationPanel';
import CustomSerialInput from '../components/reception/CustomSerialInput';
import DiscountAllocationEditor, { createDefaultDiscountAllocations, getDiscountAllocationPayload, hasBalancedDiscountAllocations, type DiscountAllocationReason, type DiscountAllocationRow } from '../components/reception/DiscountAllocationEditor';
import HospitalCombobox, { type HospitalOption } from '../components/HospitalCombobox';
import {
  getBillCashPaidAmount,
  getBillDepositAdjustedAmount,
  getBillOutstandingAmount,
  getBillSettledAmount,
  getBillTotalAmount,
} from '../lib/billAmounts';
import { buildCheckedInVisit, redirectToReceptionBillPrint } from '../lib/receptionBilling';
import { getAdmissionSlipPrintPath } from '../lib/admissionPrint';
import { DEFAULT_DUE_COLLECTION_SCOPE } from '../lib/receptionPendingDue';
export { getIpdProvisionalDisplayTotal };
export { buildCheckedInVisit, redirectToReceptionBillPrint };
export { getBillCashPaidAmount, getBillOutstandingAmount, getBillSettledAmount };

export function shouldShowServiceDepositField(depositBalance: number | null | undefined): boolean {
  return Number(depositBalance ?? 0) > 0;
}

export function allocateProportionalDiscounts(grossAmounts: number[], totalDiscount: number): number[] {
  const normalizedGross = grossAmounts.map((value) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100));
  const subtotal = normalizedGross.reduce((sum, value) => sum + value, 0);
  const discount = Math.min(subtotal, Math.max(0, Math.round((Number(totalDiscount) || 0) * 100) / 100));
  if (subtotal <= 0 || discount <= 0) return normalizedGross.map(() => 0);
  let allocated = 0;
  return normalizedGross.map((gross, index) => {
    const amount = index === normalizedGross.length - 1
      ? Math.max(0, Math.round((discount - allocated) * 100) / 100)
      : Math.min(gross, Math.round(((discount * gross) / subtotal) * 100) / 100);
    allocated = Math.round((allocated + amount) * 100) / 100;
    return amount;
  });
}

export function calculateVisitServicePaymentDraft(input: {
  grandTotal: number;
  depositBalance: number;
  depositRequested?: string | number | null;
  payNowInput?: string | number | null;
}) {
  const grandTotal = Math.max(0, Number(input.grandTotal) || 0);
  const depositBalance = Math.max(0, Number(input.depositBalance) || 0);
  const depositRequested = Math.max(0, Number(input.depositRequested || 0) || 0);
  const depositApplied = Math.min(depositBalance, grandTotal, depositRequested);
  const payableNow = Math.max(0, grandTotal - depositApplied);
  const rawCashPaid = input.payNowInput === '' || input.payNowInput == null
    ? payableNow
    : Math.max(0, Number(input.payNowInput) || 0);
  const cashPaid = Math.min(payableNow, rawCashPaid);
  const dueAfterPayment = Math.max(0, payableNow - cashPaid);
  return { depositApplied, payableNow, cashPaid, dueAfterPayment };
}

const RECEPTION_SEARCH_STALE_MS = 60_000;
// Reception is the busiest always-open screen. Prefer reload/manual refresh
// and mutation invalidation over idle polling to avoid automatic Worker growth.
const RECEPTION_ACTIVE_STALE_MS = 2 * 60_000;
const RECEPTION_SUMMARY_STALE_MS = 10 * 60_000;
const RECEPTION_LOOKUP_STALE_MS = 6 * 60 * 60_000;

type ReceptionFlowActionButtonVariant = 'default' | 'primary' | 'emerald' | 'disabled';

type ReceptionFlowActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ReactNode;
  label: string;
  detail: string;
  variant?: ReceptionFlowActionButtonVariant;
};

function ReceptionFlowActionButton({
  icon,
  label,
  detail,
  variant = 'default',
  className = '',
  title,
  ...buttonProps
}: ReceptionFlowActionButtonProps) {
  const toneClass = variant === 'primary'
    ? 'action-btn--primary'
    : variant === 'emerald'
      ? 'action-btn--emerald'
      : variant === 'disabled'
        ? 'action-btn--disabled'
        : '';
  const ariaLabel = buttonProps['aria-label'] ?? label;

  return (
    <button
      {...buttonProps}
      type={buttonProps.type ?? 'button'}
      title={title ?? label}
      aria-label={ariaLabel}
      className={['action-btn', 'patient-flow-action-button', toneClass, className].filter(Boolean).join(' ')}
    >
      <span className="patient-flow-action-icon" aria-hidden="true">{icon}</span>
      <span className="patient-flow-action-detail" aria-hidden="true">
        <span className="patient-flow-action-detail-title">{label}</span>
        <span className="patient-flow-action-detail-copy">{detail}</span>
      </span>
    </button>
  );
}


function reasonForDiscountSource(source?: string | null): DiscountAllocationReason {
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

/* ─── Types ─── */
interface Patient {
  id: number;
  name: string;
  mobile: string;
  patient_code?: string;
  age?: number;
  gender?: string;
  father_husband?: string;
  address?: string;
  guardian_mobile?: string;
  date_of_birth?: string;
  blood_group?: string;
}
interface Doctor { id: number; name: string; specialty?: string; consultation_fee?: number; }
interface ServiceItem { id: number; item_name: string; item_code?: string; price: number; department_name?: string; service_department_id?: number; category_name?: string; usage_count?: number; is_lab_catalog?: number; is_radiology?: number; }
interface ServiceDept { id: number; department_name: string; }
interface QuickBillLine extends ServiceItem { quantity: number; discountAmount: number; performerDoctorId?: number | ''; }
type QuickBillReferrerType = 'self' | 'doctor' | 'hospital' | 'other';

interface SchemePreviewResponse {
  eligible: boolean;
  scheme_id: number | null;
  scheme_name: string | null;
  scheme_code?: string | null;
  discount_value: number;
  suggested_discount: number;
  allocation_type: string;
  requires_reference: boolean;
  requires_approval: boolean;
  matched_member_id?: number | null;
  matched_member_code?: string | null;
  matched_member_name?: string | null;
  service_category?: string | null;
  blockers: string[];
}
interface Visit {
  id: number; patient_id: number; patient_name: string; patient_code?: string; mobile?: string; age?: number | string | null; date_of_birth?: string | null;
  appointment_id?: number | null;
  doctor_id?: number | null; doctor_name?: string; visit_date?: string; visit_type?: string; pending_services?: number; pending_amount?: number;
  referred_by_type?: QuickBillReferrerType | string | null; referred_by_name?: string | null; referring_doctor_id?: number | null; referred_by_doctor_name?: string | null;
  pending_doctor_visit_services?: number | null; pending_doctor_visit_amount?: number | null;
  status?: string | null; created_at?: string | null;
  bill_id?: number | null; invoice_no?: string | null; bill_total?: number | null; bill_paid?: number | null; bill_due?: number | null; bill_status?: string | null;
  bill_count?: number | null; due_bill_count?: number | null;
}

function resolveVisitDoctorId(visit?: Visit | null): number {
  if (!visit) return 0;
  const source = visit as Visit & { doctorId?: number | null; referringDoctorId?: number | null; prescriber_doctor_id?: number | null; prescriberDoctorId?: number | null };
  return Number(source.doctor_id ?? source.doctorId ?? source.prescriber_doctor_id ?? source.prescriberDoctorId ?? source.referring_doctor_id ?? source.referringDoctorId ?? 0) || 0;
}

interface VisitService {
  id: number; service_type: string; description: string; service_name?: string; amount: number;
  quantity: number; total_amount: number; status: string; doctor_name?: string; created_at?: string | null; item_code?: string | null;
}
interface BillRecord {
  id: number; invoice_no?: string; patient_name: string; patient_code?: string | null; patient_mobile?: string | null; total: number; paid?: number; paid_amount?: number; cash_paid_amount?: number | null; total_amount?: number; due?: number; status: string; created_at: string;
  bill_date?: string | null;
  settled_amount?: number | null; outstanding?: number | null; pending_amount?: number | null; deposit_adjusted?: number | null; deposit_deducted?: number | null;
  service_summary?: string | null; item_count?: number | null; doctor_name?: string | null; visit_no?: string | null; created_by_name?: string | null;
  test_bill?: number | null; doctor_visit_bill?: number | null; admission_bill?: number | null; operation_bill?: number | null; medicine_bill?: number | null;
}
interface AppointmentSummary {
  id: number; status?: string | null; billing_status?: string | null; fee?: number | null; consultation_fee?: number | null; total_amount?: number | null;
  patient_id?: number; patient_name?: string; patient_code?: string | null; patient_mobile?: string | null; patient_age?: number | string | null; patient_date_of_birth?: string | null; doctor_id?: number | null; doctor_name?: string | null; appt_time?: string | null; token_no?: number | null;
  token_assignment_type?: 'auto' | 'reserved' | 'manual' | null;
  appointment_type?: AppointmentType | null; visit_type?: string | null; discount_amount?: number | null; original_fee?: number | null; final_fee?: number | null;
  created_at?: string | null;
  bill_id?: number | null;
  invoice_no?: string | null;
  bill_total?: number | null;
  bill_paid?: number | null;
  bill_due?: number | null;
  bill_status?: string | null;
  bill_count?: number | null; due_bill_count?: number | null;
}
interface QueueStats {
  total?: number; waiting?: number; called?: number; serving?: number; completed?: number;
}
interface QueueTokenRow {
  id: number;
  visit_id?: number | null;
  appointment_id?: number | null;
  doctor_id?: number | null;
  token_no?: string | null;
  token_number?: number | null;
  status?: string | null;
  check_in_time?: string | null;
  called_at?: string | null;
  patient_id?: number | null;
  patient_name?: string | null;
  patient_code?: string | null;
  phone?: string | null;
  doctor_name?: string | null;
  department_name?: string | null;
}
interface DailyReport {
  date: string; summary: { totalBilled: number; totalPaid: number; dueCollection?: number; totalDue: number; billCount: number; paidBillCount?: number; depositReceived?: number; totalCashReceived?: number; };
  byCategory: Array<{ item_category: string; total_amount: number; item_count: number }>;
  byPaymentMethod: Array<{ payment_method: string; total_amount: number; transaction_count: number }>;
  byDoctor: Array<{ doctor_name: string; total_amount: number; service_count: number }>;
  byDoctorConsultation?: Array<{ doctor_name: string; total_amount: number; service_count: number }>;
  byDoctorTest?: Array<{ doctor_name: string; total_amount: number; service_count: number }>;
  byDoctorOther?: Array<{ doctor_name: string; total_amount: number; service_count: number }>;
}
interface AvailableBedsResponse {
  beds: Array<{ id: number; ward_name?: string | null; bed_number?: string | null; bed_type?: string | null; effective_rate?: number | null }>;
}
interface ReceptionBed {
  id?: number;
  bed_id?: number;
  ward_name?: string | null;
  bed_number?: string | null;
  bed_type?: string | null;
  floor?: string | null;
  status?: string | null;
  rate_per_day?: number | null;
  effective_rate?: number | null;
  feature_names?: string | null;
  patient_name?: string | null;
  patient_code?: string | null;
  admission_no?: string | null;
}
interface ReceptionBedsResponse {
  beds: ReceptionBed[];
}
interface DoctorTodayStatus {
  id: number; name: string; specialty?: string | null; is_available: number; max_serial?: number | null; serial_count?: number | null;
}
interface ReportDeliveryLookup {
  invoice: { id: number; invoiceNo?: string | null; status?: string | null; totalAmount: number; paidAmount: number; dueAmount: number; depositAdjusted?: number | null; createdAt?: string | null };
  patient: { id: number; name: string; patientCode?: string | null; mobile?: string | null };
  reports: Array<{ id: number; test_name?: string | null; status?: string | null; order_no?: string | null }>;
  canPrint: boolean;
  needsPayment: boolean;
  allReady: boolean;
}

interface PendingBillSummary {
  bill_id: number;
  invoice_no?: string | null;
  patient_id?: number | null;
  visit_id?: number | null;
  patient_name: string;
  patient_code?: string | null;
  patient_mobile?: string | null;
  pending_amount: number;
  total_amount?: number | null;
  paid_amount?: number | null;
  settled_amount?: number | null;
  outstanding?: number | null;
  deposit_adjusted?: number | null;
  deposit_deducted?: number | null;
  status?: string | null;
  created_at: string;
  bill_date?: string | null;
  item_count?: number | null;
  service_summary?: string | null;
  visit_no?: string | null;
  doctor_name?: string | null;
  created_by_name?: string | null;
  test_bill?: number | null;
  doctor_visit_bill?: number | null;
  admission_bill?: number | null;
  operation_bill?: number | null;
  medicine_bill?: number | null;
}

interface PendingAppointmentCharge {
  appointment_id: number;
  appt_no?: string | null;
  token_no?: number | null;
  appt_date?: string | null;
  appt_time?: string | null;
  appointment_status?: string | null;
  billing_status?: string | null;
  appointment_fee?: number | null;
  patient_id?: number | null;
  patient_name?: string | null;
  patient_code?: string | null;
  patient_mobile?: string | null;
  doctor_id?: number | null;
  doctor_name?: string | null;
  doctor_specialty?: string | null;
  pending_amount?: number | null;
  pending_item_count?: number | null;
}
interface PendingDueWorklistRow {
  source_type: 'bill' | 'appointment' | 'visit';
  source_id: number;
  bill_id?: number | null;
  appointment_id?: number | null;
  visit_id?: number | null;
  patient_id?: number | null;
  patient_name?: string | null;
  patient_code?: string | null;
  doctor_id?: number | null;
  doctor_name?: string | null;
  token_no?: number | null;
  appt_time?: string | null;
  invoice_no?: string | null;
  service_summary?: string | null;
  amount: number;
  occurred_at?: string | null;
  created_by_name?: string | null;
  billing_status?: string | null;
}
interface PendingPrescriptionLabOrderItem {
  id: number;
  testName: string;
  lineTotal: number;
}
interface PendingPrescriptionLabOrder {
  orderId: number;
  orderNo?: string | null;
  prescriptionId?: number | null;
  rxNo?: string | null;
  patientId: number;
  patientName: string;
  patientCode?: string | null;
  patientMobile?: string | null;
  doctorId?: number | null;
  doctorName?: string | null;
  orderDate?: string | null;
  pendingItemCount: number;
  pendingAmount: number;
  items: PendingPrescriptionLabOrderItem[];
}
interface ReagentUsageWarning {
  itemId?: number;
  message?: string;
}

export function buildReagentUsageWarningToast(warnings?: ReagentUsageWarning[] | null): string | null {
  const count = warnings?.length ?? 0;
  if (count <= 0) return null;
  const firstMessage = String(warnings?.find((warning) => String(warning.message ?? "").trim().length > 0)?.message ?? "").trim();
  if (count === 1) return "Lab reagent stock warning: " + (firstMessage || "one billed test could not deduct reagent stock.");
  return "Lab reagent stock warning: " + count + " billed tests could not deduct reagent stock." + (firstMessage ? " First: " + firstMessage : "");
}

interface GlobalPatientSearchResult {
  id: number;
  uhid: string;
  primary_name: string;
  primary_phone: string;
  primary_email: string;
  date_of_birth: string | null;
  gender: string | null;
  claim_status?: string | null;
  linked_patient_id?: number | null;
}

type AppointmentType = 'new_patient' | 'old_patient' | 'follow_up' | 'report_show' | 'free_visit' | 'discounted_visit' | 'emergency';

interface NewPatientFormState {
  name: string;
  mobile: string;
  mobileMissing: boolean;
  mobileMissingReason: string;
  age: string;
  ageMonths: string;
  ageDays: string;
  gender: string;
  fatherHusband: string;
  address: string;
  guardianName: string;
  guardianRelation: string;
  guardianMobile: string;
  village: string;
  unionName: string;
  upazila: string;
  district: string;
  division: string;
  dateOfBirth: string;
  bloodGroup: string;
}

interface AppointmentFeePreviewResponse {
  charge: {
    appointmentType: AppointmentType;
    originalFee: number;
    discountAmount: number;
    finalFee: number;
    billingStatus: string;
  };
  eligibility?: {
    eligible: boolean;
    windowDays: number;
    lastVisitDate: string | null;
    reason: string | null;
  };
}

interface AvailableReservedToken {
  token?: number;
  token_no?: number;
  label?: string | null;
}

type BookedTokenNumber = number | { token?: number; token_no?: number };

interface TokenReservationAvailabilityResponse {
  tokens?: AvailableReservedToken[];
  available?: AvailableReservedToken[];
  bookedTokens?: BookedTokenNumber[];
  booked?: BookedTokenNumber[];
  summary?: {
    currentTokenNo: number;
    nextRegularTokenNo: number;
    reservedTotal: number;
    reservedBooked: number;
    reservedAvailable: number;
  };
}

const APPOINTMENT_TYPE_OPTIONS: Array<{ value: AppointmentType; label: string }> = [
  { value: 'new_patient', label: 'select.newPatient' },
  { value: 'old_patient', label: 'select.followUp' },
  { value: 'report_show', label: 'select.reportShow' },
  { value: 'free_visit', label: 'select.freeVisit' },
  { value: 'emergency', label: 'select.emergency' },
];

const APPOINTMENT_SOURCE_OPTIONS = [
  { value: 'walk_in', label: 'select.walkIn' },
  { value: 'phone', label: 'select.phoneCall' },
] as const;

const EMPTY_NEW_PATIENT_FORM: NewPatientFormState = {
  name: '',
  mobile: '',
  mobileMissing: false,
  mobileMissingReason: '',
  age: '',
  ageMonths: '',
  ageDays: '',
  gender: 'male',
  fatherHusband: '',
  address: '',
  guardianName: '',
  guardianRelation: '',
  guardianMobile: '',
  village: '',
  unionName: '',
  upazila: '',
  district: '',
  division: '',
  dateOfBirth: '',
  bloodGroup: '',
};

/* ─── Helpers ─── */
const todayStr = () => getTodayGMT6();

export function addReceptionDateDays(date: string, delta: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(current.getTime())) return date;
  current.setUTCDate(current.getUTCDate() + delta);
  return current.toISOString().slice(0, 10);
}

export function formatReceptionFlowDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}


type DueCollectionScope = 'today' | 'all' | 'overdue' | 'ipd';
type DueAgeBucket = 'all' | '0_7' | '8_30' | '31_60' | '60_plus';
type DueVisitTypeFilter = 'all' | 'opd' | 'ipd';

type DueCollectionResponse = {
  bills: BillRecord[];
  summary?: { totalBills?: number; totalDue?: number };
};

const DUE_COLLECTION_SCOPE_OPTIONS: Array<{ value: DueCollectionScope; label: string; helper: string }> = [
  { value: 'today', label: 'Today Due', helper: 'Bills created today plus current pending charges' },
  { value: 'all', label: 'All Open Dues', helper: 'Every unpaid or partially paid invoice' },
  { value: 'overdue', label: 'Overdue', helper: 'Previous-date invoices still unpaid' },
  { value: 'ipd', label: 'IPD Due Discharge', helper: 'Discharged/admitted patient invoices with balance' },
];

const DUE_AGE_BUCKETS: Array<{ value: DueAgeBucket; label: string }> = [
  { value: 'all', label: 'All ages' },
  { value: '0_7', label: '0-7d' },
  { value: '8_30', label: '8-30d' },
  { value: '31_60', label: '31-60d' },
  { value: '60_plus', label: '60+d' },
];

export function receptionDueAgeDays(createdAt?: string | null, asOfDate = todayStr()): number {
  if (!createdAt) return 0;
  const billTime = new Date(String(createdAt).slice(0, 10) + 'T00:00:00Z').getTime();
  const asOfTime = new Date(asOfDate + 'T00:00:00Z').getTime();
  if (!Number.isFinite(billTime) || !Number.isFinite(asOfTime)) return 0;
  return Math.max(0, Math.floor((asOfTime - billTime) / 86400000));
}

export function receptionDueMatchesAgeBucket(ageDays: number, bucket: DueAgeBucket): boolean {
  if (bucket === 'all') return true;
  if (bucket === '0_7') return ageDays <= 7;
  if (bucket === '8_30') return ageDays >= 8 && ageDays <= 30;
  if (bucket === '31_60') return ageDays >= 31 && ageDays <= 60;
  return ageDays > 60;
}

export function isReceptionBillIpd(bill: Partial<BillRecord> & { admission_id?: number | null; admissionId?: number | null }): boolean {
  return Number(bill.admission_id ?? bill.admissionId ?? 0) > 0 || Number(bill.admission_bill ?? 0) > 0;
}

type ReceptionAppointmentTokenMode = 'auto' | 'reserved' | 'manual';
type AppointmentBookingAction = 'pay' | 'due';

export function buildReceptionAppointmentTokenPayload(
  mode: ReceptionAppointmentTokenMode,
  requestedToken: number | '',
  manualToken: string | number | '',
): { requestedTokenNo?: number; forceTokenNo?: number } {
  if (mode === 'reserved' && requestedToken) {
    return { requestedTokenNo: Number(requestedToken) };
  }
  if (mode === 'manual' && manualToken) {
    return { forceTokenNo: Number(manualToken) };
  }
  return {};
}

function formatBDT(n: number) {
  return `৳${(n ?? 0).toLocaleString('en-IN')}`;
}

function normalizeMobileForCompare(value?: string | null) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (/^01[3-9]\d{8}$/.test(digits)) return digits;
  if (/^8801[3-9]\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^1[3-9]\d{8}$/.test(digits)) return `0${digits}`;
  return digits;
}

function formatDate(value?: string | null) {
  if (!value) return 'Date N/A';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(value?: string | null, options?: { assumeUtc?: boolean }) {
  if (!value) return undefined;
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    const [hours, minutes] = value.split(':');
    const hourNum = Number(hours);
    if (Number.isNaN(hourNum)) return value.slice(0, 5);
    const hour12 = hourNum % 12 || 12;
    const period = hourNum >= 12 ? 'PM' : 'AM';
    return `${String(hour12).padStart(2, '0')}:${minutes} ${period}`;
  }
  const naiveDateTimeMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (naiveDateTimeMatch) {
    const [, year, month, day, hours, minutes, seconds = '00'] = naiveDateTimeMatch;
    if (!options?.assumeUtc) {
      const hourNum = Number(hours);
      if (Number.isNaN(hourNum)) return undefined;
      const hour12 = hourNum % 12 || 12;
      const period = hourNum >= 12 ? 'PM' : 'AM';
      return `${String(hour12).padStart(2, '0')}:${minutes} ${period}`;
    }
    const utcDate = new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`);
    if (Number.isNaN(utcDate.getTime())) return undefined;
    const time = utcDate.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Dhaka',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    return time.replace(/am|pm/i, (match) => match.toUpperCase());
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function getReceptionBillDateKey(bill: { created_at?: string | null; bill_date?: string | null }) {
  const rawDate = bill.bill_date ?? bill.created_at;
  return rawDate ? String(rawDate).slice(0, 10) : '';
}

export function filterReceptionBillsByDate<T extends { created_at?: string | null; bill_date?: string | null }>(bills: T[], selectedDate: string) {
  if (!selectedDate) return bills;
  return bills.filter((bill) => getReceptionBillDateKey(bill) === selectedDate);
}

export function filterReceptionFlowRowsByQuery<
  T extends {
    patientName?: string | null;
    serial?: number | string | null;
    admissionNo?: string | null;
    wardBed?: string | null;
    mobile?: string | null;
    patientCode?: string | null;
    invoiceNo?: string | null;
    invoice_no?: string | null;
  },
>(rows: T[], query: string): T[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return rows;
  const normalized = q.replace(/o/g, '0');
  return rows.filter((row) => {
    const haystacks = [
      row.patientName,
      String(row.serial ?? ''),
      String(row.admissionNo ?? ''),
      String(row.wardBed ?? ''),
      row.mobile,
      row.patientCode,
      row.invoiceNo,
      row.invoice_no,
    ];
    return haystacks.some((value) => {
      if (!value) return false;
      const text = String(value).toLowerCase();
      return text.includes(q) || text.includes(normalized);
    });
  });
}

export function buildReceptionPendingBillDateParam(filter: 'all' | 'date' | 'past', selectedDate: string) {
  if (!selectedDate) return '';
  if (filter === 'date') return `&date=${encodeURIComponent(selectedDate)}`;
  if (filter === 'past') return `&beforeDate=${encodeURIComponent(selectedDate)}`;
  return '';
}

export function buildReceptionDueCollectionDateParam(scope: DueCollectionScope, selectedDate: string) {
  if (scope === 'today') return buildReceptionPendingBillDateParam('date', selectedDate);
  if (scope === 'overdue') return buildReceptionPendingBillDateParam('past', selectedDate);
  return '';
}

export function pendingBillSummaryToBillRecord(bill: PendingBillSummary): BillRecord {
  const settled = getBillSettledAmount(bill);
  const outstanding = getBillOutstandingAmount(bill);
  return {
    id: bill.bill_id,
    invoice_no: bill.invoice_no ?? undefined,
    patient_name: bill.patient_name,
    patient_code: bill.patient_code ?? undefined,
    patient_mobile: bill.patient_mobile ?? undefined,
    total: Number(bill.total_amount ?? bill.pending_amount ?? 0),
    total_amount: Number(bill.total_amount ?? bill.pending_amount ?? 0),
    paid: settled,
    paid_amount: settled,
    settled_amount: settled,
    due: outstanding,
    outstanding,
    pending_amount: outstanding,
    deposit_adjusted: getBillDepositAdjustedAmount(bill),
    status: bill.status ?? 'open',
    created_at: bill.created_at,
    bill_date: bill.bill_date ?? null,
    service_summary: bill.service_summary ?? null,
    item_count: bill.item_count ?? null,
    doctor_name: bill.doctor_name ?? null,
    visit_no: bill.visit_no ?? null,
    created_by_name: bill.created_by_name ?? null,
    test_bill: bill.test_bill ?? null,
    doctor_visit_bill: bill.doctor_visit_bill ?? null,
    admission_bill: bill.admission_bill ?? null,
    operation_bill: bill.operation_bill ?? null,
    medicine_bill: bill.medicine_bill ?? null,
  };
}

const COMPLETED_RECEPTION_FLOW_STATUSES = new Set([
  'concluded',
  'completed',
  'completed_bill',
  'discharged',
  'closed',
  'cancelled',
  'transferred_out',
]);

export function isCompletedReceptionFlowStatus(status?: string | null) {
  return COMPLETED_RECEPTION_FLOW_STATUSES.has(String(status ?? '').toLowerCase());
}

export function sortReceptionFlowRows<T extends {
  status?: string | null;
  source?: string;
  visit?: { created_at?: string | null } | null;
  appointment?: { created_at?: string | null } | null;
  createdAt?: string | null;
  serial?: number | string | null;
  time?: string | null;
}>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aDone = isCompletedReceptionFlowStatus(a.status);
    const bDone = isCompletedReceptionFlowStatus(b.status);
    if (aDone !== bDone) return aDone ? 1 : -1;

    const timeA = a.source === 'visit'
      ? (a.visit?.created_at ? new Date(String(a.visit.created_at).replace(' ', 'T')).getTime() : 0)
      : a.source === 'admission'
        ? (a.createdAt ? new Date(String(a.createdAt).replace(' ', 'T')).getTime() : 0)
        : (a.appointment?.created_at ? new Date(`${String(a.appointment.created_at).replace(' ', 'T')}Z`).getTime() : 0);
    const timeB = b.source === 'visit'
      ? (b.visit?.created_at ? new Date(String(b.visit.created_at).replace(' ', 'T')).getTime() : 0)
      : b.source === 'admission'
        ? (b.createdAt ? new Date(String(b.createdAt).replace(' ', 'T')).getTime() : 0)
        : (b.appointment?.created_at ? new Date(`${String(b.appointment.created_at).replace(' ', 'T')}Z`).getTime() : 0);
    if (timeA !== timeB) return timeB - timeA;

    const serialA = Number(a.serial ?? 999999);
    const serialB = Number(b.serial ?? 999999);
    if (serialA !== serialB) return serialA - serialB;
    return String(a.time ?? '').localeCompare(String(b.time ?? ''));
  });
}

export function getAppointmentPendingAmount(appointment?: AppointmentSummary | null, billingStatus?: string | null) {
  if (!appointment) return 0;
  const pendingStatuses = new Set(['pending', 'unpaid', 'partial_paid', 'partially_paid', 'partial']);
  const normalizedStatus = String(billingStatus ?? appointment.billing_status ?? '').toLowerCase();
  if (!pendingStatuses.has(normalizedStatus)) return 0;
  return Number(
    appointment.final_fee
    ?? appointment.total_amount
    ?? appointment.fee
    ?? appointment.consultation_fee
    ?? 0,
  );
}

export function getBillServiceLabel(bill?: Partial<BillRecord | PendingBillSummary> | null) {
  if (!bill) return 'Service bill';
  const summary = String((bill as { service_summary?: string | null }).service_summary ?? '').trim();
  if (summary) {
    const parts = summary.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 3) return `${parts.slice(0, 3).join(', ')} +${parts.length - 3} more`;
    return parts.join(', ');
  }

  const categoryLabels: Array<[keyof BillRecord, string]> = [
    ['test_bill', 'Lab / diagnostic test'],
    ['doctor_visit_bill', 'Doctor consultation'],
    ['operation_bill', 'Procedure / operation'],
    ['admission_bill', 'Admission / bed charge'],
    ['medicine_bill', 'Medicine'],
  ];
  const matched = categoryLabels.find(([key]) => Number((bill as BillRecord)[key] ?? 0) > 0);
  return matched?.[1] ?? 'Service bill';
}

export function getFlowTokenLabel(row: {
  serial?: number | string | null;
  visit?: unknown | null;
  pendingServices?: number | null;
  pendingAmount?: number | null;
}) {
  if (row.serial) return `#${row.serial}`;
  if (!row.visit) return '-';
  if (Number(row.pendingServices ?? 0) > 0 || Number(row.pendingAmount ?? 0) > 0) return 'No token yet';
  return 'Walk-in';
}

export function getReceptionFlowDoctorLabel(row: {
  doctorName?: string | null;
  referredByType?: string | null;
  referredByName?: string | null;
  referredByDoctorName?: string | null;
}) {
  const doctorName = row.doctorName?.trim();
  if (doctorName) return doctorName;

  const referredByType = String(row.referredByType ?? 'self').toLowerCase();
  if (referredByType === 'doctor') {
    return row.referredByDoctorName?.trim() || row.referredByName?.trim() || 'Doctor';
  }
  if (referredByType === 'hospital') return row.referredByName?.trim() || 'Hospital';
  if (referredByType === 'other') return row.referredByName?.trim() || 'Other';
  return 'Self';
}

export function getNonConsultationPendingAmount(visit: {
  pending_amount?: number | null;
  pending_doctor_visit_amount?: number | null;
}) {
  return Math.max(0, Number(visit.pending_amount ?? 0) - Number(visit.pending_doctor_visit_amount ?? 0));
}

export function buildPendingConsultationEntries(input: {
  appointments: Array<Partial<AppointmentSummary> & { id: number }>;
  visits: Array<Partial<Visit> & { id: number }>;
}) {
  const appointmentEntries = input.appointments.map((appointment) => ({
    key: `appointment-${appointment.id}`,
    source: 'appointment' as const,
    label: 'Consultation',
    patientName: appointment.patient_name ?? `Appointment #${appointment.id}`,
    doctorName: appointment.doctor_name ?? 'Doctor',
    tokenLabel: appointment.token_no ? `#${appointment.token_no}` : '-',
    amount: getAppointmentPendingAmount(appointment as AppointmentSummary, appointment.billing_status),
    appointment,
    visit: null,
  })).filter((entry) => entry.amount > 0);

  const visitEntries = input.visits.map((visit) => ({
    key: `visit-${visit.id}`,
    source: 'visit' as const,
    label: 'Consultation',
    patientName: visit.patient_name ?? `Visit #${visit.id}`,
    doctorName: visit.doctor_name ?? 'Doctor',
    tokenLabel: getFlowTokenLabel({
      serial: null,
      visit,
      pendingServices: visit.pending_doctor_visit_services,
      pendingAmount: visit.pending_doctor_visit_amount,
    }),
    amount: Number(visit.pending_doctor_visit_amount ?? 0),
    appointment: null,
    visit,
  })).filter((entry) => entry.amount > 0);

  return [...appointmentEntries, ...visitEntries];
}

function choosePreferredVisitRow(existing: Visit, candidate: Visit): Visit {
  const existingHasBill = Number(existing.bill_id ?? 0) > 0 || Number(existing.bill_paid ?? 0) > 0 || Number(existing.bill_total ?? 0) > 0;
  const candidateHasBill = Number(candidate.bill_id ?? 0) > 0 || Number(candidate.bill_paid ?? 0) > 0 || Number(candidate.bill_total ?? 0) > 0;
  if (existingHasBill !== candidateHasBill) return existingHasBill ? existing : candidate;
  const existingTime = existing.created_at ? new Date(String(existing.created_at).replace(' ', 'T')).getTime() : 0;
  const candidateTime = candidate.created_at ? new Date(String(candidate.created_at).replace(' ', 'T')).getTime() : 0;
  return candidateTime > existingTime ? candidate : existing;
}

type AdmissionFlowAdmission = {
  id: number;
  patient_id?: number | null;
  admission_no?: string | null;
  admission_date?: string | null;
  discharge_date?: string | null;
  patient_name?: string | null;
  patient_code?: string | null;
  patient_mobile?: string | null;
  ward_name?: string | null;
  bed_number?: string | null;
  bed_type?: string | null;
  doctor_name?: string | null;
  status?: string | null;
  final_bill_id?: number | null;
  final_invoice_no?: string | null;
  final_bill_status?: string | null;
  final_bill_total_amount?: number | null;
  final_bill_paid_amount?: number | null;
  final_bill_due_amount?: number | null;
};

const ACTIVE_ADMISSION_STATUSES = new Set(['admitted', 'critical', 'active', 'occupied', 'inpatient', 'ipd']);
const FINALIZED_ADMISSION_STATUSES = new Set(['discharged', 'closed', 'cancelled', 'transferred_out']);

export function shouldIncludeAdmissionInReceptionFlow(admission: Pick<AdmissionFlowAdmission, 'status' | 'discharge_date'>, selectedDate: string) {
  const status = String(admission.status || '').toLowerCase();
  if (ACTIVE_ADMISSION_STATUSES.has(status)) return true;
  return Boolean(admission.discharge_date && String(admission.discharge_date).startsWith(selectedDate));
}

export function dedupeAdmissionsForReceptionFlow(admissions: AdmissionFlowAdmission[] = []) {
  const byPatient = new Map<string, AdmissionFlowAdmission>();
  const scoreAdmission = (admission: AdmissionFlowAdmission) => {
    const dateValue = String(admission.discharge_date || admission.admission_date || '').replace(' ', 'T');
    const time = dateValue ? new Date(dateValue).getTime() : 0;
    return [Number.isFinite(time) ? time : 0, Number(admission.id || 0)] as const;
  };

  for (const admission of admissions) {
    const patientKey = Number(admission.patient_id || 0) > 0 ? `patient-${admission.patient_id}` : `admission-${admission.id}`;
    const existing = byPatient.get(patientKey);
    if (!existing) {
      byPatient.set(patientKey, admission);
      continue;
    }
    const [existingTime, existingId] = scoreAdmission(existing);
    const [nextTime, nextId] = scoreAdmission(admission);
    if (nextTime > existingTime || (nextTime === existingTime && nextId > existingId)) {
      byPatient.set(patientKey, admission);
    }
  }

  return Array.from(byPatient.values());
}

export function shouldShowAdmissionRunningBillPrint(row: { status?: string | null; finalBillId?: number | null; billId?: number | null; final_bill_id?: number | null }) {
  const status = String(row.status || '').toLowerCase();
  const hasFinalBill = Number(row.finalBillId ?? row.billId ?? row.final_bill_id ?? 0) > 0;
  return !hasFinalBill && !FINALIZED_ADMISSION_STATUSES.has(status);
}

export function shouldShowAdmissionInvoicePrint(row: { finalBillId?: number | null; billId?: number | null; final_bill_id?: number | null }) {
  return Number(row.finalBillId ?? row.billId ?? row.final_bill_id ?? 0) > 0;
}

export function buildReceptionFlowDisplayRows(input: {
  showAdmittedPatients: boolean;
  admissionFlowRows: any[];
  visits: Visit[];
  todayAppointments: AppointmentSummary[];
  hideCompletedFlow: boolean;
}) {
  if (input.showAdmittedPatients) return sortReceptionFlowRows(input.admissionFlowRows);
  return buildReceptionFlowRows({
    visits: input.visits,
    todayAppointments: input.todayAppointments,
    hideCompletedFlow: input.hideCompletedFlow,
  });
}

export function buildAdmittedPatientFlowRows(admissions: AdmissionFlowAdmission[] = []) {
  return admissions.map((admission) => {
    const patientName = admission.patient_name || `Admission ${admission.admission_no || admission.id}`;
    const wardBed = [
      admission.ward_name,
      admission.bed_number ? `Bed ${admission.bed_number}` : '',
      admission.bed_type ? `(${admission.bed_type})` : '',
    ].filter(Boolean).join(' ');
    const patientId = Number(admission.patient_id || 0) || 0;
    const finalBillTotal = Number(admission.final_bill_total_amount || 0);
    const finalBillPaid = Number(admission.final_bill_paid_amount || 0);
    const finalBillDue = admission.final_bill_due_amount == null
      ? Math.max(0, finalBillTotal - finalBillPaid)
      : Math.max(0, Number(admission.final_bill_due_amount || 0));
    return {
      key: `admission-${admission.id}`,
      source: 'admission' as const,
      status: String(admission.status || 'admitted'),
      patientId: patientId || undefined,
      patientName,
      patientCode: admission.patient_code || undefined,
      mobile: admission.patient_mobile || undefined,
      doctorName: admission.doctor_name || undefined,
      serial: admission.admission_no || admission.id,
      time: wardBed || 'IPD',
      type: 'ipd-admission',
      createdAt: admission.admission_date || admission.discharge_date || undefined,
      admission,
      admissionId: admission.id,
      admissionNo: admission.admission_no || undefined,
      wardBed: wardBed || undefined,
      finalBillId: admission.final_bill_id || undefined,
      finalInvoiceNo: admission.final_invoice_no || undefined,
      finalBillStatus: admission.final_bill_status || undefined,
      billId: admission.final_bill_id || undefined,
      invoiceNo: admission.final_invoice_no || undefined,
      billStatus: admission.final_bill_status || undefined,
      billingStatus: admission.final_bill_status || undefined,
      billTotal: finalBillTotal,
      billPaid: finalBillPaid,
      billDue: finalBillDue,
      pendingServices: 0,
      pendingAmount: 0,
      pendingDoctorVisitServices: 0,
      pendingDoctorVisitAmount: 0,
      patient: {
        id: patientId,
        name: patientName,
        mobile: admission.patient_mobile || '',
        patient_code: admission.patient_code || undefined,
      } as Patient,
      visit: null,
      appointment: null,
    };
  });
}

export function isAdmissionFlowRow(row: { source?: string; admissionId?: number | null; admission?: unknown | null }) {
  return row.source === 'admission' || Number(row.admissionId ?? 0) > 0 || Boolean(row.admission);
}

export function getAdmissionFlowPatientId(row: {
  patient?: { id?: number | null } | null;
  patientId?: number | null;
  admission?: { patient_id?: number | null } | null;
}) {
  return Number(row.patient?.id ?? row.patientId ?? row.admission?.patient_id ?? 0) || 0;
}

export function getAdmissionFlowAdmissionId(row: {
  admissionId?: number | null;
  admission?: { id?: number | null } | null;
}) {
  return Number(row.admissionId ?? row.admission?.id ?? 0) || 0;
}

export function buildAdmissionFinalBillRecord(row: {
  billId?: number | null;
  finalBillId?: number | null;
  invoiceNo?: string | null;
  finalInvoiceNo?: string | null;
  patientName?: string | null;
  billTotal?: number | null;
  billPaid?: number | null;
  billDue?: number | null;
  billStatus?: string | null;
  finalBillStatus?: string | null;
}): BillRecord | null {
  const billId = Number(row.billId ?? row.finalBillId ?? 0) || 0;
  if (!billId) return null;
  const total = Number(row.billTotal ?? 0);
  const paid = Number(row.billPaid ?? 0);
  const due = Math.max(0, Number(row.billDue ?? total - paid));
  return {
    id: billId,
    invoice_no: row.invoiceNo ?? row.finalInvoiceNo ?? undefined,
    patient_name: row.patientName ?? 'IPD patient',
    total,
    paid,
    paid_amount: paid,
    total_amount: total,
    due,
    status: row.billStatus ?? row.finalBillStatus ?? (due > 0 ? 'partial' : 'paid'),
    created_at: '',
  };
}

export function buildReceptionFlowRows(input: {
  visits: Visit[];
  todayAppointments: AppointmentSummary[];
  hideCompletedFlow: boolean;
}) {
  const visitsByAppointment = new Map<number, Visit>();
  const standaloneVisits: Visit[] = [];
  for (const visit of input.visits) {
    const appointmentId = Number(visit.appointment_id ?? 0);
    if (appointmentId > 0) {
      const existing = visitsByAppointment.get(appointmentId);
      visitsByAppointment.set(appointmentId, existing ? choosePreferredVisitRow(existing, visit) : visit);
    } else {
      standaloneVisits.push(visit);
    }
  }
  const normalizedVisits = [...visitsByAppointment.values(), ...standaloneVisits];

  const visitRows = normalizedVisits.map((visit) => {
    const matchingAppointment = input.todayAppointments.find((appointment) =>
      visit.appointment_id && Number(appointment.id) === Number(visit.appointment_id)
    ) ?? input.todayAppointments.find((appointment) =>
      !visit.appointment_id
      && Number(appointment.patient_id) === Number(visit.patient_id)
      && (!appointment.doctor_id || Number(appointment.doctor_id) === Number(visit.doctor_id))
    );
    const visitBillId = visit.bill_id ? Number(visit.bill_id) : null;
    const appointmentBillId = matchingAppointment?.bill_id ? Number(matchingAppointment.bill_id) : null;
    const billId = visitBillId ?? appointmentBillId;
    const useAppointmentBill = !visitBillId && Boolean(appointmentBillId);
    const billTotal = Number(useAppointmentBill ? matchingAppointment?.bill_total ?? 0 : visit.bill_total ?? matchingAppointment?.bill_total ?? 0);
    const billPaid = Number(useAppointmentBill ? matchingAppointment?.bill_paid ?? 0 : visit.bill_paid ?? matchingAppointment?.bill_paid ?? 0);
    const billDue = Number(useAppointmentBill ? matchingAppointment?.bill_due ?? 0 : visit.bill_due ?? matchingAppointment?.bill_due ?? 0);
    return {
      key: `visit-${visit.id}`,
      source: 'visit' as const,
      patientName: visit.patient_name,
      patientCode: visit.patient_code,
      mobile: visit.mobile,
      age: visit.age ?? matchingAppointment?.patient_age ?? null,
      dateOfBirth: visit.date_of_birth ?? matchingAppointment?.patient_date_of_birth ?? null,
      doctorId: visit.doctor_id ? Number(visit.doctor_id) : matchingAppointment?.doctor_id ? Number(matchingAppointment.doctor_id) : null,
      doctorName: visit.doctor_name,
      referredByType: visit.referred_by_type ?? null,
      referredByName: visit.referred_by_name ?? null,
      referredByDoctorName: visit.referred_by_doctor_name ?? null,
      referringDoctorId: visit.referring_doctor_id ? Number(visit.referring_doctor_id) : null,
      serial: matchingAppointment?.token_no,
      time: formatTime(matchingAppointment?.appt_time) ?? formatTime(visit.created_at),
      status: visit.status ?? matchingAppointment?.status ?? 'checked_in',
      billingStatus: matchingAppointment?.billing_status,
      billId,
      invoiceNo: visit.invoice_no ?? matchingAppointment?.invoice_no ?? null,
      billTotal,
      billPaid,
      billDue,
      billStatus: useAppointmentBill ? matchingAppointment?.bill_status ?? (billDue <= 0 && billPaid > 0 ? 'paid' : null) : visit.bill_status ?? matchingAppointment?.bill_status ?? (billId && billDue <= 0 && billPaid > 0 ? 'paid' : null),
      billCount: Number(useAppointmentBill ? matchingAppointment?.bill_count ?? 0 : visit.bill_count ?? matchingAppointment?.bill_count ?? 0),
      dueBillCount: Number(useAppointmentBill ? matchingAppointment?.due_bill_count ?? 0 : visit.due_bill_count ?? matchingAppointment?.due_bill_count ?? 0),
      type: visit.visit_type ?? matchingAppointment?.appointment_type ?? 'visit',
      pendingServices: Number(visit.pending_services ?? 0),
      pendingAmount: Number(visit.pending_amount ?? 0),
      pendingDoctorVisitServices: Number(visit.pending_doctor_visit_services ?? 0),
      pendingDoctorVisitAmount: Number(visit.pending_doctor_visit_amount ?? 0),
      patient: {
        id: visit.patient_id,
        name: visit.patient_name,
        mobile: visit.mobile ?? '',
        patient_code: visit.patient_code,
        date_of_birth: visit.date_of_birth ?? matchingAppointment?.patient_date_of_birth ?? undefined,
      } as Patient,
      visit,
      appointment: matchingAppointment,
    };
  });

  const seenActiveReportShows = new Set<string>();
  const appointmentRows = input.todayAppointments
    .filter((appointment) => !normalizedVisits.some((visit) =>
      visit.appointment_id && Number(visit.appointment_id) === Number(appointment.id)
    ))
    .filter((appointment) => {
      const status = String(appointment.status ?? '').toLowerCase();
      if (appointment.appointment_type !== 'report_show' || ['cancelled', 'no_show', 'completed', 'concluded'].includes(status)) {
        return true;
      }
      const key = `${appointment.patient_id ?? 'unknown'}-${appointment.doctor_id ?? 'unknown'}`;
      if (seenActiveReportShows.has(key)) return false;
      seenActiveReportShows.add(key);
      return true;
    })
    .map((appointment) => ({
      key: `appointment-${appointment.id}`,
      source: 'appointment' as const,
      patientName: appointment.patient_name ?? `Appointment #${appointment.id}`,
      patientCode: appointment.patient_code ?? undefined,
      mobile: appointment.patient_mobile ?? undefined,
      age: appointment.patient_age ?? null,
      dateOfBirth: appointment.patient_date_of_birth ?? null,
      doctorId: appointment.doctor_id ? Number(appointment.doctor_id) : null,
      doctorName: appointment.doctor_name ?? undefined,
      referredByType: appointment.doctor_name ? 'doctor' : 'self',
      referredByName: null,
      referredByDoctorName: appointment.doctor_name ?? null,
      referringDoctorId: appointment.doctor_id ? Number(appointment.doctor_id) : null,
      serial: appointment.token_no,
      time: formatTime(appointment.appt_time) ?? formatTime(appointment.created_at, { assumeUtc: true }),
      status: appointment.status ?? 'booked',
      billingStatus: appointment.billing_status,
      billId: appointment.bill_id ? Number(appointment.bill_id) : null,
      invoiceNo: appointment.invoice_no ?? null,
      billTotal: Number(appointment.bill_total ?? 0),
      billPaid: Number(appointment.bill_paid ?? 0),
      billDue: Number(appointment.bill_due ?? 0),
      billCount: Number(appointment.bill_count ?? 0),
      dueBillCount: Number(appointment.due_bill_count ?? 0),
      billStatus: appointment.bill_status ?? null,
      type: appointment.appointment_type ?? appointment.visit_type ?? 'appointment',
      pendingServices: 0,
      pendingAmount: getAppointmentPendingAmount(appointment, appointment.billing_status),
      pendingDoctorVisitServices: 0,
      pendingDoctorVisitAmount: 0,
      patient: {
        id: Number(appointment.patient_id ?? 0),
        name: appointment.patient_name ?? `Appointment #${appointment.id}`,
        mobile: appointment.patient_mobile ?? '',
        patient_code: appointment.patient_code ?? undefined,
        date_of_birth: appointment.patient_date_of_birth ?? undefined,
      } as Patient,
      visit: null,
      appointment,
    }));

  const rows = sortReceptionFlowRows([...visitRows, ...appointmentRows]);
  return input.hideCompletedFlow ? rows.filter((row) => !isCompletedReceptionFlowStatus(row.status)) : rows;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateAgeLabel(dateOfBirth?: string | null, referenceDate: Date = new Date()) {
  if (!dateOfBirth) return null;
  const ageLabel = formatAgeFromDateOfBirth(dateOfBirth, 'en-GB', referenceDate);
  return ageLabel === '—' ? null : ageLabel.toLowerCase();
}

function parseReceptionAgePart(value: string, label: string, max?: number): { value: number; error?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { value: 0 };
  if (!/^\d+$/.test(trimmed)) return { value: 0, error: `${label} must be a whole non-negative number` };

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) return { value: 0, error: `${label} is too large` };
  if (max !== undefined && parsed > max) return { value: 0, error: `${label} must be ${max} or less` };
  return { value: parsed };
}

export function buildReceptionNewPatientAgeDraft(input: {
  age: string;
  ageMonths: string;
  ageDays: string;
  dateOfBirth: string;
}, referenceDate: Date = new Date()): (
  | { ok: true; age: number; dateOfBirth: string; ageParts: { years: number; months: number; days: number } }
  | { ok: false; error: string }
) {
  const selectedDateOfBirth = input.dateOfBirth.trim();
  if (selectedDateOfBirth) {
    const ageParts = calculateAgePartsFromDateOfBirth(selectedDateOfBirth, referenceDate);
    if (!ageParts) return { ok: false, error: 'Date of birth must be today or earlier' };
    return { ok: true, age: ageParts.years, dateOfBirth: selectedDateOfBirth, ageParts };
  }

  const hasManualAge = [input.age, input.ageMonths, input.ageDays].some((value) => value.trim().length > 0);
  if (!hasManualAge) return { ok: false, error: 'Age is required' };

  const years = parseReceptionAgePart(input.age, 'Years', 130);
  const months = parseReceptionAgePart(input.ageMonths, 'Months', 11);
  const days = parseReceptionAgePart(input.ageDays, 'Days', 31);
  const error = years.error ?? months.error ?? days.error;
  if (error) return { ok: false, error };

  const ageParts = { years: years.value, months: months.value, days: days.value };
  return {
    ok: true,
    age: ageParts.years,
    dateOfBirth: estimateDateOfBirthFromAgeParts(ageParts, referenceDate) ?? formatLocalDate(referenceDate),
    ageParts,
  };
}

export function buildPatientAgeLabel(age?: number | string | null, dateOfBirth?: string | null, referenceDate: Date = new Date()) {
  return formatPatientAgeLabel(age, dateOfBirth, referenceDate);
}

export function buildPatientIdentityParts(input: {
  age?: number | string | null;
  date_of_birth?: string | null;
  mobile?: string | null;
}, referenceDate: Date = new Date()) {
  const parts: string[] = [];
  const ageLabel = buildPatientAgeLabel(input.age, input.date_of_birth, referenceDate);
  const mobile = (input.mobile ?? '').toString().trim();

  if (ageLabel) parts.push(ageLabel);
  if (mobile) parts.push(mobile);

  return [...new Set(parts)];
}

export function buildReceptionPatientIdentityText(
  patient: {
    id?: number | null;
    patient_code?: string | null;
    age?: number | string | null;
    date_of_birth?: string | null;
    mobile?: string | null;
  },
  fallbackCode?: string,
  referenceDate: Date = new Date(),
): string {
  return formatPatientIdentityText(patient, fallbackCode, referenceDate);
}

function renderPatientIdentityBadges(parts: string[], className: string): React.ReactNode {
  if (parts.length === 0) return null;
  return (
    <span className={className}>
      {parts.map((part) => (
        <span key={part} className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          {part}
        </span>
      ))}
    </span>
  );
}

export function buildPatientInlineLabel(visit: Visit): React.ReactNode {
  // Keep age and mobile on the same title line as the patient name, but render
  // them as readable identity chips instead of a low-contrast muted suffix.
  return renderPatientIdentityBadges(
    buildPatientIdentityParts({
      age: visit.age,
      date_of_birth: visit.date_of_birth,
      mobile: visit.mobile,
    }),
    'ml-2 inline-flex max-w-full flex-nowrap items-center gap-1 align-middle text-sm font-semibold text-[var(--color-text-primary)]',
  );
}

function buildPatientFlowIdentityLabel(row: {
  age?: number | string | null;
  dateOfBirth?: string | null;
  mobile?: string | null;
}): React.ReactNode {
  return renderPatientIdentityBadges(
    buildPatientIdentityParts({
      age: row.age,
      date_of_birth: row.dateOfBirth,
      mobile: row.mobile,
    }),
    'mt-1 flex max-w-[240px] flex-wrap items-center gap-1 text-xs font-semibold',
  );
}

function serviceIcon(type: string) {
  switch (type) {
    case 'doctor_visit': return <Stethoscope className="w-4 h-4" />;
    case 'test': return <FlaskConical className="w-4 h-4" />;
    case 'procedure': return <Syringe className="w-4 h-4" />;
    case 'admission': return <Bed className="w-4 h-4" />;
    case 'medicine': return <Package className="w-4 h-4" />;
    default: return <Receipt className="w-4 h-4" />;
  }
}

function serviceLabel(type: string) {
  switch (type) {
    case 'doctor_visit': return 'Doctor Visit';
    case 'test': return 'Lab Test';
    case 'procedure': return 'Procedure';
    case 'admission': return 'Admission';
    case 'medicine': return 'Medicine';
    case 'service': return 'Service';
    default: return type;
  }
}

export function summarizeReceptionBeds(beds: ReceptionBed[]) {
  const counts = {
    total: beds.length,
    available: 0,
    occupied: 0,
    cleaning: 0,
    maintenance: 0,
    reserved: 0,
  };
  const wardAvailabilityMap = new Map<string, number>();

  for (const bed of beds) {
    const status = String(bed.status ?? '').toLowerCase();
    if (status === 'available' || status === 'occupied' || status === 'cleaning' || status === 'maintenance' || status === 'reserved') {
      counts[status] += 1;
    }
    if (status === 'available') {
      const ward = String(bed.ward_name || 'Ward');
      wardAvailabilityMap.set(ward, (wardAvailabilityMap.get(ward) ?? 0) + 1);
    }
  }

  return {
    ...counts,
    wardAvailability: Array.from(wardAvailabilityMap.entries()).sort((a, b) => a[0].localeCompare(b[0])),
  };
}

function getReceptionBedId(bed: ReceptionBed): number | null {
  const id = Number(bed.id ?? bed.bed_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type BedStatusStyle = {
  pill: string;
  accent: string;
  soft: string;
  dot: string;
  icon: string;
  label: string;
};

const BED_STATUS_STYLES: Record<string, BedStatusStyle> = {
  available: {
    pill: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    accent: 'border-l-emerald-500',
    soft: 'bg-emerald-50/40',
    dot: 'bg-emerald-500',
    icon: 'text-emerald-600',
    label: 'Available',
  },
  occupied: {
    pill: 'bg-rose-50 text-rose-700 border-rose-300',
    accent: 'border-l-rose-500',
    soft: 'bg-rose-50/40',
    dot: 'bg-rose-500',
    icon: 'text-rose-600',
    label: 'Occupied',
  },
  cleaning: {
    pill: 'bg-cyan-50 text-cyan-700 border-cyan-300',
    accent: 'border-l-cyan-500',
    soft: 'bg-cyan-50/40',
    dot: 'bg-cyan-500',
    icon: 'text-cyan-600',
    label: 'Cleaning',
  },
  maintenance: {
    pill: 'bg-amber-50 text-amber-700 border-amber-300',
    accent: 'border-l-amber-500',
    soft: 'bg-amber-50/40',
    dot: 'bg-amber-500',
    icon: 'text-amber-600',
    label: 'Maintenance',
  },
  reserved: {
    pill: 'bg-violet-50 text-violet-700 border-violet-300',
    accent: 'border-l-violet-500',
    soft: 'bg-violet-50/40',
    dot: 'bg-violet-500',
    icon: 'text-violet-600',
    label: 'Reserved',
  },
};

const BED_STATUS_DEFAULT: BedStatusStyle = {
  pill: 'bg-slate-50 text-slate-700 border-slate-300',
  accent: 'border-l-slate-400',
  soft: 'bg-slate-50/40',
  dot: 'bg-slate-400',
  icon: 'text-slate-500',
  label: 'Unknown',
};

function getBedStatusStyle(status?: string | null): BedStatusStyle {
  return BED_STATUS_STYLES[String(status ?? '').toLowerCase()] ?? BED_STATUS_DEFAULT;
}

function bedStatusPillClass(status?: string | null): string {
  return getBedStatusStyle(status).pill;
}

function formatBedStatusLabel(status?: string | null): string {
  const normalized = String(status ?? '').toLowerCase();
  if (!normalized) return 'Unknown';
  return normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function BedStatusIcon({ status, className }: { status?: string | null; className?: string }) {
  const normalized = String(status ?? '').toLowerCase();
  const style = getBedStatusStyle(normalized);
  const iconClass = className ?? `h-3.5 w-3.5 ${style.icon}`;
  switch (normalized) {
    case 'available': return <CheckCircle2 className={iconClass} aria-hidden="true" />;
    case 'occupied': return <UserRound className={iconClass} aria-hidden="true" />;
    case 'cleaning': return <Sparkles className={iconClass} aria-hidden="true" />;
    case 'maintenance': return <Wrench className={iconClass} aria-hidden="true" />;
    case 'reserved': return <Bookmark className={iconClass} aria-hidden="true" />;
    default: return <Bed className={iconClass} aria-hidden="true" />;
  }
}

const BED_FILTER_KEYS = ['all', 'available', 'cleaning', 'reserved', 'maintenance', 'occupied'] as const;
type BedFilterKey = typeof BED_FILTER_KEYS[number];

const BED_FILTER_LABELS: Record<BedFilterKey, string> = {
  all: 'Total',
  available: 'Available',
  cleaning: 'Cleaning',
  reserved: 'Reserved',
  maintenance: 'Repair',
  occupied: 'Occupied',
};

function getBedFilterValue(key: BedFilterKey, summary: ReturnType<typeof summarizeReceptionBeds>): number {
  switch (key) {
    case 'all': return summary.total;
    case 'available': return summary.available;
    case 'cleaning': return summary.cleaning;
    case 'reserved': return summary.reserved;
    case 'maintenance': return summary.maintenance;
    case 'occupied': return summary.occupied;
  }
}

/* ─── Component ─── */
export default function ReceptionDashboard({ role = 'reception' }: { role?: string }) {
  const navigate = useNavigate();
  const { slug = '' } = useParams<{ slug: string }>();
  const { t } = useTranslation(['reception', 'billing', 'common', 'patients', 'sidebar']);
  const basePath = getRoleBasePath(slug, role);
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const receptionDashboardSnapshotQueryKey = useMemo(() => ['reception', 'dashboard-snapshot', date], [date]);
  const invalidateReceptionDashboardSnapshot = () => {
    queryClient.invalidateQueries({ queryKey: receptionDashboardSnapshotQueryKey });
  };

  /* Pagination */
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  /* Modals */
  const [activeModal, setActiveModal] = useState<'none' | 'newPatient' | 'appointment' | 'appointmentPayment' | 'newVisit' | 'collectPayment' | 'quickAdmitResult' | 'quickServiceBill' | 'addService' | 'addLab' | 'addProcedure' | 'generateBill' | 'dailyReport' | 'visitorsList' | 'ipdAdmission' | 'reportDelivery' | 'waitingQueue' | 'dailyCollection' | 'doctorFees' | 'testFees' | 'cashSummary' | 'provisionalBilling' | 'pendingLabOrder'>('none');
  const [pendingBillFilter, setPendingBillFilter] = useState<'all' | 'date' | 'past'>(DEFAULT_DUE_COLLECTION_SCOPE);
  const [pendingDueDate, setPendingDueDate] = useState(date);
  const [pendingDuePage, setPendingDuePage] = useState(1);
  const [dueCollectionDate, setDueCollectionDate] = useState(date);
  const [hideCompletedFlow, setHideCompletedFlow] = useState(false);
  const [showAdmittedPatients, setShowAdmittedPatients] = useState(false);
  const [flowSearch, setFlowSearch] = useState('');
  const [drawerPatientId, setDrawerPatientId] = useState<number | null>(null);

  useEffect(() => {
    setPendingDueDate(date);
    setDueCollectionDate(date);
  }, [date]);
  useEffect(() => setPendingDuePage(1), [pendingBillFilter, pendingDueDate]);
  const [showReservationPanel, setShowReservationPanel] = useState(false);
  const [showBedsDrawer, setShowBedsDrawer] = useState(false);
  const [bedStatusFilter, setBedStatusFilter] = useState<'all' | 'available' | 'cleaning' | 'reserved' | 'maintenance' | 'occupied'>('all');
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [pendingAddServiceForAppointment, setPendingAddServiceForAppointment] = useState<number | null>(null);
  const [provisionalBillingPrefill, setProvisionalBillingPrefill] = useState<{ patientId: number; admissionId: number } | null>(null);
  const [batchPaymentBills, setBatchPaymentBills] = useState<BillRecord[]>([]);
  const [batchPaymentIdempotencyKey, setBatchPaymentIdempotencyKey] = useState(() => 'reception-batch-due-' + crypto.randomUUID());
  const [isBatchPaymentCollecting, setIsBatchPaymentCollecting] = useState(false);
  const [payBill, setPayBill] = useState<BillRecord | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payReference, setPayReference] = useState('');
  const [dueCollectionScope, setDueCollectionScope] = useState<DueCollectionScope>('today');
  const [dueCollectionSearch, setDueCollectionSearch] = useState('');
  const [dueVisitTypeFilter, setDueVisitTypeFilter] = useState<DueVisitTypeFilter>('all');
  const [dueAgeBucket, setDueAgeBucket] = useState<DueAgeBucket>('all');
  const [selectedPendingLabOrder, setSelectedPendingLabOrder] = useState<PendingPrescriptionLabOrder | null>(null);
  const [selectedPendingLabItemIds, setSelectedPendingLabItemIds] = useState<number[]>([]);
  const [pendingLabPaymentMethod, setPendingLabPaymentMethod] = useState('cash');
  const [pendingLabPaymentReference, setPendingLabPaymentReference] = useState('');
  const [createdEmergencyPatient, setCreatedEmergencyPatient] = useState<Patient | null>(null);
  const [newPatientForm, setNewPatientForm] = useState<NewPatientFormState>(EMPTY_NEW_PATIENT_FORM);
  const newPatientSubmitLockRef = useRef(false);
  const newPatientCreateIdempotencyRef = useRef<string | null>(null);
  const newPatientPayloadSignatureRef = useRef<string | null>(null);
  const [createAsFamilyMember, setCreateAsFamilyMember] = useState(false);
  const [newPatientReturnModal, setNewPatientReturnModal] = useState<typeof activeModal>('appointment');
  const [appointmentPatientSearch, setAppointmentPatientSearch] = useState('');
  const [appointmentPatient, setAppointmentPatient] = useState<Patient | null>(null);

  useEffect(() => {
    if (batchPaymentBills.length > 0) {
      const totalDue = batchPaymentBills.reduce((sum, bill) => sum + getBillOutstandingAmount(bill), 0);
      setPayAmount(String(totalDue));
      return;
    }
    if (!payBill) return;
    const due = getBillOutstandingAmount(payBill);
    setPayAmount(String(due));
  }, [payBill, batchPaymentBills]);
  const [appointmentDoctorId, setAppointmentDoctorId] = useState<number | ''>('');
  const [appointmentDate, setAppointmentDate] = useState(date);
  const [appointmentTime, setAppointmentTime] = useState('');
  const [appointmentSource, setAppointmentSource] = useState<'walk_in' | 'phone'>('walk_in');
  const [appointmentType, setAppointmentType] = useState<AppointmentType>('new_patient');
  const [appointmentDiscount, setAppointmentDiscount] = useState('');
  const [appointmentDiscountReason, setAppointmentDiscountReason] = useState('');
  const [appointmentDiscountByName, setAppointmentDiscountByName] = useState('');
  const [appointmentComplaint, setAppointmentComplaint] = useState('');
  const [appointmentTokenMode, setAppointmentTokenMode] = useState<ReceptionAppointmentTokenMode>('auto');
  const [appointmentRequestedToken, setAppointmentRequestedToken] = useState<number | ''>('');
  const [appointmentManualToken, setAppointmentManualToken] = useState('');
  const [quickBillExtRefDoctorId, setQuickBillExtRefDoctorId] = useState<number | ''>('');
  const [quickBillExtRefDoctorSearch, setQuickBillExtRefDoctorSearch] = useState('');
  const [showQuickBillNewExtRefForm, setShowQuickBillNewExtRefForm] = useState(false);
  const [newExtRefDoctorName, setNewExtRefDoctorName] = useState('');
  const [newExtRefDoctorPhone, setNewExtRefDoctorPhone] = useState('');
  const [newExtRefDoctorChamber, setNewExtRefDoctorChamber] = useState('');
  const [appointmentPreview, setAppointmentPreview] = useState<AppointmentFeePreviewResponse['charge'] | null>(null);
  const [appointmentPreviewLoading, setAppointmentPreviewLoading] = useState(false);
  const [bookedAppointment, setBookedAppointment] = useState<{ id: number; patientId?: number; tokenNo?: number; apptNo?: string; consultationFee?: number; billingStatus?: string; discountAmount?: number; discountByName?: string | null } | null>(null);
  const [appointmentPaymentMethod, setAppointmentPaymentMethod] = useState('cash');
  const [appointmentPaymentReference, setAppointmentPaymentReference] = useState('');
  const [appointmentPaymentSchemeCodeInput, setAppointmentPaymentSchemeCodeInput] = useState('');
  const [appointmentPaymentMemberCodeInput, setAppointmentPaymentMemberCodeInput] = useState('');
  const [appointmentPaymentSchemePreview, setAppointmentPaymentSchemePreview] = useState<SchemePreviewResponse | null>(null);
  const appointmentBookingActionRef = useRef<AppointmentBookingAction>('due');
  const [quickBillPatientSearch, setQuickBillPatientSearch] = useState('');
  const [quickBillPatient, setQuickBillPatient] = useState<Patient | null>(null);
  const [quickBillSearch, setQuickBillSearch] = useState('');
  const [quickBillSearchDebounced, setQuickBillSearchDebounced] = useState('');
  const [quickBillDept, setQuickBillDept] = useState<number | ''>('');
  const [quickBillLines, setQuickBillLines] = useState<QuickBillLine[]>([]);
  const [quickBillDoctorId, setQuickBillDoctorId] = useState<number | ''>('');
  const [quickBillPerformerDoctorId, setQuickBillPerformerDoctorId] = useState<number | ''>('');
  const [quickBillPerformerDoctorSearch, setQuickBillPerformerDoctorSearch] = useState('');
  const [quickBillDoctorTouched, setQuickBillDoctorTouched] = useState(false);
  const [quickBillReferrerType, setQuickBillReferrerType] = useState<QuickBillReferrerType>('self');
  const [quickBillReferrerHospital, setQuickBillReferrerHospital] = useState<HospitalOption | null>(null);
  const [quickBillOtherReferrerName, setQuickBillOtherReferrerName] = useState('');
  const [quickBillPaymentMethod, setQuickBillPaymentMethod] = useState('cash');
  const [quickBillPaymentReference, setQuickBillPaymentReference] = useState('');
  const [quickBillIdempotencyKey, setQuickBillIdempotencyKey] = useState(() => 'dashboard-service-bill-' + crypto.randomUUID());
  const [quickBillPaidAmount, setQuickBillPaidAmount] = useState('');
  const [quickBillDepositDeducted, setQuickBillDepositDeducted] = useState('');
  const [quickBillDiscountAmount, setQuickBillDiscountAmount] = useState('');
  const [quickBillDiscountByName, setQuickBillDiscountByName] = useState('');
  const [quickBillAdvancedDiscount, setQuickBillAdvancedDiscount] = useState(false);
  const [quickBillDiscountSources, setQuickBillDiscountSources] = useState<DiscountAllocationRow[]>([]);
  const [quickBillDoctorWaiverAmount, setQuickBillDoctorWaiverAmount] = useState(0);
  const [quickBillDoctorWaiverLoading, setQuickBillDoctorWaiverLoading] = useState(false);
  const [quickBillSchemeCodeInput, setQuickBillSchemeCodeInput] = useState('');
  const [quickBillMemberCodeInput, setQuickBillMemberCodeInput] = useState('');
  const [quickBillSchemePreview, setQuickBillSchemePreview] = useState<SchemePreviewResponse | null>(null);
  const [reportInvoiceInput, setReportInvoiceInput] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setQuickBillSearchDebounced(quickBillSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [quickBillSearch]);
  const [reportInvoiceLookup, setReportInvoiceLookup] = useState('');
  const [admissionPatientSearch, setAdmissionPatientSearch] = useState('');
  const [admissionPatient, setAdmissionPatient] = useState<Patient | null>(null);
  const [admissionBedId, setAdmissionBedId] = useState<number | ''>('');
  const [admissionDoctorId, setAdmissionDoctorId] = useState<number | ''>('');
  const [admissionFee, setAdmissionFee] = useState('');
  const [admissionDeposit, setAdmissionDeposit] = useState('');
  const [admissionPaymentMethod, setAdmissionPaymentMethod] = useState('cash');
  const [patientDepositBalance, setPatientDepositBalance] = useState<number | null>(null);
  const [admissionReason, setAdmissionReason] = useState('');
  const [admissionPackageId, setAdmissionPackageId] = useState<number | ''>('');
  const [admissionBillingMode, setAdmissionBillingMode] = useState('regular');
  const admissionCreateIdempotencyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!admissionPatient) { setPatientDepositBalance(null); return; }
    let cancelled = false;
    api.get<{ balance?: number }>(`/api/deposits?patient_id=${admissionPatient.id}&balance_only=1`)
      .then((res) => { if (!cancelled) setPatientDepositBalance(res.balance ?? null); })
      .catch(() => { if (!cancelled) setPatientDepositBalance(null); });
    return () => { cancelled = true; };
  }, [admissionPatient]);

  /* ── Global patient search (cross-hospital) ── */
  const { data: globalPatientsData } = useApiQuery<{
    results: GlobalPatientSearchResult[]
  }>(
    ['reception', 'global-patient-search', appointmentPatientSearch],
    `/api/patients/global-search?q=${encodeURIComponent(appointmentPatientSearch)}`,
    { enabled: /^\d{11}$/.test(appointmentPatientSearch.trim()), staleTime: RECEPTION_SEARCH_STALE_MS },
  );
  const { data: appointmentPatientLookupData } = useApiQuery<{ patients: Patient[] }>(
    ['reception', 'appointment-patient-lookup', appointmentPatientSearch],
    `/api/patients?search=${encodeURIComponent(appointmentPatientSearch.trim())}&limit=8`,
    { enabled: appointmentPatientSearch.trim().length >= 2, staleTime: RECEPTION_SEARCH_STALE_MS },
  );
  const newPatientLookupTerm = newPatientForm.mobile.trim() || newPatientForm.name.trim();
  const { data: newPatientLocalLookupData } = useApiQuery<{ patients: Patient[] }>(
    ['reception', 'new-patient-local-lookup', newPatientLookupTerm],
    `/api/patients?search=${encodeURIComponent(newPatientLookupTerm)}&limit=8`,
    { enabled: activeModal === 'newPatient' && newPatientLookupTerm.length >= 2, staleTime: RECEPTION_SEARCH_STALE_MS },
  );
  const { data: newPatientGlobalLookupData } = useApiQuery<{ results: GlobalPatientSearchResult[] }>(
    ['reception', 'new-patient-global-lookup', newPatientLookupTerm],
    `/api/patients/global-search?q=${encodeURIComponent(newPatientLookupTerm)}`,
    { enabled: activeModal === 'newPatient' && /^\d{11}$/.test(newPatientLookupTerm.trim()), staleTime: RECEPTION_SEARCH_STALE_MS },
  );

  const quickBillPatientLookupTerm = quickBillPatientSearch.trim();
  const { data: quickBillPatientLookupData, isFetching: quickBillPatientLookupFetching } = useApiQuery<{ patients: Patient[] }>(
    ['reception', 'quick-bill-patient-lookup', quickBillPatientLookupTerm],
    '/api/patients?search=' + encodeURIComponent(quickBillPatientLookupTerm) + '&limit=8',
    {
      enabled: activeModal === 'quickServiceBill' && !quickBillPatient && quickBillPatientLookupTerm.length >= 2,
      staleTime: RECEPTION_SEARCH_STALE_MS,
    },
  );

  const admissionPatientLookupTerm = admissionPatientSearch.trim();
  const { data: admissionPatientLookupData, isFetching: admissionPatientLookupFetching } = useApiQuery<{ patients: Patient[] }>(
    ['reception', 'ipd-admission-patient-lookup', admissionPatientLookupTerm],
    '/api/reception/admission-candidates?search=' + encodeURIComponent(admissionPatientLookupTerm) + '&limit=8',
    {
      enabled: activeModal === 'ipdAdmission' && !admissionPatient && admissionPatientLookupTerm.length >= 2,
      staleTime: 0,
    },
  );

  const linkGlobalPatient = useApiMutation<{ patientId: number; alreadyLinked: boolean; patient?: { id: number; name: string; mobile: string; patient_code?: string } }, { uhid: string }>(
    'post',
    '/api/patients/link-global',
    {
      onSuccess: (data) => {
        if (data.alreadyLinked) {
          toast.success(t('toast.patientAlreadyLinked', { ns: 'reception' }));
        } else {
          toast.success(t('toast.patientLinked', { ns: 'reception' }));
        }
        const p = data.patient;
        const linkedPatient = p
          ? { id: p.id, name: p.name, mobile: p.mobile ?? '', patient_code: p.patient_code }
          : { id: data.patientId, name: '', mobile: '', patient_code: undefined };
        const targetModal = activeModal === 'newPatient' ? newPatientReturnModal : 'appointment';
        selectPatientForReturnFlow(linkedPatient as Patient, targetModal);
        queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
      },
      onError: (error) => toast.error(error.message || t('toast.failedLinkPatient', { ns: 'reception' })),
    },
  );

  /* ── Data fetching ── */
  const { data: dashboardSnapshotData, isLoading: dashboardSnapshotLoading } = useApiQuery<{
    visits: { visits: Visit[] };
    appointments: { appointments: AppointmentSummary[] };
    queueStats: { Results: QueueStats };
    pendingLabOrders: { data: PendingPrescriptionLabOrder[] };
    activeCounter: { active: boolean; session: { id: number; counterName?: string; counter_name?: string } | null };
  }>(
    receptionDashboardSnapshotQueryKey,
    `/api/reception/dashboard-snapshot?date=${date}`,
    { staleTime: RECEPTION_ACTIVE_STALE_MS, refetchInterval: RECEPTION_ACTIVE_STALE_MS },
  );
  const visitsData = dashboardSnapshotData?.visits;
  const visitsLoading = dashboardSnapshotLoading;

  const { data: billingData, isLoading: billingLoading } = useApiQuery<{ bills: BillRecord[] }>(
    queryKeys.billing.all,
    '/api/billing',
    { staleTime: RECEPTION_SUMMARY_STALE_MS },
  );

  const { data: patientsData } = useApiQuery<{ patients: Patient[] }>(
    queryKeys.patients.all,
    '/api/patients',
    { staleTime: RECEPTION_LOOKUP_STALE_MS },
  );

  const { data: doctorsData } = useApiQuery<{ doctors: Doctor[] }>(
    queryKeys.doctors.all,
    '/api/doctors',
    { staleTime: RECEPTION_LOOKUP_STALE_MS },
  );
  const { data: performerDoctorsData } = useApiQuery<{ doctors: Doctor[] }>(
    ['doctors', 'performers', 'lab-test'],
    '/api/doctors?service_type=lab_test&incentive_type=performer',
    { staleTime: RECEPTION_LOOKUP_STALE_MS },
  );

  const { data: servicesData } = useApiQuery<{ services: ServiceItem[] }>(
    queryKeys.reception.services(),
    '/api/reception/services',
    { staleTime: RECEPTION_LOOKUP_STALE_MS },
  );

  const { data: serviceDeptsData } = useApiQuery<{ departments: ServiceDept[] }>(
    ['reception', 'serviceDepts'],
    '/api/reception/service-departments',
    { staleTime: RECEPTION_LOOKUP_STALE_MS },
  );

  interface ExtRefDoctor { id: number; name: string; phone?: string | null; chamber?: string | null; specialty?: string | null; }
  const { data: extRefDoctorsData } = useApiQuery<ExtRefDoctor[]>(
    ['external-referring-doctors'],
    '/api/external-referring-doctors',
    { staleTime: RECEPTION_LOOKUP_STALE_MS },
  );
  const extRefDoctors = extRefDoctorsData ?? [];

  const { data: dailyReportData, isLoading: reportLoading } = useApiQuery<DailyReport>(
    queryKeys.reception.dailyReport(date),
    `/api/reception/daily-report?date=${date}`,
    { staleTime: RECEPTION_SUMMARY_STALE_MS },
  );

  const todayAppointmentsData = dashboardSnapshotData?.appointments;
  const appointmentsLoading = dashboardSnapshotLoading;
  const queueStatsData = dashboardSnapshotData?.queueStats;
  const queueStatsLoading = dashboardSnapshotLoading;
  const { data: waitingQueueData, isLoading: waitingQueueLoading } = useApiQuery<{ Results: QueueTokenRow[] }>(
    ['queue', 'tokens', 'waiting-dashboard', date],
    `/api/queue/tokens?date=${encodeURIComponent(date)}&status=all`,
    { enabled: activeModal === 'waitingQueue', staleTime: RECEPTION_ACTIVE_STALE_MS },
  );

  const activeCounterData = dashboardSnapshotData?.activeCounter;
  const { data: bedsData } = useApiQuery<AvailableBedsResponse>(
    ['admissions', 'available-beds-with-pricing', 'dashboard'],
    '/api/admissions/available-beds-with-pricing',
    { staleTime: RECEPTION_LOOKUP_STALE_MS },
  );
  const { data: receptionBedsData, isLoading: receptionBedsLoading } = useApiQuery<ReceptionBedsResponse>(
    [...queryKeys.admissions.beds({ scope: 'reception-drawer' })],
    '/api/admissions/ward-bed-overview',
    { staleTime: RECEPTION_LOOKUP_STALE_MS },
  );
  const { data: admittedFlowData } = useApiQuery<{ admissions: AdmissionFlowAdmission[] }>(
    ['reception', 'patient-flow', 'admitted', showAdmittedPatients],
    '/api/admissions?status=all&perPage=100',
    { enabled: showAdmittedPatients, staleTime: RECEPTION_ACTIVE_STALE_MS },
  );
  const { data: packagesData } = useApiQuery<{ data: Array<{ id: number; package_name: string; total_price: number; included_bed_days: number; extra_bed_rate: number; package_type: string; description?: string }> }>(
    ['billingMaster', 'packages'],
    '/api/billing-master/packages',
    { staleTime: RECEPTION_LOOKUP_STALE_MS },
  );
  const { data: doctorsTodayData } = useApiQuery<{ doctors: DoctorTodayStatus[] }>(
    ['reception', 'doctors-today', date],
    `/api/reception/doctors/today?date=${date}`,
    { staleTime: RECEPTION_LOOKUP_STALE_MS },
  );
  const { data: ambulanceStatsData } = useApiQuery<{ totalVehicles?: number; available?: number; onTrip?: number; activeTrips?: number }>(
    ['ambulance', 'stats', 'dashboard'],
    '/api/ambulance/stats',
    { staleTime: RECEPTION_LOOKUP_STALE_MS },
  );
  const pendingBillDateParam = buildReceptionPendingBillDateParam(pendingBillFilter, pendingDueDate);
  const { data: dashboardPendingWorklistData, isLoading: dashboardPendingLoading } = useApiQuery<{
    data: PendingDueWorklistRow[];
    pagination: { page: number; limit: number; total: number; pages: number };
  }>(
    ['billing-counter', 'pending-due-worklist', 'dashboard', pendingBillFilter, pendingDueDate, pendingDuePage],
    `/api/billing-counter/pending-due-worklist?limit=8&page=${pendingDuePage}${pendingBillDateParam}`,
    { staleTime: RECEPTION_SUMMARY_STALE_MS },
  );
  const dueCollectionDateParam = buildReceptionDueCollectionDateParam(dueCollectionScope, dueCollectionDate);
  const { data: collectPaymentPendingBillsData, isLoading: collectPaymentPendingBillsLoading } = useApiQuery<{ data: PendingBillSummary[]; pagination?: { total: number } }>(
    ['billing-counter', 'pending-bills', 'collect-payment', dueCollectionScope, dueCollectionDate],
    `/api/billing-counter/pending-bills?limit=100${dueCollectionDateParam}`,
    { enabled: activeModal === 'collectPayment', staleTime: RECEPTION_ACTIVE_STALE_MS },
  );
  const { data: collectPaymentPendingAppointmentsData } = useApiQuery<{ data: PendingAppointmentCharge[] }>(
    ['billing-counter', 'pending-appointments', 'collect-payment', dueCollectionScope, dueCollectionDate],
    `/api/billing-counter/pending-appointment-charges?limit=100${dueCollectionDateParam}`,
    { enabled: activeModal === 'collectPayment', staleTime: RECEPTION_ACTIVE_STALE_MS },
  );
  const pendingLabOrdersData = dashboardSnapshotData?.pendingLabOrders;
  const pendingLabOrdersLoading = dashboardSnapshotLoading;

  const reportLookupQuery = useApiQuery<ReportDeliveryLookup>(
    ['reception', 'report-delivery', reportInvoiceLookup],
    `/api/reception/report-delivery/lookup?invoice=${encodeURIComponent(reportInvoiceLookup)}`,
    { enabled: activeModal === 'reportDelivery' && reportInvoiceLookup.trim().length > 0, retry: false },
  );

  const { data: quickBillDepositBalanceData } = useApiQuery<{ balance: number }>(
    ['deposits', 'balance', 'quick-service-bill', quickBillPatient?.id],
    quickBillPatient ? `/api/deposits/balance/${quickBillPatient.id}` : '/api/deposits/balance/0',
    { enabled: activeModal === 'quickServiceBill' && Boolean(quickBillPatient?.id) },
  );
  const { data: selectedVisitDepositBalanceData } = useApiQuery<{ balance: number }>(
    ['deposits', 'balance', 'visit-service-bill', selectedVisit?.patient_id],
    selectedVisit ? `/api/deposits/balance/${selectedVisit.patient_id}` : '/api/deposits/balance/0',
    { enabled: activeModal === 'addService' && Boolean(selectedVisit?.patient_id) },
  );

  const { data: visitServicesData } = useApiQuery<{ services: VisitService[]; pendingTotal: number }>(
    queryKeys.reception.visitServices(selectedVisit?.id ?? 0),
    selectedVisit ? `/api/reception/visits/${selectedVisit.id}/services` : '',
    { enabled: !!selectedVisit && activeModal !== 'none' },
  );

  const visits = visitsData?.visits ?? [];
  const bills = billingData?.bills ?? [];
  const patients = patientsData?.patients ?? [];
  const doctors = doctorsData?.doctors ?? [];
  const performerDoctors = performerDoctorsData?.doctors ?? [];
  const serviceItems = servicesData?.services ?? [];
  const serviceDepts = serviceDeptsData?.departments ?? [];
  const todayAppointments = todayAppointmentsData?.appointments ?? [];
  const pendingLabOrders = pendingLabOrdersData?.data ?? [];
  const queueStats = queueStatsData?.Results ?? {};
  const waitingQueueTokens = waitingQueueData?.Results ?? [];
  const activeCounterSession = activeCounterData?.session ?? null;
  const availableBeds = bedsData?.beds ?? [];
  const receptionBeds = (receptionBedsData?.beds ?? []).map((bed) => ({ ...bed, id: bed.id ?? bed.bed_id }));
  const receptionBedSummary = useMemo(() => summarizeReceptionBeds(receptionBeds), [receptionBeds]);
  const visibleDrawerBeds = useMemo(() => {
    if (bedStatusFilter === 'all') return receptionBeds;
    return receptionBeds.filter((bed) => String(bed.status ?? '').toLowerCase() === bedStatusFilter);
  }, [bedStatusFilter, receptionBeds]);
  const doctorAlerts = (doctorsTodayData?.doctors ?? []).filter((doctor) => Number(doctor.is_available) !== 1);

  // Fallback for older check-in responses that do not include visitId.
  // Current responses open the add-service modal directly from the mutation.
  useEffect(() => {
    if (!pendingAddServiceForAppointment || !visits.length) return;
    const appt = todayAppointments.find((a) => a.id === pendingAddServiceForAppointment);
    if (!appt) return;
    const candidate = visits.find(
      (v) =>
        v.patient_id === appt.patient_id &&
        (v.doctor_id ?? null) === (appt.doctor_id ?? null) &&
        ['initiated', 'checked_in', 'checked-in', 'waiting'].includes((v.status ?? '').toLowerCase()),
    );
    if (!candidate) return;
    setPendingAddServiceForAppointment(null);
    openAddService(candidate, 'service');
  }, [pendingAddServiceForAppointment, visits, todayAppointments]);

  /* ── Mutations ── */
  const issueTokenMutation = useApiMutation<{ tokenNo: string }, { visitId: number; patientId: number; priority?: string }>(
    'post',
    '/api/queue/token',
    {
      onSuccess: (data) => {
        toast.success(t('toast.queueTokenIssued', { ns: 'reception', tokenNo: data.tokenNo }));
        queryClient.invalidateQueries({ queryKey: queryKeys.queue.stats() });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: ['queue', 'tokens', 'waiting-dashboard', date] });
      },
      onError: () => toast.error(t('toast.visitCreatedNoToken', { ns: 'reception' })),
    },
  );

  const updateBedStatusMutation = useApiMutation<unknown, { bedId: number; status: 'available' | 'cleaning' | 'reserved' | 'maintenance' }>(
    'put',
    (vars) => `/api/admissions/beds/${vars.bedId}`,
    {
      onSuccess: () => {
        toast.success('Bed status updated');
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
        queryClient.invalidateQueries({ queryKey: ['admissions', 'available-beds-with-pricing'] });
      },
      onError: (error) => toast.error(error.message || 'Failed to update bed status'),
    },
  );

  const createPatientMutation = useApiMutation<
    { patient?: Patient; id?: number; patientId?: number; patientCode?: string },
    {
      name: string;
      // `mobile` is conditional-optional: omit it (and supply
      // `mobileMissingReason` + alternative contact) when the
      // receptionist has no number to give.
      mobile?: string;
      mobileMissingReason?: string;
      guardianName?: string;
      guardianRelation?: string;
      village?: string;
      unionName?: string;
      upazila?: string;
      district?: string;
      division?: string;
      age: number;
      gender: string;
      fatherHusband?: string;
      address?: string;
      guardianMobile?: string;
      dateOfBirth?: string;
      bloodGroup?: string;
      duplicateOverrideReason?: string;
      idempotencyKey?: string;
    }
  >(
    'post',
    '/api/patients',
    {
      onSuccess: (data) => {
        newPatientCreateIdempotencyRef.current = null;
        newPatientPayloadSignatureRef.current = null;
        toast.success(t('toast.patientRegistered', { ns: 'reception' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
        const patientId = data.patient?.id ?? data.patientId ?? data.id;
        if (patientId) {
          const ageDraft = buildReceptionNewPatientAgeDraft(newPatientForm);
          const createdPatient: Patient = data.patient ?? {
            id: Number(patientId),
            name: newPatientForm.name.trim(),
            mobile: newPatientForm.mobile.trim(),
            patient_code: data.patientCode,
            age: ageDraft.ok ? ageDraft.age : Number(newPatientForm.age),
            gender: newPatientForm.gender,
            father_husband: newPatientForm.fatherHusband.trim() || undefined,
            address: newPatientForm.address.trim() || undefined,
            guardian_mobile: newPatientForm.guardianMobile.trim() || undefined,
            date_of_birth: ageDraft.ok ? ageDraft.dateOfBirth : newPatientForm.dateOfBirth || undefined,
            blood_group: newPatientForm.bloodGroup || undefined,
          };
          selectPatientForReturnFlow(createdPatient);
        } else {
          setActiveModal('none');
        }
        setNewPatientForm(EMPTY_NEW_PATIENT_FORM);
        setCreateAsFamilyMember(false);
      },
      onError: (error) => {
        const payload = (error as { payload?: { code?: string; possibleDuplicates?: Array<Record<string, unknown>> } }).payload;
        if (payload?.code === 'POSSIBLE_DUPLICATE_PATIENT') {
          newPatientCreateIdempotencyRef.current = null;
          newPatientPayloadSignatureRef.current = null;
          // The new patient modal always sends duplicateOverrideReason, so
          // reaching this 409 path means the override was rejected (e.g. a
          // concurrent registration since the form opened). Surface a warning
          // and refresh the lookup queries; do NOT silently hijack the save
          // to an existing patient — the user must explicitly click a
          // suggestion in the list above to use an existing record.
          queryClient.invalidateQueries({ queryKey: ['reception', 'new-patient-local-lookup'] });
          queryClient.invalidateQueries({ queryKey: ['reception', 'new-patient-global-lookup'] });
          toast.error(t('toast.existingPatientMatch', { ns: 'reception' }));
          return;
        }
        // Preserve the key when the outcome is uncertain (transport/5xx) or
        // the same request is still processing, so a retry can replay safely.
        const isProcessingConflict = error instanceof ApiClientError
          && error.status === 409
          && error.message.includes('already being processed');
        if (error instanceof ApiClientError && error.status < 500 && !isProcessingConflict) {
          newPatientCreateIdempotencyRef.current = null;
          newPatientPayloadSignatureRef.current = null;
        }
        toast.error(error.message || t('toast.failedRegisterPatient', { ns: 'reception' }));
      },
      onSettled: () => {
        newPatientSubmitLockRef.current = false;
      },
    },
  );

  const createVisitMutation = useApiMutation<{ id: number; visitNo: string }, { patientId: number; doctorId?: number; visitType: string }>(
    'post',
    '/api/visits',
    {
      onSuccess: (data) => {
        toast.success(t('toast.visitCreated', { ns: 'reception' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        if (issueToken && newVisitPatientId && canAutoIssueToken) {
          issueTokenMutation.mutate({
            visitId: data.id,
            patientId: Number(newVisitPatientId),
            priority: newVisitType === 'emergency' ? 'emergency' : 'normal',
          });
        }
        setActiveModal('none');
      },
      onError: () => toast.error(t('toast.failedCreateVisit', { ns: 'reception' })),
    },
  );

  const createAppointmentMutation = useApiMutation<
    { id: number; tokenNo?: number; apptNo?: string; consultationFee?: number; billingStatus?: string; discountAmount?: number; discountByName?: string | null },
    {
      patientId: number;
      doctorId?: number;
      apptDate: string;
      visitType: 'opd' | 'followup' | 'emergency';
      appointmentType: AppointmentType;
      discountAmount: number;
      discountReason?: string;
      discountByName?: string;
      chiefComplaint?: string;
      apptTime?: string;
      source: 'walk_in' | 'phone';
      requestedTokenNo?: number;
      forceTokenNo?: number;
    }
  >(
    'post',
    '/api/appointments',
    {
      onSuccess: (data) => {
        toast.success(data.tokenNo ? t('toast.appointmentBookedWithToken', { ns: 'reception', tokenNo: data.tokenNo }) : t('toast.appointmentBooked', { ns: 'reception' }));
        setBookedAppointment(data);
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] });
        // Always check fee — local compute is more reliable than stale cache
        const fee = Number(data.consultationFee ?? appointmentPreview?.finalFee ?? 0);
        const shouldCollectNow = appointmentBookingActionRef.current === 'pay' && fee > 0;
        appointmentBookingActionRef.current = 'due';
        if (shouldCollectNow) {
          if (!activeCounterSession) {
            toast.error(t('toast.activateBillingCounter', { ns: 'reception' }));
            setActiveModal('none');
            return;
          }
          setActiveModal('none');
          payAppointmentMutation.mutate({
            id: data.id,
            paymentMethod: appointmentPaymentMethod,
            externalTransactionId: normalizeExternalTransactionId(appointmentPaymentMethod, fee, appointmentPaymentReference),
            discountByName: (data.discountByName || appointmentDiscountByName).trim() || undefined,
            idempotencyKey: `dash-appt-pay-${data.id}-${crypto.randomUUID()}`,
          });
          return;
        }
        setActiveModal('none');
      },
      onError: (error) => {
        appointmentBookingActionRef.current = 'due';
        toast.error(error.message || t('toast.failedBookAppointment', { ns: 'reception' }));
      },
    },
  );

  const createExtRefDoctorMutation = useApiMutation<
    { id: number; name: string; reused?: boolean },
    { name: string; phone?: string; chamber?: string; specialty?: string }
  >(
    'post',
    '/api/external-referring-doctors',
    {
      onSuccess: (data) => {
        toast.success(data.reused ? t('toast.doctorFound', { ns: 'reception' }) : t('toast.externalDoctorAdded', { ns: 'reception' }));
        queryClient.invalidateQueries({ queryKey: ['external-referring-doctors'] });
        setQuickBillExtRefDoctorId(data.id);
        setQuickBillExtRefDoctorSearch(data.name);
        setShowQuickBillNewExtRefForm(false);
        setNewExtRefDoctorName('');
        setNewExtRefDoctorPhone('');
        setNewExtRefDoctorChamber('');
      },
      onError: (error) => toast.error(error.message || t('toast.failedAddExternalDoctor', { ns: 'reception' })),
    },
  );

  const checkAppointmentPaymentSchemePreviewMutation = useApiMutation<SchemePreviewResponse, { patient_id?: number; scheme_code?: string; member_code?: string; service_category?: string; subtotal: number }>(
    'post',
    '/api/billing-master/apply-scheme-preview',
    {
      onSuccess: (preview) => {
        setAppointmentPaymentSchemePreview(preview);
        if (preview.eligible) toast.success(`Eligible: ${preview.scheme_name ?? 'scheme'} benefit`);
        else toast.error(preview.blockers?.[0] ?? 'Scheme is not eligible.');
      },
      onError: (error) => toast.error(error.message || 'Failed to check appointment benefit'),
    },
  );

  const payAppointmentMutation = useApiMutation<
    { invoiceNo?: string; receiptNo?: string; billId?: number },
    {
      id: number;
      paymentMethod: string;
      idempotencyKey: string;
      discountByName?: string;
      externalTransactionId?: string;
      schemeApplication?: { schemeId?: number; schemeCode?: string; memberCode?: string; memberId?: number; serviceCategory?: string; allocationType?: string; suggestedDiscount?: number };
    }
  >(
    'post',
    (vars) => `/api/appointments/${vars.id}/pay-now`,
    {
      onSuccess: (data) => {
        toast.success(data.invoiceNo ? t('toast.appointmentPaidInvoice', { ns: 'reception', invoiceNo: data.invoiceNo }) : t('toast.appointmentPaid', { ns: 'reception' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.today() });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.billing.all });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] });
        setBookedAppointment(null);
        setAppointmentPaymentSchemeCodeInput('');
        setAppointmentPaymentMemberCodeInput('');
        setAppointmentPaymentSchemePreview(null);
        setAppointmentPaymentReference('');
        setActiveModal('none');
        redirectToReceptionBillPrint(navigate, basePath, data.billId);
      },
      onError: (error) => {
        if (error.message?.includes('Activate a billing counter')) {
          queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        invalidateReceptionDashboardSnapshot();
        }
        toast.error(error.message || t('toast.failedCollectAppointmentPayment', { ns: 'reception' }));
      },
    },
  );
  const checkInAppointmentMutation = useApiMutation<{ visitId?: number; sentToRoom?: boolean; message?: string }, { id: number; sendToRoom?: boolean }>(
    'post',
    (vars) => `/api/appointments/${vars.id}/check-in`,
    {
      onSuccess: (data) => {
        toast.success(data.sentToRoom ? t('toast.patientCheckedInRoom', { ns: 'reception' }) : t('toast.patientCheckedIn', { ns: 'reception' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.today() });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.queue.stats() });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: ['queue', 'tokens', 'waiting-dashboard', date] });
      },
      onError: (error) => toast.error(error.message || t('toast.checkInFailed', { ns: 'reception' })),
    },
  );
  const createReportShowAppointmentMutation = useApiMutation<
    { id: number; tokenNo?: number; apptNo?: string; consultationFee?: number; billingStatus?: string; status?: string; reused?: boolean },
    {
      patientId: number;
      doctorId: number;
      apptDate: string;
      visitType: 'followup';
      appointmentType: 'report_show';
      discountAmount: number;
      chiefComplaint?: string;
      source: 'walk_in';
    }
  >(
    'post',
    '/api/appointments',
    {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.today() });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        if (!data.status || String(data.status).toLowerCase() === 'scheduled') {
          toast.success(data.reused ? t('toast.reportShowSerialExists', { ns: 'reception' }) : t('toast.reportShowCreated', { ns: 'reception' }));
          checkInAppointmentMutation.mutate({ id: data.id });
          return;
        }
        toast.success(t('toast.reportShowActive', { ns: 'reception' }));
      },
      onError: (error) => toast.error(error.message || t('toast.failedStartReportShow', { ns: 'reception' })),
    },
  );
  const updateVisitStatusMutation = useApiMutation<unknown, { visitId: number; status: 'engaged' | 'concluded' }>(
    'put',
    (vars) => `/api/queue/visits/${vars.visitId}/status`,
    {
      onSuccess: () => {
        toast.success(t('toast.visitStatusUpdated', { ns: 'reception' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.queue.stats() });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: ['queue', 'tokens', 'waiting-dashboard', date] });
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.today() });
        invalidateReceptionDashboardSnapshot();
      },
      onError: (error) => toast.error(error.message || t('toast.statusUpdateFailed', { ns: 'reception' })),
    },
  );
  const updateQueueTokenStatusMutation = useApiMutation<unknown, { id: number; status: 'called' | 'serving' | 'completed' | 'no_show' }>(
    'put',
    (vars) => `/api/queue/tokens/${vars.id}/status`,
    {
      onSuccess: (_data, variables) => {
        const label = variables.status === 'serving'
          ? t('toast.patientSentToRoom', { ns: 'reception' })
          : variables.status === 'called'
            ? t('toast.patientCalled', { ns: 'reception' })
            : variables.status === 'completed'
              ? t('toast.queueCompleted', { ns: 'reception' })
              : t('toast.markedNoShow', { ns: 'reception' });
        toast.success(label);
        queryClient.invalidateQueries({ queryKey: queryKeys.queue.stats() });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: ['queue', 'tokens', 'waiting-dashboard', date] });
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.today() });
        invalidateReceptionDashboardSnapshot();
      },
      onError: (error) => toast.error(error.message || t('toast.queueUpdateFailed', { ns: 'reception' })),
    },
  );

  const quickAdmitMutation = useApiMutation<{ patient?: Patient; visitNo?: string }, { reason: string; idempotencyKey: string }>(
    'post',
    '/api/reception/quick-admit',
    {
      onSuccess: (data) => {
        toast.success(t('toast.emergencyPatientCreated', { ns: 'reception' }));
        setCreatedEmergencyPatient(data.patient ?? null);
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
        setActiveModal('quickAdmitResult');
      },
      onError: (error) => toast.error(error.message || t('toast.quickAdmitFailed', { ns: 'reception' })),
    },
  );

  const addLabMutation = useApiMutation<unknown, { labTestIds: number[]; discountAmount?: number; orderDate?: string; notes?: string }>(
    'post',
    () => `/api/reception/visits/${selectedVisit!.id}/services/lab`,
    {
      onSuccess: () => {
        toast.success(t('toast.labOrderAdded', { ns: 'reception' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visitServices(selectedVisit!.id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        setActiveModal('none');
      },
      onError: () => toast.error(t('toast.failedAddLabOrder', { ns: 'reception' })),
    },
  );

  const addProcedureMutation = useApiMutation<unknown, { serviceItemId: number; procedureName: string; instructions?: string; quantity?: number; discountAmount?: number }>(
    'post',
    () => `/api/reception/visits/${selectedVisit!.id}/services/procedure`,
    {
      onSuccess: () => {
        toast.success(t('toast.procedureOrdered', { ns: 'reception' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visitServices(selectedVisit!.id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        setActiveModal('none');
      },
      onError: () => toast.error(t('toast.failedOrderProcedure', { ns: 'reception' })),
    },
  );

  const generateBillMutation = useApiMutation<{ billId: number; invoiceNo: string; total: number }, { discount?: number; discountByName?: string; discountAllocations?: Array<{ reason: string; amount: number; doctorId?: number; note?: string }>; schemeApplication?: { schemeId?: number; schemeCode?: string; memberCode?: string; memberId?: number; serviceCategory?: string; allocationType?: string; suggestedDiscount?: number }; idempotencyKey?: string }>(
    'post',
    () => `/api/reception/visits/${selectedVisit!.id}/generate-bill`,
    {
      onSuccess: (data) => {
        toast.success(t('toast.billGenerated', { ns: 'reception', invoiceNo: data.invoiceNo }));
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visitServices(selectedVisit!.id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.billing.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.dailyReport(date) });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
        setActiveModal('none');
        redirectToReceptionBillPrint(navigate, basePath, data.billId);
      },
      onError: () => toast.error(t('toast.failedGenerateBill', { ns: 'reception' })),
    },
  );

  const checkQuickBillSchemePreviewMutation = useApiMutation<SchemePreviewResponse, { patient_id?: number; scheme_code?: string; member_code?: string; service_category?: string; subtotal: number }>(
    'post',
    '/api/billing-master/apply-scheme-preview',
    {
      onSuccess: (preview) => {
        setQuickBillSchemePreview(preview);
        if (preview.eligible) toast.success(`Eligible: ${preview.scheme_name ?? 'scheme'} benefit`);
        else toast.error(preview.blockers?.[0] ?? 'Scheme is not eligible.');
      },
      onError: (error) => toast.error(error.message || 'Failed to check scheme benefit'),
    },
  );

  const checkVisitServiceSchemePreviewMutation = useApiMutation<SchemePreviewResponse, { patient_id?: number; scheme_code?: string; member_code?: string; service_category?: string; subtotal: number }>(
    'post',
    '/api/billing-master/apply-scheme-preview',
    {
      onSuccess: (preview) => {
        setServiceSchemePreview(preview);
        if (preview.eligible) toast.success(`Eligible: ${preview.scheme_name ?? 'scheme'} benefit`);
        else toast.error(preview.blockers?.[0] ?? 'Scheme is not eligible.');
      },
      onError: (error) => toast.error(error.message || 'Failed to check scheme benefit'),
    },
  );

  const checkFinalBillSchemePreviewMutation = useApiMutation<SchemePreviewResponse, { patient_id?: number; scheme_code?: string; member_code?: string; service_category?: string; subtotal: number }>(
    'post',
    '/api/billing-master/apply-scheme-preview',
    {
      onSuccess: (preview) => {
        setBillSchemePreview(preview);
        if (preview.eligible) toast.success(`Eligible: ${preview.scheme_name ?? 'scheme'} benefit`);
        else toast.error(preview.blockers?.[0] ?? 'Scheme is not eligible.');
      },
      onError: (error) => toast.error(error.message || 'Failed to check scheme benefit'),
    },
  );

  const createQuickServiceBillMutation = useApiMutation<{ invoiceNo?: string; total?: number; billId?: number }, unknown>(
    'post',
    '/api/billing-counter/invoices',
    {
      onSuccess: (data) => {
        toast.success(data.invoiceNo ? t('toast.billCreatedInvoice', { ns: 'reception', invoiceNo: data.invoiceNo }) : t('toast.billCreated', { ns: 'reception' }));
        resetQuickBill();
        setActiveModal('none');
        queryClient.invalidateQueries({ queryKey: queryKeys.billing.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.dailyReport(date) });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: ['reception', 'patient-context'] });
        redirectToReceptionBillPrint(navigate, basePath, data.billId);
      },
      onError: (error) => toast.error(error.message || t('toast.failedCreateServiceBill', { ns: 'reception' })),
    },
  );
  const billPendingLabOrderMutation = useApiMutation<{ invoiceNo?: string; total?: number; billId?: number; reagentUsageWarnings?: ReagentUsageWarning[] }, {
    orderId: number;
    itemIds: number[];
    billMode: 'paid' | 'credit';
    payment: { paymentMethod: string; paidAmount: number; externalTransactionId?: string };
  }>(
    'post',
    (payload) => `/api/billing-counter/lab-orders/${payload.orderId}/bill`,
    {
      onSuccess: (data) => {
        toast.success(data.invoiceNo ? `Lab bill ${data.invoiceNo} created` : 'Lab bill created');
        const reagentWarningToast = buildReagentUsageWarningToast(data.reagentUsageWarnings);
        if (reagentWarningToast) toast.error(reagentWarningToast);
        setSelectedPendingLabOrder(null);
        setSelectedPendingLabItemIds([]);
        setActiveModal('none');
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-lab-orders'] });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.billing.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.dailyReport(date) });
        redirectToReceptionBillPrint(navigate, basePath, data.billId);
      },
      onError: (error) => toast.error(error.message || 'Failed to create lab bill'),
    },
  );
  const createVisitServiceBillMutation = useApiMutation<{ invoiceNo?: string; total?: number; billId?: number }, unknown>(
    'post',
    '/api/billing-counter/invoices',
    {
      onSuccess: (data) => {
        toast.success(data.invoiceNo ? t('toast.billCreatedInvoice', { ns: 'reception', invoiceNo: data.invoiceNo }) : t('toast.billCreated', { ns: 'reception' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.billing.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visitServices(selectedVisit?.id ?? 0) });
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: queryKeys.reception.dailyReport(date) });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: ['reception', 'patient-context'] });
        setSelectedServiceLines([]);
        setServiceDiscount('');
        setServiceDiscountByName('');
        setServiceSchemeCodeInput('');
        setServiceMemberCodeInput('');
        setServiceSchemePreview(null);
        setServicePaymentMethod('cash');
        setVisitServiceBillIdempotencyKey('visit-service-bill-' + crypto.randomUUID());
        setServiceDepositDeducted('');
        queryClient.invalidateQueries({ queryKey: ['deposits', 'balance', 'visit-service-bill'] });
        setActiveModal('none');
        redirectToReceptionBillPrint(navigate, basePath, data.billId);
      },
      onError: (error) => toast.error(error.message || t('toast.failedCreateVisitBill', { ns: 'reception' })),
    },
  );
  const admitWithDepositMutation = useApiMutation<{ admission?: { id?: number; admission_no?: string }; deposit?: { receiptNo?: string } | null }, unknown>(
    'post',
    '/api/reception/admit-with-deposit',
    {
      onSuccess: (data) => {
        toast.success(data.admission?.admission_no ? t('toast.admittedWithNo', { ns: 'reception', admissionNo: data.admission.admission_no }) : t('toast.patientAdmitted', { ns: 'reception' }));
        setActiveModal('none');
        setAdmissionPatient(null);
        setPatientDepositBalance(null);
        setAdmissionPatientSearch('');
        setAdmissionBedId('');
        setAdmissionDoctorId('');
        setAdmissionFee('');
        setAdmissionDeposit('');
        setAdmissionReason('');
        setAdmissionPackageId('');
        setAdmissionBillingMode('regular');
        admissionCreateIdempotencyRef.current = null;
        queryClient.invalidateQueries({ queryKey: ['admissions'] });
        queryClient.invalidateQueries({ queryKey: ['admissions', 'available-beds-with-pricing'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        invalidateReceptionDashboardSnapshot();
        queryClient.invalidateQueries({ queryKey: ['reception', 'patient-context'] });
        queryClient.invalidateQueries({ queryKey: ['reception', 'ipd-admission-patient-lookup'] });
        if (data.admission?.id) {
          navigate(getAdmissionSlipPrintPath(basePath, Number(data.admission.id)));
        } else {
          toast.error('Admission created, but the admission slip could not be opened.');
        }
      },
      onError: (error) => {
        admissionCreateIdempotencyRef.current = null;
        toast.error(error.message || t('toast.admissionFailed', { ns: 'reception' }));
      },
    },
  );

  const refreshPaymentViews = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.billing.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.reception.dailyReport(date) });
    queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
    queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] });
    queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
    queryClient.invalidateQueries({ queryKey: ['reception', 'patient-context'] });
  };

  const closePaymentModal = () => {
    setPayBill(null);
    setBatchPaymentBills([]);
    setPayAmount('');
    setPayReference('');
  };

  const collectPaymentMutation = useApiMutation<{ receiptNo: string; billId: number; status: string }, unknown>(
    'post',
    '/api/billing/pay',
    {
      onSuccess: (data) => {
        toast.success(t('toast.paymentRecorded', { ns: 'reception', receiptNo: data.receiptNo }));
        closePaymentModal();
        refreshPaymentViews();
        redirectToReceptionBillPrint(navigate, basePath, data.billId);
      },
      onError: (error) => toast.error(error.message || t('toast.failedCollectPayment', { ns: 'reception' })),
    },
  );

  const collectBatchPayment = async () => {
    const requestedAmount = Number(payAmount);
    const totalDue = batchPaymentBills.reduce((sum, bill) => sum + getBillOutstandingAmount(bill), 0);
    if (batchPaymentBills.length <= 1 || requestedAmount <= 0) return;
    if (requiresPaymentReference(payMethod, requestedAmount) && !payReference.trim()) {
      toast.error('Transaction/reference number is required for non-cash payments.');
      return;
    }
    if (requestedAmount > totalDue) {
      toast.error('Payment amount exceeds total due.');
      return;
    }

    setIsBatchPaymentCollecting(true);
    let remaining = requestedAmount;
    let paidCount = 0;
    try {
      for (const bill of batchPaymentBills) {
        if (remaining <= 0) break;
        const billDue = getBillOutstandingAmount(bill);
        const amount = Math.min(billDue, remaining);
        if (amount <= 0) continue;
        await api.post('/api/billing/pay', {
          billId: bill.id,
          amount,
          type: 'due',
          paymentMethod: payMethod,
          externalTransactionId: normalizeExternalTransactionId(payMethod, amount, payReference),
          idempotencyKey: `${batchPaymentIdempotencyKey}-${bill.id}`,
        });
        remaining -= amount;
        paidCount += 1;
      }
      toast.success(`Payment recorded for ${paidCount} invoice(s).`);
      closePaymentModal();
      refreshPaymentViews();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toast.failedCollectPayment', { ns: 'reception' }));
    } finally {
      setIsBatchPaymentCollecting(false);
    }
  };

  /* ── KPI calculations ── */
  const reportSummary = dailyReportData?.summary;
  const billingCollectionToday = Number(reportSummary?.totalPaid ?? 0);
  const dueCollectionToday = Number(reportSummary?.dueCollection ?? 0);
  const depositReceivedToday = Number(reportSummary?.depositReceived ?? 0);
  const totalCashReceivedToday = Number(reportSummary?.totalCashReceived ?? (billingCollectionToday + dueCollectionToday + depositReceivedToday));
  const selectedDateBills = filterReceptionBillsByDate(bills, date);
  const paidBills = selectedDateBills.filter(b => b.status === 'paid');
  const paidBillCount = reportSummary?.paidBillCount ?? paidBills.length;
  const pendingVisits = visits.filter(v => (v.pending_services ?? 0) > 0);
  const dueBills = selectedDateBills.filter((bill) => {
    const due = getBillOutstandingAmount(bill);
    return ['open', 'unpaid', 'due', 'partially_paid', 'partial_paid'].includes(String(bill.status ?? '').toLowerCase()) || due > 0;
  });
  const allOpenDueBills = bills.filter((bill) => {
    const due = getBillOutstandingAmount(bill);
    return due > 0 && !['paid', 'cancelled', 'refunded', 'draft'].includes(String(bill.status ?? '').toLowerCase());
  });
  const overdueDueCount = allOpenDueBills.filter((bill) => String(bill.created_at ?? '').slice(0, 10) < date).length;
  const ipdDueCount = allOpenDueBills.filter(isReceptionBillIpd).length;
const collectPaymentPendingBillRecords = (collectPaymentPendingBillsData?.data ?? []).map(pendingBillSummaryToBillRecord);
  const dueCollectionUnfilteredBills = dueCollectionScope === 'ipd'
    ? collectPaymentPendingBillRecords.filter(isReceptionBillIpd)
    : collectPaymentPendingBillRecords;
  const dueCollectionQueryTotal = dueCollectionScope === 'ipd'
    ? dueCollectionUnfilteredBills.length
    : (collectPaymentPendingBillsData?.pagination?.total ?? dueCollectionUnfilteredBills.length);
  const dueCollectionSearchTerm = dueCollectionSearch.trim().toLowerCase();
  const dueCollectionBaseBills = dueCollectionUnfilteredBills.filter((bill) => {
    if (dueVisitTypeFilter === 'ipd' && !isReceptionBillIpd(bill)) return false;
    if (dueVisitTypeFilter === 'opd' && isReceptionBillIpd(bill)) return false;
    if (!receptionDueMatchesAgeBucket(receptionDueAgeDays(bill.created_at, dueCollectionDate), dueAgeBucket)) return false;
    if (!dueCollectionSearchTerm) return true;
    return [bill.patient_name, bill.invoice_no, bill.patient_code, bill.patient_mobile, bill.service_summary]
      .some((value) => String(value ?? '').toLowerCase().includes(dueCollectionSearchTerm));
  });
  const collectPaymentPendingAppointmentCharges = collectPaymentPendingAppointmentsData?.data ?? [];
  const showSameDayPendingVisitDrafts = dueCollectionScope === 'today' && dueCollectionDate === date;
  const unpaidAppointments = todayAppointments.filter((appointment) =>
    ['pending', 'unpaid', 'partial_paid', 'partially_paid'].includes(String(appointment.billing_status ?? '').toLowerCase()),
  );
  const pendingConsultationEntries = useMemo(
    () => buildPendingConsultationEntries({ appointments: unpaidAppointments, visits }),
    [unpaidAppointments, visits],
  );
  const pendingNonConsultationVisits = useMemo(
    () => pendingVisits.filter((visit) => getNonConsultationPendingAmount(visit) > 0),
    [pendingVisits],
  );
  const pendingVisitConsultationEntries = pendingConsultationEntries.filter((entry) => entry.source === 'visit');
  const collectPaymentVisibleAppointmentCharges = collectPaymentPendingAppointmentCharges.filter((charge) => {
    if (!dueCollectionSearchTerm) return true;
    return [charge.patient_name, charge.patient_code, charge.patient_mobile, charge.doctor_name, charge.appt_no]
      .some((value) => String(value ?? '').toLowerCase().includes(dueCollectionSearchTerm));
  });
  const collectPaymentPendingVisitConsultations = showSameDayPendingVisitDrafts
    ? pendingVisitConsultationEntries.filter((entry) => {
        if (!dueCollectionSearchTerm) return true;
        return [entry.patientName, entry.doctorName, entry.tokenLabel]
          .some((value) => String(value ?? '').toLowerCase().includes(dueCollectionSearchTerm));
      })
    : [];
  const collectPaymentPendingServiceVisits = showSameDayPendingVisitDrafts
    ? pendingNonConsultationVisits.filter((visit) => {
        if (!dueCollectionSearchTerm) return true;
        return [visit.patient_name, visit.patient_code, visit.id]
          .some((value) => String(value ?? '').toLowerCase().includes(dueCollectionSearchTerm));
      })
    : [];
  const dueCollectionTotalVisibleItems = dueCollectionBaseBills.length
    + collectPaymentVisibleAppointmentCharges.length
    + collectPaymentPendingVisitConsultations.length
    + collectPaymentPendingServiceVisits.length;
  const pendingLabOrderCount = pendingLabOrders.reduce((sum, order) => sum + Number(order.pendingItemCount ?? order.items.length ?? 0), 0);
  const pendingBillCount = pendingConsultationEntries.length + pendingNonConsultationVisits.length + dueBills.length + pendingLabOrders.length;
  const pendingLabOrdersByPatient = useMemo(() => {
    const grouped = new Map<number, PendingPrescriptionLabOrder[]>();
    for (const order of pendingLabOrders) {
      const patientId = Number(order.patientId);
      if (!Number.isFinite(patientId) || patientId <= 0) continue;
      grouped.set(patientId, [...(grouped.get(patientId) ?? []), order]);
    }
    return grouped;
  }, [pendingLabOrders]);
  const dashboardPendingTotalCount = dashboardPendingWorklistData?.pagination?.total ?? dashboardPendingWorklistData?.data?.length ?? 0;
  const normalizedRole = role === 'receptionist' ? 'reception' : role;
  const canApplyDiscount = ['hospital_admin', 'md', 'director', 'accountant', 'reception'].includes(normalizedRole);
  const discountReferralRequired = (subtotal: number, discount: number) => subtotal > 0 && discount > 0 && (discount / subtotal) * 100 > 20;
  const showDiscountReferralField = (discount: number) => discount > 0;
  const requireDiscountReferralName = (subtotal: number, discount: number, discountByName: string): boolean => {
    if (!discountReferralRequired(subtotal, discount)) return false;
    if (discountByName.trim()) return false;
    toast.error('Discount referred by name is required when discount is above 20%.');
    return true;
  };
  const priorityVisits = [...visits]
    .sort((a, b) => Number(b.pending_amount ?? 0) - Number(a.pending_amount ?? 0))
    .slice(0, 6);
  const bedSummary = receptionBedSummary.wardAvailability.slice(0, 4);
  const admissionPatientMatches = useMemo(() => {
    const q = admissionPatientSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    const sourcePatients = admissionPatientLookupData?.patients ?? [];
    return sourcePatients.filter((patient) =>
      patient.name.toLowerCase().includes(q)
      || patient.mobile?.includes(admissionPatientSearch.trim())
      || patient.patient_code?.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [admissionPatientLookupData?.patients, admissionPatientSearch, patients]);
  const openAppointmentModal = (
    patient?: Patient | null,
    doctorId?: number | null,
    appointmentTypeValue: AppointmentType = 'new_patient',
    source: 'walk_in' | 'phone' = 'walk_in',
  ) => {
    setActiveModal('appointment');
    setAppointmentPatient(patient ?? null);
    setAppointmentPatientSearch('');
    setAppointmentDoctorId(doctorId ? Number(doctorId) : '');
    setAppointmentDate(date);
    setAppointmentTime('');
    setAppointmentSource(source);
    setAppointmentType(appointmentTypeValue);
    setAppointmentDiscount('');
    setAppointmentDiscountReason('');
    setAppointmentComplaint('');
    setAppointmentTokenMode('auto');
    setAppointmentRequestedToken('');
    setAppointmentManualToken('');
    setAppointmentPaymentMethod('cash');
    setAppointmentPaymentReference('');
    setNewExtRefDoctorName('');
    setNewExtRefDoctorPhone('');
    setNewExtRefDoctorChamber('');
    setBookedAppointment(null);
    appointmentBookingActionRef.current = 'due';
  };
  const openAppointmentPaymentModal = (appointment: { id: number; tokenNo?: number; consultationFee?: number; billingStatus?: string } | AppointmentSummary) => {
    setAppointmentPaymentMethod('cash');
    setAppointmentPaymentReference('');
    setAppointmentPaymentSchemeCodeInput('');
    setAppointmentPaymentMemberCodeInput('');
    setAppointmentPaymentSchemePreview(null);
    setBookedAppointment({
      id: Number(appointment.id),
      patientId: 'patient_id' in appointment && appointment.patient_id ? Number(appointment.patient_id) : undefined,
      tokenNo: 'tokenNo' in appointment && appointment.tokenNo ? Number(appointment.tokenNo) : ('token_no' in appointment && appointment.token_no ? Number(appointment.token_no) : undefined),
      consultationFee: 'consultationFee' in appointment && appointment.consultationFee != null
        ? Number(appointment.consultationFee)
        : Number(
          ('final_fee' in appointment ? appointment.final_fee : undefined)
          ?? ('total_amount' in appointment ? appointment.total_amount : undefined)
          ?? ('fee' in appointment ? appointment.fee : undefined)
          ?? ('consultation_fee' in appointment ? appointment.consultation_fee : undefined)
          ?? 0,
        ),
      billingStatus: 'billingStatus' in appointment ? appointment.billingStatus : ('billing_status' in appointment ? appointment.billing_status ?? undefined : undefined),
    });
    setActiveModal('appointmentPayment');
  };

  const submitAppointmentBooking = (action: AppointmentBookingAction) => {
    if (!appointmentPatient || !appointmentDoctorId) {
      toast.error(t('toast.selectPatientAndDoctor', { ns: 'reception' }));
      return;
    }
    if (appointmentTokenMode === 'manual' && !appointmentManualToken) {
      toast.error(t('appointments.forceTokenNoRequired', { ns: 'appointments', defaultValue: 'Enter a custom serial number.' }));
      return;
    }
    if (requireDiscountReferralName(Number(appointmentPreview?.originalFee ?? 0), Number(appointmentPreview?.discountAmount ?? 0), appointmentDiscountByName)) return;
    const appointmentPayableNow = Math.max(0, Number(appointmentPreview?.finalFee ?? 0));
    if (action === 'pay' && requiresPaymentReference(appointmentPaymentMethod, appointmentPayableNow) && !appointmentPaymentReference.trim()) {
      toast.error('Transaction/reference number is required for non-cash payments.');
      return;
    }
    if (action === 'pay' && !activeCounterSession) {
      toast.error(t('toast.activateBillingCounter', { ns: 'reception' }));
      queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        invalidateReceptionDashboardSnapshot();
      navigate(`${basePath}/billing-counter`);
      return;
    }
    appointmentBookingActionRef.current = action;
    createAppointmentMutation.mutate({
      patientId: appointmentPatient.id,
      doctorId: Number(appointmentDoctorId),
      apptDate: appointmentDate,
      apptTime: appointmentTime || undefined,
      visitType: appointmentType === 'emergency' ? 'emergency' : ['old_patient', 'follow_up', 'report_show'].includes(appointmentType) ? 'followup' : 'opd',
      appointmentType,
      discountAmount: appointmentType === 'free_visit' ? Number(appointmentPreview?.originalFee ?? 0) : Number(appointmentDiscount || 0),
      discountReason: appointmentDiscountReason || undefined,
      discountByName: appointmentDiscountByName.trim() || undefined,
      chiefComplaint: appointmentComplaint || undefined,
      source: appointmentSource,
      ...buildReceptionAppointmentTokenPayload(appointmentTokenMode, appointmentRequestedToken, appointmentManualToken),
    });
  };

  const activeReportShowAppointmentFor = (patientId?: number | null, doctorId?: number | null) => {
    if (!patientId || !doctorId) return null;
    return todayAppointments.find((appointment) => {
      const status = String(appointment.status ?? '').toLowerCase();
      return Number(appointment.patient_id) === Number(patientId)
        && Number(appointment.doctor_id) === Number(doctorId)
        && appointment.appointment_type === 'report_show'
        && !['cancelled', 'no_show', 'completed', 'concluded'].includes(status);
    }) ?? null;
  };
  const startReportShow = (patient?: Patient | null, doctorId?: number | null) => {
    if (!patient?.id || !doctorId) {
      toast.error(t('toast.reportShowNeedsPatientDoctor', { ns: 'reception' }));
      return;
    }
    const existing = activeReportShowAppointmentFor(patient.id, doctorId);
    if (existing) {
      const status = String(existing.status ?? '').toLowerCase();
      if (status === 'scheduled') {
        toast.success(t('toast.usingExistingSerial', { ns: 'reception' }));
        checkInAppointmentMutation.mutate({ id: existing.id });
        return;
      }
      toast.success(t('toast.reportShowActive', { ns: 'reception' }));
      queryClient.invalidateQueries({ queryKey: queryKeys.appointments.today() });
        invalidateReceptionDashboardSnapshot();
      queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
      return;
    }
    createReportShowAppointmentMutation.mutate({
      patientId: patient.id,
      doctorId: Number(doctorId),
      apptDate: date,
      visitType: 'followup',
      appointmentType: 'report_show',
      discountAmount: 0,
      chiefComplaint: 'Report show',
      source: 'walk_in',
    });
  };
  const openQuickServiceBill = (patient?: Patient | null, doctorId?: number | null) => {
    resetQuickBill();
    if (patient) {
      setQuickBillPatient(patient);
      setQuickBillPatientSearch(patient.name);
    }
    setQuickBillDoctorId(doctorId ? Number(doctorId) : '');
    setQuickBillDoctorTouched(Boolean(doctorId));
    setQuickBillReferrerType(doctorId ? 'doctor' : 'self');
    setActiveModal('quickServiceBill');
  };
  const openIpdAdmission = (patient?: Patient | null, doctorId?: number | null) => {
    setAdmissionPatient(patient ?? null);
    setAdmissionPatientSearch(patient?.name ?? '');
    setAdmissionDoctorId(doctorId ? Number(doctorId) : '');
    setAdmissionBedId('');
    setAdmissionFee('');
    setAdmissionDeposit('');
    setAdmissionReason('');
    setAdmissionPackageId('');
    setAdmissionBillingMode('regular');
    setActiveModal('ipdAdmission');
  };

  const openAdmissionBillingModal = (row: any) => {
    const admissionId = getAdmissionFlowAdmissionId(row);
    const patientId = getAdmissionFlowPatientId(row);
    if (!admissionId || !patientId) {
      toast.error('Admission billing data is missing');
      return;
    }
    setProvisionalBillingPrefill({ admissionId, patientId });
    setActiveModal('provisionalBilling');
  };

  const openAdmissionRunningBillPrint = (row: any) => {
    const admissionId = getAdmissionFlowAdmissionId(row);
    if (!admissionId) {
      toast.error('Admission id is missing');
      return;
    }
    window.open(getIpdRunningBillPrintPath(basePath, admissionId), '_blank', 'noopener,noreferrer');
  };

  const openAdmissionDischargeSummary = (row: any) => {
    const admissionId = getAdmissionFlowAdmissionId(row);
    if (!admissionId) {
      toast.error('Admission id is missing');
      return;
    }
    window.open(`${basePath}/admissions/${admissionId}/discharge`, '_blank', 'noopener,noreferrer');
  };

  const openAdmissionWorkspace = (row: any) => {
    const admissionId = getAdmissionFlowAdmissionId(row);
    if (admissionId) {
      navigate(`${basePath}/admissions?admissionId=${encodeURIComponent(String(admissionId))}`);
      return;
    }
    navigate(`${basePath}/admissions`);
  };
  const pendingBillToBillRecord = pendingBillSummaryToBillRecord;

  const openPaymentForBill = (bill: BillRecord) => {
    const due = getBillOutstandingAmount(bill);
    setBatchPaymentBills([]);
    setPayBill(bill);
    setPayAmount(String(due));
    setActiveModal('none');
  };

  const openPaymentForBillBatch = (bills: BillRecord[]) => {
    const dueBills = bills
      .filter((bill) => getBillOutstandingAmount(bill) > 0)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (dueBills.length === 0) return;
    if (dueBills.length === 1) {
      openPaymentForBill(dueBills[0]);
      return;
    }
    const totalDue = dueBills.reduce((sum, bill) => sum + getBillOutstandingAmount(bill), 0);
    const settledTotal = dueBills.reduce((sum, bill) => sum + getBillSettledAmount(bill), 0);
    setBatchPaymentBills(dueBills);
    setBatchPaymentIdempotencyKey('reception-batch-due-' + crypto.randomUUID());
    setPayBill({
      ...dueBills[0],
      invoice_no: dueBills.length + ' invoices',
      total: dueBills.reduce((sum, bill) => sum + getBillTotalAmount(bill), 0),
      paid: settledTotal,
      paid_amount: settledTotal,
      settled_amount: settledTotal,
      due: totalDue,
      outstanding: totalDue,
      service_summary: 'Multiple invoices',
      item_count: dueBills.reduce((sum, bill) => sum + Number(bill.item_count ?? 0), 0),
    });
    setPayAmount(String(totalDue));
    setActiveModal('none');
  };

  const openPaymentForPendingBill = (bill: PendingBillSummary) => {
    openPaymentForBill(pendingBillToBillRecord(bill));
  };

  const openPaymentForDueRow = async (row: { patient?: { id?: number | null } | null; visit?: { id?: number | null; patient_id?: number | null } | null }) => {
    const patientId = Number(row.patient?.id ?? row.visit?.patient_id ?? 0);
    const visitId = Number(row.visit?.id ?? 0);
    if (!patientId || !visitId) return;
    try {
      const response = await api.get<{ data: PendingBillSummary[] }>(
        '/api/billing-counter/pending-bills?limit=100' + pendingBillDateParam + '&patient_id=' + patientId + '&visit_id=' + visitId,
      );
      openPaymentForBillBatch((response.data ?? []).map(pendingBillToBillRecord));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load due invoices');
    }
  };
  const openPendingLabOrder = (order: PendingPrescriptionLabOrder) => {
    setSelectedPendingLabOrder(order);
    setSelectedPendingLabItemIds(order.items.map((item) => item.id));
    setPendingLabPaymentMethod('cash');
    setActiveModal('pendingLabOrder');
  };
  const selectedPendingLabItems = selectedPendingLabOrder?.items.filter((item) => selectedPendingLabItemIds.includes(item.id)) ?? [];
  const selectedPendingLabTotal = selectedPendingLabItems.reduce((sum, item) => sum + Number(item.lineTotal ?? 0), 0);
  const togglePendingLabItem = (itemId: number) => {
    setSelectedPendingLabItemIds((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
    );
  };
  const dashboardPendingEntries = useMemo(() => (dashboardPendingWorklistData?.data ?? []).map((row) => {
    const sourceId = Number(row.source_id);
    const amount = Number(row.amount ?? 0);
    if (row.source_type === 'bill') {
      const bill: PendingBillSummary = {
        bill_id: Number(row.bill_id ?? sourceId),
        invoice_no: row.invoice_no ?? null,
        patient_id: row.patient_id ?? null,
        visit_id: row.visit_id ?? null,
        patient_name: row.patient_name ?? `Bill #${sourceId}`,
        patient_code: row.patient_code ?? null,
        pending_amount: amount,
        status: row.billing_status ?? null,
        created_at: row.occurred_at ?? '',
        service_summary: row.service_summary ?? null,
        doctor_name: row.doctor_name ?? null,
        created_by_name: row.created_by_name ?? null,
      };
      return {
        key: `bill-${sourceId}`,
        type: 'bill' as const,
        patientName: bill.patient_name,
        subtitle: `${bill.invoice_no ?? `Bill #${bill.bill_id}`} - ${getBillServiceLabel(bill)}`,
        meta: `${formatDate(bill.created_at)}${bill.created_by_name ? ` - added by ${bill.created_by_name}` : ''}`,
        amount,
        action: () => openPaymentForPendingBill(bill),
      };
    }

    if (row.source_type === 'appointment') {
      return {
        key: `appointment-${sourceId}`,
        type: 'appointment' as const,
        patientName: row.patient_name ?? `Appointment #${sourceId}`,
        subtitle: `${row.doctor_name ?? 'Doctor'}${row.appt_time ? ` - ${row.appt_time}` : ''}`,
        meta: row.occurred_at ? `${formatDate(row.occurred_at)} - consultation entry` : 'Consultation entry',
        amount,
        action: () => openAppointmentPaymentModal({
          id: Number(row.appointment_id ?? sourceId),
          tokenNo: row.token_no ? Number(row.token_no) : undefined,
          consultationFee: amount,
          billingStatus: row.billing_status ?? 'pending',
        }),
      };
    }

    const visit = visits.find((item) => Number(item.id) === Number(row.visit_id ?? sourceId)) ?? {
      id: Number(row.visit_id ?? sourceId),
      patient_id: Number(row.patient_id ?? 0),
      patient_name: row.patient_name ?? `Visit #${sourceId}`,
      patient_code: row.patient_code ?? undefined,
      doctor_id: row.doctor_id ?? undefined,
      doctor_name: row.doctor_name ?? undefined,
      visit_date: row.occurred_at ?? undefined,
      pending_doctor_visit_amount: amount,
    };
    return {
      key: `visit-${sourceId}`,
      type: 'appointment' as const,
      patientName: row.patient_name ?? `Visit #${sourceId}`,
      subtitle: `${row.doctor_name ?? 'Doctor'} - Consultation`,
      meta: row.occurred_at ? `${formatDate(row.occurred_at)} - consultation entry` : 'Consultation entry',
      amount,
      action: () => {
        setSelectedVisit(visit as Visit);
        setBillDiscount(0);
        setBillDiscountByName('');
        setActiveModal('generateBill');
      },
    };
  }), [dashboardPendingWorklistData?.data, visits]);
  const pendingDuePagination = dashboardPendingWorklistData?.pagination ?? {
    page: pendingDuePage,
    limit: 8,
    total: dashboardPendingEntries.length,
    pages: dashboardPendingEntries.length > 0 ? 1 : 0,
  };
  useEffect(() => {
    if (pendingDuePagination.pages > 0 && pendingDuePage > pendingDuePagination.pages) {
      setPendingDuePage(pendingDuePagination.pages);
    }
  }, [pendingDuePage, pendingDuePagination.pages]);
  const admissionFlowRows = useMemo<any[]>(() => {
    if (!showAdmittedPatients) return [];
    const relevantAdmissions = (admittedFlowData?.admissions ?? []).filter((admission) => shouldIncludeAdmissionInReceptionFlow(admission, date));
    const rows = buildAdmittedPatientFlowRows(dedupeAdmissionsForReceptionFlow(relevantAdmissions));
    return hideCompletedFlow ? rows.filter((row) => !isCompletedReceptionFlowStatus(row.status)) : rows;
  }, [admittedFlowData?.admissions, date, hideCompletedFlow, showAdmittedPatients]);

  const receptionFlowRows = useMemo<any[]>(() => buildReceptionFlowDisplayRows({
    showAdmittedPatients,
    admissionFlowRows,
    visits,
    todayAppointments,
    hideCompletedFlow,
  }), [admissionFlowRows, hideCompletedFlow, showAdmittedPatients, todayAppointments, visits]);

  const filteredFlowRows = useMemo(
    () => filterReceptionFlowRowsByQuery(receptionFlowRows, flowSearch),
    [receptionFlowRows, flowSearch],
  );

  /* Paginated rows */
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredFlowRows.slice(start, start + pageSize);
  }, [filteredFlowRows, currentPage]);

  const totalPages = Math.ceil(filteredFlowRows.length / pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [date, flowSearch]);

  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  /* ── Visit creation form state ── */
  const [newVisitPatientId, setNewVisitPatientId] = useState<number | ''>('');
  const [newVisitDoctorId, setNewVisitDoctorId] = useState<number | ''>('');
  const [newVisitType, setNewVisitType] = useState<'opd' | 'emergency'>('opd');
  const [issueToken, setIssueToken] = useState(true);
  const [patientSearch, setPatientSearch] = useState('');
  const selectedNewVisitDoctor = newVisitDoctorId ? doctors.find(d => d.id === Number(newVisitDoctorId)) : undefined;
  const selectedDoctorFee = Number(selectedNewVisitDoctor?.consultation_fee ?? 0);
  const canAutoIssueToken = selectedDoctorFee <= 0;

  const filteredPatients = useMemo(() => {
    if (!patientSearch) return [];
    return patients.filter(p =>
      p.name.toLowerCase().includes(patientSearch.toLowerCase()) ||
      p.mobile?.includes(patientSearch) ||
      p.patient_code?.includes(patientSearch)
    ).slice(0, 8);
  }, [patientSearch, patients]);

  const appointmentPatientMatches = useMemo(() => {
    const q = appointmentPatientSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    const serverMatches = appointmentPatientLookupData?.patients ?? [];
    if (serverMatches.length > 0) return serverMatches.slice(0, 8);
    return patients.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.mobile?.includes(appointmentPatientSearch.trim()) ||
      p.patient_code?.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [appointmentPatientLookupData?.patients, appointmentPatientSearch, patients]);

  const appointmentGlobalPatientResults = useMemo(() => {
    if (appointmentPatientMatches.length > 0) return [];
    return globalPatientsData?.results ?? [];
  }, [appointmentPatientMatches.length, globalPatientsData?.results]);

  const openNewPatientFromSearch = (term: string, options?: { familyMobile?: string; guardianName?: string; returnModal?: typeof activeModal }) => {
    const mobileSource = options?.familyMobile ?? term;
    const digits = mobileSource.replace(/\D/g, '');
    const familyMobile = options?.familyMobile ?? (digits.length >= 6 ? mobileSource : '');
    setCreateAsFamilyMember(Boolean(options?.familyMobile));
    setNewPatientReturnModal(options?.returnModal ?? 'appointment');
    setNewPatientForm({
      ...EMPTY_NEW_PATIENT_FORM,
      name: options?.familyMobile ? '' : (digits.length >= 6 ? '' : term),
      mobile: familyMobile,
      guardianMobile: familyMobile,
      fatherHusband: options?.guardianName ?? '',
    });
    setActiveModal('newPatient');
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedPatient = params.get('newPatient');
    if (!requestedPatient) return;
    const familyMobile = params.get('familyMobile') ?? undefined;
    const guardianName = params.get('guardianName') ?? undefined;
    openNewPatientFromSearch(requestedPatient, familyMobile ? { familyMobile, guardianName } : undefined);
    params.delete('newPatient');
    params.delete('familyMobile');
    params.delete('guardianName');
    const query = params.toString();
    navigate(query ? `${window.location.pathname}?${query}` : window.location.pathname, { replace: true });
  }, []);

  const newPatientPossibleMatches = useMemo(() => {
    const mobile = newPatientForm.mobile.trim();
    const name = newPatientForm.name.trim().toLowerCase();
    if (mobile.length < 2 && name.length < 2) return [];
    const localLookupPatients = newPatientLocalLookupData?.patients ?? patients;
    return localLookupPatients.filter((patient) =>
      (mobile.length >= 2 && patient.mobile?.includes(mobile))
      || (name.length >= 2 && patient.name.toLowerCase().includes(name))
    ).slice(0, 5);
  }, [newPatientForm.mobile, newPatientForm.name, newPatientLocalLookupData?.patients, patients]);
  const newPatientFamilyMatches = useMemo(() => {
    const mobile = normalizeMobileForCompare(newPatientForm.mobile);
    if (!mobile) return [];
    return (newPatientLocalLookupData?.patients ?? patients)
      .filter((patient) => normalizeMobileForCompare(patient.mobile) === mobile)
      .slice(0, 8);
  }, [newPatientForm.mobile, newPatientLocalLookupData?.patients, patients]);

  const newPatientGlobalMatches = newPatientGlobalLookupData?.results ?? [];

  const quickBillPatientMatches = useMemo(() => {
    const q = quickBillPatientSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    const sourcePatients = quickBillPatientLookupData?.patients ?? patients;
    return sourcePatients.filter((patient) =>
      patient.name.toLowerCase().includes(q)
      || patient.mobile?.includes(quickBillPatientSearch.trim())
      || patient.patient_code?.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [patients, quickBillPatientLookupData?.patients, quickBillPatientSearch]);

  const defaultReferringDoctorIdForPatient = (patientId: number): number | '' => {
    const appointmentDoctorIdForPatient = todayAppointments.find((appointment) =>
      Number(appointment.patient_id) === Number(patientId) && appointment.doctor_id
    )?.doctor_id;
    if (appointmentDoctorIdForPatient) return Number(appointmentDoctorIdForPatient);

    const visitDoctorIdForPatient = visits.find((visit) =>
      Number(visit.patient_id) === Number(patientId) && visit.doctor_id
    )?.doctor_id;
    return visitDoctorIdForPatient ? Number(visitDoctorIdForPatient) : '';
  };

  const resetQuickBillReferralForPatient = (patient: Patient) => {
    const defaultDoctorId = defaultReferringDoctorIdForPatient(patient.id);
    setQuickBillDoctorId(defaultDoctorId);
    setQuickBillDoctorTouched(false);
    setQuickBillReferrerType(defaultDoctorId ? 'doctor' : 'self');
    setQuickBillExtRefDoctorId('');
    setQuickBillExtRefDoctorSearch('');
    setShowQuickBillNewExtRefForm(false);
    setQuickBillReferrerHospital(null);
    setQuickBillOtherReferrerName('');
    setQuickBillDoctorWaiverAmount(0);
    setQuickBillDoctorWaiverLoading(false);
    setQuickBillDiscountSources((current) => current.filter((row) => row.reason !== 'doctor_commission_waiver'));
  };

  const selectQuickBillPatient = (patient: Patient) => {
    setQuickBillPatient(patient);
    setQuickBillPatientSearch(patient.name);
    resetQuickBillReferralForPatient(patient);
    setQuickBillDepositDeducted('');
  };

  function selectPatientForReturnFlow(patient: Patient, returnModal: typeof activeModal = newPatientReturnModal) {
    if (returnModal === 'quickServiceBill') {
      selectQuickBillPatient(patient);
      setActiveModal('quickServiceBill');
      return;
    }

    if (returnModal === 'ipdAdmission') {
      setAdmissionPatient(patient);
      setAdmissionPatientSearch('');
      setActiveModal('ipdAdmission');
      return;
    }

    setAppointmentPatient(patient);
    setAppointmentPatientSearch('');
    setNewVisitPatientId(patient.id);
    setPatientSearch(returnModal === 'newVisit' ? '' : patient.name);
    setActiveModal(returnModal === 'none' || returnModal === 'newPatient' ? 'appointment' : returnModal);
  }

  useEffect(() => {
    if (activeModal !== 'appointment' || appointmentType !== 'report_show' || !appointmentPatient || appointmentDoctorId) return;
    const defaultDoctorId = defaultReferringDoctorIdForPatient(appointmentPatient.id);
    if (defaultDoctorId) {
      setAppointmentDoctorId(defaultDoctorId);
    }
  }, [activeModal, appointmentDoctorId, appointmentPatient, appointmentType, todayAppointments, visits]);

  useEffect(() => {
    const selectedDoctor = doctors.find((doctor) => doctor.id === Number(appointmentDoctorId));
    if (!appointmentDoctorId || !selectedDoctor) {
      setAppointmentPreview(null);
      return;
    }

    let cancelled = false;
    setAppointmentPreviewLoading(true);
    const params = new URLSearchParams({
      doctorId: String(appointmentDoctorId),
      appointmentType,
      discountAmount: appointmentDiscount || '0',
    });
    if (appointmentPatient?.id) params.set('patientId', String(appointmentPatient.id));
    if (appointmentDate) params.set('apptDate', appointmentDate);
    api.get<AppointmentFeePreviewResponse>(`/api/appointments/fee-preview?${params}`)
      .then((response) => {
        if (!cancelled) setAppointmentPreview(response.charge);
      })
      .catch(() => {
        if (cancelled) return;
        const originalFee = appointmentType === 'report_show' ? 0 : Number(selectedDoctor.consultation_fee ?? 0);
        const discountAmount = appointmentType === 'free_visit'
          ? originalFee
          : Math.min(Number(appointmentDiscount || 0), originalFee);
        setAppointmentPreview({
          appointmentType,
          originalFee,
          discountAmount,
          finalFee: Math.max(0, originalFee - discountAmount),
          billingStatus: Math.max(0, originalFee - discountAmount) > 0 ? 'pending' : 'paid',
        });
      })
      .finally(() => {
        if (!cancelled) setAppointmentPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [appointmentDate, appointmentDiscount, appointmentDoctorId, appointmentPatient?.id, appointmentType, doctors]);

  const { data: availableTokensData, isLoading: availableTokensLoading } = useApiQuery<TokenReservationAvailabilityResponse>(
    queryKeys.tokenReservations.available({ date: appointmentDate, doctorId: String(appointmentDoctorId || '') }),
    `/api/reception/token-reservations/available?date=${appointmentDate}&doctorId=${appointmentDoctorId || ''}`,
    { enabled: activeModal === 'appointment' && !!appointmentDoctorId },
  );
  const availableTokens = useMemo(() => (availableTokensData?.tokens ?? availableTokensData?.available ?? [])
    .map((token) => ({
      token_no: Number(token.token_no ?? token.token),
      label: token.label ?? null,
    }))
    .filter((token) => Number.isInteger(token.token_no) && token.token_no > 0), [availableTokensData?.available, availableTokensData?.tokens]);
  const tokenAvailabilitySummary = availableTokensData?.summary;
  const bookedTokenNumbers = useMemo(() => new Set((availableTokensData?.bookedTokens ?? availableTokensData?.booked ?? [])
    .map((token) => typeof token === 'number' ? token : Number(token.token_no ?? token.token))
    .filter((tokenNo) => Number.isInteger(tokenNo) && tokenNo > 0)), [availableTokensData?.booked, availableTokensData?.bookedTokens]);
  const reservedAvailableTokenNumbers = useMemo(() => new Set(availableTokens.map((token) => token.token_no)), [availableTokens]);
  const tokenStripNumbers = useMemo(() => {
    const nextRegular = Number(tokenAvailabilitySummary?.nextRegularTokenNo ?? 1);
    const current = Number(tokenAvailabilitySummary?.currentTokenNo ?? 0);
    const maxReserved = availableTokens.reduce((max, token) => Math.max(max, token.token_no), 0);
    const maxBooked = Array.from(bookedTokenNumbers).reduce((max, tokenNo) => Math.max(max, tokenNo), 0);
    const end = Math.max(20, Math.min(40, Math.max(nextRegular + 6, current + 6, maxReserved, maxBooked)));
    return Array.from({ length: end }, (_, index) => index + 1);
  }, [availableTokens, bookedTokenNumbers, tokenAvailabilitySummary?.currentTokenNo, tokenAvailabilitySummary?.nextRegularTokenNo]);

  useEffect(() => {
    if (!appointmentRequestedToken) return;
    if (appointmentTokenMode !== 'reserved') return;
    if (availableTokens.some((token) => token.token_no === appointmentRequestedToken)) return;
    setAppointmentRequestedToken('');
  }, [appointmentRequestedToken, appointmentTokenMode, availableTokens]);

  /* ── Service add form state ── */
  const [selectedServiceLines, setSelectedServiceLines] = useState<QuickBillLine[]>([]);
  const [selectedServiceDoctorId, setSelectedServiceDoctorId] = useState<number | ''>('');
  const [selectedServicePerformerDoctorId, setSelectedServicePerformerDoctorId] = useState<number | ''>('');
  const [selectedServicePerformerDoctorSearch, setSelectedServicePerformerDoctorSearch] = useState('');
  const filteredQuickBillPerformerDoctors = useMemo(() => {
    const query = quickBillPerformerDoctorSearch.trim().toLowerCase();
    if (!query) return performerDoctors;
    return performerDoctors.filter((doctor) => `${doctor.name} ${doctor.specialty ?? ''}`.toLowerCase().includes(query));
  }, [performerDoctors, quickBillPerformerDoctorSearch]);
  const filteredSelectedServicePerformerDoctors = useMemo(() => {
    const query = selectedServicePerformerDoctorSearch.trim().toLowerCase();
    if (!query) return performerDoctors;
    return performerDoctors.filter((doctor) => `${doctor.name} ${doctor.specialty ?? ''}`.toLowerCase().includes(query));
  }, [performerDoctors, selectedServicePerformerDoctorSearch]);
  const [serviceDiscount, setServiceDiscount] = useState('');
  const [serviceDiscountByName, setServiceDiscountByName] = useState('');
  const [serviceAdvancedDiscount, setServiceAdvancedDiscount] = useState(false);
  const [serviceDiscountSources, setServiceDiscountSources] = useState<DiscountAllocationRow[]>([]);
  const [serviceDoctorWaiverAmount, setServiceDoctorWaiverAmount] = useState(0);
  const [serviceDoctorWaiverLoading, setServiceDoctorWaiverLoading] = useState(false);
  const [serviceSchemeCodeInput, setServiceSchemeCodeInput] = useState('');
  const [serviceMemberCodeInput, setServiceMemberCodeInput] = useState('');
  const [serviceSchemePreview, setServiceSchemePreview] = useState<SchemePreviewResponse | null>(null);
  const [servicePaymentMethod, setServicePaymentMethod] = useState('cash');
  const [servicePaymentReference, setServicePaymentReference] = useState('');
  const [visitServiceBillIdempotencyKey, setVisitServiceBillIdempotencyKey] = useState(() => 'visit-service-bill-' + crypto.randomUUID());
  const [serviceSearch, setServiceSearch] = useState('');
  const [serviceSearchDebounced, setServiceSearchDebounced] = useState('');
  const [selectedServiceDept, setSelectedServiceDept] = useState<number | ''>('');
  const [selectedServiceCategory, setSelectedServiceCategory] = useState('');
  const [serviceDepositDeducted, setServiceDepositDeducted] = useState('');
  const [serviceCashPaid, setServiceCashPaid] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setServiceSearchDebounced(serviceSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [serviceSearch]);

  const modalServiceSearch = activeModal === 'quickServiceBill' ? quickBillSearchDebounced : serviceSearchDebounced;
  const modalServiceDept = activeModal === 'quickServiceBill' ? quickBillDept : selectedServiceDept;
  const modalServicePath = `/api/reception/services?limit=200${modalServiceSearch ? `&search=${encodeURIComponent(modalServiceSearch)}` : ''}${modalServiceDept ? `&department_id=${modalServiceDept}` : ''}`;
  const { data: modalServicesData, isFetching: modalServicesLoading } = useApiQuery<{ services: ServiceItem[] }>(
    ['reception', 'modal-services', activeModal, modalServiceSearch, modalServiceDept],
    modalServicePath,
    { enabled: activeModal === 'addService' || activeModal === 'quickServiceBill' },
  );
  const modalServiceItems = modalServicesData?.services ?? serviceItems;
  const serviceCategoryOptions = useMemo(() => {
    const names = new Set<string>();
    modalServiceItems.forEach((service) => {
      if (selectedServiceDept && Number(service.service_department_id) !== Number(selectedServiceDept)) return;
      const category = service.category_name?.trim();
      if (category) names.add(category);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [modalServiceItems, selectedServiceDept]);

  const filteredServices = useMemo(() => {
    let list = modalServiceItems;
    if (selectedServiceDept) {
      const selectedDeptName = serviceDepts.find((dept) => dept.id === Number(selectedServiceDept))?.department_name?.toLowerCase();
      list = list.filter((service) =>
        Number(service.service_department_id) === Number(selectedServiceDept)
        || (selectedDeptName ? service.department_name?.toLowerCase() === selectedDeptName : false)
      );
    }
    if (selectedServiceCategory) {
      list = list.filter((service) => service.category_name === selectedServiceCategory);
    }
    if (serviceSearch) {
      const q = serviceSearch.toLowerCase();
      list = list.filter(s => s.item_name.toLowerCase().includes(q) || s.item_code?.toLowerCase().includes(q) || s.category_name?.toLowerCase().includes(q));
    }
    return list;
  }, [modalServiceItems, selectedServiceCategory, serviceDepts, selectedServiceDept, serviceSearch]);

  const filteredQuickBillServices = useMemo(() => {
    let list = modalServiceItems;
    if (quickBillDept) {
      const selectedDeptName = serviceDepts.find((dept) => dept.id === Number(quickBillDept))?.department_name?.toLowerCase();
      list = list.filter((service) =>
        Number(service.service_department_id) === Number(quickBillDept)
        || (selectedDeptName ? service.department_name?.toLowerCase() === selectedDeptName : false)
      );
    }
    if (quickBillSearch.trim()) {
      const query = quickBillSearch.trim().toLowerCase();
      list = list.filter((service) =>
        service.item_name.toLowerCase().includes(query)
        || service.item_code?.toLowerCase().includes(query)
        || service.department_name?.toLowerCase().includes(query)
      );
    }
    return list;
  }, [modalServiceItems, quickBillDept, quickBillSearch, serviceDepts]);

  const quickBillSubtotal = useMemo(() => quickBillLines.reduce((sum, line) => sum + (Number(line.price ?? 0) * line.quantity), 0), [quickBillLines]);
  const quickBillDiscount = Math.min(quickBillSubtotal, Math.max(0, Number(quickBillDiscountAmount || 0)));
  const quickBillTotal = Math.max(0, quickBillSubtotal - quickBillDiscount);
  const quickBillDiscountByNameRequired = discountReferralRequired(quickBillSubtotal, quickBillDiscount);
  const quickBillDepositBalance = Number(quickBillDepositBalanceData?.balance ?? 0);
  const quickBillDepositApplied = Math.min(quickBillDepositBalance, quickBillTotal, Math.max(0, Number(quickBillDepositDeducted || 0)));
  const quickBillPayableNow = Math.max(0, quickBillTotal - quickBillDepositApplied);
  const quickBillCashPaid = Math.min(quickBillPayableNow, Math.max(0, Number(quickBillPaidAmount || 0)));
  const quickBillDueAfterPayment = Math.max(0, quickBillTotal - quickBillDepositApplied - quickBillCashPaid);
  const quickBillReferrerName = quickBillReferrerType === 'doctor' && quickBillExtRefDoctorId
    ? extRefDoctors.find((doctor) => doctor.id === quickBillExtRefDoctorId)?.name ?? ''
    : quickBillReferrerType === 'other'
      ? quickBillOtherReferrerName.trim()
      : '';
  const quickBillSuggestedSchemeDiscount = Math.min(Number(quickBillSchemePreview?.suggested_discount ?? 0), quickBillSubtotal);
  const quickBillHasEligibleSchemePreview = Boolean(quickBillSchemePreview?.eligible && quickBillSuggestedSchemeDiscount > 0 && quickBillDiscount > 0);
  const quickBillDoctorWaiverDoctorId = quickBillReferrerType === 'doctor' && quickBillDoctorId ? Number(quickBillDoctorId) : null;
  const quickBillDoctorWaiverDoctorName = quickBillDoctorWaiverDoctorId
    ? doctors.find(({ id }) => Number(id) === quickBillDoctorWaiverDoctorId)?.name ?? ''
    : '';

  useEffect(() => {
    let cancelled = false;
    if (quickBillHasEligibleSchemePreview || quickBillDiscount <= 0 || !quickBillDoctorWaiverDoctorId || quickBillLines.length === 0) {
      setQuickBillDoctorWaiverAmount(0);
      setQuickBillDoctorWaiverLoading(false);
      return;
    }

    setQuickBillDoctorWaiverAmount(0);
    setQuickBillDoctorWaiverLoading(true);
    api.post<{ doctorWaiverAmount?: number }>('/api/tenant/discounts/doctor-waiver-preview', {
      doctorId: quickBillDoctorWaiverDoctorId,
      totalDiscount: quickBillDiscount,
      items: allocateServiceDiscounts(quickBillLines, quickBillDiscount).map((line) => {
        const quantity = Number(line.quantity ?? 1);
        const grossLineTotal = Number(line.price ?? 0) * quantity;
        return {
          itemCategory: line.is_lab_catalog === 1 ? 'lab' : line.is_radiology === 1 ? 'radiology' : 'service',
          description: line.item_name,
          lineTotal: Math.max(0, grossLineTotal - Number(line.allocatedDiscount ?? 0)),
          grossLineTotal,
          quantity,
          referenceId: line.id,
          labTestId: line.is_lab_catalog === 1 ? line.id : undefined,
        };
      }),
    })
      .then((preview) => {
        if (!cancelled) {
          setQuickBillDoctorWaiverAmount(Number(preview.doctorWaiverAmount ?? 0));
          setQuickBillDoctorWaiverLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQuickBillDoctorWaiverAmount(0);
          setQuickBillDoctorWaiverLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [quickBillDiscount, quickBillDoctorWaiverDoctorId, quickBillHasEligibleSchemePreview, quickBillLines]);

  const submitQuickBillSchemeCheck = () => {
    const schemeCode = quickBillSchemeCodeInput.trim();
    const memberCode = quickBillMemberCodeInput.trim();
    if (!schemeCode && !memberCode) {
      toast.error('Enter a scheme or member code.');
      return;
    }
    if (!quickBillPatient) {
      toast.error(t('toast.selectPatient', { ns: 'reception' }));
      return;
    }
    if (quickBillSubtotal <= 0) {
      toast.error('Add services before checking scheme benefit.');
      return;
    }
    checkQuickBillSchemePreviewMutation.mutate({
      patient_id: quickBillPatient.id,
      scheme_code: schemeCode || undefined,
      member_code: memberCode || undefined,
      service_category: 'quick_service_bill',
      subtotal: quickBillSubtotal,
    });
  };

  const applyQuickBillSchemeDiscount = () => {
    if (!quickBillSchemePreview?.eligible || quickBillSuggestedSchemeDiscount <= 0) {
      toast.error(quickBillSchemePreview?.blockers?.[0] || 'No eligible scheme benefit to apply.');
      return;
    }
    const reason = reasonForDiscountSource(quickBillSchemePreview.allocation_type);
    setQuickBillDiscountAmount(String(quickBillSuggestedSchemeDiscount));
    setQuickBillAdvancedDiscount(true);
    setQuickBillDiscountSources([{ id: crypto.randomUUID(), reason, amount: String(quickBillSuggestedSchemeDiscount), note: 'Scheme: ' + (quickBillSchemePreview.scheme_name ?? 'Benefit') }]);
    if (quickBillSchemePreview.requires_reference && !quickBillDiscountByName.trim()) {
      setQuickBillDiscountByName(quickBillSchemePreview.matched_member_name || quickBillSchemePreview.matched_member_code || quickBillSchemePreview.scheme_name || 'Scheme benefit');
    }
  };

  const submitQuickServiceBill = (mode: 'draft' | 'payNow') => {
    if (!quickBillPatient) {
      toast.error(t('toast.selectPatient', { ns: 'reception' }));
      return;
    }
    if (requireDiscountReferralName(quickBillSubtotal, quickBillDiscount, quickBillDiscountByName)) return;
    if (quickBillDoctorWaiverLoading && quickBillDiscountSources.some((row) => row.reason === 'doctor_commission_waiver')) {
      toast.error('Wait for the doctor commission preview to finish.');
      return;
    }
    if (quickBillAdvancedDiscount && !hasBalancedDiscountAllocations(quickBillDiscount, quickBillDiscountSources)) {
      toast.error('Advanced discount source total must match discount amount.');
      return;
    }
    const quickBillDiscountAllocationPayload = getDiscountAllocationPayload(quickBillDiscount, quickBillAdvancedDiscount, quickBillDiscountSources);
    if (quickBillReferrerType === 'doctor' && !quickBillDoctorId && !quickBillExtRefDoctorId) {
      toast.error('Select an in-hospital or external referring doctor.');
      return;
    }
    if (quickBillReferrerType === 'hospital' && !quickBillReferrerHospital) {
      toast.error('Select a referral hospital.');
      return;
    }
    if (quickBillReferrerType === 'other' && !quickBillReferrerName) {
      toast.error('Enter the referrer name or source.');
      return;
    }

    const paidAmount = mode === 'payNow' ? quickBillPayableNow : quickBillCashPaid;
    if (requiresPaymentReference(quickBillPaymentMethod, paidAmount) && !quickBillPaymentReference.trim()) {
      toast.error('Transaction/reference number is required for non-cash payments.');
      return;
    }
    const depositDeducted = quickBillDepositApplied;
    const creditAmount = Math.max(0, quickBillTotal - depositDeducted - paidAmount);

    createQuickServiceBillMutation.mutate({
      patientId: quickBillPatient.id,
      createWalkInVisit: true,
      billMode: (depositDeducted + paidAmount) > 0 ? 'paid' : 'credit',
      referredByType: quickBillReferrerType,
      referrerSelectionSource: quickBillReferrerType === 'doctor' && quickBillDoctorId
        ? (quickBillDoctorTouched ? 'manual' : 'patient_context')
        : undefined,
      referringDoctorId: quickBillReferrerType === 'doctor' && quickBillDoctorId ? Number(quickBillDoctorId) : undefined,
      referredByHospitalId: quickBillReferrerType === 'hospital' ? quickBillReferrerHospital?.id : undefined,
      referredByName: quickBillReferrerName || undefined,
      discountByName: quickBillDiscountByName.trim() || undefined,
      schemeApplication: quickBillSchemePreview?.eligible && quickBillDiscount > 0 ? {
        schemeId: quickBillSchemePreview.scheme_id ?? undefined,
        schemeCode: (quickBillSchemePreview.scheme_code ?? quickBillSchemeCodeInput.trim()) || undefined,
        memberCode: (quickBillSchemePreview.matched_member_code ?? quickBillMemberCodeInput.trim()) || undefined,
        memberId: quickBillSchemePreview.matched_member_id ?? undefined,
        serviceCategory: quickBillSchemePreview.service_category ?? 'quick_service_bill',
        allocationType: reasonForDiscountSource(quickBillSchemePreview.allocation_type),
        suggestedDiscount: quickBillSchemePreview.suggested_discount,
      } : undefined,
      discountAllocations: quickBillDiscountAllocationPayload,
      idempotencyKey: quickBillIdempotencyKey,
      items: allocateServiceDiscounts(quickBillLines, quickBillDiscount).map((line) => ({
        serviceItemId: line.id,
        quantity: line.quantity,
        discountAmount: line.allocatedDiscount,
        performerDoctorId: line.performerDoctorId ? Number(line.performerDoctorId) : quickBillPerformerDoctorId ? Number(quickBillPerformerDoctorId) : undefined,
        prescriberDoctorId: quickBillReferrerType === 'doctor' && quickBillDoctorId ? Number(quickBillDoctorId) : undefined,
      })),
      payment: {
        paymentMethod: quickBillPaymentMethod,
        paidAmount,
        depositDeducted,
        creditAmount,
        externalTransactionId: normalizeExternalTransactionId(quickBillPaymentMethod, paidAmount, quickBillPaymentReference),
      },
    });
  };


  const selectedServicesSubtotal = useMemo(
    () => selectedServiceLines.reduce((sum, line) => sum + (Number(line.price ?? 0) * Number(line.quantity ?? 1)), 0),
    [selectedServiceLines],
  );
  const serviceDiscountAmount = Math.min(selectedServicesSubtotal, Math.max(0, Number(serviceDiscount || 0)));
  const selectedServicesGrandTotal = Math.max(0, selectedServicesSubtotal - serviceDiscountAmount);
  const serviceDiscountByNameRequired = discountReferralRequired(selectedServicesSubtotal, serviceDiscountAmount);
  const selectedServicesDepositBalance = Number(selectedVisitDepositBalanceData?.balance ?? 0);
  const selectedServicesPaymentDraft = calculateVisitServicePaymentDraft({
    grandTotal: selectedServicesGrandTotal,
    depositBalance: selectedServicesDepositBalance,
    depositRequested: serviceDepositDeducted,
    payNowInput: serviceCashPaid,
  });
  const selectedServicesDepositApplied = selectedServicesPaymentDraft.depositApplied;
  const selectedServicesPayableNow = selectedServicesPaymentDraft.payableNow;
  const selectedServicesCashPaid = selectedServicesPaymentDraft.cashPaid;
  const selectedServicesDueAfterPayment = selectedServicesPaymentDraft.dueAfterPayment;
  const selectedServicesSuggestedSchemeDiscount = Math.min(Number(serviceSchemePreview?.suggested_discount ?? 0), selectedServicesSubtotal);
  const serviceHasEligibleSchemePreview = Boolean(serviceSchemePreview?.eligible && selectedServicesSuggestedSchemeDiscount > 0 && serviceDiscountAmount > 0);
  const serviceDoctorWaiverDoctorId = selectedServiceDoctorId ? Number(selectedServiceDoctorId) : null;
  const serviceDoctorWaiverDoctorName = serviceDoctorWaiverDoctorId
    ? doctors.find(({ id }) => Number(id) === serviceDoctorWaiverDoctorId)?.name ?? ''
    : '';

  useEffect(() => {
    let cancelled = false;
    if (serviceHasEligibleSchemePreview || serviceDiscountAmount <= 0 || !serviceDoctorWaiverDoctorId || selectedServiceLines.length === 0) {
      setServiceDoctorWaiverAmount(0);
      setServiceDoctorWaiverLoading(false);
      return;
    }

    setServiceDoctorWaiverAmount(0);
    setServiceDoctorWaiverLoading(true);
    api.post<{ doctorWaiverAmount?: number }>('/api/tenant/discounts/doctor-waiver-preview', {
      doctorId: serviceDoctorWaiverDoctorId,
      totalDiscount: serviceDiscountAmount,
      items: allocateServiceDiscounts(selectedServiceLines, serviceDiscountAmount).map((line) => {
        const quantity = Number(line.quantity ?? 1);
        const grossLineTotal = Number(line.price ?? 0) * quantity;
        return {
          itemCategory: line.is_lab_catalog === 1 ? 'lab' : line.is_radiology === 1 ? 'radiology' : 'service',
          description: line.item_name,
          lineTotal: Math.max(0, grossLineTotal - Number(line.allocatedDiscount ?? 0)),
          grossLineTotal,
          quantity,
          referenceId: line.id,
          labTestId: line.is_lab_catalog === 1 ? line.id : undefined,
        };
      }),
    })
      .then((preview) => {
        if (!cancelled) {
          setServiceDoctorWaiverAmount(Number(preview.doctorWaiverAmount ?? 0));
          setServiceDoctorWaiverLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setServiceDoctorWaiverAmount(0);
          setServiceDoctorWaiverLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [serviceDiscountAmount, serviceDoctorWaiverDoctorId, serviceHasEligibleSchemePreview, selectedServiceLines]);

  const submitVisitServiceSchemeCheck = () => {
    const schemeCode = serviceSchemeCodeInput.trim();
    const memberCode = serviceMemberCodeInput.trim();
    if (!schemeCode && !memberCode) {
      toast.error('Enter a scheme or member code.');
      return;
    }
    if (!selectedVisit) {
      toast.error('Select a visit first.');
      return;
    }
    if (selectedServicesSubtotal <= 0) {
      toast.error(t('toast.selectAtLeastOneService', { ns: 'reception' }));
      return;
    }
    checkVisitServiceSchemePreviewMutation.mutate({
      patient_id: selectedVisit.patient_id,
      scheme_code: schemeCode || undefined,
      member_code: memberCode || undefined,
      service_category: 'visit_service_bill',
      subtotal: selectedServicesSubtotal,
    });
  };

  const applyVisitServiceSchemeDiscount = () => {
    if (!serviceSchemePreview?.eligible || selectedServicesSuggestedSchemeDiscount <= 0) {
      toast.error(serviceSchemePreview?.blockers?.[0] || 'No eligible scheme benefit to apply.');
      return;
    }
    const reason = reasonForDiscountSource(serviceSchemePreview.allocation_type);
    setServiceDiscount(String(selectedServicesSuggestedSchemeDiscount));
    setServiceAdvancedDiscount(true);
    setServiceDiscountSources([{ id: crypto.randomUUID(), reason, amount: String(selectedServicesSuggestedSchemeDiscount), note: 'Scheme: ' + (serviceSchemePreview.scheme_name ?? 'Benefit') }]);
    if (serviceSchemePreview.requires_reference && !serviceDiscountByName.trim()) {
      setServiceDiscountByName(serviceSchemePreview.matched_member_name || serviceSchemePreview.matched_member_code || serviceSchemePreview.scheme_name || 'Scheme benefit');
    }
  };

  const toggleServiceSelection = (item: ServiceItem) => {
    setSelectedServiceLines((current) => {
      const existing = current.find((line) => line.id === item.id);
      if (existing) {
        return current.filter((line) => line.id !== item.id);
      }
      return [...current, { ...item, quantity: 1, discountAmount: 0 }];
    });
  };

  const updateSelectedServiceQty = (itemId: number, quantity: number) => {
    setSelectedServiceLines((current) => current.map((line) => (
      line.id === itemId ? { ...line, quantity: Math.max(1, Number(quantity) || 1) } : line
    )));
  };

  const bumpSelectedServiceQty = (itemId: number, delta: number) => {
    setSelectedServiceLines((current) => current.map((line) => (
      line.id === itemId ? { ...line, quantity: Math.max(1, Number(line.quantity ?? 1) + delta) } : line
    )));
  };

  function allocateServiceDiscounts(lines: QuickBillLine[], totalDiscount: number): Array<QuickBillLine & { allocatedDiscount: number }> {
    const discounts = allocateProportionalDiscounts(
      lines.map((line) => Number(line.price ?? 0) * Number(line.quantity ?? 1)),
      totalDiscount,
    );
    return lines.map((line, index) => ({ ...line, allocatedDiscount: discounts[index] ?? 0 }));
  }

  const resetQuickBill = () => {
    setQuickBillPatientSearch('');
    setQuickBillPatient(null);
    setQuickBillSearch('');
    setQuickBillDept('');
    setQuickBillLines([]);
    setQuickBillDoctorId('');
    setQuickBillDoctorTouched(false);
    setQuickBillReferrerType('self');
    setQuickBillReferrerHospital(null);
    setQuickBillOtherReferrerName('');
    setQuickBillPaymentMethod('cash');
    setQuickBillPaymentReference('');
    setQuickBillIdempotencyKey('dashboard-service-bill-' + crypto.randomUUID());
    setQuickBillPaidAmount('');
    setQuickBillDepositDeducted('');
    setQuickBillDiscountAmount('');
    setQuickBillDiscountByName('');
    setQuickBillAdvancedDiscount(false);
    setQuickBillDiscountSources([]);
    setQuickBillDoctorWaiverAmount(0);
    setQuickBillDoctorWaiverLoading(false);
    setQuickBillSchemeCodeInput('');
    setQuickBillMemberCodeInput('');
    setQuickBillSchemePreview(null);
    setQuickBillExtRefDoctorId('');
    setQuickBillExtRefDoctorSearch('');
    setShowQuickBillNewExtRefForm(false);
    setNewExtRefDoctorName('');
    setNewExtRefDoctorPhone('');
    setNewExtRefDoctorChamber('');
  };

  const addQuickBillItem = (item: ServiceItem) => {
    setQuickBillLines((current) => {
      const existing = current.find((line) => line.id === item.id);
      if (existing) {
        return current.map((line) => line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [...current, { ...item, quantity: 1, discountAmount: 0 }];
    });
  };

  /* ── Lab form state ── */
  const [selectedLabTests, setSelectedLabTests] = useState<number[]>([]);
  const [labDiscount, setLabDiscount] = useState(0);
  const [labNotes, setLabNotes] = useState('');

  /* ── Procedure form state ── */
  const [procName, setProcName] = useState('');
  const [procInstructions, setProcInstructions] = useState('');
  const [procServiceItemId, setProcServiceItemId] = useState<number | ''>('');
  const [procDiscount, setProcDiscount] = useState(0);

  /* ── Bill generation state ── */
  const [billDiscount, setBillDiscount] = useState(0);
  const [billDiscountByName, setBillDiscountByName] = useState('');
  const [billAdvancedDiscount, setBillAdvancedDiscount] = useState(false);
  const [billDiscountSources, setBillDiscountSources] = useState<DiscountAllocationRow[]>([]);
  const [billDoctorWaiverAmount, setBillDoctorWaiverAmount] = useState(0);
  const [billDoctorWaiverLoading, setBillDoctorWaiverLoading] = useState(false);
  const [billSchemeCodeInput, setBillSchemeCodeInput] = useState('');
  const [billMemberCodeInput, setBillMemberCodeInput] = useState('');
  const [billSchemePreview, setBillSchemePreview] = useState<SchemePreviewResponse | null>(null);
  const pendingTotal = visitServicesData?.pendingTotal ?? 0;
  const pendingVisitServices = useMemo(() => visitServicesData?.services ?? [], [visitServicesData?.services]);
  const billDiscountByNameRequired = discountReferralRequired(pendingTotal, billDiscount);
  const billSuggestedSchemeDiscount = Math.min(Number(billSchemePreview?.suggested_discount ?? 0), pendingTotal);
  const billHasEligibleSchemePreview = Boolean(billSchemePreview?.eligible && billSuggestedSchemeDiscount > 0 && billDiscount > 0);
  const selectedVisitDoctorId = resolveVisitDoctorId(selectedVisit);
  const billDoctorWaiverDoctorId = selectedVisitDoctorId || null;
  const billDoctorWaiverDoctorName = billDoctorWaiverDoctorId
    ? doctors.find(({ id }) => Number(id) === billDoctorWaiverDoctorId)?.name ?? ''
    : '';

  useEffect(() => {
    let cancelled = false;
    if (billHasEligibleSchemePreview || billDiscount <= 0 || !billDoctorWaiverDoctorId || pendingVisitServices.length === 0) {
      setBillDoctorWaiverAmount(0);
      setBillDoctorWaiverLoading(false);
      return;
    }

    const pendingGrossAmounts = pendingVisitServices.map((service: any) => {
      const quantity = Math.max(1, Number(service.quantity ?? 1));
      const currentLineTotal = Math.max(0, Number(service.total_amount ?? service.line_total ?? service.amount ?? 0));
      const catalogGross = Math.max(0, Number(service.unit_price ?? service.price ?? 0) * quantity);
      return Math.max(currentLineTotal, catalogGross);
    });
    const pendingDiscounts = allocateProportionalDiscounts(pendingGrossAmounts, billDiscount);

    setBillDoctorWaiverAmount(0);
    setBillDoctorWaiverLoading(true);
    api.post<{ doctorWaiverAmount?: number }>('/api/tenant/discounts/doctor-waiver-preview', {
      doctorId: billDoctorWaiverDoctorId,
      totalDiscount: billDiscount,
      items: pendingVisitServices.map((service: any, index: number) => {
        const quantity = Math.max(1, Number(service.quantity ?? 1));
        const grossLineTotal = pendingGrossAmounts[index] ?? 0;
        return {
          itemCategory: String(service.service_type ?? service.item_category ?? 'test'),
          description: service.description ?? null,
          lineTotal: Math.max(0, grossLineTotal - Number(pendingDiscounts[index] ?? 0)),
          grossLineTotal,
          quantity,
          referenceId: service.reference_id ?? service.service_item_id ?? null,
        };
      }),
    })
      .then((preview) => {
        if (!cancelled) {
          setBillDoctorWaiverAmount(Number(preview.doctorWaiverAmount ?? 0));
          setBillDoctorWaiverLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBillDoctorWaiverAmount(0);
          setBillDoctorWaiverLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [billDiscount, billDoctorWaiverDoctorId, billHasEligibleSchemePreview, pendingVisitServices]);

  /* ── Handlers ─── */
  const openAddService = (visit: Visit, type: 'service' | 'lab' | 'procedure') => {
    setSelectedVisit(visit);
    setActiveModal(type === 'service' ? 'addService' : type === 'lab' ? 'addLab' : 'addProcedure');
    setSelectedServiceLines([]);
    setServiceSearch('');
    setSelectedServiceDept('');
    setSelectedLabTests([]);
    setLabDiscount(0);
    setProcName('');
    setProcServiceItemId('');
    setProcDiscount(0);
    setServiceDiscount('');
    setServiceDiscountByName('');
    setServiceAdvancedDiscount(false);
    setServiceDiscountSources([]);
    setServiceDoctorWaiverAmount(0);
    setServiceDoctorWaiverLoading(false);
    setServiceSchemeCodeInput('');
    setServiceMemberCodeInput('');
    setServiceSchemePreview(null);
    setServiceDepositDeducted('');
    setVisitServiceBillIdempotencyKey('visit-service-bill-' + crypto.randomUUID());
    setServicePaymentMethod('cash');
    setSelectedServiceDoctorId(resolveVisitDoctorId(visit) || '');
  };

  const submitFinalBillSchemeCheck = () => {
    const schemeCode = billSchemeCodeInput.trim();
    const memberCode = billMemberCodeInput.trim();
    if (!schemeCode && !memberCode) {
      toast.error('Enter a scheme or member code.');
      return;
    }
    if (!selectedVisit) {
      toast.error('Select a visit first.');
      return;
    }
    if (pendingTotal <= 0) {
      toast.error('No pending bill amount to check.');
      return;
    }
    checkFinalBillSchemePreviewMutation.mutate({
      patient_id: selectedVisit.patient_id,
      scheme_code: schemeCode || undefined,
      member_code: memberCode || undefined,
      service_category: 'reception_visit_bill',
      subtotal: pendingTotal,
    });
  };

  const applyFinalBillSchemeDiscount = () => {
    if (!billSchemePreview?.eligible || billSuggestedSchemeDiscount <= 0) {
      toast.error(billSchemePreview?.blockers?.[0] || 'No eligible scheme benefit to apply.');
      return;
    }
    const reason = reasonForDiscountSource(billSchemePreview.allocation_type);
    setBillDiscount(billSuggestedSchemeDiscount);
    setBillAdvancedDiscount(true);
    setBillDiscountSources([{ id: crypto.randomUUID(), reason, amount: String(billSuggestedSchemeDiscount), note: 'Scheme: ' + (billSchemePreview.scheme_name ?? 'Benefit') }]);
    if (billSchemePreview.requires_reference && !billDiscountByName.trim()) {
      setBillDiscountByName(billSchemePreview.matched_member_name || billSchemePreview.matched_member_code || billSchemePreview.scheme_name || 'Scheme benefit');
    }
  };

  const openGenerateBill = (visit: Visit) => {
    setSelectedVisit(visit);
    setActiveModal('generateBill');
    setBillDiscount(0);
    setBillDiscountByName('');
    setBillAdvancedDiscount(false);
    setBillDiscountSources([]);
    setBillDoctorWaiverAmount(0);
    setBillDoctorWaiverLoading(false);
    setBillSchemeCodeInput('');
    setBillMemberCodeInput('');
    setBillSchemePreview(null);
  };

  // Single entry point for the per-row "+" action.
  // The add-item flow must not implicitly change doctor room status. Room-in
  // and room-out remain controlled only by the dedicated room action buttons.
  const handleAddServiceClick = (
    row: typeof filteredFlowRows[number],
    kind: 'service' | 'lab' | 'procedure' | 'bill',
  ) => {
    if (!row.visit) {
      // Appointment-only row: create/reuse the visit without sending the patient
      // to the doctor room, then open the billing modal with appointment doctor
      // prefilled as the referral/source doctor.
      if (row.appointment) {
        setPendingAddServiceForAppointment(row.appointment.id);
        checkInAppointmentMutation.mutate(
          { id: row.appointment.id, sendToRoom: false },
          {
            onSuccess: (data) => {
              const checkedInVisit = buildCheckedInVisit({
                appointment: row.appointment!,
                visitId: data.visitId,
                sentToRoom: false,
              });
              if (!checkedInVisit) return;
              setPendingAddServiceForAppointment(null);
              if (kind === 'bill') {
                openGenerateBill(checkedInVisit);
              } else {
                openAddService(checkedInVisit, kind);
              }
            },
          },
        );
      }
      return;
    }

    if (kind === 'bill') {
      openGenerateBill(row.visit);
    } else {
      openAddService(row.visit, kind);
    }
  };

  const visitFromQueueToken = (token: QueueTokenRow): Visit | null => {
    if (!token.visit_id || !token.patient_id) return null;
    return {
      id: Number(token.visit_id),
      patient_id: Number(token.patient_id),
      patient_name: token.patient_name ?? 'Unknown patient',
      patient_code: token.patient_code ?? undefined,
      mobile: token.phone ?? undefined,
      appointment_id: token.appointment_id ?? null,
      doctor_id: token.doctor_id ?? null,
      doctor_name: token.doctor_name ?? undefined,
      status: token.status ?? null,
      visit_type: 'opd',
    };
  };

  const patientFromQueueToken = (token: QueueTokenRow): Patient | null => {
    if (!token.patient_id) return null;
    return {
      id: Number(token.patient_id),
      name: token.patient_name ?? 'Unknown patient',
      mobile: token.phone ?? '',
      patient_code: token.patient_code ?? undefined,
    };
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'F1') { event.preventDefault(); openAppointmentModal(); }
      if (event.key === 'F2') { event.preventDefault(); openQuickServiceBill(); }
      if (event.key === 'F3') { event.preventDefault(); openIpdAdmission(); }
      if (event.key === 'F4') { event.preventDefault(); setActiveModal('provisionalBilling'); }
      if (event.key === 'F5') { event.preventDefault(); setActiveModal('collectPayment'); }
      if (event.key === 'F6') { event.preventDefault(); setActiveModal('reportDelivery'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openAppointmentModal, openQuickServiceBill, openIpdAdmission]);

  return (
    <DashboardLayout role={role} showBreadcrumbs={false}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <ReceptionTopBar
          role={role}
          onCreatePatient={openNewPatientFromSearch}
          onQuickAdmit={() => quickAdmitMutation.mutate({ reason: 'Emergency quick admit from search bar', idempotencyKey: `search-quick-admit-${Date.now()}-${Math.random().toString(36).slice(2)}` })}
          quickAdmitPending={quickAdmitMutation.isPending}
          onManageIpdBilling={(prefill) => {
            setProvisionalBillingPrefill(prefill);
            setActiveModal('provisionalBilling');
          }}
        />

        <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <button type="button" onClick={() => setActiveModal('visitorsList')} className="text-left">
            <DeskStat label={t('heading.todaysVisits', { ns: 'reception' })} value={visits.length} loading={visitsLoading} icon={<Users className="h-4 w-4" />} tone="blue" />
          </button>
          <button type="button" onClick={() => setActiveModal('dailyCollection')} className="text-left">
            <DeskStat label="Due Collection" value={formatBDT(dueCollectionToday)} loading={reportLoading} icon={<CreditCard className="h-4 w-4" />} tone="amber" />
          </button>
          <button type="button" onClick={() => setActiveModal('dailyCollection')} className="text-left">
            <DeskStat label="Total Cash Received" value={formatBDT(totalCashReceivedToday)} loading={reportLoading} icon={<Banknote className="h-4 w-4" />} tone="cyan" />
          </button>
          <button type="button" onClick={() => setActiveModal('dailyCollection')} className="text-left">
            <DeskStat label="Billing Collection" value={formatBDT(billingCollectionToday)} loading={reportLoading} icon={<Receipt className="h-4 w-4" />} tone="emerald" />
          </button>
          <button type="button" onClick={() => setActiveModal('dailyCollection')} className="text-left">
            <DeskStat label="Deposit Received" value={formatBDT(depositReceivedToday)} loading={reportLoading} icon={<CreditCard className="h-4 w-4" />} tone="slate" />
          </button>
          <button type="button" onClick={() => setActiveModal('collectPayment')} className="text-left">
            <DeskStat label="Pending Billing" value={pendingBillCount} loading={visitsLoading || appointmentsLoading || billingLoading} icon={<AlertTriangle className="h-4 w-4" />} tone="amber" />
          </button>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <button onClick={() => openAppointmentModal()} className="rounded-lg bg-blue-600 p-4 text-left text-white transition hover:bg-blue-700">
            <Calendar className="mb-3 h-6 w-6" />
            <span className="block font-semibold">{t('heading.appointmentF1', { ns: 'reception' })}</span>
            <span className="text-xs opacity-90">{t('info.appointmentDesc', { ns: 'reception' })}</span>
          </button>
          <button onClick={() => openQuickServiceBill()} className="rounded-lg bg-amber-500 p-4 text-left text-white transition hover:bg-amber-600">
            <FlaskConical className="mb-3 h-6 w-6" />
            <span className="block font-semibold">{t('heading.testServiceF2', { ns: 'reception' })}</span>
            <span className="text-xs opacity-90">{t('info.testServiceDesc', { ns: 'reception' })}</span>
          </button>
          <button onClick={() => openIpdAdmission()} className="rounded-lg bg-emerald-600 p-4 text-left text-white transition hover:bg-emerald-700">
            <Bed className="mb-3 h-6 w-6" />
            <span className="block font-semibold">{t('heading.ipdAdmissionF3', { ns: 'reception' })}</span>
            <span className="text-xs opacity-90">{t('info.bedsAvailable', { ns: 'reception', count: availableBeds.length })}</span>
          </button>
          <button
            onClick={() => setActiveModal('provisionalBilling')}
            className="rounded-lg bg-purple-600 p-4 text-left text-white transition hover:bg-purple-700"
          >
            <Receipt className="mb-3 h-6 w-6" />
            <span className="block font-semibold">{t('heading.ipdBillingF4', { ns: 'reception' })}</span>
            <span className="text-xs opacity-90">{t('info.ipdBillingDesc', { ns: 'reception' })}</span>
          </button>
          <button onClick={() => setActiveModal('collectPayment')} className="rounded-lg bg-cyan-600 p-4 text-left text-white transition hover:bg-cyan-700">
            <CreditCard className="mb-3 h-6 w-6" />
            <span className="block font-semibold">{t('heading.collectPaymentF5', { ns: 'reception' })}</span>
            <span className="text-xs opacity-90">{t('info.pendingToday', { ns: 'reception', count: pendingBillCount })}</span>
          </button>
          <button onClick={() => setActiveModal('reportDelivery')} className="rounded-lg bg-indigo-600 p-4 text-left text-white transition hover:bg-indigo-700">
            <FileText className="mb-3 h-6 w-6" />
            <span className="block font-semibold">{t('heading.deliverReportF6', { ns: 'reception' })}</span>
            <span className="text-xs opacity-90">
              {pendingLabOrderCount > 0 ? `${pendingLabOrderCount} pending lab test(s)` : t('info.deliverReportDesc', { ns: 'reception' })}
            </span>
          </button>
        </section>

        <section className={`grid gap-4 ${showAdmittedPatients ? 'xl:grid-cols-1' : 'xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]'}`}>
          <div className="card min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--color-border)] bg-gradient-to-r from-white via-cyan-50/40 to-white dark:from-slate-900 dark:via-cyan-950/20 dark:to-slate-900">
              <div>
                <h2 className="section-title flex items-center gap-2"><ListChecks className="h-4 w-4" /> {t('heading.todaysPatientFlow', { ns: 'reception' })}</h2>
                <p className="text-xs text-[var(--color-text-muted)]">Token, doctor room movement, prescription billing, and cross-referral from one table.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
                  <input
                    type="text"
                    className="input h-11 w-56 rounded-full pl-10 pr-9 text-sm shadow-sm md:w-64"
                    placeholder={t('search.byNameOrSerialOrNumber', { ns: 'reception' }) || 'Name, serial, or number'}
                    value={flowSearch}
                    onChange={(e) => setFlowSearch(e.target.value)}
                  />
                  {flowSearch && (
                    <button
                      type="button"
                      className="patient-flow-icon-button absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 border-transparent bg-transparent shadow-none"
                      onClick={() => setFlowSearch('')}
                      aria-label="Clear patient-flow search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className={`patient-flow-chip-button ${hideCompletedFlow ? 'patient-flow-chip-button--active' : ''}`}
                  onClick={() => {
                    setHideCompletedFlow((current) => {
                      const next = !current;
                      setCurrentPage(1);
                      return next;
                    });
                  }}
                >
                  <ListChecks className="h-4 w-4" aria-hidden="true" />
                  <span>Hide completed</span>
                </button>
                <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-1 shadow-sm">
                  <button
                    type="button"
                    className="patient-flow-icon-button"
                    onClick={() => setDate(prev => addReceptionDateDays(prev, -1))}
                    title="Previous day"
                    aria-label="Previous day"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={`patient-flow-chip-button ${showAdmittedPatients ? 'patient-flow-chip-button--active' : ''}`}
                    onClick={() => {
                      setShowAdmittedPatients((current) => {
                        const next = !current;
                        setCurrentPage(1);
                        return next;
                      });
                    }}
                  >
                    {showAdmittedPatients ? 'Showing IPD Patients' : 'Show IPD Patients'}
                  </button>
                  <label className="patient-flow-date-input" title="Select patient-flow date">
                    <span>{formatReceptionFlowDate(date)}</span>
                    <Calendar className="h-4 w-4" aria-hidden="true" />
                    <input
                      type="date"
                      className="patient-flow-date-native-input"
                      value={date}
                      onChange={e => setDate(e.target.value)}
                      aria-label="Select patient-flow date"
                    />
                  </label>
                  <button
                    type="button"
                    className="patient-flow-icon-button"
                    onClick={() => setDate(prev => addReceptionDateDays(prev, 1))}
                    title="Next day"
                    aria-label="Next day"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  {date !== todayStr() && (
                    <button
                      type="button"
                      className="patient-flow-chip-button h-9 px-3 text-xs"
                      onClick={() => setDate(todayStr())}
                    >
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Today</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="table-base min-w-[940px]">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="w-28">{t('table.token', { ns: 'reception' })}</th>
                      <th>{t('table.patient', { ns: 'reception' })}</th>
                      <th>{t('table.doctor', { ns: 'reception' })}</th>
                      <th>{t('table.status', { ns: 'reception' })}</th>
                      <th className="w-72 text-right">{t('table.actions', { ns: 'reception' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitsLoading || appointmentsLoading ? (
                      [...Array(5)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    ) : filteredFlowRows.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="flex flex-col items-center justify-center py-16">
                            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-bg-secondary)]">
                              <Users className="h-7 w-7 text-[var(--color-text-muted)]" />
                            </div>
                            <p className="font-medium text-[var(--color-text)]">{flowSearch.trim() ? (t('empty.noSearchResults', { ns: 'reception' }) || 'No patients found') : t('empty.noPatientsInQueue', { ns: 'reception' })}</p>
                            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{flowSearch.trim() ? (t('empty.tryDifferentSearch', { ns: 'reception' }) || 'Try a different name, serial, or number') : t('empty.patientsWillAppear', { ns: 'reception' })}</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((row) => {
                        const canBill = Boolean(row.visit);
                        const hasInvoice = Boolean(row.billId);
                        const invoiceDue = Number(row.billDue ?? 0);
                        const invoiceTotal = Number(row.billTotal ?? 0);
                        const invoicePaid = Number(row.billPaid ?? 0);
                        const dueBillCount = Number(row.dueBillCount ?? 0);
                        const invoiceStatus = String(row.billStatus ?? '').toLowerCase();
                        const normalizedStatus = String(row.status ?? '').toLowerCase();
                        const isInRoom = ['engaged', 'in_room', 'in-room', 'serving', 'arrived'].includes(normalizedStatus);
                        const canSendToRoom = row.visit && row.doctorId ? ['waiting', 'waiting_for_bill', 'checked_in', 'checked-in', 'booked', 'scheduled', 'confirmed', 'initiated'].includes(normalizedStatus) : false;
                        const appointmentPendingAmount = getAppointmentPendingAmount(row.appointment, row.billingStatus);
                        const consultationBillingPending = row.appointment
                          && ['pending', 'unpaid', 'partial_paid', 'partially_paid', 'partial'].includes(String(row.billingStatus ?? '').toLowerCase());
                        const needsConsultationPayment = Boolean(consultationBillingPending && !hasInvoice && appointmentPendingAmount > 0);
                        const pendingDoctorVisitAmount = Number(row.pendingDoctorVisitAmount ?? 0);
                        const pendingDoctorVisitServices = Number(row.pendingDoctorVisitServices ?? 0);
                        const pendingOtherServiceAmount = Math.max(0, Number(row.pendingAmount ?? 0) - pendingDoctorVisitAmount);
                        const hasPendingBillingEntry = !hasInvoice && (needsConsultationPayment || row.pendingAmount > 0 || row.pendingServices > 0);
                        const patientPendingLabOrders = pendingLabOrdersByPatient.get(Number(row.patient?.id ?? 0)) ?? [];
                        const patientPendingLabItemCount = patientPendingLabOrders.reduce((sum, order) => sum + Number(order.pendingItemCount ?? order.items.length ?? 0), 0);
                        const patientId = getAdmissionFlowPatientId(row);
                        const isAdmissionRow = isAdmissionFlowRow(row);
                        const admissionFinalBill = isAdmissionRow ? buildAdmissionFinalBillRecord(row) : null;
                        const admissionFinalDue = admissionFinalBill ? getBillOutstandingAmount(admissionFinalBill) : 0;
                        const showAdmissionRunningBillPrint = isAdmissionRow && shouldShowAdmissionRunningBillPrint(row);
                        const showAdmissionFinalInvoicePrint = isAdmissionRow && shouldShowAdmissionInvoicePrint(row);
                        const showInvoicePrint = hasInvoice && (!isAdmissionRow || showAdmissionFinalInvoicePrint);
                        const patientIdentityParts = buildPatientIdentityParts({
                          age: row.age,
                          date_of_birth: row.dateOfBirth,
                          mobile: row.mobile,
                        });
                        const openRowPatientContext = () => {
                          if (Number.isFinite(patientId) && patientId > 0) {
                            setDrawerPatientId(patientId);
                          }
                        };
                        return (
                          <tr
                            key={row.key}
                            className="patient-flow-row group"
                            onClick={openRowPatientContext}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openRowPatientContext();
                              }
                            }}
                            role="button"
                            tabIndex={patientId > 0 ? 0 : -1}
                            aria-label={`Open patient context for ${row.patientName}`}
                          >
                            <td className="align-top">
                              <div className="font-data text-base font-bold text-[var(--color-text)]">{getFlowTokenLabel(row)}</div>
                              <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{row.time ?? String(row.type ?? '')}</div>
                            </td>
                            <td className="align-top">
                              <div
                                className="max-w-[240px]"
                                title={
                                  [
                                    row.patientName,
                                    row.patientCode ? `PID-${row.patientCode}` : null,
                                    ...patientIdentityParts,
                                  ].filter(Boolean).join(' · ')
                                }
                              >
                                <div className="truncate font-medium text-[var(--color-text)]">
                                  {row.patientName}
                                </div>
                                {buildPatientFlowIdentityLabel(row)}
                              </div>
                            </td>
                            <td className="align-top text-sm">
                              <span className="font-medium text-[var(--color-text)]">{getReceptionFlowDoctorLabel(row)}</span>
                            </td>
                            <td className="align-top">
                              <div className="flex flex-col gap-1">
                                {(() => {
                                  const s = String(row.status ?? '').toLowerCase();
                                  if (isAdmissionRow) {
                                    if (s === 'critical') {
                                      return <span className="badge bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-400">Critical IPD</span>;
                                    }
                                    if (s === 'discharged') {
                                      return <span className="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-400">Discharged</span>;
                                    }
                                    if (s === 'transferred') {
                                      return <span className="badge bg-violet-50 text-violet-700 dark:bg-violet-900 dark:text-violet-400">Transferred</span>;
                                    }
                                    return <span className="badge bg-cyan-50 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-400">Admitted</span>;
                                  }
                                  // Determine main status
                                  if (s === 'waiting' || s === 'waiting_for_bill') {
                                    return <span className="badge bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-400">Waiting</span>;
                                  }
                                  if (s === 'engaged' || s === 'in_room' || s === 'in-room' || s === 'serving' || s === 'arrived') {
                                    return <span className="badge bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-400">In-Room</span>;
                                  }
                                  if (hasInvoice && invoiceDue > 0) {
                                    return <span className="badge bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-400">Bill due</span>;
                                  }
                                  if (hasPendingBillingEntry) {
                                    return <span className="badge bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-400">{pendingDoctorVisitAmount > 0 || needsConsultationPayment ? 'Consultation entry pending' : 'Service entry pending'}</span>;
                                  }
                                  if (s === 'completed' || s === 'completed_bill') {
                                    return <span className="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-400">Completed</span>;
                                  }
                                  if (s === 'checked_in' || s === 'checked-in' || s === 'booked' || s === 'initiated') {
                                    return <span className="badge bg-violet-50 text-violet-700 dark:bg-violet-900 dark:text-violet-400">{t('status.checkedIn', { ns: 'reception' })}</span>;
                                  }
                                  if (s === 'cancelled' || s === 'no_show') {
                                    return <span className="badge bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400">{t('status.cancelled', { ns: 'reception' })}</span>;
                                  }
                                  if (s === 'scheduled' || s === 'confirmed' || s === 'pending') {
                                    return <span className="badge bg-sky-50 text-sky-700 dark:bg-sky-900 dark:text-sky-400">{t('status.scheduled', { ns: 'reception' })}</span>;
                                  }
                                  return <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">{row.status}</span>;
                                })()}
                                {pendingDoctorVisitServices > 0 ? <span className="badge badge-warning">{pendingDoctorVisitServices} consultation entry</span> : null}
                                {pendingOtherServiceAmount > 0 ? <span className="badge badge-warning">Service entry pending</span> : null}
                                {patientPendingLabItemCount > 0 ? <span className="badge badge-warning">{patientPendingLabItemCount} pending test</span> : null}
                                {isAdmissionRow && row.wardBed ? <span className="badge bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{row.wardBed}</span> : null}
                                {isAdmissionRow && admissionFinalBill ? (
                                  <span className={`badge ${admissionFinalDue > 0 ? 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-400' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-400'}`}>
                                    {admissionFinalDue > 0 ? `Final due ${formatBDT(admissionFinalDue)}` : 'Final bill settled'}
                                  </span>
                                ) : null}
                                {needsConsultationPayment ? (
                                  <span className="badge bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-400">
                                    {t('status.consultationDue', { ns: 'reception' })} {formatBDT(appointmentPendingAmount)}
                                  </span>
                                ) : null}
                                {(() => {
                                  const consultationPaid = !needsConsultationPayment && row.appointment && String(row.billingStatus ?? '').toLowerCase() === 'paid';
                                  const consultationBillId = row.appointment?.bill_id ? Number(row.appointment.bill_id) : null;
                                  const hasSeparateTestBill = hasInvoice && consultationBillId !== null && Number(row.billId) !== consultationBillId;
                                  const consultationFee = consultationPaid && hasSeparateTestBill ? Number(row.appointment?.final_fee ?? row.appointment?.fee ?? row.appointment?.consultation_fee ?? 0) : 0;
                                  const totalPaid = invoicePaid || invoiceTotal;
                                  const displayPaid = totalPaid + consultationFee;
                                  if (hasInvoice) {
                                    return (
                                      <span className={`badge ${invoiceDue > 0 ? 'bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-400' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-400'}`}>
                                        {invoiceDue > 0 ? `${t('status.unpaid', { ns: 'reception' })} ${formatBDT(invoiceDue)}${dueBillCount > 1 ? ` · ${dueBillCount} bills` : ''}` : `${t('status.paid', { ns: 'reception' })} ${formatBDT(displayPaid)}`}
                                      </span>
                                    );
                                  }
                                  if (row.pendingServices > 0) {
                                    return <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">Bill not generated</span>;
                                  }
                                  if (invoiceStatus) {
                                    return <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">{invoiceStatus}</span>;
                                  }
                                  return null;
                                })()}
                              </div>
                            </td>
                            <td className="w-72 align-top overflow-visible">
                              <div
                                className="patient-flow-actions ml-auto flex min-w-[17rem] flex-wrap items-start justify-end gap-1.5 overflow-visible pt-2"
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => event.stopPropagation()}
                              >
                                {isAdmissionRow ? (
                                  <>
                                    <ReceptionFlowActionButton variant="primary" icon={<Receipt className="h-4 w-4" />} label="IPD billing" detail="Add charge, deposit, or bill" onClick={() => openAdmissionBillingModal(row)} title="IPD billing / add charge or deposit" aria-label="Open IPD billing for admitted patient" />
                                    {showAdmissionRunningBillPrint ? (
                                      <ReceptionFlowActionButton icon={<Printer className="h-4 w-4" />} label="Running bill" detail="Print current IPD statement" onClick={() => openAdmissionRunningBillPrint(row)} title="Print running bill" aria-label="Print running bill" />
                                    ) : null}
                                    <ReceptionFlowActionButton variant="emerald" icon={<FileText className="h-4 w-4" />} label="Discharge" detail="Summary, clearance, final note" onClick={() => openAdmissionDischargeSummary(row)} title="Discharge summary / clearance" aria-label="Open discharge summary or clearance" />
                                    <ReceptionFlowActionButton icon={<Bed className="h-4 w-4" />} label="IPD workspace" detail="Bed, transfer, admission tools" onClick={() => openAdmissionWorkspace(row)} title="Admission workspace / bed transfer" aria-label="Open admission workspace" />
                                  </>
                                ) : null}
                                {patientPendingLabOrders.length > 0 ? (
                                  <ReceptionFlowActionButton variant="primary" icon={<FlaskConical className="h-4 w-4" />} label="Bill lab tests" detail={`${patientPendingLabItemCount} prescription item${patientPendingLabItemCount === 1 ? '' : 's'}`} onClick={() => openPendingLabOrder(patientPendingLabOrders[0])} title="Bill prescription lab tests" aria-label="Bill prescription lab tests" />
                                ) : null}
                                {row.appointment && !row.visit ? (
                                  <ReceptionFlowActionButton
                                    variant={needsConsultationPayment ? 'disabled' : 'default'}
                                    icon={<Stethoscope className="h-4 w-4" />}
                                    label={needsConsultationPayment ? 'Payment needed' : 'Send to room'}
                                    detail={needsConsultationPayment ? 'Collect consultation first' : 'Check in and move to doctor'}
                                    onClick={() => checkInAppointmentMutation.mutate({ id: row.appointment!.id, sendToRoom: true })}
                                    disabled={checkInAppointmentMutation.isPending || needsConsultationPayment}
                                    title={needsConsultationPayment ? 'Collect consultation payment before room' : 'Check in and move to room'}
                                    aria-label={needsConsultationPayment ? 'Collect consultation payment before room' : 'Check in and move to room'}
                                  />
                                ) : row.visit ? (
                                  canSendToRoom ? (
                                    <ReceptionFlowActionButton icon={<Stethoscope className="h-4 w-4" />} label="Move to room" detail="Send patient to doctor room" onClick={() => updateVisitStatusMutation.mutate({ visitId: row.visit!.id, status: 'engaged' })} disabled={updateVisitStatusMutation.isPending} title="Move to room" aria-label="Move to room" />
                                  ) : isInRoom ? (
                                    <ReceptionFlowActionButton icon={<LogOut className="h-4 w-4" />} label="Move out" detail="Mark doctor-room work done" onClick={() => updateVisitStatusMutation.mutate({ visitId: row.visit!.id, status: 'concluded' })} disabled={updateVisitStatusMutation.isPending} title="Move out of room" aria-label="Move out of room" />
                                  ) : (
                                    <ReceptionFlowActionButton variant="disabled" icon={<Stethoscope className="h-4 w-4" />} label="Room unavailable" detail="No room action for status" disabled title="Room action unavailable" aria-label="Room action unavailable" />
                                  )
                                ) : null}

                                {needsConsultationPayment ? (
                                  <ReceptionFlowActionButton variant="emerald" icon={<CreditCard className="h-4 w-4" />} label="Pay consult" detail={formatBDT(appointmentPendingAmount)} onClick={() => openAppointmentPaymentModal(row.appointment!)} title="Pay Consultation" aria-label="Pay consultation" />
                                ) : (canBill || (row.appointment && !row.visit)) ? (
                                  row.visit && row.pendingServices > 0 ? (
                                    <ReceptionFlowActionButton variant="primary" icon={<Plus className="h-4 w-4" />} label="Bill pending" detail={`${row.pendingServices} pending service${row.pendingServices === 1 ? '' : 's'}`} onClick={() => handleAddServiceClick(row, 'bill')} title="Bill pending items" aria-label="Bill pending items" />
                                  ) : (
                                    <ReceptionFlowActionButton variant="primary" icon={<Plus className="h-4 w-4" />} label="Add item" detail="Service, test, medicine bill" onClick={() => handleAddServiceClick(row, 'service')} title="Add item / bill" aria-label="Add item or bill" />
                                  )
                                ) : null}

                                {hasInvoice && invoiceDue > 0 ? (
                                  <ReceptionFlowActionButton
                                    variant="emerald"
                                    icon={<CreditCard className="h-4 w-4" />}
                                    label={dueBillCount > 1 ? 'Collect dues' : 'Collect due'}
                                    detail={dueBillCount > 1 ? `${dueBillCount} invoices · ${formatBDT(invoiceDue)}` : formatBDT(invoiceDue)}
                                    onClick={() => {
                                      if (dueBillCount > 1) {
                                        void openPaymentForDueRow(row);
                                        return;
                                      }
                                      openPaymentForBill({
                                        id: row.billId!,
                                        invoice_no: row.invoiceNo ?? undefined,
                                        patient_name: row.patientName,
                                        total: invoiceTotal,
                                        paid: invoicePaid,
                                        paid_amount: invoicePaid,
                                        total_amount: invoiceTotal,
                                        due: invoiceDue,
                                        status: row.billStatus ?? 'pending',
                                        created_at: '',
                                      });
                                    }}
                                    title={dueBillCount > 1 ? 'Collect all due invoices' : 'Collect due'}
                                    aria-label={dueBillCount > 1 ? 'Collect all due invoices' : 'Collect due'}
                                  />
                                ) : null}

                                {showInvoicePrint && (
                                  <ReceptionFlowActionButton
                                    icon={<Printer className="h-4 w-4" />}
                                    label={isAdmissionRow ? 'Final invoice' : 'Print invoice'}
                                    detail={isAdmissionRow ? 'Print final IPD invoice' : 'Open printable bill copy'}
                                    onClick={() => { window.open(`${basePath}/billing/${row.billId}/print`, '_blank', 'noopener,noreferrer'); }}
                                    title={isAdmissionRow ? 'Print final invoice' : 'Print invoice'}
                                    aria-label={isAdmissionRow ? 'Print final invoice' : 'Print invoice'}
                                  />
                                )}
                                <ReceptionFlowActionButton icon={<UserRound className="h-4 w-4" />} label="Patient context" detail="Open full patient side panel" onClick={openRowPatientContext} title={t('patientDrawer.openContext', { defaultValue: 'Patient context' })} aria-label={t('patientDrawer.openContext', { defaultValue: 'Patient context' })} />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
                    <div className="text-sm text-[var(--color-text-muted)]">
                      Showing {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredFlowRows.length)} of {filteredFlowRows.length}
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="btn-ghost p-1.5 disabled:opacity-50"
                          aria-label="Previous patient-flow page"
                        >
                          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        </button>
                      {[...Array(Math.min(5, totalPages))].map((_, i) => {
                        const page = totalPages <= 5 ? i + 1 : currentPage <= 3 ? i + 1 : currentPage >= totalPages - 2 ? totalPages - 4 + i : currentPage - 2 + i;
                        if (page < 1 || page > totalPages) return null;
                        return (
                          <button
                            key={page}
                              onClick={() => setCurrentPage(page)}
                              aria-label={`Go to patient-flow page ${page}`}
                              aria-current={page === currentPage ? 'page' : undefined}
                              className={`h-8 w-8 rounded-lg text-sm font-medium ${
                                page === currentPage
                                  ? 'bg-[var(--color-primary)] text-white'
                                : 'hover:bg-[var(--color-bg-secondary)]'
                            }`}
                          >
                            {page}
                          </button>
                        );
                      })}
                        <button
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                          className="btn-ghost p-1.5 disabled:opacity-50"
                          aria-label="Next patient-flow page"
                        >
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className={showAdmittedPatients ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-2' : 'space-y-4'}>
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title">{t('quickGlance', { ns: 'sidebar', defaultValue: 'Quick Glance' })}</h2>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                  onClick={() => setShowBedsDrawer(true)}
                >
                  <Bed className="h-3.5 w-3.5" />
                  Beds
                  <span className="rounded bg-white/20 px-1.5 py-0.5 font-data">{receptionBedSummary.available}</span>
                </button>
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowBedsDrawer(true)}
                  className="w-full rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-left transition hover:border-emerald-300 hover:bg-emerald-100"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-emerald-700">{t('heading.bedAvailability', { ns: 'reception' })}</div>
                    <div className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
                      {receptionBedSummary.available}/{receptionBedSummary.total}
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-emerald-900">
                    {bedSummary.length === 0 ? t('empty.noFreeBed', { ns: 'reception' }) : bedSummary.map(([label, count]) => `${label}: ${count}`).join(' | ')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-semibold">
                    <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-cyan-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />Cleaning {receptionBedSummary.cleaning}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-violet-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />Reserved {receptionBedSummary.reserved}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Maintenance {receptionBedSummary.maintenance}
                    </span>
                  </div>
                </button>
                <div className="rounded-lg bg-amber-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-amber-700">{t('heading.doctorAlerts', { ns: 'reception' })}</div>
                    <button
                      onClick={() => setShowReservationPanel(true)}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-amber-300 text-amber-700 hover:bg-amber-100"
                    >
                      <Hash className="w-3.5 h-3.5" /> Token Reservations
                    </button>
                  </div>
                  <div className="mt-1 text-sm text-amber-900">
                    {doctorAlerts.length === 0 ? t('empty.allDoctorsAvailable', { ns: 'reception' }) : doctorAlerts.slice(0, 3).map((doctor) => `${doctor.name}: ${t('info.onLeave', { ns: 'reception' })}`).join(' | ')}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button className="rounded-lg border border-[var(--color-border)] p-3 text-left" onClick={() => navigate(`${basePath}/ambulance`)}>
                    <Ambulance className="mb-2 h-5 w-5 text-blue-600" />
                    <div className="text-xs text-[var(--color-text-muted)]">{t('ambulance', { ns: 'sidebar' })}</div>
                    <div className="font-semibold">{ambulanceStatsData?.available ?? 0} available</div>
                  </button>
                  <button className="rounded-lg border border-[var(--color-border)] p-3 text-left" onClick={() => navigate(`${basePath}/blood-bank`)}>
                    <Droplets className="mb-2 h-5 w-5 text-red-600" />
                    <div className="text-xs text-[var(--color-text-muted)]">{t('bloodBank', { ns: 'sidebar' })}</div>
                    <div className="font-semibold">Open</div>
                  </button>
                </div>
              </div>
            </div>
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title">{t('heading.pendingDue', { ns: 'reception' })}</h2>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <input
                    className="input h-8 w-[8.5rem] px-2 py-1 text-xs"
                    type="date"
                    value={pendingDueDate}
                    onChange={(event) => {
                      setPendingDueDate(event.target.value);
                      if (pendingBillFilter === 'all') setPendingBillFilter('date');
                    }}
                    aria-label="Pending due date"
                  />
                  <div className="flex rounded-lg border border-[var(--color-border)] p-0.5">
                    <button
                      type="button"
                      className={`rounded px-2 py-0.5 text-xs font-medium ${pendingBillFilter === 'all' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}`}
                      onClick={() => setPendingBillFilter('all')}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`rounded px-2 py-0.5 text-xs font-medium ${pendingBillFilter === 'date' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}`}
                      onClick={() => setPendingBillFilter('date')}
                    >
                      Date
                    </button>
                    <button
                      type="button"
                      className={`rounded px-2 py-0.5 text-xs font-medium ${pendingBillFilter === 'past' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}`}
                      onClick={() => setPendingBillFilter('past')}
                    >
                      Before
                    </button>
                  </div>
                  <span className="badge badge-warning">{dashboardPendingTotalCount + pendingLabOrders.length}</span>
                </div>
              </div>
              <div className="space-y-2">
	                {pendingLabOrders.length > 0 ? (
	                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
	                    <div className="mb-2 flex items-center justify-between gap-2">
	                      <div className="text-xs font-semibold text-amber-800">Prescription lab orders</div>
	                      <span className="badge badge-warning text-[10px]">{pendingLabOrderCount} test(s)</span>
	                    </div>
	                    <div className="space-y-1.5">
	                      {pendingLabOrders.slice(0, 4).map((order) => (
	                        <button
	                          key={order.orderId}
	                          type="button"
	                          className="flex w-full items-center justify-between gap-2 rounded-md bg-white px-2.5 py-2 text-left text-xs shadow-sm hover:bg-amber-100"
	                          onClick={() => openPendingLabOrder(order)}
	                        >
	                          <span className="min-w-0">
	                            <span className="block truncate font-semibold text-[var(--color-text)]">{order.patientName}</span>
	                            <span className="block truncate text-[var(--color-text-muted)]">
	                              {order.orderNo ?? `Order #${order.orderId}`} {order.doctorName ? `- ${order.doctorName}` : ''}
	                            </span>
	                          </span>
	                          <span className="shrink-0 text-right font-data font-semibold text-amber-800">
	                            {order.items.length} / {formatBDT(order.pendingAmount)}
	                          </span>
	                        </button>
	                      ))}
	                    </div>
	                  </div>
	                ) : null}
	                {dashboardPendingLoading || pendingLabOrdersLoading ? (
	                  [...Array(3)].map((_, index) => <div key={index} className="skeleton h-14 w-full rounded-lg" />)
	                ) : dashboardPendingEntries.map((entry) => (
                  <button
                    key={entry.key}
                    className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] p-2 text-left text-sm"
                    onClick={entry.action}
                  >
                      <span>
                        <span className="block font-medium">{entry.patientName}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">{entry.subtitle}</span>
                        <span className="block text-[11px] text-[var(--color-text-muted)]">{entry.meta}</span>
                      </span>
                    <span className="flex items-center gap-2">
                      <span className={`badge ${entry.type === 'appointment' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-400' : 'badge-warning'}`}>
                        {entry.type === 'appointment' ? 'Consultation' : 'Bill'}
                      </span>
                      <span className="font-data font-semibold text-red-600">{formatBDT(entry.amount)}</span>
                    </span>
                  </button>
                ))}
	                {!dashboardPendingLoading && !pendingLabOrdersLoading && dashboardPendingEntries.length === 0 && pendingLabOrders.length === 0 ? (
                  <div className="text-sm text-[var(--color-text-muted)]">{t('empty.noPendingBills', { ns: 'reception' })}</div>
                ) : null}
                {!dashboardPendingLoading && pendingDuePagination.total > 0 ? (
                  <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-text-muted)]">
                    <span>{((pendingDuePagination.page - 1) * pendingDuePagination.limit) + 1}–{Math.min(pendingDuePagination.page * pendingDuePagination.limit, pendingDuePagination.total)} of {pendingDuePagination.total}</span>
                    <div className="flex items-center gap-1">
                      <button type="button" className="btn-ghost h-7 px-2" disabled={pendingDuePagination.page <= 1} onClick={() => setPendingDuePage((page) => Math.max(1, page - 1))} aria-label="Previous pending due page"><ChevronLeft className="h-3.5 w-3.5" /></button>
                      <span className="min-w-12 text-center font-medium text-[var(--color-text)]">{pendingDuePagination.page}/{pendingDuePagination.pages}</span>
                      <button type="button" className="btn-ghost h-7 px-2" disabled={pendingDuePagination.page >= pendingDuePagination.pages} onClick={() => setPendingDuePage((page) => Math.min(pendingDuePagination.pages, page + 1))} aria-label="Next pending due page"><ChevronRight className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
        </section>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          MODALS
      ═══════════════════════════════════════════════════════════ */}

      {activeModal === 'newPatient' && (
        <Modal title={t('modal.newPatient', { ns: 'reception' })} onClose={() => setActiveModal('none')}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">{t('form.mobileSearchFirst', { ns: 'reception' })}</label>
                <input
                  className="input disabled:bg-gray-100"
                  value={newPatientForm.mobile}
                  disabled={newPatientForm.mobileMissing}
                  onChange={(event) => {
                    setCreateAsFamilyMember(false);
                    setNewPatientForm((current) => ({ ...current, mobile: event.target.value }));
                  }}
                  placeholder={newPatientForm.mobileMissing
                    ? t('patients:mobileNotAvailablePlaceholder', { defaultValue: 'Will be updated later' })
                    : t('placeholder.mobile', { ns: 'reception' })}
                />
                <label className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <input
                    type="checkbox"
                    checked={newPatientForm.mobileMissing}
                    onChange={(event) => setNewPatientForm((current) => ({
                      ...current,
                      mobileMissing: event.target.checked,
                      mobileMissingReason: event.target.checked ? current.mobileMissingReason : '',
                    }))}
                    className="rounded"
                  />
                  {t('patients:mobileNotAvailableCheckbox', { defaultValue: 'Mobile number is not available right now' })}
                </label>
              </div>
              <div>
                <label className="label">{t('form.nameRequired', { ns: 'reception' })}</label>
                <input className="input" value={newPatientForm.name} onChange={(event) => setNewPatientForm((current) => ({ ...current, name: event.target.value }))} placeholder={t('placeholder.patientName', { ns: 'reception' })} />
              </div>
              <div>
                <label className="label">{t('form.ageRequired', { ns: 'reception' })}</label>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="130"
                    step="1"
                    value={newPatientForm.age}
                    onChange={(event) => setNewPatientForm((current) => ({ ...current, age: event.target.value, dateOfBirth: '' }))}
                    placeholder={t('patients:ageYearsPlaceholder', { defaultValue: 'Years' })}
                    aria-label={t('patients:ageYearsPlaceholder', { defaultValue: 'Years' })}
                  />
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="11"
                    step="1"
                    value={newPatientForm.ageMonths}
                    onChange={(event) => setNewPatientForm((current) => ({ ...current, ageMonths: event.target.value, dateOfBirth: '' }))}
                    placeholder={t('patients:ageMonthsPlaceholder', { defaultValue: 'Months' })}
                    aria-label={t('patients:ageMonthsPlaceholder', { defaultValue: 'Months' })}
                  />
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="31"
                    step="1"
                    value={newPatientForm.ageDays}
                    onChange={(event) => setNewPatientForm((current) => ({ ...current, ageDays: event.target.value, dateOfBirth: '' }))}
                    placeholder={t('patients:ageDaysPlaceholder', { defaultValue: 'Days' })}
                    aria-label={t('patients:ageDaysPlaceholder', { defaultValue: 'Days' })}
                  />
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {t('patients:agePartsHint', { defaultValue: 'Use whole numbers. Example: 1 year 3 months is Years=1, Months=3.' })}
                </p>
              </div>
              <div>
                <label className="label">{t('form.genderRequired', { ns: 'reception' })}</label>
                <select className="input" value={newPatientForm.gender} onChange={(event) => setNewPatientForm((current) => ({ ...current, gender: event.target.value }))}>
                  <option value="male">{t('select.male', { ns: 'reception' })}</option>
                  <option value="female">{t('select.female', { ns: 'reception' })}</option>
                  <option value="other">{t('select.other', { ns: 'reception' })}</option>
                </select>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 p-3">
              <div className="mb-3 text-sm font-semibold text-[var(--color-text)]">{t('form.optionalPatientDetails', { ns: 'reception' })}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">{t('form.fatherHusband', { ns: 'reception' })}</label>
                  <input
                    className="input"
                    value={newPatientForm.fatherHusband}
                    onChange={(event) => setNewPatientForm((current) => ({ ...current, fatherHusband: event.target.value }))}
                    placeholder={t('placeholder.guardianName', { ns: 'reception' })}
                  />
                </div>
                <div>
                  <label className="label">{t('form.dateOfBirth', { ns: 'reception' })}</label>
                  <input
                    className="input"
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={newPatientForm.dateOfBirth}
                    onChange={(event) => {
                      const dateOfBirth = event.target.value;
                      const ageParts = calculateAgePartsFromDateOfBirth(dateOfBirth);
                      setNewPatientForm((current) => ({
                        ...current,
                        dateOfBirth,
                        age: ageParts ? String(ageParts.years) : current.age,
                        ageMonths: ageParts ? String(ageParts.months) : current.ageMonths,
                        ageDays: ageParts ? String(ageParts.days) : current.ageDays,
                      }));
                    }}
                  />
                </div>
                <div>
                  <label className="label">{t('form.bloodGroup', { ns: 'reception' })}</label>
                  <select
                    className="input"
                    value={newPatientForm.bloodGroup}
                    onChange={(event) => setNewPatientForm((current) => ({ ...current, bloodGroup: event.target.value }))}
                  >
                    <option value="">{t('select.notSet', { ns: 'reception' })}</option>
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                    <option value="AB+">AB+</option>
                    <option value="AB-">AB-</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('form.address', { ns: 'reception' })}</label>
                  <input
                    className="input"
                    value={newPatientForm.address}
                    onChange={(event) => setNewPatientForm((current) => ({ ...current, address: event.target.value }))}
                    placeholder={t('placeholder.villageAreaCity', { ns: 'reception' })}
                  />
                </div>
              </div>
            </div>
            {(newPatientForm.mobileMissing || !newPatientForm.mobile.trim()) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-3">
                <div className="text-sm font-semibold text-amber-900">
                  {t('patients:alternativeContactTitle', { defaultValue: 'Alternative contact (required when no mobile is provided)' })}
                </div>
                {!newPatientForm.mobile.trim() && (
                  <div>
                    <label className="label">{t('patients:mobileMissingReasonLabel', { defaultValue: 'Reason mobile is missing' })} *</label>
                    <select
                      className="input"
                      value={newPatientForm.mobileMissingReason}
                      onChange={(event) => setNewPatientForm((current) => ({ ...current, mobileMissingReason: event.target.value }))}
                    >
                      <option value="">{t('select.selectOption', { ns: 'reception', defaultValue: 'Select…' })}</option>
                      <option value="no_personal_mobile">{t('patients:reasonNoPersonalMobile', { defaultValue: 'Patient has no personal mobile' })}</option>
                      <option value="no_family_mobile">{t('patients:reasonNoFamilyMobile', { defaultValue: 'No family member has a mobile' })}</option>
                      <option value="emergency_arrival">{t('patients:reasonEmergencyArrival', { defaultValue: 'Patient arrived in emergency, mobile not obtainable' })}</option>
                      <option value="patient_refused">{t('patients:reasonPatientRefused', { defaultValue: 'Patient does not want to share the number' })}</option>
                      <option value="will_update_later">{t('patients:reasonWillUpdateLater', { defaultValue: 'Will be updated later' })}</option>
                      <option value="other">{t('patients:reasonOther', { defaultValue: 'Other' })}</option>
                    </select>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="label">{t('patients:guardianNameLabel', { defaultValue: 'Guardian name' })}</label>
                    <input
                      className="input"
                      value={newPatientForm.guardianName}
                      onChange={(event) => setNewPatientForm((current) => ({ ...current, guardianName: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">{t('patients:guardianRelationLabel', { defaultValue: 'Relation' })}</label>
                    <select
                      className="input"
                      value={newPatientForm.guardianRelation}
                      onChange={(event) => setNewPatientForm((current) => ({ ...current, guardianRelation: event.target.value }))}
                    >
                      <option value="">{t('select.selectOption', { ns: 'reception', defaultValue: 'Select…' })}</option>
                      <option value="father">{t('patients:relation.father', { defaultValue: 'Father' })}</option>
                      <option value="mother">{t('patients:relation.mother', { defaultValue: 'Mother' })}</option>
                      <option value="spouse">{t('patients:relation.spouse', { defaultValue: 'Spouse' })}</option>
                      <option value="son">{t('patients:relation.son', { defaultValue: 'Son' })}</option>
                      <option value="daughter">{t('patients:relation.daughter', { defaultValue: 'Daughter' })}</option>
                      <option value="sibling">{t('patients:relation.sibling', { defaultValue: 'Sibling' })}</option>
                      <option value="grandparent">{t('patients:relation.grandparent', { defaultValue: 'Grandparent' })}</option>
                      <option value="uncle">{t('patients:relation.uncle', { defaultValue: 'Uncle' })}</option>
                      <option value="aunt">{t('patients:relation.aunt', { defaultValue: 'Aunt' })}</option>
                      <option value="neighbor">{t('patients:relation.neighbor', { defaultValue: 'Neighbour' })}</option>
                      <option value="legal_guardian">{t('patients:relation.legalGuardian', { defaultValue: 'Legal guardian' })}</option>
                      <option value="other">{t('patients:relation.other', { defaultValue: 'Other' })}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('form.guardianMobile', { ns: 'reception' })}</label>
                    <input
                      className="input"
                      value={newPatientForm.guardianMobile}
                      onChange={(event) => setNewPatientForm((current) => ({ ...current, guardianMobile: event.target.value }))}
                      placeholder={t('placeholder.optionalPhone', { ns: 'reception' })}
                    />
                  </div>
                </div>
                <details className="rounded-md bg-white px-3 py-2 text-xs text-amber-800">
                  <summary className="cursor-pointer font-semibold text-amber-900">
                    {t('patients:structuredAddressToggle', { defaultValue: 'Or supply a full structured address' })}
                  </summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input type="text" value={newPatientForm.village} onChange={(event) => setNewPatientForm((current) => ({ ...current, village: event.target.value }))} placeholder={t('patients:structuredAddress.village', { defaultValue: 'Village' })} className="input" />
                    <input type="text" value={newPatientForm.unionName} onChange={(event) => setNewPatientForm((current) => ({ ...current, unionName: event.target.value }))} placeholder={t('patients:structuredAddress.union', { defaultValue: 'Union' })} className="input" />
                    <input type="text" value={newPatientForm.upazila} onChange={(event) => setNewPatientForm((current) => ({ ...current, upazila: event.target.value }))} placeholder={t('patients:structuredAddress.upazila', { defaultValue: 'Upazila / thana' })} className="input" />
                    <input type="text" value={newPatientForm.district} onChange={(event) => setNewPatientForm((current) => ({ ...current, district: event.target.value }))} placeholder={t('patients:structuredAddress.district', { defaultValue: 'District' })} className="input" />
                    <input type="text" value={newPatientForm.division} onChange={(event) => setNewPatientForm((current) => ({ ...current, division: event.target.value }))} placeholder={t('patients:structuredAddress.division', { defaultValue: 'Division (optional)' })} className="input sm:col-span-2" />
                  </div>
                </details>
                <p className="text-xs text-amber-800">
                  {t('patients:alternativeContactHint', { defaultValue: 'Provide at least a named guardian (name + relation) or a full structured address (village + union + upazila + district).' })}
                </p>
              </div>
            )}
            {newPatientFamilyMatches.length > 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="mb-2 text-sm font-semibold text-emerald-900">{t('heading.familyProfiles', { ns: 'reception' })}</div>
                <div className="space-y-2">
                  {newPatientFamilyMatches.map((patient) => (
                    <button
                      key={patient.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-sm hover:bg-emerald-100"
                      onClick={() => {
                        setCreateAsFamilyMember(false);
                        selectPatientForReturnFlow(patient);
                      }}
                    >
                      <span>
                        <span className="block font-semibold">{patient.name}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {[
                            buildPatientAgeLabel(patient.age, patient.date_of_birth) ? `Age: ${buildPatientAgeLabel(patient.age, patient.date_of_birth)}` : null,
                            patient.gender,
                            patient.patient_code ? `PID: ${patient.patient_code}` : `Patient #${patient.id}`,
                          ].filter(Boolean).join(' - ')}
                        </span>
                      </span>
                      <span className="text-xs text-[var(--color-primary)]">Select</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg border border-dashed border-emerald-300 bg-white px-3 py-2 text-left text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                    onClick={() => {
                      setCreateAsFamilyMember(true);
                      setNewPatientForm((current) => ({
                        ...EMPTY_NEW_PATIENT_FORM,
                        mobile: current.mobile,
                        guardianMobile: current.guardianMobile,
                      }));
                    }}
                  >
                    <span>{t('btn.addNewFamilyMember', { ns: 'reception' })}</span>
                    <span className="text-xs">{t('info.sameMobile', { ns: 'reception' })}</span>
                  </button>
                </div>
                {createAsFamilyMember ? (
                  <div className="mt-2 rounded-md bg-white px-3 py-2 text-xs text-emerald-800">
                    {t('info.newFamilyMemberMode', { ns: 'reception' })}
                  </div>
                ) : null}
              </div>
            ) : newPatientPossibleMatches.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="mb-2 text-sm font-semibold text-amber-900">{t('heading.possibleExistingPatient', { ns: 'reception' })}</div>
                <div className="space-y-2">
                  {newPatientPossibleMatches.map((patient) => (
                    <button
                      key={patient.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-sm hover:bg-amber-100"
                      onClick={() => {
                        selectPatientForReturnFlow(patient);
                      }}
                    >
                      <span>
                        <span className="block font-semibold">{patient.name}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">{buildReceptionPatientIdentityText(patient, 'No code')}</span>
                      </span>
                      <span className="text-xs text-[var(--color-primary)]">{t('btn.useThis', { ns: 'reception' })}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {newPatientGlobalMatches.length > 0 ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="mb-2 text-sm font-semibold text-blue-900">{t('heading.globalPatientRegistry', { ns: 'reception' })}</div>
                <div className="space-y-2">
                  {newPatientGlobalMatches.slice(0, 5).map((patient) => (
                    <button
                      key={patient.uhid}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-sm hover:bg-blue-100 disabled:opacity-50"
                      disabled={linkGlobalPatient.isPending}
                      onClick={() => linkGlobalPatient.mutate({ uhid: patient.uhid })}
                    >
                      <span>
                        <span className="block font-semibold">{patient.primary_name}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {[patient.primary_phone, patient.uhid, calculateAgeLabel(patient.date_of_birth), patient.gender].filter(Boolean).join(' - ')}
                        </span>
                      </span>
                      <span className="text-xs text-[var(--color-primary)]">{patient.linked_patient_id ? t('btn.useLinkedPatient', { ns: 'reception' }) : t('btn.linkPatient', { ns: 'reception' })}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setActiveModal('none')} className="btn-secondary">Cancel</button>
              <button
                className="btn-primary"
                disabled={createPatientMutation.isPending || linkGlobalPatient.isPending}
                onClick={() => {
                  if (newPatientSubmitLockRef.current) return;
                  const ageDraft = buildReceptionNewPatientAgeDraft(newPatientForm);
                  if (!newPatientForm.name.trim() || !newPatientForm.gender) {
                    toast.error(t('toast.fieldsRequired', { ns: 'reception' }));
                    return;
                  }
                  if (!ageDraft.ok) {
                    toast.error(ageDraft.error);
                    return;
                  }
                  // Conditional-mobile contract: when no number was provided,
                  // the receptionist MUST pick a reason AND at least one of
                  // (named guardian, full structured address).
                  const trimmedMobile = newPatientForm.mobile.trim();
                  if (!trimmedMobile) {
                    const hasGuardian = newPatientForm.guardianName.trim() && newPatientForm.guardianRelation;
                    const hasStructuredAddress = newPatientForm.village.trim()
                      && newPatientForm.unionName.trim()
                      && newPatientForm.upazila.trim()
                      && newPatientForm.district.trim();
                    if (!newPatientForm.mobileMissingReason || (!hasGuardian && !hasStructuredAddress)) {
                      toast.error(t('toast.alternativeContactRequired', {
                        ns: 'reception',
                        defaultValue: 'Mobile is missing — provide a reason and either a guardian contact or a full address.',
                      }));
                      return;
                    }
                  }
                  // Always create a new patient from this modal. The user has
                  // already seen any existing matches in the family / possible /
                  // global suggestion lists above and chose not to click them.
                  // The same mobile may legitimately belong to multiple patients
                  // (e.g. parent + child sharing one phone, family members), so
                  // we always send duplicateOverrideReason to authorise a new
                  // record instead of silently hijacking the save to an existing
                  // patient. To use an existing patient the user must click the
                  // suggestion in the list above.
                  const patientPayload = {
                    name: newPatientForm.name.trim(),
                    mobile: !newPatientForm.mobileMissing && trimmedMobile ? trimmedMobile : undefined,
                    mobileMissingReason: !trimmedMobile
                      ? newPatientForm.mobileMissingReason || undefined
                      : undefined,
                    guardianName: newPatientForm.guardianName.trim() || undefined,
                    guardianRelation: newPatientForm.guardianRelation || undefined,
                    village: newPatientForm.village.trim() || undefined,
                    unionName: newPatientForm.unionName.trim() || undefined,
                    upazila: newPatientForm.upazila.trim() || undefined,
                    district: newPatientForm.district.trim() || undefined,
                    division: newPatientForm.division.trim() || undefined,
                    age: ageDraft.age,
                    gender: newPatientForm.gender,
                    fatherHusband: newPatientForm.fatherHusband.trim() || undefined,
                    address: newPatientForm.address.trim() || undefined,
                    guardianMobile: newPatientForm.guardianMobile.trim() || undefined,
                    dateOfBirth: ageDraft.dateOfBirth,
                    bloodGroup: newPatientForm.bloodGroup || undefined,
                    duplicateOverrideReason: 'Create new patient record (mobile may match existing family members)',
                  };
                  const payloadSignature = JSON.stringify(patientPayload);
                  if (
                    !newPatientCreateIdempotencyRef.current
                    || newPatientPayloadSignatureRef.current !== payloadSignature
                  ) {
                    newPatientCreateIdempotencyRef.current = `reception-patient-registration-${crypto.randomUUID()}`;
                    newPatientPayloadSignatureRef.current = payloadSignature;
                  }
                  newPatientSubmitLockRef.current = true;
                  createPatientMutation.mutate({
                    ...patientPayload,
                    idempotencyKey: newPatientCreateIdempotencyRef.current,
                  });
                }}
              >
                {createPatientMutation.isPending ? t('btn.saving', { ns: 'reception' }) : t('btn.saveAndContinue', { ns: 'reception' })}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {activeModal === 'collectPayment' && (
        <Modal title={t('modal.collectPayment', { ns: 'reception' })} onClose={() => setActiveModal('none')}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {DUE_COLLECTION_SCOPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDueCollectionScope(option.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${dueCollectionScope === option.value ? 'bg-cyan-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-cyan-50 hover:text-cyan-700'}`}
                  title={option.helper}
                >
                  {option.label}
                </button>
              ))}
              <label className="ml-auto flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                Date
                <input
                  type="date"
                  value={dueCollectionDate}
                  onChange={(event) => {
                    setDueCollectionDate(event.target.value);
                    if (dueCollectionScope === 'all' || dueCollectionScope === 'ipd') {
                      setDueCollectionScope('today');
                    }
                  }}
                  className="bg-transparent text-xs outline-none"
                />
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <input
                type="search"
                value={dueCollectionSearch}
                onChange={(event) => setDueCollectionSearch(event.target.value)}
                placeholder="Search patient, invoice, mobile"
                className="input h-9 text-sm"
              />
              <select value={dueVisitTypeFilter} onChange={(event) => setDueVisitTypeFilter(event.target.value as DueVisitTypeFilter)} className="input h-9 text-sm">
                <option value="all">All OPD/IPD</option>
                <option value="opd">OPD only</option>
                <option value="ipd">IPD only</option>
              </select>
              <select value={dueAgeBucket} onChange={(event) => setDueAgeBucket(event.target.value as DueAgeBucket)} className="input h-9 text-sm">
                {DUE_AGE_BUCKETS.map((bucket) => <option key={bucket.value} value={bucket.value}>{bucket.label}</option>)}
              </select>
            </div>
            <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3 text-sm text-cyan-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    {dueCollectionScope === 'today'
                      ? `Showing dues for ${formatReceptionFlowDate(dueCollectionDate)}`
                      : dueCollectionScope === 'overdue'
                        ? `Showing dues before ${formatReceptionFlowDate(dueCollectionDate)}`
                        : dueCollectionScope === 'ipd'
                          ? 'Showing IPD due invoices'
                          : 'Showing all open dues'}
                  </div>
                  <div className="text-xs text-cyan-700">
                    {dueCollectionScope === 'all'
                      ? 'Includes previous unpaid and partially paid invoices, not only today.'
                      : dueCollectionScope === 'ipd'
                        ? 'Only unpaid or partially paid IPD/admission invoices are listed.'
                        : dueCollectionScope === 'overdue'
                          ? 'Shows unpaid invoices before the selected date.'
                          : 'Shows unpaid invoices for the selected date.'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-cyan-700">Invoices {dueCollectionBaseBills.length}/{dueCollectionQueryTotal}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-blue-700">Consult {collectPaymentVisibleAppointmentCharges.length + collectPaymentPendingVisitConsultations.length}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-emerald-700">Showing {dueCollectionTotalVisibleItems}</span>
                </div>
              </div>
            </div>
            {collectPaymentPendingBillsLoading ? (
              <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Loading open dues...</div>
            ) : dueCollectionTotalVisibleItems === 0 ? (
              <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">No open due invoices found for this filter.</div>
            ) : (
              <>
                {dueCollectionBaseBills.map((bill) => {
                  const paid = getBillSettledAmount(bill);
                  const due = getBillOutstandingAmount(bill);
                  return (
                    <button
                      key={bill.id}
                      type="button"
                      onClick={() => openPaymentForBill(bill)}
                      className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] p-3 text-left hover:border-[var(--color-primary)]"
                    >
                      <span>
                        <span className="block font-semibold">{bill.patient_name}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">{bill.invoice_no ?? `Bill #${bill.id}`} - {getBillServiceLabel(bill)}</span>
                        <span className="block text-[11px] text-[var(--color-text-muted)]">{formatDate(bill.created_at)} - Paid {formatBDT(paid)}</span>
                      </span>
                      <span className="font-data font-semibold text-red-600">{formatBDT(due)}</span>
                    </button>
                  );
                })}
                {collectPaymentVisibleAppointmentCharges.length > 0 ? (
                  <div className="pt-2">
                    <h3 className="mb-2 text-sm font-semibold">Pending appointment consultations</h3>
                    <div className="space-y-2">
                      {collectPaymentVisibleAppointmentCharges.map((charge) => (
                        <button
                          key={`appointment-charge-${charge.appointment_id}`}
                          type="button"
                          onClick={() => openAppointmentPaymentModal({
                            id: Number(charge.appointment_id),
                            tokenNo: charge.token_no ? Number(charge.token_no) : undefined,
                            consultationFee: Number(charge.pending_amount ?? charge.appointment_fee ?? 0),
                            billingStatus: charge.billing_status ?? 'pending',
                          })}
                          className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] p-3 text-left hover:border-[var(--color-primary)]"
                        >
                          <span>
                            <span className="block font-semibold">{charge.patient_name ?? `Appointment #${charge.appointment_id}`}</span>
                            <span className="text-xs text-[var(--color-text-muted)]">{charge.doctor_name ?? 'Doctor'}{charge.appt_date ? ` - ${formatDate(charge.appt_date)}` : ''}</span>
                          </span>
                          <span className="font-data font-semibold">{formatBDT(Number(charge.pending_amount ?? charge.appointment_fee ?? 0))}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {collectPaymentPendingVisitConsultations.length > 0 ? (
                  <div className="pt-2">
                    <h3 className="mb-2 text-sm font-semibold">Pending visit consultations</h3>
                    <div className="space-y-2">
                      {collectPaymentPendingVisitConsultations.map((entry) => (
                        <button
                          key={entry.key}
                          type="button"
                          onClick={() => {
                            if (entry.visit) {
                              setSelectedVisit(entry.visit as Visit);
                              setBillDiscount(0);
                              setBillDiscountByName('');
                              setActiveModal('generateBill');
                            }
                          }}
                          className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] p-3 text-left hover:border-[var(--color-primary)]"
                        >
                          <span>
                            <span className="block font-semibold">{entry.patientName}</span>
                            <span className="text-xs text-[var(--color-text-muted)]">{entry.doctorName} - {entry.tokenLabel}</span>
                          </span>
                          <span className="font-data font-semibold">{formatBDT(entry.amount)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {collectPaymentPendingServiceVisits.length > 0 ? (
                  <div className="pt-2">
                    <h3 className="mb-2 text-sm font-semibold">Pending tests/services</h3>
                    <div className="space-y-2">
                      {collectPaymentPendingServiceVisits.map((visit) => (
                        <button
                          key={visit.id}
                          type="button"
                          onClick={() => {
                            setSelectedVisit(visit);
                            setBillDiscount(0);
                            setActiveModal('generateBill');
                          }}
                          className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] p-3 text-left hover:border-[var(--color-primary)]"
                        >
                          <span>
                            <span className="block font-semibold">{visit.patient_name}</span>
                            <span className="text-xs text-[var(--color-text-muted)]">{visit.pending_services ?? 0} service(s)</span>
                          </span>
                          <span className="font-data font-semibold">{formatBDT(getNonConsultationPendingAmount(visit))}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </Modal>
      )}

      {activeModal === 'quickServiceBill' && (
        <Modal title={t('modal.testServiceBill', { ns: 'reception' })} onClose={() => setActiveModal('none')} size="wide">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-cyan-50 p-3 text-sm text-cyan-900">
              <span>{t('quickBill.walkInHint', { ns: 'reception', defaultValue: 'Direct walk-in tests/services can be billed without a referring doctor. Select a doctor only when the service came from an OPD visit or prescription.' })}</span>
              <span className={`badge ${activeCounterSession ? 'badge-success' : 'badge-warning'}`}>{activeCounterSession ? 'Counter active' : 'Open counter first'}</span>
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
              <section className="space-y-3">
                <div>
                  <label className="label">Patient</label>
                  {quickBillPatient ? (
                    <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3">
                      <div>
                        <div className="font-semibold">{quickBillPatient.name}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{buildReceptionPatientIdentityText(quickBillPatient)}</div>
                      </div>
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => {
                        setQuickBillPatient(null);
                        setQuickBillPatientSearch('');
                        setQuickBillDoctorId('');
                        setQuickBillDoctorTouched(false);
                        setQuickBillReferrerType('self');
                        setQuickBillReferrerHospital(null);
                        setQuickBillOtherReferrerName('');
                        setQuickBillExtRefDoctorId('');
                        setQuickBillExtRefDoctorSearch('');
                        setQuickBillDepositDeducted('');
                      }}>
                        Change
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                        <input
                          className="input pl-9"
                          value={quickBillPatientSearch}
                          onChange={(event) => setQuickBillPatientSearch(event.target.value)}
                          placeholder="Search by mobile, name, or patient ID"
                        />
                      </div>
                      {quickBillPatientMatches.length > 0 ? (
                        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                          {quickBillPatientMatches.map((patient) => (
                            <div
                              key={patient.id}
                              className="flex w-full items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2 text-sm last:border-0 hover:bg-[var(--color-bg-secondary)]"
                            >
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
                                onClick={() => {
                                  selectQuickBillPatient(patient);
                                }}
                              >
                                <span className="block truncate font-medium">{patient.name}</span>
                                <span className="text-xs text-[var(--color-text-muted)]">{buildReceptionPatientIdentityText(patient)}</span>
                              </button>
                              <div className="flex shrink-0 items-center gap-2">
                                {patient.mobile ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      openNewPatientFromSearch(patient.mobile ?? quickBillPatientSearch, { familyMobile: patient.mobile ?? undefined, guardianName: patient.name, returnModal: 'quickServiceBill' });
                                      setQuickBillPatientSearch('');
                                    }}
                                    className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                                  >
                                    Add family
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="text-xs text-[var(--color-primary)]"
                                  onClick={() => {
                                    selectQuickBillPatient(patient);
                                  }}
                                >
                                  Select
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : quickBillPatientLookupFetching ? (
                        <div className="mt-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
                          Searching patient...
                        </div>
                      ) : quickBillPatientSearch.trim().length >= 2 ? (
                        <div className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                          {t('quickBill.noPatientFound', { ns: 'reception', defaultValue: 'No saved patient found. Register the patient first, then return to Test / Service Bill.' })}
                          <button type="button" className="ml-2 font-semibold underline" onClick={() => {
                            const searchTerm = quickBillPatientSearch.trim();
                            const digits = searchTerm.replace(/\D/g, '');
                            const isMobile = digits.length >= 6;
                            setNewPatientReturnModal('quickServiceBill');
                            setNewPatientForm({
                              ...EMPTY_NEW_PATIENT_FORM,
                              name: isMobile ? '' : searchTerm,
                              mobile: isMobile ? searchTerm : '',
                            });
                            setActiveModal('newPatient');
                          }}>{t('btn.newPatient', { ns: 'reception', defaultValue: 'New patient' })}</button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
                  <label className="label mb-0">{t('form.referredBy', { ns: 'reception', defaultValue: 'Referred by' })}</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['self', 'doctor', 'hospital', 'other'] as QuickBillReferrerType[]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={`rounded-lg border px-2 py-2 text-xs font-semibold capitalize ${
                          quickBillReferrerType === type
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                            : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                        }`}
                        onClick={() => {
                          setQuickBillReferrerType(type);
                          if (type !== 'doctor') {
                            setQuickBillDoctorId('');
                            setQuickBillExtRefDoctorId('');
                            setQuickBillExtRefDoctorSearch('');
                          }
                          if (type !== 'hospital') setQuickBillReferrerHospital(null);
                          if (type !== 'other') setQuickBillOtherReferrerName('');
                        }}
                      >
                        {type}
                      </button>
                    ))}
                  </div>

                  {quickBillReferrerType === 'doctor' && (
                    <>
                      <div>
                        <label className="label">In-hospital doctor</label>
                        <select
                          className="input"
                          value={quickBillDoctorId}
                          onChange={(event) => {
                            setQuickBillDoctorTouched(true);
                            setQuickBillDoctorId(Number(event.target.value) || '');
                            setQuickBillExtRefDoctorId('');
                            setQuickBillExtRefDoctorSearch('');
                          }}
                        >
                          <option value="">Select external doctor below</option>
                          {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? ` - ${doctor.specialty}` : ''}</option>)}
                        </select>
                        {quickBillPatient && !quickBillDoctorTouched && quickBillDoctorId ? (
                          <div className="mt-1 text-xs text-[var(--color-text-muted)]">Auto-selected from today's OPD context.</div>
                        ) : null}
                      </div>

                      <div>
                        <label className="label">Performer</label>
                        <input
                          className="input mb-2"
                          placeholder="Search performer doctor"
                          value={quickBillPerformerDoctorSearch}
                          onChange={(event) => setQuickBillPerformerDoctorSearch(event.target.value)}
                        />
                        <select className="input" value={quickBillPerformerDoctorId} onChange={(event) => setQuickBillPerformerDoctorId(Number(event.target.value) || '')}>
                          <option value="">Optional performer</option>
                          {filteredQuickBillPerformerDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? ` - ${doctor.specialty}` : ''}</option>)}
                        </select>
                        {performerDoctors.length === 0 ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">No performer commission rule configured for lab tests.</p> : null}
                      </div>

                      <div className="flex items-center justify-between">
                        <label className="label mb-0">External doctor</label>
                        <button
                          type="button"
                          className="text-xs text-[var(--color-primary)] hover:underline"
                          onClick={() => setShowQuickBillNewExtRefForm(!showQuickBillNewExtRefForm)}
                        >
                          {showQuickBillNewExtRefForm ? t('btn.selectExisting', { ns: 'reception' }) : t('btn.addNew', { ns: 'reception' })}
                        </button>
                      </div>

                      {showQuickBillNewExtRefForm ? (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <input
                            className="input"
                            placeholder={t('placeholder.doctorName', { ns: 'reception' })}
                            value={newExtRefDoctorName}
                            onChange={(e) => setNewExtRefDoctorName(e.target.value)}
                          />
                          <input
                            className="input"
                            placeholder={t('placeholder.phone', { ns: 'reception' })}
                            value={newExtRefDoctorPhone}
                            onChange={(e) => setNewExtRefDoctorPhone(e.target.value)}
                          />
                          <input
                            className="input"
                            placeholder={t('placeholder.chamber', { ns: 'reception' })}
                            value={newExtRefDoctorChamber}
                            onChange={(e) => setNewExtRefDoctorChamber(e.target.value)}
                          />
                          <div className="sm:col-span-3">
                            <button
                              type="button"
                              className="btn-primary text-sm"
                              disabled={!newExtRefDoctorName.trim() || createExtRefDoctorMutation.isPending}
                              onClick={() => {
                                if (!newExtRefDoctorName.trim()) return;
                                createExtRefDoctorMutation.mutate({
                                  name: newExtRefDoctorName.trim(),
                                  phone: newExtRefDoctorPhone.trim() || undefined,
                                  chamber: newExtRefDoctorChamber.trim() || undefined,
                                });
                              }}
                            >
                              {createExtRefDoctorMutation.isPending ? t('btn.saving', { ns: 'reception' }) : t('btn.saveDoctor', { ns: 'reception' })}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <input
                            className="input"
                            placeholder="Search external doctor..."
                            value={quickBillExtRefDoctorSearch}
                            onChange={(e) => {
                              setQuickBillExtRefDoctorSearch(e.target.value);
                              setQuickBillExtRefDoctorId('');
                            }}
                          />
                          {quickBillExtRefDoctorSearch.trim().length > 0 ? (
                            <div className="max-h-32 overflow-y-auto rounded border border-[var(--color-border)]">
                              {extRefDoctors
                                .filter((d) => d.name.toLowerCase().includes(quickBillExtRefDoctorSearch.toLowerCase()))
                                .slice(0, 10)
                                .map((d) => (
                                  <button
                                    key={d.id}
                                    type="button"
                                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-[var(--color-bg-secondary)] ${quickBillExtRefDoctorId === d.id ? 'bg-blue-50 dark:bg-blue-950' : ''}`}
                                    onClick={() => {
                                      setQuickBillExtRefDoctorId(d.id);
                                      setQuickBillExtRefDoctorSearch(d.name);
                                      setQuickBillDoctorId('');
                                    }}
                                  >
                                    <span className="font-medium">{d.name}</span>
                                    <span className="text-xs text-[var(--color-text-muted)]">
                                      {d.phone || ''}{d.chamber ? ` • ${d.chamber}` : ''}
                                    </span>
                                  </button>
                                ))}
                              {extRefDoctors.filter((d) => d.name.toLowerCase().includes(quickBillExtRefDoctorSearch.toLowerCase())).length === 0 ? (
                                <div className="px-3 py-2 text-sm text-[var(--color-text-muted)]">No matching doctor found</div>
                              ) : null}
                            </div>
                          ) : null}
                          {quickBillExtRefDoctorId ? (
                            <div className="text-xs text-emerald-600">
                              Selected: {extRefDoctors.find((d) => d.id === quickBillExtRefDoctorId)?.name}
                              <button type="button" className="ml-2 text-red-500 hover:underline" onClick={() => { setQuickBillExtRefDoctorId(''); setQuickBillExtRefDoctorSearch(''); }}>Clear</button>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </>
                  )}

                  {quickBillReferrerType === 'hospital' && (
                    <HospitalCombobox
                      value={quickBillReferrerHospital}
                      onChange={setQuickBillReferrerHospital}
                      placeholder="Search referral hospital..."
                    />
                  )}

                  {quickBillReferrerType === 'other' && (
                    <input
                      className="input"
                      value={quickBillOtherReferrerName}
                      onChange={(event) => setQuickBillOtherReferrerName(event.target.value)}
                      placeholder="Referrer name or source"
                    />
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Department</label>
                    <select className="input" value={quickBillDept} onChange={(event) => setQuickBillDept(Number(event.target.value) || '')}>
                      <option value="">All departments</option>
                      {serviceDepts.map((dept) => <option key={dept.id} value={dept.id}>{dept.department_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Search item</label>
                    <input
                      className="input"
                      value={quickBillSearch}
                      onChange={(event) => setQuickBillSearch(event.target.value)}
                      placeholder="CBC, X-Ray, dressing, injection..."
                    />
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                  {modalServicesLoading ? (
                    <div className="p-4 text-sm text-[var(--color-text-muted)]">Loading catalog...</div>
                  ) : filteredQuickBillServices.length === 0 ? (
                    <div className="p-4 text-sm text-[var(--color-text-muted)]">{t('empty.noBillableItem', { ns: 'reception' })}</div>
                  ) : filteredQuickBillServices.map((service) => (
                    <button
                      key={service.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2.5 text-left text-sm last:border-0 hover:bg-[var(--color-bg-secondary)]"
                      onClick={() => addQuickBillItem(service)}
                    >
                      <span>
                        <span className="block font-medium">{service.item_name}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">{service.department_name ?? service.item_code ?? 'Service'}</span>
                      </span>
                      <span className="flex items-center gap-2 font-data font-semibold">
                        {formatBDT(service.price)}
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <div className="rounded-lg border border-[var(--color-border)]">
                  <div className="border-b border-[var(--color-border)] px-3 py-2 font-semibold">Billing cart</div>
                  {quickBillLines.length === 0 ? (
                    <div className="p-4 text-sm text-[var(--color-text-muted)]">Select tests or services to create a bill.</div>
                  ) : (
                    <div className="divide-y divide-[var(--color-border)]">
                      {quickBillLines.map((line) => {
                        const gross = Number(line.price ?? 0) * line.quantity;
                        return (
                          <div key={line.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{line.item_name}</div>
                              <div className="font-data text-xs text-[var(--color-text-muted)]">{formatBDT(line.price)} each</div>
                            </div>
                            <div className="inline-flex h-8 items-center rounded-md border border-[var(--color-border)] bg-white">
                              <button
                                type="button"
                                className="px-2 text-sm font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                                onClick={() => setQuickBillLines((current) => current.map((item) => item.id === line.id ? { ...item, quantity: Math.max(1, item.quantity - 1) } : item))}
                                aria-label="Decrease quantity"
                              >
                                -
                              </button>
                              <span className="w-8 text-center font-data text-sm">{line.quantity}</span>
                              <button
                                type="button"
                                className="px-2 text-sm font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                                onClick={() => setQuickBillLines((current) => current.map((item) => item.id === line.id ? { ...item, quantity: item.quantity + 1 } : item))}
                                aria-label="Increase quantity"
                              >
                                +
                              </button>
                            </div>
                            <div className="w-24 text-right font-data font-semibold">{formatBDT(gross)}</div>
                            <button type="button" className="btn-ghost p-1 text-red-600" onClick={() => setQuickBillLines((current) => current.filter((item) => item.id !== line.id))} aria-label="Remove item">
                                <Trash2 className="h-4 w-4" />
                              </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {shouldShowServiceDepositField(quickBillDepositBalance) ? (
                    <>
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 sm:col-span-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">Available deposit</span>
                          <span className="font-data font-semibold text-emerald-700">
                            {formatBDT(quickBillDepositBalance)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="mt-2 text-xs font-medium text-[var(--color-primary)]"
                          onClick={() => setQuickBillDepositDeducted(String(Math.min(quickBillDepositBalance, quickBillTotal)))}
                        >
                          Use maximum available
                        </button>
                      </div>
                      <div>
                        <label className="label">Use deposit</label>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={Math.min(quickBillDepositBalance, quickBillTotal)}
                          value={quickBillDepositDeducted}
                          onChange={(event) => setQuickBillDepositDeducted(String(Math.min(quickBillDepositBalance, quickBillTotal, Math.max(0, Number(event.target.value) || 0))))}
                          placeholder={formatBDT(Math.min(quickBillDepositBalance, quickBillTotal))}
                        />
                      </div>
                    </>
                  ) : null}
                  <div>
                    <label className="label">Payment method</label>
                    <select className="input" value={quickBillPaymentMethod} onChange={(event) => {
                      setQuickBillPaymentMethod(event.target.value);
                      if (event.target.value === 'cash') setQuickBillPaymentReference('');
                    }}>
                      <option value="cash">Cash</option>
                      <option value="bkash">bKash</option>
                      <option value="nagad">Nagad</option>
                      <option value="card">Card</option>
                      <option value="bank">Bank</option>
                      <option value="cheque">Cheque</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <label className="label mb-0">Paid now</label>
                      <button
                        type="button"
                        className="text-xs font-semibold text-[var(--color-primary)] hover:underline"
                        onClick={() => setQuickBillPaidAmount(String(quickBillPayableNow))}
                        disabled={quickBillPayableNow <= 0}
                      >
                        Fill full payable
                      </button>
                    </div>
                    <input
                      className="input mt-1"
                      type="number"
                      min={0}
                      max={quickBillPayableNow}
                      value={quickBillPaidAmount}
                      onChange={(event) => setQuickBillPaidAmount(String(Math.min(quickBillPayableNow, Math.max(0, Number(event.target.value) || 0))))}
                      placeholder="0"
                    />
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">Default is 0. Type only for partial payment, or use “Create bill & pay now” for full payment.</p>
                  </div>
                  {requiresPaymentReference(quickBillPaymentMethod, Math.max(quickBillCashPaid, quickBillPayableNow)) ? (
                    <div className="sm:col-span-2">
                      <label className="label">Transaction / reference number</label>
                      <input className="input" value={quickBillPaymentReference} onChange={(event) => setQuickBillPaymentReference(event.target.value)} placeholder="bKash/Nagad/card/bank reference" />
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg bg-[var(--color-bg-secondary)] p-3 text-sm">
                  <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-white p-2 dark:bg-slate-800">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Scheme / Benefit</div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input
                        className="input h-9 bg-white sm:col-span-1"
                        value={quickBillSchemeCodeInput}
                        onChange={(event) => { setQuickBillSchemeCodeInput(event.target.value); setQuickBillSchemePreview(null); }}
                        placeholder="Scheme code"
                      />
                      <input
                        className="input h-9 bg-white sm:col-span-1"
                        value={quickBillMemberCodeInput}
                        onChange={(event) => { setQuickBillMemberCodeInput(event.target.value); setQuickBillSchemePreview(null); }}
                        placeholder="Member code"
                      />
                      <button type="button" className="btn-secondary h-9 justify-center px-3 text-xs" disabled={checkQuickBillSchemePreviewMutation.isPending || quickBillSubtotal <= 0 || !quickBillPatient} onClick={submitQuickBillSchemeCheck}>
                        {checkQuickBillSchemePreviewMutation.isPending ? 'Checking…' : 'Check'}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
                      <span>{quickBillSchemePreview?.eligible ? `${quickBillSchemePreview.scheme_name ?? 'Scheme'} · ${quickBillSchemePreview.discount_value}% · suggested ${formatBDT(quickBillSuggestedSchemeDiscount)}` : quickBillSchemePreview?.blockers?.join(', ') || 'Optional: check staff/VIP/member benefit before discount.'}</span>
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!quickBillSchemePreview?.eligible || quickBillSuggestedSchemeDiscount <= 0} onClick={applyQuickBillSchemeDiscount}>Apply</button>
                    </div>
                  </div>

                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label className="text-sm font-medium">Discount</label>
                    <input
                      className="input h-9 w-32 text-right font-data"
                      type="number"
                      min={0}
                      max={quickBillSubtotal}
                      value={quickBillDiscountAmount}
                      onChange={(event) => setQuickBillDiscountAmount(String(Math.min(quickBillSubtotal, Math.max(0, Number(event.target.value) || 0))))}
                      placeholder="0"
                    />
                  </div>
                  {showDiscountReferralField(quickBillDiscount) ? (
                    <div className="mb-2">
                      <label className="label text-xs">Discount referred by{quickBillDiscountByNameRequired ? ' *' : ''}</label>
                      <input
                        className="input h-9 bg-white"
                        value={quickBillDiscountByName}
                        onChange={(event) => setQuickBillDiscountByName(event.target.value)}
                        placeholder={quickBillDiscountByNameRequired ? 'Required above 20%' : 'Optional'}
                      />
                    </div>
                  ) : null}
                  {quickBillDiscount > 0 ? (
                    <DiscountAllocationEditor
                      totalDiscount={quickBillDiscount}
                      enabled={quickBillAdvancedDiscount}
                      rows={quickBillDiscountSources}
                      onEnabledChange={setQuickBillAdvancedDiscount}
                      onRowsChange={setQuickBillDiscountSources}
                      onQuickSourceSelected={(reason) => {
                        if (reason === 'doctor_commission_waiver' && quickBillDoctorWaiverDoctorName) {
                          setQuickBillDiscountByName(quickBillDoctorWaiverDoctorName);
                        }
                      }}
                      compact
                      context={{
                        selectedDoctorId: quickBillDoctorWaiverDoctorId,
                        doctorAvailableWaiverAmount: quickBillHasEligibleSchemePreview ? 0 : quickBillDoctorWaiverAmount,
                        doctorWaiverLoading: !quickBillHasEligibleSchemePreview && quickBillDoctorWaiverLoading,
                      }}
                    />
                  ) : null}
                  <div className="flex justify-between"><span>Subtotal</span><span className="font-data">{formatBDT(quickBillSubtotal)}</span></div>
                  <div className="flex justify-between"><span>Discount</span><span className="font-data text-amber-700">{formatBDT(quickBillDiscount)}</span></div>
                  {quickBillDepositApplied > 0 ? (
                    <div className="flex justify-between"><span>Deposit adjusted</span><span className="font-data">{formatBDT(quickBillDepositApplied)}</span></div>
                  ) : null}
                  <div className="flex justify-between"><span>Paid now</span><span className="font-data">{formatBDT(quickBillCashPaid)}</span></div>
                  <div className="mt-2 flex justify-between border-t border-[var(--color-border)] pt-2 font-semibold">
                    <span>Grand total</span>
                    <span className="font-data">{formatBDT(quickBillTotal)}</span>
                  </div>
                  <div className={`flex justify-between text-xs ${quickBillDueAfterPayment > 0 ? 'text-red-600' : 'text-[var(--color-text-muted)]'}`}>
                    <span>Remaining due on invoice</span>
                    <span className="font-data">{formatBDT(quickBillDueAfterPayment)}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button type="button" className="btn-secondary" onClick={() => setActiveModal('none')}>Cancel</button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={createQuickServiceBillMutation.isPending || !quickBillPatient || quickBillLines.length === 0 || !activeCounterSession}
                    onClick={() => submitQuickServiceBill('draft')}
                  >
                    {createQuickServiceBillMutation.isPending ? t('btn.creating', { ns: 'reception' }) : 'Create bill'}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={createQuickServiceBillMutation.isPending || !quickBillPatient || quickBillLines.length === 0 || !activeCounterSession || quickBillPayableNow <= 0}
                    onClick={() => submitQuickServiceBill('payNow')}
                  >
                    {createQuickServiceBillMutation.isPending ? t('btn.creating', { ns: 'reception' }) : `Create bill & pay now ${formatBDT(quickBillPayableNow)}`}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </Modal>
      )}

      {activeModal === 'quickAdmitResult' && createdEmergencyPatient && (
        <Modal title={t('modal.emergencyPatientCreated', { ns: 'reception' })} onClose={() => setActiveModal('none')}>
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <div className="font-semibold">{createdEmergencyPatient.name}</div>
              <div>{createdEmergencyPatient.patient_code ?? `Patient #${createdEmergencyPatient.id}`}</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                className="btn-secondary justify-center"
                onClick={() => {
                  setNewVisitPatientId(createdEmergencyPatient.id);
                  setPatientSearch(createdEmergencyPatient.name);
                  setNewVisitType('emergency');
                  setIssueToken(false);
                  setActiveModal('newVisit');
                }}
              >
                Add doctor / OPD
              </button>
              <button
                className="btn-primary justify-center"
                onClick={() => {
                  const visit = visits.find((item) => item.patient_id === createdEmergencyPatient.id);
                  if (visit) {
                    openAddService(visit, 'service');
                  } else {
                    toast('Emergency patient created. Refreshing worklist...');
                    queryClient.invalidateQueries({ queryKey: queryKeys.reception.visits(date) });
        invalidateReceptionDashboardSnapshot();
                    setActiveModal('none');
                  }
                }}
              >
                Add service / bill
              </button>
            </div>
          </div>
        </Modal>
      )}

      {activeModal === 'appointment' && (
        <Modal title={t('modal.opdSerialPayment', { ns: 'reception' })} onClose={() => setActiveModal('none')}>
          <div className="space-y-4">
            <div>
              <label className="label">{t('form.patientRequired', { ns: 'reception' })}</label>
              {appointmentPatient ? (
                <div className="flex items-center justify-between rounded-lg border border-[var(--color-primary)] bg-blue-50 p-3">
                  <div>
                    <div className="font-semibold">{appointmentPatient.name}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{buildReceptionPatientIdentityText(appointmentPatient, t('status.noCode', { ns: 'reception' }))}</div>
                  </div>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAppointmentPatient(null)}>{t('btn.change', { ns: 'reception' })}</button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input className="input pl-9" value={appointmentPatientSearch} onChange={(event) => setAppointmentPatientSearch(event.target.value)} placeholder={t('placeholder.fullMobileOrName', { ns: 'reception' })} />
                  {appointmentPatientMatches.length > 0 || appointmentGlobalPatientResults.length > 0 ? (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white shadow-lg dark:bg-slate-800">
                      {appointmentPatientMatches.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t('heading.thisHospital', { ns: 'reception' })}</div>
                          {appointmentPatientMatches.map((patient) => (
                            <div key={patient.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-[var(--color-bg-secondary)]">
                              <button
                                type="button"
                                onClick={() => { setAppointmentPatient(patient); setAppointmentPatientSearch(''); }}
                                className="min-w-0 flex-1 text-left"
                              >
                                <span className="block truncate font-semibold">{patient.name}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">{buildReceptionPatientIdentityText(patient, t('status.noCode', { ns: 'reception' }))}</span>
                              </button>
                              {patient.mobile ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    openNewPatientFromSearch(patient.mobile ?? appointmentPatientSearch, { familyMobile: patient.mobile ?? undefined, guardianName: patient.name });
                                    setAppointmentPatientSearch('');
                                  }}
                                  className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                                >
                                  Add family
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </>
                      )}
                      {appointmentGlobalPatientResults.length > 0 && (
                        <>
                          <div className="border-t border-blue-200 bg-blue-50 dark:bg-blue-950">
                            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-600">{t('heading.globalPatientRegistryTitle', { ns: 'reception' })}</div>
                            {appointmentGlobalPatientResults.map((gp) => (
                              <div
                                key={gp.uhid}
                                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-100 dark:hover:bg-blue-900"
                              >
                                <button
                                  type="button"
                                  onClick={() => { linkGlobalPatient.mutate({ uhid: gp.uhid }); }}
                                  disabled={linkGlobalPatient.isPending}
                                  className="min-w-0 flex-1 text-left disabled:opacity-50"
                                >
                                  <div className="font-semibold text-blue-700 dark:text-blue-400">{gp.primary_name}</div>
                                  <div className="text-xs text-blue-500">
                                    {gp.primary_phone}
                                    {gp.uhid ? ` • ${gp.uhid}` : ''}
                                    {calculateAgeLabel(gp.date_of_birth) ? ` • ${calculateAgeLabel(gp.date_of_birth)}` : ''}
                                    {gp.gender ? ` • ${String(gp.gender).replace('_', ' ')}` : ''}
                                  </div>
                                </button>
                                <div className="flex shrink-0 items-center gap-2">
                                  {gp.primary_phone ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        openNewPatientFromSearch(gp.primary_phone ?? appointmentPatientSearch, { familyMobile: gp.primary_phone ?? undefined, guardianName: gp.primary_name });
                                        setAppointmentPatientSearch('');
                                      }}
                                      className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                                    >
                                      Add family
                                    </button>
                                  ) : null}
                                  <div className="rounded bg-blue-200 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-800 dark:text-blue-300">
                                    {gp.linked_patient_id ? t('btn.useLinkedPatient', { ns: 'reception' }) : t('btn.linkToHospital', { ns: 'reception' })}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
              {!appointmentPatient && appointmentPatientSearch.trim().length >= 2 && appointmentPatientMatches.length === 0 && appointmentGlobalPatientResults.length === 0 ? (
                <button className="mt-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-[var(--color-primary)] bg-blue-50 px-3 py-2 text-sm font-medium text-[var(--color-primary)] transition hover:bg-blue-100" onClick={() => {
                  openNewPatientFromSearch(appointmentPatientSearch.trim());
                }}>
                  <UserPlus className="h-4 w-4" />
                  {t('btn.registerNewPatient', { ns: 'reception' })}
                </button>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <label className="label">{t('form.doctorRequired', { ns: 'reception' })}</label>
                <select className="input" value={appointmentDoctorId} onChange={(event) => setAppointmentDoctorId(Number(event.target.value) || '')}>
                  <option value="">{t('select.selectDoctor', { ns: 'reception' })}</option>
                  {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} - {doctor.specialty || 'Doctor'}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('form.visitType', { ns: 'reception' })}</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {APPOINTMENT_TYPE_OPTIONS.map((option) => {
                    const selected = appointmentType === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setAppointmentType(option.value)}
                        className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${selected ? 'border-cyan-500 bg-cyan-50 text-cyan-800 shadow-sm ring-1 ring-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-100' : 'border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-cyan-300 hover:bg-cyan-50/60 dark:bg-slate-900 dark:hover:bg-cyan-950/30'}`}
                      >
                        {t(option.label, { ns: 'reception' })}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">{t('form.appointmentDateRequired', { ns: 'reception' })}</label>
                <div className="flex gap-2">
                  <input className="input min-w-0 flex-1" type="date" value={appointmentDate} onChange={(event) => setAppointmentDate(event.target.value)} />
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]"
                    onClick={() => setAppointmentDate((current) => addReceptionDateDays(current, 1))}
                  >
                    Next day
                  </button>
                </div>
              </div>
              <div>
                <label className="label">{t('form.time', { ns: 'reception' })}</label>
                <input className="input" type="time" value={appointmentTime} onChange={(event) => setAppointmentTime(event.target.value)} />
              </div>
              <div>
                <label className="label">{t('form.source', { ns: 'reception' })}</label>
                <div className="grid grid-cols-2 gap-2">
                  {APPOINTMENT_SOURCE_OPTIONS.map((option) => {
                    const selected = appointmentSource === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setAppointmentSource(option.value)}
                        className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${selected ? 'border-cyan-500 bg-cyan-50 text-cyan-800 shadow-sm ring-1 ring-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-100' : 'border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-cyan-300 hover:bg-cyan-50/60 dark:bg-slate-900 dark:hover:bg-cyan-950/30'}`}
                      >
                        {t(option.label, { ns: 'reception' })}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-[var(--color-bg-secondary)] p-3">
                <div className="text-xs text-[var(--color-text-muted)]">{t('form.doctorFee', { ns: 'reception' })}</div>
                <div className="font-data font-semibold">{appointmentPreviewLoading ? '...' : formatBDT(appointmentPreview?.originalFee ?? 0)}</div>
              </div>
              <div>
                <label className="label">{t('form.discount', { ns: 'reception' })}</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={appointmentType === 'free_visit' ? String(appointmentPreview?.originalFee ?? 0) : appointmentDiscount}
                  onChange={(event) => setAppointmentDiscount(event.target.value)}
                  disabled={appointmentType === 'free_visit' || appointmentType === 'report_show'}
                />
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <div className="text-xs text-emerald-700">{t('form.payNow', { ns: 'reception' })}</div>
                <div className="font-data font-semibold text-emerald-800">{appointmentPreviewLoading ? '...' : formatBDT(appointmentPreview?.finalFee ?? 0)}</div>
              </div>
            </div>

            {appointmentType === 'free_visit' ? (
              <div>
                <label className="label">{t('form.discountReason', { ns: 'reception' })}</label>
                <input className="input" value={appointmentDiscountReason} onChange={(event) => setAppointmentDiscountReason(event.target.value)} />
              </div>
            ) : null}

            {showDiscountReferralField(Number(appointmentPreview?.discountAmount ?? 0)) ? (
              <div>
                <label className="label">
                  Discount referred by{discountReferralRequired(Number(appointmentPreview?.originalFee ?? 0), Number(appointmentPreview?.discountAmount ?? 0)) ? ' *' : ''}
                </label>
                <input
                  className="input"
                  placeholder={discountReferralRequired(Number(appointmentPreview?.originalFee ?? 0), Number(appointmentPreview?.discountAmount ?? 0)) ? 'Required above 20%' : 'Optional'}
                  value={appointmentDiscountByName}
                  onChange={(e) => setAppointmentDiscountByName(e.target.value)}
                />
              </div>
            ) : null}

            {appointmentDoctorId ? (
              <div className="rounded-xl border border-cyan-100 bg-cyan-50/35 p-3 shadow-sm dark:border-cyan-900/50 dark:bg-cyan-950/20">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">Serial setup</p>
                    <h3 className="mt-0.5 text-sm font-bold text-blue-950 dark:text-blue-100">Pick serial mode</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" />Booked</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-white ring-1 ring-slate-300" />Free</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" />Reserved</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-fuchsia-500" />Duplicate manual</span>
                    <span className="ml-1 rounded-full bg-white px-2.5 py-1 font-semibold text-cyan-700 shadow-sm ring-1 ring-cyan-100 dark:bg-slate-900 dark:ring-cyan-900/50">Next #{tokenAvailabilitySummary?.nextRegularTokenNo ?? 'Auto'}</span>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-cyan-100 bg-white/85 p-2 dark:border-slate-700 dark:bg-slate-900/70">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Serial strip</p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">Click any free gap to use it as custom serial</p>
                  </div>
                  <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                    {availableTokensLoading ? (
                      <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-[var(--color-text-muted)]">Checking queue...</span>
                    ) : tokenStripNumbers.map((tokenNo) => {
                      const booked = bookedTokenNumbers.has(tokenNo);
                      const reserved = reservedAvailableTokenNumbers.has(tokenNo);
                      const nextRegular = Number(tokenAvailabilitySummary?.nextRegularTokenNo) === tokenNo;
                      const selectedManual = appointmentTokenMode === 'manual' && Number(appointmentManualToken) === tokenNo;
                      const selectedReserved = appointmentTokenMode === 'reserved' && Number(appointmentRequestedToken) === tokenNo;
                      const selected = selectedManual || selectedReserved;
                      return (
                        <button
                          key={tokenNo}
                          type="button"
                          title={booked ? `#${tokenNo} already booked - click to reuse as manual duplicate` : reserved ? `#${tokenNo} reserved and available` : `Use #${tokenNo} as custom serial`}
                          className={`relative h-9 min-w-9 rounded-lg border text-xs font-bold transition ${
                            booked
                              ? selectedManual
                                ? 'border-fuchsia-600 bg-fuchsia-600 text-white shadow-sm ring-2 ring-fuchsia-100'
                                : 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 hover:border-fuchsia-500 hover:bg-fuchsia-100 dark:border-fuchsia-700 dark:bg-fuchsia-950/30 dark:text-fuchsia-200'
                              : selected
                                ? 'border-amber-500 bg-amber-500 text-white shadow-sm ring-2 ring-amber-100'
                                : reserved
                                  ? 'border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-500'
                                  : nextRegular
                                    ? 'border-cyan-400 bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100 hover:border-cyan-600'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50'
                          }`}
                          onClick={() => {
                            if (booked) {
                              setAppointmentTokenMode('manual');
                              setAppointmentRequestedToken('');
                              setAppointmentManualToken(String(tokenNo));
                              return;
                            }
                            if (reserved) {
                              setAppointmentTokenMode('reserved');
                              setAppointmentManualToken('');
                              setAppointmentRequestedToken(tokenNo);
                              return;
                            }
                            setAppointmentTokenMode('manual');
                            setAppointmentRequestedToken('');
                            setAppointmentManualToken(String(tokenNo));
                          }}
                        >
                          {tokenNo}
                          {booked ? <span className="absolute -right-1.5 -top-1 rounded-full bg-fuchsia-600 px-1 text-[9px] leading-3 text-white ring-2 ring-white">x2</span> : null}
                          {!booked && reserved ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-white" /> : null}
                          {nextRegular && !selected && !booked ? <span className="absolute -bottom-1 left-1/2 h-1 w-4 -translate-x-1/2 rounded-full bg-cyan-500" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 lg:grid-cols-3">
                  <button
                    type="button"
                    className={`rounded-xl border p-3 text-left transition ${appointmentTokenMode === 'auto' ? 'border-cyan-400 bg-white shadow-sm ring-2 ring-cyan-100 dark:border-cyan-500 dark:bg-cyan-950/30' : 'border-[var(--color-border)] bg-white/80 hover:border-cyan-200 hover:bg-white dark:bg-slate-900'}`}
                    onClick={() => {
                      setAppointmentTokenMode('auto');
                      setAppointmentRequestedToken('');
                      setAppointmentManualToken('');
                    }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--color-text-primary)]">Auto regular</span>
                      <span className={`grid h-5 w-5 place-items-center rounded-full border text-xs ${appointmentTokenMode === 'auto' ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-slate-300 text-transparent'}`}>✓</span>
                    </span>
                    <span className="mt-1 block font-data text-xl font-bold text-cyan-700">#{tokenAvailabilitySummary?.nextRegularTokenNo ?? 'Auto'}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">Recommended</span>
                  </button>

                  <button
                    type="button"
                    disabled={availableTokensLoading || availableTokens.length === 0}
                    className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${appointmentTokenMode === 'reserved' ? 'border-blue-400 bg-white shadow-sm ring-2 ring-blue-100 dark:border-blue-500 dark:bg-blue-950/30' : 'border-[var(--color-border)] bg-white/80 hover:border-blue-200 hover:bg-white dark:bg-slate-900'}`}
                    onClick={() => {
                      if (availableTokens.length === 0) return;
                      setAppointmentTokenMode('reserved');
                      setAppointmentManualToken('');
                      setAppointmentRequestedToken(availableTokens[0]?.token_no ?? '');
                    }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--color-text-primary)]">Reserved serial</span>
                      <span className={`grid h-5 w-5 place-items-center rounded-full border text-xs ${appointmentTokenMode === 'reserved' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 text-transparent'}`}>✓</span>
                    </span>
                    <span className="mt-1 block font-data text-xl font-bold text-blue-700">{availableTokens.length > 0 ? `${availableTokens.length} free` : 'None'}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">Reserved slot</span>
                  </button>

                  <button
                    type="button"
                    className={`rounded-xl border p-3 text-left transition ${appointmentTokenMode === 'manual' ? 'border-amber-400 bg-white shadow-sm ring-2 ring-amber-100 dark:border-amber-500 dark:bg-amber-950/30' : 'border-[var(--color-border)] bg-white/80 hover:border-amber-200 hover:bg-white dark:bg-slate-900'}`}
                    onClick={() => {
                      setAppointmentTokenMode('manual');
                      setAppointmentRequestedToken('');
                    }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--color-text-primary)]">Custom serial</span>
                      <span className={`grid h-5 w-5 place-items-center rounded-full border text-xs ${appointmentTokenMode === 'manual' ? 'border-amber-600 bg-amber-600 text-white' : 'border-slate-300 text-transparent'}`}>✓</span>
                    </span>
                    <span className="mt-1 block font-data text-xl font-bold text-amber-700">{appointmentManualToken ? `#${appointmentManualToken}` : 'Manual'}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">Fill gap / VIP</span>
                  </button>
                </div>

                {appointmentTokenMode === 'reserved' && availableTokens.length > 0 ? (
                  <div className="mt-2 rounded-xl border border-blue-100 bg-white p-2 dark:border-blue-900/50 dark:bg-slate-900">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--color-text-muted)]">Reserved free:</span>
                      {availableTokens.map((token) => {
                        const selected = Number(appointmentRequestedToken) === Number(token.token_no);
                        return (
                          <button
                            key={token.token_no}
                            type="button"
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${selected ? 'border-blue-500 bg-blue-600 text-white shadow-sm' : 'border-blue-100 bg-blue-50 text-blue-700 hover:border-blue-300 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200'}`}
                            onClick={() => setAppointmentRequestedToken(Number(token.token_no))}
                          >
                            #{token.token_no}{token.label ? <span className="ml-1 opacity-80">{token.label}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {appointmentTokenMode === 'manual' ? (
                  <div className="mt-2 rounded-xl border border-amber-100 bg-white p-2 dark:border-amber-900/50 dark:bg-slate-900">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_190px] sm:items-center">
                      <p className="text-xs text-[var(--color-text-muted)]"><span className="font-semibold text-[var(--color-text-primary)]">Custom serial:</span> click a free number above or type manually.</p>
                      <CustomSerialInput value={appointmentManualToken} onChange={setAppointmentManualToken} />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div>
              <label className="label">Patient concern / report-show note</label>
              <textarea className="input min-h-20" value={appointmentComplaint} onChange={(event) => setAppointmentComplaint(event.target.value)} placeholder="Main complaint, follow-up note, report show purpose..." />
            </div>

            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <button className="btn-secondary" onClick={() => setActiveModal('none')}>Cancel</button>
              <button
                className="btn-secondary"
                disabled={createAppointmentMutation.isPending || payAppointmentMutation.isPending || !appointmentPatient || !appointmentDoctorId}
                onClick={() => submitAppointmentBooking('due')}
              >
                {createAppointmentMutation.isPending && appointmentBookingActionRef.current === 'due'
                  ? t('btn.booking', { ns: 'reception' })
                  : t('btn.bookAndDue', { ns: 'reception' })}
              </button>
              <button
                className="btn-primary"
                disabled={createAppointmentMutation.isPending || payAppointmentMutation.isPending || !appointmentPatient || !appointmentDoctorId}
                onClick={() => submitAppointmentBooking('pay')}
              >
                {(createAppointmentMutation.isPending && appointmentBookingActionRef.current === 'pay') || payAppointmentMutation.isPending
                  ? t('btn.collecting', { ns: 'reception' })
                  : t('btn.bookAndPay', { ns: 'reception' })}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {activeModal === 'appointmentPayment' && bookedAppointment && (
        <Modal title={t('modal.collectAppointmentPayment', { ns: 'reception' })} onClose={() => setActiveModal('none')}>
          <div className="space-y-4">
            {!activeCounterSession ? (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {t('appointmentPayment.counterRequired', { ns: 'reception', defaultValue: 'Billing counter session is required before collecting appointment payment.' })}
              </div>
            ) : null}
            <div className="rounded-lg bg-emerald-50 p-4">
              <div className="text-sm text-emerald-700">Payable consultation fee</div>
              <div className="font-data text-2xl font-semibold text-emerald-900">{formatBDT(bookedAppointment.consultationFee ?? appointmentPreview?.finalFee ?? 0)}</div>
            </div>
            <div className="rounded-md border border-[var(--color-border)] bg-white px-3 py-3 text-xs dark:bg-slate-800">
              <div className="mb-2 font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Scheme / Benefit</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input className="input h-8 bg-white" value={appointmentPaymentSchemeCodeInput} onChange={(event) => { setAppointmentPaymentSchemeCodeInput(event.target.value); setAppointmentPaymentSchemePreview(null); }} placeholder="Scheme code" />
                <input className="input h-8 bg-white" value={appointmentPaymentMemberCodeInput} onChange={(event) => { setAppointmentPaymentMemberCodeInput(event.target.value); setAppointmentPaymentSchemePreview(null); }} placeholder="Member code" />
                <button
                  type="button"
                  className="btn-secondary h-8 justify-center px-2 text-xs"
                  disabled={checkAppointmentPaymentSchemePreviewMutation.isPending || (!appointmentPaymentSchemeCodeInput.trim() && !appointmentPaymentMemberCodeInput.trim()) || Number(bookedAppointment.consultationFee ?? appointmentPreview?.finalFee ?? 0) <= 0}
                  onClick={() => checkAppointmentPaymentSchemePreviewMutation.mutate({
                    patient_id: bookedAppointment.patientId,
                    scheme_code: appointmentPaymentSchemeCodeInput.trim() || undefined,
                    member_code: appointmentPaymentMemberCodeInput.trim() || undefined,
                    service_category: 'appointment_payment',
                    subtotal: Number(bookedAppointment.consultationFee ?? appointmentPreview?.finalFee ?? 0),
                  })}
                >
                  {checkAppointmentPaymentSchemePreviewMutation.isPending ? 'Checking…' : 'Check'}
                </button>
              </div>
              <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                {appointmentPaymentSchemePreview?.eligible
                  ? `${appointmentPaymentSchemePreview.scheme_name ?? 'Scheme'} · suggested ${formatBDT(Math.min(Number(appointmentPaymentSchemePreview.suggested_discount ?? 0), Number(bookedAppointment.consultationFee ?? appointmentPreview?.finalFee ?? 0)))}`
                  : appointmentPaymentSchemePreview?.blockers?.join(', ') || 'Optional: leave empty for normal appointment payment.'}
              </div>
            </div>

            <div>
              <label className="label">Payment method</label>
              <select className="input" value={appointmentPaymentMethod} onChange={(event) => {
                setAppointmentPaymentMethod(event.target.value);
                if (event.target.value === 'cash') setAppointmentPaymentReference('');
              }}>
                <option value="cash">Cash</option>
                <option value="bkash">bKash</option>
                <option value="nagad">Nagad</option>
                <option value="card">Card</option>
                <option value="bank">Bank</option>
              </select>
            </div>
            {requiresPaymentReference(appointmentPaymentMethod, Number(bookedAppointment.consultationFee ?? appointmentPreview?.finalFee ?? 0)) ? (
              <div>
                <label className="label">Transaction / reference number</label>
                <input className="input" value={appointmentPaymentReference} onChange={(event) => setAppointmentPaymentReference(event.target.value)} placeholder="bKash/Nagad/card/bank reference" />
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <button className="btn-secondary" onClick={() => setActiveModal('none')}>Later</button>
              <button
                className="btn-primary"
                disabled={payAppointmentMutation.isPending}
                onClick={() => {
                  if (!activeCounterSession) {
                    queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        invalidateReceptionDashboardSnapshot();
                    navigate(`${basePath}/billing-counter`);
                    return;
                  }
                  const appointmentAmount = Math.max(0, Number(bookedAppointment.consultationFee ?? appointmentPreview?.finalFee ?? 0));
                  if (requiresPaymentReference(appointmentPaymentMethod, appointmentAmount) && !appointmentPaymentReference.trim()) {
                    toast.error('Transaction/reference number is required for non-cash payments.');
                    return;
                  }
                  payAppointmentMutation.mutate({
                    id: bookedAppointment.id,
                    paymentMethod: appointmentPaymentMethod,
                    externalTransactionId: normalizeExternalTransactionId(appointmentPaymentMethod, appointmentAmount, appointmentPaymentReference),
                    discountByName: (bookedAppointment.discountByName || appointmentDiscountByName).trim() || undefined,
                    schemeApplication: appointmentPaymentSchemePreview?.eligible && Number(appointmentPaymentSchemePreview.suggested_discount ?? 0) > 0 ? {
                      schemeId: appointmentPaymentSchemePreview.scheme_id ?? undefined,
                      schemeCode: (appointmentPaymentSchemePreview.scheme_code ?? appointmentPaymentSchemeCodeInput.trim()) || undefined,
                      memberCode: (appointmentPaymentSchemePreview.matched_member_code ?? appointmentPaymentMemberCodeInput.trim()) || undefined,
                      memberId: appointmentPaymentSchemePreview.matched_member_id ?? undefined,
                      serviceCategory: appointmentPaymentSchemePreview.service_category ?? 'appointment_payment',
                      allocationType: reasonForDiscountSource(appointmentPaymentSchemePreview.allocation_type),
                      suggestedDiscount: appointmentPaymentSchemePreview.suggested_discount,
                    } : undefined,
                    idempotencyKey: `dash-appt-pay-${bookedAppointment.id}-${crypto.randomUUID()}`,
                  });
                }}
              >
                {payAppointmentMutation.isPending ? t('btn.collecting', { ns: 'reception' }) : activeCounterSession ? t('btn.collectAndPrint', { ns: 'reception' }) : t('btn.openBillingCounter', { ns: 'reception' })}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── New Visit Modal ── */}
      {activeModal === 'newVisit' && (
        <Modal title={t('modal.walkInNewVisit', { ns: 'reception' })} onClose={() => setActiveModal('none')}>
          <div className="space-y-4">
            <div>
              <label className="label">Search Patient *</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input className="input pl-9" placeholder="Mobile number, name, or patient code"
                  value={newVisitPatientId ? (patients.find(p => p.id === newVisitPatientId)?.name ?? '') : patientSearch}
                  onChange={e => { setPatientSearch(e.target.value); setNewVisitPatientId(''); }}
                />
              </div>
              {!newVisitPatientId && patientSearch && filteredPatients.length > 0 && (
                <div className="mt-1 border border-[var(--color-border)] rounded-lg overflow-hidden shadow-card max-h-40 overflow-y-auto">
                  {filteredPatients.map(p => (
                    <button key={p.id} onClick={() => { setNewVisitPatientId(p.id); setPatientSearch(''); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-border-light)] flex justify-between">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-[var(--color-text-muted)]">{buildReceptionPatientIdentityText(p)}</span>
                    </button>
                  ))}
                </div>
              )}
              {!newVisitPatientId && patientSearch && filteredPatients.length === 0 && (
                <button onClick={() => {
                  setNewPatientReturnModal('newVisit');
                  const searchTerm = patientSearch.trim();
                  const digits = searchTerm.replace(/\D/g, '');
                  const isMobile = digits.length >= 6;
                  setNewPatientForm({
                    ...EMPTY_NEW_PATIENT_FORM,
                    name: isMobile ? '' : searchTerm,
                    mobile: isMobile ? searchTerm : '',
                  });
                  setActiveModal('newPatient');
                }} className="mt-1 text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1">
                  <UserPlus className="w-3.5 h-3.5" /> Register new patient
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Visit Type</label>
                <select className="input" value={newVisitType} onChange={e => setNewVisitType(e.target.value as 'opd' | 'emergency')}>
                  <option value="opd">OPD</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
              <div>
                <label className="label">Doctor</label>
                <select className="input" value={newVisitDoctorId} onChange={e => setNewVisitDoctorId(Number(e.target.value) || '')}>
                  <option value="">Select (optional)</option>
                  {doctors.map(d => {
                    const fee = Number(d.consultation_fee ?? 0);
                    return <option key={d.id} value={d.id}>{d.name} — {d.specialty || 'Doctor'} — {fee > 0 ? formatBDT(fee) : 'No fee'}</option>;
                  })}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={issueToken && canAutoIssueToken}
                disabled={!canAutoIssueToken}
                onChange={e => setIssueToken(e.target.checked)}
                className="accent-[var(--color-primary)] w-4 h-4 disabled:opacity-50"
              />
              <Ticket className="w-4 h-4 text-[var(--color-text-muted)]" />
              <span className="text-sm">Issue queue token automatically</span>
            </label>
            {!canAutoIssueToken && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {t('newVisit.consultationFeeHint', { ns: 'reception', defaultValue: 'Consultation fee {{fee}}. Send the charge to billing, approve due, or mark no-charge before queue token.', fee: formatBDT(selectedDoctorFee) })}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setActiveModal('none')} className="btn-secondary">Cancel</button>
              <button
                onClick={() => {
                  if (!newVisitPatientId) { toast.error(t('toast.selectPatient', { ns: 'reception' })); return; }
                  createVisitMutation.mutate({
                    patientId: Number(newVisitPatientId),
                    doctorId: newVisitDoctorId ? Number(newVisitDoctorId) : undefined,
                    visitType: newVisitType,
                  });
                }}
                disabled={createVisitMutation.isPending || !newVisitPatientId}
                className="btn-primary"
              >
                {createVisitMutation.isPending ? t('btn.creating', { ns: 'reception' }) : t('btn.createVisit', { ns: 'reception' })}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add Service Modal (Bulk Add Multiple Items) ── */}
      {activeModal === 'addService' && selectedVisit && (
        <Modal
          title={
            <>
              {t('modal.addServiceTest', { ns: 'reception', name: selectedVisit.patient_name })}
              {buildPatientInlineLabel(selectedVisit)}
            </>
          }
          onClose={() => setActiveModal('none')}
          size="wide"
        >
          <div className="space-y-4">
            {/* Search + filter row */}
            <div className="grid gap-3 md:grid-cols-[1fr_1.2fr_1.4fr]">
              <div>
                <label className="label">Department</label>
                <select className="input" value={selectedServiceDept} onChange={e => { setSelectedServiceDept(Number(e.target.value) || ''); setSelectedServiceCategory(''); }}>
                  <option value="">All</option>
                  {serviceDepts.map(d => <option key={d.id} value={d.id}>{d.department_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Category</label>
                <select className="input" value={selectedServiceCategory} onChange={e => setSelectedServiceCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {serviceCategoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Search Service</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                  <input className="input pl-9" placeholder="Service name" value={serviceSearch} onChange={e => setServiceSearch(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,55fr)_minmax(320px,45fr)]">

              {/* Left: Service catalog + compact doctor selector */}
              <div className="space-y-3">
                <div className="border border-[var(--color-border)] rounded-lg max-h-80 overflow-y-auto">
                  {modalServicesLoading ? (
                    <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">Loading services...</div>
                  ) : filteredServices.length === 0 ? (
                    <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">{t('empty.noServicesFound', { ns: 'reception' })}</div>
                  ) : (
                    filteredServices.map(s => (
                      <button key={s.id}
                        onClick={() => toggleServiceSelection(s)}
                        className={`w-full text-left px-3 py-2.5 flex justify-between items-center hover:bg-[var(--color-border-light)] border-b border-[var(--color-border)] last:border-0 ${selectedServiceLines.some((line) => line.id === s.id) ? 'bg-blue-50 dark:bg-blue-950' : ''}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-5 h-5 rounded border flex items-center justify-center ${selectedServiceLines.some((line) => line.id === s.id) ? 'bg-[var(--color-primary)] border-[var(--color-primary)]' : 'border-[var(--color-border)]'}`}>
                            {selectedServiceLines.some((line) => line.id === s.id) && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                          </div>
                          <span className="font-medium text-sm">{s.item_name}</span>
                          {s.is_lab_catalog === 1 && (
                            <span className="badge badge-info text-[10px]">Lab</span>
                          )}
                          {s.is_radiology === 1 && (
                            <span className="badge bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 text-[10px]">X-Ray/Rad</span>
                          )}
                          {s.category_name && (
                            <span className="text-xs text-[var(--color-text-muted)]">{s.category_name}</span>
                          )}
                          {Number(s.usage_count ?? 0) > 0 && (
                            <span className="text-[10px] text-emerald-700 dark:text-emerald-300">{s.usage_count}x</span>
                          )}
                          <span className="text-xs text-[var(--color-text-muted)]">{s.department_name}</span>
                        </div>
                        <span className="font-data font-semibold text-sm">{formatBDT(s.price)}</span>
                      </button>
                    ))
                  )}
                </div>

                {selectedServiceLines.length > 0 && (
                  <div className="rounded-lg border border-[var(--color-border)] bg-slate-50/70 p-3 dark:bg-slate-900/40">
                    <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Doctor (if applicable)</label>
                    <select className="input h-9 text-sm" value={selectedServiceDoctorId} onChange={e => setSelectedServiceDoctorId(Number(e.target.value) || '')}>
                      <option value="">None</option>
                      {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <label className="mt-3 mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Performer</label>
                    <input
                      className="input mb-2 h-9 text-sm"
                      placeholder="Search performer doctor"
                      value={selectedServicePerformerDoctorSearch}
                      onChange={e => setSelectedServicePerformerDoctorSearch(e.target.value)}
                    />
                    <select className="input h-9 text-sm" value={selectedServicePerformerDoctorId} onChange={e => setSelectedServicePerformerDoctorId(Number(e.target.value) || '')}>
                      <option value="">No performer</option>
                      {filteredSelectedServicePerformerDoctors.map(d => <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` - ${d.specialty}` : ''}</option>)}
                    </select>
                    {performerDoctors.length === 0 ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">No performer commission rule configured for lab tests.</p> : null}
                  </div>
                )}
              </div>

              {/* Right: Selected items */}
              <div className="border border-[var(--color-border)] rounded-lg flex flex-col">
                <div className="px-3 py-2.5 border-b border-[var(--color-border)] bg-slate-50 dark:bg-slate-800">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-[var(--color-text)]">Selected</span>
                    <span className="badge badge-primary text-xs">{selectedServiceLines.length}</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto max-h-80">
                  {selectedServiceLines.length === 0 ? (
                    <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">Click items on the left to add</div>
                  ) : (
                    <div className="divide-y divide-[var(--color-border)]">
                      {selectedServiceLines.map((line) => (
                        <div key={line.id} className="px-2.5 py-2">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{line.item_name}</div>
                              <div className="truncate text-[11px] text-[var(--color-text-muted)]">{line.department_name}{line.category_name ? ` - ${line.category_name}` : ''}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-40"
                                onClick={() => bumpSelectedServiceQty(line.id, -1)}
                                disabled={Number(line.quantity ?? 1) <= 1}
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="min-w-5 text-center font-data text-xs font-semibold">{line.quantity}</span>
                              <button
                                type="button"
                                className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]"
                                onClick={() => bumpSelectedServiceQty(line.id, 1)}
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                              <span className="min-w-16 text-right font-data text-sm font-semibold">{formatBDT(Number(line.price ?? 0) * Number(line.quantity ?? 1))}</span>
                              <button
                                onClick={() => toggleServiceSelection(line)}
                                className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {selectedServiceLines.length > 0 && (
                  <div className="px-3 py-2 border-t border-[var(--color-border)] bg-emerald-50 dark:bg-emerald-950">
                    <div className="space-y-2">
                      {shouldShowServiceDepositField(selectedServicesDepositBalance) ? (
                        <div className="rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-xs text-emerald-800">
                          <div className="flex items-center justify-between gap-2">
                            <span>Available deposit</span>
                            <span className="font-data font-semibold">{formatBDT(selectedServicesDepositBalance)}</span>
                          </div>
                          <button
                            type="button"
                            className="mt-1 text-[11px] font-semibold text-[var(--color-primary)]"
                            onClick={() => setServiceDepositDeducted(String(Math.min(selectedServicesDepositBalance, selectedServicesGrandTotal)))}
                          >
                            Use max deposit
                          </button>
                        </div>
                      ) : null}
                      {canApplyDiscount && serviceAdvancedDiscount ? (
                        <div className="rounded-md border border-[var(--color-border)] bg-white px-2 py-2 text-xs dark:bg-slate-800">
                          <div className="mb-2 font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Scheme / Benefit</div>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <input className="input h-8 bg-white" value={serviceSchemeCodeInput} onChange={(event) => { setServiceSchemeCodeInput(event.target.value); setServiceSchemePreview(null); }} placeholder="Scheme code" />
                            <input className="input h-8 bg-white" value={serviceMemberCodeInput} onChange={(event) => { setServiceMemberCodeInput(event.target.value); setServiceSchemePreview(null); }} placeholder="Member code" />
                            <button type="button" className="btn-secondary h-8 justify-center px-2 text-xs" disabled={checkVisitServiceSchemePreviewMutation.isPending || selectedServicesSubtotal <= 0 || !selectedVisit} onClick={submitVisitServiceSchemeCheck}>
                              {checkVisitServiceSchemePreviewMutation.isPending ? 'Checking…' : 'Check'}
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
                            <span>{serviceSchemePreview?.eligible ? `${serviceSchemePreview.scheme_name ?? 'Scheme'} · ${serviceSchemePreview.discount_value}% · suggested ${formatBDT(selectedServicesSuggestedSchemeDiscount)}` : serviceSchemePreview?.blockers?.join(', ') || 'Optional: check staff/VIP/member benefit for this visit bill.'}</span>
                            <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!serviceSchemePreview?.eligible || selectedServicesSuggestedSchemeDiscount <= 0} onClick={applyVisitServiceSchemeDiscount}>Apply</button>
                          </div>
                        </div>
                      ) : null}
                      {canApplyDiscount ? (
                        <div>
                          <label className="label text-xs">Discount</label>
                          <input
                            type="number"
                            min={0}
                            max={selectedServicesSubtotal}
                            className="input bg-white"
                            value={serviceDiscount}
                            onChange={(event) => {
                              const value = event.target.value;
                              setServiceDiscount(value === '' ? '' : String(Math.min(selectedServicesSubtotal, Math.max(0, Number(value) || 0))));
                            }}
                          />
                        </div>
                      ) : null}
                      {canApplyDiscount && showDiscountReferralField(serviceDiscountAmount) ? (
                        <div>
                          <label className="label text-xs">Discount referred by{serviceDiscountByNameRequired ? ' *' : ''}</label>
                          <input
                            className="input bg-white"
                            value={serviceDiscountByName}
                            onChange={(event) => setServiceDiscountByName(event.target.value)}
                            placeholder={serviceDiscountByNameRequired ? 'Required above 20%' : 'Optional'}
                          />
                        </div>
                      ) : null}
                      {canApplyDiscount && serviceDiscountAmount > 0 ? (
                        <DiscountAllocationEditor
                          totalDiscount={serviceDiscountAmount}
                          enabled={serviceAdvancedDiscount}
                          rows={serviceDiscountSources}
                          onEnabledChange={setServiceAdvancedDiscount}
                          onRowsChange={setServiceDiscountSources}
                          onQuickSourceSelected={(reason) => {
                            if (reason === 'doctor_commission_waiver' && serviceDoctorWaiverDoctorName) {
                              setServiceDiscountByName(serviceDoctorWaiverDoctorName);
                            }
                          }}
                          compact
                          context={{
                            selectedDoctorId: serviceDoctorWaiverDoctorId,
                            doctorAvailableWaiverAmount: serviceHasEligibleSchemePreview ? 0 : serviceDoctorWaiverAmount,
                            doctorWaiverLoading: !serviceHasEligibleSchemePreview && serviceDoctorWaiverLoading,
                          }}
                        />
                      ) : canApplyDiscount ? (
                        <button
                          type="button"
                          className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-xs font-semibold text-[var(--color-text)] shadow-sm hover:bg-[var(--color-bg-secondary)] dark:bg-slate-900"
                          onClick={() => {
                            if (serviceDiscountSources.length === 0) {
                              setServiceDiscountSources(createDefaultDiscountAllocations(serviceDiscountAmount, {
                                selectedDoctorId: serviceDoctorWaiverDoctorId,
                                doctorAvailableWaiverAmount: serviceHasEligibleSchemePreview ? 0 : serviceDoctorWaiverAmount,
                                doctorWaiverLoading: !serviceHasEligibleSchemePreview && serviceDoctorWaiverLoading,
                              }));
                            }
                            setServiceAdvancedDiscount(true);
                          }}
                        >
                          Advanced / Split
                        </button>
                      ) : null}
                      <div className={`grid gap-2 ${shouldShowServiceDepositField(selectedServicesDepositBalance) ? 'grid-cols-3' : 'grid-cols-2'}`}>
                        {shouldShowServiceDepositField(selectedServicesDepositBalance) ? (
                          <div>
                            <label className="label text-xs">Use deposit</label>
                            <input
                              type="number"
                              min={0}
                              max={Math.min(selectedServicesDepositBalance, selectedServicesGrandTotal)}
                              className="input bg-white"
                              value={serviceDepositDeducted}
                              onChange={(event) => setServiceDepositDeducted(String(Math.min(selectedServicesDepositBalance, selectedServicesGrandTotal, Math.max(0, Number(event.target.value) || 0))))}
                              placeholder="0"
                            />
                          </div>
                        ) : null}
                        <div>
                          <label className="label text-xs">Pay now</label>
                          <input
                            type="number"
                            min={0}
                            max={selectedServicesPayableNow}
                            className="input bg-white"
                            value={serviceCashPaid}
                            onChange={(event) => setServiceCashPaid(String(Math.min(selectedServicesPayableNow, Math.max(0, Number(event.target.value) || 0))))}
                            placeholder={formatBDT(selectedServicesPayableNow)}
                          />
                        </div>
                        <div>
                          <label className="label text-xs">Payment method</label>
                          <select className="input bg-white" value={servicePaymentMethod} onChange={(event) => {
                            setServicePaymentMethod(event.target.value);
                            if (event.target.value === 'cash') setServicePaymentReference('');
                          }}>
                          <option value="cash">Cash</option>
                          <option value="bkash">bKash</option>
                          <option value="nagad">Nagad</option>
                          <option value="card">Card</option>
                          <option value="bank">Bank</option>
                          <option value="cheque">Cheque</option>
                          </select>
                        </div>
                        {requiresPaymentReference(servicePaymentMethod, selectedServicesCashPaid) ? (
                          <div className="col-span-full">
                            <label className="label text-xs">Transaction / reference number</label>
                            <input className="input bg-white" value={servicePaymentReference} onChange={(event) => setServicePaymentReference(event.target.value)} placeholder="bKash/Nagad/card/bank reference" />
                          </div>
                        ) : null}
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Grand Total</span>
                        <span className="font-data text-sm font-bold text-emerald-700 dark:text-emerald-400">
                          {formatBDT(selectedServicesGrandTotal)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-emerald-700/80 dark:text-emerald-300">
                        <span>Subtotal</span>
                        <span className="font-data">{formatBDT(selectedServicesSubtotal)}</span>
                      </div>
                      {canApplyDiscount ? (
                        <div className="flex justify-between items-center text-[11px] text-amber-700 dark:text-amber-300">
                          <span>Discount</span>
                          <span className="font-data">- {formatBDT(serviceDiscountAmount)}</span>
                        </div>
                      ) : null}
                      {selectedServicesDepositApplied > 0 ? (
                        <div className="flex justify-between items-center text-[11px] text-emerald-700/80 dark:text-emerald-300">
                          <span>Deposit applied</span>
                          <span className="font-data">- {formatBDT(selectedServicesDepositApplied)}</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between items-center text-xs font-semibold text-[var(--color-text)]">
                        <span>Payable now</span>
                        <span className="font-data">{formatBDT(selectedServicesPayableNow)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-emerald-700/80 dark:text-emerald-300">
                        <span>Pay now</span>
                        <span className="font-data">{formatBDT(selectedServicesCashPaid)}</span>
                      </div>
                      {selectedServicesDueAfterPayment > 0 ? (
                        <div className="flex justify-between items-center text-[11px] text-amber-700 dark:text-amber-300">
                          <span>Due after payment</span>
                          <span className="font-data">{formatBDT(selectedServicesDueAfterPayment)}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            </div>


            {/* Current visit services preview */}
            {visitServicesData && visitServicesData.services.length > 0 && (
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-600 mb-2">Current Visit Services ({visitServicesData.services.length})</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {visitServicesData.services.map(s => (
                    <div key={s.id} className="flex justify-between text-xs">
                      <span className="flex items-center gap-1">
                        {serviceIcon(s.service_type)}
                        {s.description}
                        {s.status === 'pending' && <span className="badge badge-warning text-[10px] px-1">pending</span>}
                        {s.status === 'billed' && <span className="badge badge-success text-[10px] px-1">billed</span>}
                      </span>
                      <span className="font-data">{formatBDT(s.total_amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-2 pt-2 border-t border-slate-200">
                  <span className="text-xs font-semibold">Pending Total</span>
                  <span className="font-data font-bold text-sm">{formatBDT(visitServicesData.pendingTotal)}</span>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setActiveModal('none')} className="btn-secondary">Close</button>
              <button
                onClick={() => {
                  if (selectedServiceLines.length === 0) { toast.error(t('toast.selectAtLeastOneService', { ns: 'reception' })); return; }
                  if (!activeCounterSession) { toast.error(t('toast.activateBillingCounter', { ns: 'reception' })); return; }
                  if (requireDiscountReferralName(selectedServicesSubtotal, canApplyDiscount ? serviceDiscountAmount : 0, serviceDiscountByName)) return;
                  if (serviceDoctorWaiverLoading && serviceDiscountSources.some((row) => row.reason === 'doctor_commission_waiver')) {
                    toast.error('Wait for the doctor commission preview to finish.');
                    return;
                  }
                  if (serviceAdvancedDiscount && !hasBalancedDiscountAllocations(serviceDiscountAmount, serviceDiscountSources)) {
                    toast.error('Advanced discount source total must match discount amount.');
                    return;
                  }
                  const serviceDiscountAllocationPayload = getDiscountAllocationPayload(canApplyDiscount ? serviceDiscountAmount : 0, serviceAdvancedDiscount, serviceDiscountSources);
                  const linesWithDiscount = allocateServiceDiscounts(selectedServiceLines, canApplyDiscount ? serviceDiscountAmount : 0);
                  createVisitServiceBillMutation.mutate({
                    patientId: selectedVisit.patient_id,
                    visitId: selectedVisit.id,
                    billMode: selectedServicesDepositApplied > 0 ? 'paid' : 'credit',
                    referringDoctorId: selectedServiceDoctorId ? Number(selectedServiceDoctorId) : undefined,
                    discountByName: serviceDiscountByName.trim() || undefined,
                    schemeApplication: serviceSchemePreview?.eligible && serviceDiscountAmount > 0 ? {
                      schemeId: serviceSchemePreview.scheme_id ?? undefined,
                      schemeCode: (serviceSchemePreview.scheme_code ?? serviceSchemeCodeInput.trim()) || undefined,
                      memberCode: (serviceSchemePreview.matched_member_code ?? serviceMemberCodeInput.trim()) || undefined,
                      memberId: serviceSchemePreview.matched_member_id ?? undefined,
                      serviceCategory: serviceSchemePreview.service_category ?? 'visit_service_bill',
                      allocationType: reasonForDiscountSource(serviceSchemePreview.allocation_type),
                      suggestedDiscount: serviceSchemePreview.suggested_discount,
                    } : undefined,
                    discountAllocations: serviceDiscountAllocationPayload,
                    idempotencyKey: visitServiceBillIdempotencyKey + '-credit',
                    items: linesWithDiscount.map((line) => ({
                      serviceItemId: line.id,
                      quantity: line.quantity,
                      discountAmount: line.allocatedDiscount,
                      performerDoctorId: line.performerDoctorId ? Number(line.performerDoctorId) : selectedServicePerformerDoctorId ? Number(selectedServicePerformerDoctorId) : undefined,
                      prescriberDoctorId: selectedServiceDoctorId ? Number(selectedServiceDoctorId) : undefined,
                    })),
                    payment: {
                      paymentMethod: servicePaymentMethod,
                      paidAmount: 0,
                      depositDeducted: selectedServicesDepositApplied,
                      creditAmount: selectedServicesPayableNow,
                    },
                  });
                }}
                disabled={createVisitServiceBillMutation.isPending || selectedServiceLines.length === 0 || !activeCounterSession}
                className="btn-secondary"
              >
                {createVisitServiceBillMutation.isPending ? t('btn.creating', { ns: 'reception' }) : t('btn.createBillUpper', { ns: 'reception' })}
              </button>
              <button
                onClick={() => {
                  if (selectedServiceLines.length === 0) { toast.error(t('toast.selectAtLeastOneService', { ns: 'reception' })); return; }
                  if (!activeCounterSession) { toast.error(t('toast.activateBillingCounter', { ns: 'reception' })); return; }
                  if (requiresPaymentReference(servicePaymentMethod, selectedServicesCashPaid) && !servicePaymentReference.trim()) {
                    toast.error('Transaction/reference number is required for non-cash payments.');
                    return;
                  }
                  if (requireDiscountReferralName(selectedServicesSubtotal, canApplyDiscount ? serviceDiscountAmount : 0, serviceDiscountByName)) return;
                  if (serviceDoctorWaiverLoading && serviceDiscountSources.some((row) => row.reason === 'doctor_commission_waiver')) {
                    toast.error('Wait for the doctor commission preview to finish.');
                    return;
                  }
                  if (serviceAdvancedDiscount && !hasBalancedDiscountAllocations(serviceDiscountAmount, serviceDiscountSources)) {
                    toast.error('Advanced discount source total must match discount amount.');
                    return;
                  }
                  const serviceDiscountAllocationPayload = getDiscountAllocationPayload(canApplyDiscount ? serviceDiscountAmount : 0, serviceAdvancedDiscount, serviceDiscountSources);
                  const linesWithDiscount = allocateServiceDiscounts(selectedServiceLines, canApplyDiscount ? serviceDiscountAmount : 0);
                  createVisitServiceBillMutation.mutate({
                    patientId: selectedVisit.patient_id,
                    visitId: selectedVisit.id,
                    billMode: 'paid',
                    referringDoctorId: selectedServiceDoctorId ? Number(selectedServiceDoctorId) : undefined,
                    discountByName: serviceDiscountByName.trim() || undefined,
                    schemeApplication: serviceSchemePreview?.eligible && serviceDiscountAmount > 0 ? {
                      schemeId: serviceSchemePreview.scheme_id ?? undefined,
                      schemeCode: (serviceSchemePreview.scheme_code ?? serviceSchemeCodeInput.trim()) || undefined,
                      memberCode: (serviceSchemePreview.matched_member_code ?? serviceMemberCodeInput.trim()) || undefined,
                      memberId: serviceSchemePreview.matched_member_id ?? undefined,
                      serviceCategory: serviceSchemePreview.service_category ?? 'visit_service_bill',
                      allocationType: reasonForDiscountSource(serviceSchemePreview.allocation_type),
                      suggestedDiscount: serviceSchemePreview.suggested_discount,
                    } : undefined,
                    discountAllocations: serviceDiscountAllocationPayload,
                    idempotencyKey: visitServiceBillIdempotencyKey + '-paid',
                    items: linesWithDiscount.map((line) => ({
                      serviceItemId: line.id,
                      quantity: line.quantity,
                      discountAmount: line.allocatedDiscount,
                      performerDoctorId: line.performerDoctorId ? Number(line.performerDoctorId) : selectedServicePerformerDoctorId ? Number(selectedServicePerformerDoctorId) : undefined,
                      prescriberDoctorId: selectedServiceDoctorId ? Number(selectedServiceDoctorId) : undefined,
                    })),
                    payment: {
                      paymentMethod: servicePaymentMethod,
                      paidAmount: selectedServicesCashPaid,
                      depositDeducted: selectedServicesDepositApplied,
                      creditAmount: selectedServicesDueAfterPayment,
                      externalTransactionId: normalizeExternalTransactionId(servicePaymentMethod, selectedServicesCashPaid, servicePaymentReference),
                    },
                  });
                }}
                disabled={createVisitServiceBillMutation.isPending || selectedServiceLines.length === 0 || !activeCounterSession}
                className="btn-primary"
              >
                {createVisitServiceBillMutation.isPending ? t('btn.processing', { ns: 'reception' }) : t('btn.payNow', { ns: 'reception' })}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {activeModal === 'pendingLabOrder' && selectedPendingLabOrder && (
        <Modal title="Prescription lab order" onClose={() => {
          setSelectedPendingLabOrder(null);
          setSelectedPendingLabItemIds([]);
          setActiveModal('none');
        }} size="wide">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 p-3">
              <div>
                <div className="font-semibold text-[var(--color-text)]">{selectedPendingLabOrder.patientName}</div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  {selectedPendingLabOrder.patientCode ?? `Patient #${selectedPendingLabOrder.patientId}`}
                  {selectedPendingLabOrder.orderNo ? ` - ${selectedPendingLabOrder.orderNo}` : ''}
                  {selectedPendingLabOrder.rxNo ? ` - ${selectedPendingLabOrder.rxNo}` : ''}
                </div>
              </div>
              <span className={`badge ${activeCounterSession ? 'badge-success' : 'badge-warning'}`}>{activeCounterSession ? 'Counter active' : 'Open counter first'}</span>
            </div>

            <div className="rounded-lg border border-[var(--color-border)]">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
                <span className="text-sm font-semibold">Select tests to bill here</span>
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-xs"
                  onClick={() => {
                    const allSelected = selectedPendingLabItemIds.length === selectedPendingLabOrder.items.length;
                    setSelectedPendingLabItemIds(allSelected ? [] : selectedPendingLabOrder.items.map((item) => item.id));
                  }}
                >
                  {selectedPendingLabItemIds.length === selectedPendingLabOrder.items.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {selectedPendingLabOrder.items.map((item) => {
                  const checked = selectedPendingLabItemIds.includes(item.id);
                  return (
                    <label key={item.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-[var(--color-bg-secondary)]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--color-primary)]"
                        checked={checked}
                        onChange={() => togglePendingLabItem(item.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.testName}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">Leave unchecked if patient will test outside.</span>
                      </span>
                      <span className="font-data font-semibold">{formatBDT(item.lineTotal)}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Payment method</label>
                <select className="input" value={pendingLabPaymentMethod} onChange={(event) => {
                  setPendingLabPaymentMethod(event.target.value);
                  if (event.target.value === 'cash') setPendingLabPaymentReference('');
                }}>
                  <option value="cash">Cash</option>
                  <option value="bkash">bKash</option>
                  <option value="nagad">Nagad</option>
                  <option value="card">Card</option>
                  <option value="bank">Bank</option>
                  <option value="cheque">Cheque</option>
                </select>
                {requiresPaymentReference(pendingLabPaymentMethod, selectedPendingLabTotal) ? (
                  <div className="mt-2">
                    <label className="label">Transaction / reference number</label>
                    <input className="input" value={pendingLabPaymentReference} onChange={(event) => setPendingLabPaymentReference(event.target.value)} placeholder="bKash/Nagad/card/bank reference" />
                  </div>
                ) : null}
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-emerald-800">Selected total</span>
                  <span className="font-data text-lg font-bold text-emerald-800">{formatBDT(selectedPendingLabTotal)}</span>
                </div>
                <div className="mt-1 text-xs text-emerald-700">{selectedPendingLabItems.length} selected test(s)</div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setActiveModal('none')}>Close</button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!activeCounterSession || selectedPendingLabItemIds.length === 0 || billPendingLabOrderMutation.isPending}
                onClick={() => billPendingLabOrderMutation.mutate({
                  orderId: selectedPendingLabOrder.orderId,
                  itemIds: selectedPendingLabItemIds,
                  billMode: 'credit',
                  payment: { paymentMethod: pendingLabPaymentMethod, paidAmount: 0 },
                })}
              >
                {billPendingLabOrderMutation.isPending ? 'Creating...' : 'Create Due Bill'}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!activeCounterSession || selectedPendingLabItemIds.length === 0 || billPendingLabOrderMutation.isPending}
                onClick={() => {
                  if (requiresPaymentReference(pendingLabPaymentMethod, selectedPendingLabTotal) && !pendingLabPaymentReference.trim()) {
                    toast.error('Transaction/reference number is required for non-cash payments.');
                    return;
                  }
                  billPendingLabOrderMutation.mutate({
                    orderId: selectedPendingLabOrder.orderId,
                    itemIds: selectedPendingLabItemIds,
                    billMode: 'paid',
                    payment: {
                      paymentMethod: pendingLabPaymentMethod,
                      paidAmount: selectedPendingLabTotal,
                      externalTransactionId: normalizeExternalTransactionId(pendingLabPaymentMethod, selectedPendingLabTotal, pendingLabPaymentReference),
                    },
                  });
                }}
              >
                {billPendingLabOrderMutation.isPending ? 'Processing...' : 'Pay Selected'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add Lab Modal ── */}
      {activeModal === 'addLab' && selectedVisit && (
        <Modal
          title={
            <>
              {t('modal.addLabTests', { ns: 'reception', name: selectedVisit.patient_name })}
              {buildPatientInlineLabel(selectedVisit)}
            </>
          }
          onClose={() => setActiveModal('none')}
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-muted)]">Select tests from the lab catalog</p>
            <LabTestSelector
              selected={selectedLabTests}
              onChange={setSelectedLabTests}
            />
            {canApplyDiscount ? (
              <div>
                <label className="label">Discount</label>
                <input type="number" min={0} className="input" value={labDiscount} onChange={e => setLabDiscount(Math.max(0, Number(e.target.value) || 0))} />
              </div>
            ) : null}
            <div>
              <label className="label">Notes</label>
              <textarea className="input" rows={2} value={labNotes} onChange={e => setLabNotes(e.target.value)} placeholder="Optional instructions" />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setActiveModal('none')} className="btn-secondary">Cancel</button>
              <button
                onClick={() => {
                  if (selectedLabTests.length === 0) { toast.error(t('toast.selectAtLeastOneTest', { ns: 'reception' })); return; }
                  addLabMutation.mutate({ labTestIds: selectedLabTests, discountAmount: canApplyDiscount ? labDiscount : 0, notes: labNotes || undefined });
                }}
                disabled={addLabMutation.isPending || selectedLabTests.length === 0}
                className="btn-primary"
              >
                {addLabMutation.isPending ? t('btn.ordering', { ns: 'reception' }) : t('btn.orderTests', { ns: 'reception', count: selectedLabTests.length })}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add Procedure Modal ── */}
      {activeModal === 'addProcedure' && selectedVisit && (
        <Modal
          title={
            <>
              {t('modal.orderProcedure', { ns: 'reception', name: selectedVisit.patient_name })}
              {buildPatientInlineLabel(selectedVisit)}
            </>
          }
          onClose={() => setActiveModal('none')}
        >
          <div className="space-y-4">
            <div>
              <label className="label">Procedure Name *</label>
              <input className="input" value={procName} onChange={e => setProcName(e.target.value)} placeholder="e.g. Suture Removal, Dressing" />
            </div>
            <div>
              <label className="label">Link to Service Item (for billing)</label>
              <select className="input" value={procServiceItemId} onChange={e => setProcServiceItemId(Number(e.target.value) || '')}>
                <option value="">Custom price (enter below)</option>
                {serviceItems.filter(s => s.department_name?.toLowerCase().includes('procedure') || s.item_name.toLowerCase().includes('suture') || s.item_name.toLowerCase().includes('dressing')).map(s => (
                  <option key={s.id} value={s.id}>{s.item_name} — {formatBDT(s.price)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Instructions</label>
              <textarea className="input" rows={2} value={procInstructions} onChange={e => setProcInstructions(e.target.value)} placeholder="e.g. After 7 days, wound check" />
            </div>
            {canApplyDiscount ? (
              <div>
                <label className="label">Discount</label>
                <input type="number" min={0} className="input" value={procDiscount} onChange={e => setProcDiscount(Math.max(0, Number(e.target.value) || 0))} />
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <button onClick={() => setActiveModal('none')} className="btn-secondary">Cancel</button>
              <button
                onClick={() => {
                  if (!procName.trim()) { toast.error(t('toast.enterProcedureName', { ns: 'reception' })); return; }
                  addProcedureMutation.mutate({
                    serviceItemId: procServiceItemId ? Number(procServiceItemId) : 0,
                    procedureName: procName.trim(),
                    instructions: procInstructions || undefined,
                    discountAmount: canApplyDiscount ? procDiscount : 0,
                  });
                }}
                disabled={addProcedureMutation.isPending || !procName.trim()}
                className="btn-primary"
              >
                {addProcedureMutation.isPending ? t('btn.ordering', { ns: 'reception' }) : t('btn.orderProcedure', { ns: 'reception' })}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Generate Bill Modal ── */}
      {activeModal === 'generateBill' && selectedVisit && (
        <Modal title={t('modal.generateBill', { ns: 'reception', name: selectedVisit.patient_name })} onClose={() => setActiveModal('none')}>
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-xs font-semibold text-slate-600 mb-2">Pending Services</p>
              {visitServicesData?.services.filter(s => s.status === 'pending').length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">{t('empty.noPendingServices', { ns: 'reception' })}</p>
              ) : (
                <div className="space-y-2">
                    {visitServicesData?.services.filter(s => s.status === 'pending').map(s => (
                      <div key={s.id} className="flex justify-between gap-3 text-sm">
                        <span>
                          <span className="flex items-center gap-1">
                            {serviceIcon(s.service_type)}
                            {s.description}
                            {s.quantity > 1 && <span className="text-[var(--color-text-muted)]">×{s.quantity}</span>}
                          </span>
                          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                            {formatDate(s.created_at)}{s.doctor_name ? ` - Ref: ${s.doctor_name}` : ''}{s.item_code ? ` - ${s.item_code}` : ''}
                          </span>
                        </span>
                        <span className="font-data">{formatBDT(s.total_amount)}</span>
                      </div>
                    ))}
                  <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
                    <span>Subtotal</span>
                    <span className="font-data">{formatBDT(pendingTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-md border border-[var(--color-border)] bg-white px-3 py-3 text-xs dark:bg-slate-800">
              <div className="mb-2 font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Scheme / Benefit</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input className="input h-8 bg-white" value={billSchemeCodeInput} onChange={(event) => { setBillSchemeCodeInput(event.target.value); setBillSchemePreview(null); }} placeholder="Scheme code" />
                <input className="input h-8 bg-white" value={billMemberCodeInput} onChange={(event) => { setBillMemberCodeInput(event.target.value); setBillSchemePreview(null); }} placeholder="Member code" />
                <button type="button" className="btn-secondary h-8 justify-center px-2 text-xs" disabled={checkFinalBillSchemePreviewMutation.isPending || pendingTotal <= 0 || !selectedVisit} onClick={submitFinalBillSchemeCheck}>
                  {checkFinalBillSchemePreviewMutation.isPending ? 'Checking…' : 'Check'}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
                <span>{billSchemePreview?.eligible ? `${billSchemePreview.scheme_name ?? 'Scheme'} · ${billSchemePreview.discount_value}% · suggested ${formatBDT(billSuggestedSchemeDiscount)}` : billSchemePreview?.blockers?.join(', ') || 'Optional: check staff/VIP/member benefit for final bill.'}</span>
                <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!billSchemePreview?.eligible || billSuggestedSchemeDiscount <= 0} onClick={applyFinalBillSchemeDiscount}>Apply</button>
              </div>
            </div>

            <div>
              <label className="label">Final bill discount</label>
              <input
                type="number"
                min={0}
                max={pendingTotal}
                className="input"
                value={billDiscount}
                onChange={e => setBillDiscount(Math.min(pendingTotal, Math.max(0, Number(e.target.value) || 0)))}
              />
            </div>

            {billDiscount > 0 && (
              <div>
                <label className="label">Discount referred by{billDiscountByNameRequired ? ' *' : ''}</label>
                <input
                  className="input"
                  placeholder={billDiscountByNameRequired ? 'Required above 20%' : 'Optional'}
                  value={billDiscountByName}
                  onChange={(e) => setBillDiscountByName(e.target.value)}
                />
              </div>
            )}

            {billDiscount > 0 ? (
              <DiscountAllocationEditor
                totalDiscount={billDiscount}
                enabled={billAdvancedDiscount}
                rows={billDiscountSources}
                onEnabledChange={setBillAdvancedDiscount}
                onRowsChange={setBillDiscountSources}
                onQuickSourceSelected={(reason) => {
                  if (reason === 'doctor_commission_waiver' && billDoctorWaiverDoctorName) {
                    setBillDiscountByName(billDoctorWaiverDoctorName);
                  }
                }}
                context={{
                  selectedDoctorId: billDoctorWaiverDoctorId,
                  doctorAvailableWaiverAmount: billHasEligibleSchemePreview ? 0 : billDoctorWaiverAmount,
                  doctorWaiverLoading: !billHasEligibleSchemePreview && billDoctorWaiverLoading,
                }}
              />
            ) : null}

            <div className="bg-[var(--color-primary-light)] border border-[var(--color-primary)]/20 rounded-xl p-4 flex justify-between items-center">
              <span className="font-semibold text-[var(--color-primary-dark)]">Grand Total</span>
              <span className="font-data text-2xl font-bold text-[var(--color-primary-dark)]">{formatBDT(Math.max(0, pendingTotal - billDiscount))}</span>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setActiveModal('none')} className="btn-secondary">Cancel</button>
              <button
                onClick={() => {
                  if (requireDiscountReferralName(pendingTotal, billDiscount, billDiscountByName)) return;
                  if (billDoctorWaiverLoading && billDiscountSources.some((row) => row.reason === 'doctor_commission_waiver')) {
                    toast.error('Wait for the doctor commission preview to finish.');
                    return;
                  }
                  if (billAdvancedDiscount && !hasBalancedDiscountAllocations(billDiscount, billDiscountSources)) {
                    toast.error('Advanced discount source total must match discount amount.');
                    return;
                  }
                  generateBillMutation.mutate({
                    discount: billDiscount,
                    discountByName: billDiscountByName.trim() || undefined,
                    schemeApplication: billSchemePreview?.eligible && billDiscount > 0 ? {
                      schemeId: billSchemePreview.scheme_id ?? undefined,
                      schemeCode: (billSchemePreview.scheme_code ?? billSchemeCodeInput.trim()) || undefined,
                      memberCode: (billSchemePreview.matched_member_code ?? billMemberCodeInput.trim()) || undefined,
                      memberId: billSchemePreview.matched_member_id ?? undefined,
                      serviceCategory: billSchemePreview.service_category ?? 'reception_visit_bill',
                      allocationType: reasonForDiscountSource(billSchemePreview.allocation_type),
                      suggestedDiscount: billSchemePreview.suggested_discount,
                    } : undefined,
                    discountAllocations: getDiscountAllocationPayload(billDiscount, billAdvancedDiscount, billDiscountSources),
                    idempotencyKey: `reception-bill-${selectedVisit.id}-${crypto.randomUUID()}`,
                  });
                }}
                disabled={generateBillMutation.isPending || pendingTotal <= 0}
                className="btn-primary"
              >
                {generateBillMutation.isPending ? t('btn.generating', { ns: 'reception' }) : t('btn.generateBill', { ns: 'reception' })}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {activeModal === 'ipdAdmission' && (
        <Modal title={t('modal.ipdAdmission', { ns: 'reception' })} onClose={() => setActiveModal('none')} size="wide">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr_1fr] lg:grid-rows-[auto_1fr] lg:items-start">
            <section className="space-y-3 lg:col-start-1 lg:row-start-1">
              <h3 className="font-semibold">Patient</h3>
              {admissionPatient ? (
                <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3">
                  <div>
                    <div className="font-semibold">{admissionPatient.name}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{buildReceptionPatientIdentityText(admissionPatient)}</div>
                  </div>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAdmissionPatient(null)}>Change</button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                    <input className="input pl-9" value={admissionPatientSearch} onChange={(event) => setAdmissionPatientSearch(event.target.value)} placeholder="Mobile, name, or patient ID" />
                  </div>
                  {admissionPatientMatches.length > 0 ? (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                      {admissionPatientMatches.map((patient) => (
                        <button key={patient.id} className="block w-full border-b border-[var(--color-border)] px-3 py-2 text-left text-sm last:border-0 hover:bg-[var(--color-bg-secondary)]" onClick={() => setAdmissionPatient(patient)}>
                          <span className="block font-medium">{patient.name}</span>
                          <span className="text-xs text-[var(--color-text-muted)]">{buildReceptionPatientIdentityText(patient)}</span>
                        </button>
                      ))}
                    </div>
                  ) : admissionPatientLookupFetching ? (
                    <div className="mt-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
                      Searching patient...
                    </div>
                  ) : admissionPatientSearch.trim().length >= 2 ? (
                    <button className="text-xs text-[var(--color-primary)] hover:underline" onClick={() => {
                      const searchTerm = admissionPatientSearch.trim();
                      const digits = searchTerm.replace(/\D/g, '');
                      const isMobile = digits.length >= 6;
                      setNewPatientReturnModal('ipdAdmission');
                      setNewPatientForm({
                        ...EMPTY_NEW_PATIENT_FORM,
                        name: isMobile ? '' : searchTerm,
                        mobile: isMobile ? searchTerm : '',
                      });
                      setActiveModal('newPatient');
                    }}>
                      <span className="flex w-full items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-left shadow-sm transition hover:border-amber-400 hover:bg-amber-100">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                          <UserPlus className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-amber-950">
                            {t('btn.noSavedPatientRegister', { ns: 'reception' })}
                          </span>
                          <span className="mt-1 block text-xs font-medium leading-5 text-amber-800">
                            {t('info.registerPatientToContinueAdmission', { ns: 'reception' })}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow-sm">
                          {t('btn.registerNewPatient', { ns: 'reception' })}
                        </span>
                      </span>
                    </button>
                  ) : null}
                </>
              )}
              <div>
                <label className="label">Admitting doctor</label>
                <select className="input" value={admissionDoctorId} onChange={(event) => setAdmissionDoctorId(Number(event.target.value) || '')}>
                  <option value="">Select doctor</option>
                  {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? ` - ${doctor.specialty}` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Reason / diagnosis</label>
                <textarea className="input min-h-24" value={admissionReason} onChange={(event) => setAdmissionReason(event.target.value)} placeholder="Admission reason, provisional diagnosis..." />
              </div>
            </section>

            <section className="space-y-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <h3 className="font-semibold">Available Bed</h3>
              <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-[var(--color-border)]">
                {availableBeds.length === 0 ? (
                  <div className="p-4 text-sm text-[var(--color-text-muted)]">{t('empty.noAvailableBed', { ns: 'reception' })}</div>
                ) : availableBeds.map((bed) => (
                  <button
                    key={bed.id}
                    type="button"
                    className={`flex w-full items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5 text-left last:border-0 hover:bg-emerald-50 ${Number(admissionBedId) === Number(bed.id) ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''}`}
                    onClick={() => setAdmissionBedId(Number(bed.id))}
                  >
                    <span>
                      <span className="block font-medium">{bed.ward_name ?? 'Ward'} - Bed {bed.bed_number ?? bed.id}</span>
                      <span className="text-xs text-[var(--color-text-muted)]">{bed.bed_type ?? 'General'} {bed.effective_rate ? `- ${formatBDT(Number(bed.effective_rate))}/day` : ''}</span>
                    </span>
                    <span className="badge badge-success">Empty</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3 lg:col-start-1 lg:row-start-2">
              <h3 className="font-semibold">Billing Package (optional)</h3>
              <div>
                <label className="label">Package</label>
                <select className="input" value={admissionPackageId} onChange={(e) => {
                  const val = e.target.value;
                  setAdmissionPackageId(val ? Number(val) : '');
                  if (val) {
                    const pkg = (packagesData?.data ?? []).find(p => p.id === Number(val));
                    if (pkg) setAdmissionBillingMode(pkg.package_type || 'package');
                  } else {
                    setAdmissionBillingMode('regular');
                  }
                }}>
                  <option value="">No package — Regular billing</option>
                  {(packagesData?.data ?? []).map(pkg => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.package_name} — {formatBDT(pkg.total_price)}
                      {pkg.package_type === 'package_included_days' ? ' (bed included)' : ''}
                    </option>
                  ))}
                </select>
                {admissionPackageId && (() => {
                  const pkg = (packagesData?.data ?? []).find(p => p.id === Number(admissionPackageId));
                  if (!pkg) return null;
                  return (
                    <div className="mt-2 rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
                      <p className="font-medium">{pkg.package_name}</p>
                      {pkg.description && <p className="text-xs mt-1">{pkg.description}</p>}
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div>Package price: <span className="font-data font-semibold">{formatBDT(pkg.total_price)}</span></div>
                        <div>Bed billing: <span className="font-semibold">{pkg.package_type === 'package_included_days' ? 'Included in package' : 'Selected bed rate'}</span></div>
                        <div>Type: <span className="font-semibold capitalize">{pkg.package_type.replace(/_/g, ' ')}</span></div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </section>

            <section className="space-y-3 lg:col-start-3 lg:row-span-2 lg:row-start-1">
              <div>
                <h3 className="font-semibold">Admission Fee</h3>
                <label className="label mt-2 block">Admission fee (৳)</label>
                <input className="input" type="number" min={0} value={admissionFee} onChange={(event) => setAdmissionFee(event.target.value)} placeholder="0 (optional)" />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">One-time admission/registration fee. Will be added as a charge to the patient ledger.</p>
              </div>
              <h3 className="font-semibold pt-2 border-t border-[var(--color-border)]">Advance Collection</h3>
              <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                Counter must be active before collecting deposit. The deposit goes through the same patient deposit ledger.
              </div>
              <div>
                <label className="label">Advance deposit</label>
                <input className="input" type="number" min={0} value={admissionDeposit} onChange={(event) => setAdmissionDeposit(event.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="label">Payment method</label>
                <select className="input" value={admissionPaymentMethod} onChange={(event) => setAdmissionPaymentMethod(event.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bkash">bKash</option>
                  <option value="nagad">Nagad</option>
                  <option value="card">Card</option>
                  <option value="bank">Bank</option>
                </select>
              </div>
              {patientDepositBalance !== null && patientDepositBalance > 0 && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-600 font-medium">Existing Deposit:</span>
                    <span className="font-data font-bold text-emerald-700">{formatBDT(patientDepositBalance)}</span>
                  </div>
                </div>
              )}
                <div className="rounded-lg bg-[var(--color-bg-secondary)] p-3 text-sm">
                <div className="flex justify-between"><span>Selected bed</span><span>{admissionBedId ? (() => { const b = availableBeds.find(bed => bed.id === Number(admissionBedId)); return b ? `${b.ward_name ?? 'Ward'} - ${b.bed_number ?? b.id}` : `#${admissionBedId}`; })() : 'Not selected'}</span></div>
                {admissionPackageId && (() => {
                  const pkg = (packagesData?.data ?? []).find(p => p.id === Number(admissionPackageId));
                  return pkg ? <div className="flex justify-between"><span>Package</span><span className="font-medium">{pkg.package_name}</span></div> : null;
                })()}
                {admissionFee && Number(admissionFee) > 0 && (
                  <div className="flex justify-between"><span>Admission fee</span><span className="font-data">{formatBDT(Number(admissionFee))}</span></div>
                )}
                <div className="flex justify-between"><span>Deposit now</span><span className="font-data">{formatBDT(Number(admissionDeposit || 0))}</span></div>
                </div>
              <button
                className="btn-primary w-full"
                disabled={admitWithDepositMutation.isPending || !admissionPatient}
                onClick={() => {
                  if (!admissionPatient) { toast.error(t('toast.selectPatient', { ns: 'reception' })); return; }
                  if (!admissionCreateIdempotencyRef.current) {
                    admissionCreateIdempotencyRef.current = `dash-admission-${admissionPatient.id}-${crypto.randomUUID()}`;
                  }
                  admitWithDepositMutation.mutate({
                    patientId: admissionPatient.id,
                    bedId: admissionBedId ? Number(admissionBedId) : undefined,
                    doctorId: admissionDoctorId ? Number(admissionDoctorId) : undefined,
                    admissionType: 'planned',
                    admitSource: 'walk_in',
                    admissionReason: admissionReason || undefined,
                    provisionalDiagnosis: admissionReason || undefined,
                    admissionFee: Number(admissionFee || 0) || undefined,
                    packageId: admissionPackageId ? Number(admissionPackageId) : undefined,
                    billingMode: admissionBillingMode || 'regular',
                    depositAmount: Number(admissionDeposit || 0),
                    paymentMethod: admissionPaymentMethod,
                    idempotencyKey: admissionCreateIdempotencyRef.current,
                  });
                }}
              >
                {admitWithDepositMutation.isPending ? t('btn.admitting', { ns: 'reception' }) : t('btn.admitAndPrint', { ns: 'reception' })}
              </button>
            </section>
          </div>
        </Modal>
      )}

      {activeModal === 'provisionalBilling' && (
        <ProvisionalBillingModal
          onClose={() => {
            setActiveModal('none');
            setProvisionalBillingPrefill(null);
          }}
          formatBDT={formatBDT}
          basePath={basePath}
          initialAdmissionId={provisionalBillingPrefill?.admissionId}
          initialPatientId={provisionalBillingPrefill?.patientId}
        />
      )}

      {activeModal === 'reportDelivery' && (
        <Modal title={t('modal.deliverReport', { ns: 'reception' })} onClose={() => setActiveModal('none')} size="wide">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="label">Invoice / barcode</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                  <input
                    className="input pl-9 text-lg"
                    value={reportInvoiceInput}
                    onChange={(event) => setReportInvoiceInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setReportInvoiceLookup(reportInvoiceInput.trim());
                    }}
                    placeholder="Scan or enter invoice number"
                  />
                </div>
              </div>
              <button className="btn-primary" onClick={() => setReportInvoiceLookup(reportInvoiceInput.trim())}>Lookup</button>
            </div>
            {reportLookupQuery.isFetching ? (
              <div className="skeleton h-32 rounded-lg" />
            ) : reportLookupQuery.data ? (
              <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                <div className="rounded-lg border border-[var(--color-border)] p-4">
                  <h3 className="font-semibold">{reportLookupQuery.data.patient.name}</h3>
                  <p className="text-sm text-[var(--color-text-muted)]">{reportLookupQuery.data.patient.patientCode ?? ''} {reportLookupQuery.data.patient.mobile ? `- ${reportLookupQuery.data.patient.mobile}` : ''}</p>
                  <div className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between"><span>Invoice</span><span className="font-data">{reportLookupQuery.data.invoice.invoiceNo ?? reportLookupQuery.data.invoice.id}</span></div>
                    <div className="flex justify-between"><span>Total</span><span className="font-data">{formatBDT(reportLookupQuery.data.invoice.totalAmount)}</span></div>
                    <div className="flex justify-between"><span>Paid</span><span className="font-data text-emerald-600">{formatBDT(reportLookupQuery.data.invoice.paidAmount)}</span></div>
                    <div className="flex justify-between font-semibold"><span>Due</span><span className="font-data text-red-600">{formatBDT(reportLookupQuery.data.invoice.dueAmount)}</span></div>
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] p-4">
                  <h3 className="mb-2 font-semibold">Report status</h3>
                  <div className="space-y-2">
                    {reportLookupQuery.data.reports.length === 0 ? (
                      <div className="text-sm text-[var(--color-text-muted)]">No lab report item linked with this invoice.</div>
                    ) : reportLookupQuery.data.reports.map((report) => (
                      <div key={report.id} className="flex items-center justify-between rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm">
                        <span>{report.test_name ?? 'Report'}</span>
                        <span className={`badge ${['completed', 'verified', 'delivered', 'reported', 'ready'].includes(String(report.status ?? '').toLowerCase()) ? 'badge-success' : 'badge-warning'}`}>{report.status ?? 'Processing'}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-end gap-3">
                    {reportLookupQuery.data.needsPayment ? (
                      <button className="btn-primary" onClick={() => {
                        const invoice = reportLookupQuery.data!.invoice;
                        const depositAdjusted = Number(invoice.depositAdjusted ?? 0);
                        const settledAmount = Number(invoice.paidAmount ?? 0);
                        const cashPaidAmount = Math.max(0, settledAmount - depositAdjusted);
                        setPayBill({
                          id: invoice.id,
                          invoice_no: invoice.invoiceNo ?? undefined,
                          patient_name: reportLookupQuery.data!.patient.name,
                          total: invoice.totalAmount,
                          paid: cashPaidAmount,
                          cash_paid_amount: cashPaidAmount,
                          paid_amount: settledAmount,
                          settled_amount: settledAmount,
                          due: invoice.dueAmount,
                          outstanding: invoice.dueAmount,
                          deposit_adjusted: depositAdjusted,
                          status: invoice.status ?? 'open',
                          created_at: invoice.createdAt ?? new Date().toISOString(),
                        });
                        setPayAmount(String(invoice.dueAmount));
                      }}>
                        Collect Due
                      </button>
                    ) : reportLookupQuery.data.invoice ? (
                      <button className="btn-primary" disabled={!reportLookupQuery.data.canPrint} onClick={() => window.open(`${basePath}/billing/${reportLookupQuery.data!.invoice.id}/print`, '_blank', 'noopener,noreferrer')}>
                        <Printer className="h-4 w-4" />
                        Print Report / Receipt
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : reportInvoiceLookup ? (
              <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">Invoice not found or unavailable.</div>
            ) : null}
          </div>
        </Modal>
      )}

      {/* ── Today's Visitors List Modal ── */}
      {activeModal === 'visitorsList' && (
        <Modal title={t('modal.todaysVisitors', { ns: 'reception', date })} onClose={() => setActiveModal('none')} size="wide">
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {visitsLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-16 w-full rounded-lg" />)}
              </div>
            ) : visits.length === 0 ? (
              <div className="text-center py-12">
                <Users className="h-12 w-12 mx-auto text-[var(--color-text-muted)] mb-3" />
                <p className="text-[var(--color-text-muted)]">{t('empty.noVisitorsToday', { ns: 'reception' })}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Summary */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-blue-50 rounded-lg p-3">
                    <p className="text-xs text-blue-600 font-medium">{t('heading.totalVisitors', { ns: 'reception' })}</p>
                    <p className="font-data text-xl font-bold text-blue-800">{visits.length}</p>
                  </div>
                  <div className="bg-violet-50 rounded-lg p-3">
                    <p className="text-xs text-violet-600 font-medium">{t('heading.withAppointments', { ns: 'reception' })}</p>
                    <p className="font-data text-xl font-bold text-violet-800">
                      {visits.filter(v => todayAppointments.some(a => Number(a.patient_id) === Number(v.patient_id))).length}
                    </p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-3">
                    <p className="text-xs text-amber-600 font-medium">{t('heading.walkIns', { ns: 'reception' })}</p>
                    <p className="font-data text-xl font-bold text-amber-800">
                      {visits.filter(v => !todayAppointments.some(a => Number(a.patient_id) === Number(v.patient_id))).length}
                    </p>
                  </div>
                </div>

                {/* Visitor List */}
                <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>{t('table.patient', { ns: 'reception' })}</th>
                        <th>{t('table.token', { ns: 'reception' })}</th>
                        <th>{t('table.doctor', { ns: 'reception' })}</th>
                        <th>{t('form.time', { ns: 'reception' })}</th>
                        <th>{t('table.status', { ns: 'reception' })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receptionFlowRows.map((row) => (
                        <tr key={row.key}>
                          <td>
                            <div className="font-medium">{row.patientName}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              {row.patientCode ? `PID-${row.patientCode}` : ''} {row.mobile ? `• ${row.mobile}` : ''}
                            </div>
                          </td>
                          <td className="font-data font-semibold">
                            {getFlowTokenLabel(row)}
                          </td>
                          <td>{row.doctorName || '—'}</td>
                          <td className="font-data text-sm">{row.time || '-'}</td>
                          <td>
                            {(() => {
                              const s = String(row.status ?? '').toLowerCase();
                              if (s === 'waiting' || s === 'waiting_for_bill') return <span className="badge bg-amber-50 text-amber-700 dark:bg-amber-900 dark:text-amber-400">Waiting</span>;
                              if (s === 'engaged' || s === 'in_room' || s === 'in-room' || s === 'serving' || s === 'arrived') return <span className="badge bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-400">In-Room</span>;
                              if (s === 'completed' || s === 'completed_bill') return <span className="badge bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-400">Completed</span>;
                              if (s === 'checked_in' || s === 'checked-in' || s === 'booked' || s === 'initiated') return <span className="badge bg-violet-50 text-violet-700 dark:bg-violet-900 dark:text-violet-400">Checked In</span>;
                              return <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">{row.status}</span>;
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Daily Report Modal ── */}
      {activeModal === 'dailyReport' && (
        <Modal title={t('modal.dailyReport', { ns: 'reception', date })} onClose={() => setActiveModal('none')}>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {reportLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-16 w-full rounded-lg" />)}
              </div>
            ) : dailyReportData ? (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 rounded-lg p-3">
                    <p className="text-xs text-blue-600 font-medium">{t('heading.totalBilled', { ns: 'reception' })}</p>
                    <p className="font-data text-xl font-bold text-blue-800">{formatBDT(dailyReportData.summary.totalBilled)}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-3">
                    <p className="text-xs text-emerald-600 font-medium">{t('heading.totalPaid', { ns: 'reception' })}</p>
                    <p className="font-data text-xl font-bold text-emerald-800">{formatBDT(dailyReportData.summary.totalPaid)}</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-3">
                    <p className="text-xs text-amber-600 font-medium">{t('heading.totalDue', { ns: 'reception' })}</p>
                    <p className="font-data text-xl font-bold text-amber-800">{formatBDT(dailyReportData.summary.totalDue)}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-600 font-medium">{t('heading.bills', { ns: 'reception' })}</p>
                    <p className="font-data text-xl font-bold text-slate-800">{dailyReportData.summary.billCount}</p>
                  </div>
                </div>

                {/* By Category */}
                <div className="card p-3">
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><Receipt className="w-4 h-4" /> {t('heading.byCategory', { ns: 'reception' })}</h4>
                  {dailyReportData.byCategory.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-muted)]">{t('empty.noData', { ns: 'reception' })}</p>
                  ) : (
                    <div className="space-y-1">
                      {dailyReportData.byCategory.map((c, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="capitalize">{c.item_category.replace(/_/g, ' ')}</span>
                          <span className="font-data font-medium">{formatBDT(c.total_amount)} ({c.item_count} items)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* By Payment Method */}
                <div className="card p-3">
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><CreditCard className="w-4 h-4" /> {t('heading.byPaymentMethod', { ns: 'reception' })}</h4>
                  {dailyReportData.byPaymentMethod.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-muted)]">{t('empty.noPaymentsToday', { ns: 'reception' })}</p>
                  ) : (
                    <div className="space-y-1">
                      {dailyReportData.byPaymentMethod.map((m, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="capitalize">{m.payment_method || 'Unknown'}</span>
                          <span className="font-data font-medium">{formatBDT(m.total_amount)} ({m.transaction_count} txns)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* By Doctor */}
                <div className="card p-3">
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><Stethoscope className="w-4 h-4" /> Doctor Visit Fees</h4>
                  {(dailyReportData.byDoctorConsultation ?? []).length === 0 ? (
                    <p className="text-xs text-[var(--color-text-muted)]">No doctor visit fee</p>
                  ) : (
                    <div className="space-y-1">
                      {(dailyReportData.byDoctorConsultation ?? []).map((d, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span>{d.doctor_name}</span>
                          <span className="font-data font-medium">{formatBDT(d.total_amount)} ({d.service_count} visits)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="card p-3">
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><FlaskConical className="w-4 h-4" /> Test / Diagnostic by Doctor</h4>
                  {(dailyReportData.byDoctorTest ?? []).length === 0 ? (
                    <p className="text-xs text-[var(--color-text-muted)]">No doctor-linked test collection</p>
                  ) : (
                    <div className="space-y-1">
                      {(dailyReportData.byDoctorTest ?? []).map((d, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span>{d.doctor_name}</span>
                          <span className="font-data font-medium">{formatBDT(d.total_amount)} ({d.service_count} tests)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {(dailyReportData.byDoctorOther ?? []).length > 0 ? (
                  <div className="card p-3">
                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><Wrench className="w-4 h-4" /> Other Doctor-linked Services</h4>
                    <div className="space-y-1">
                      {(dailyReportData.byDoctorOther ?? []).map((d, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span>{d.doctor_name}</span>
                          <span className="font-data font-medium">{formatBDT(d.total_amount)} ({d.service_count} svcs)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-center text-[var(--color-text-muted)]">{t('empty.noReportData', { ns: 'reception' })}</p>
            )}
          </div>
        </Modal>
      )}

      {payBill && (
        <Modal title={batchPaymentBills.length > 1 ? 'Collect payment - ' + batchPaymentBills.length + ' invoices' : t('modal.collectPaymentInvoice', { ns: 'reception', invoiceNo: payBill.invoice_no ?? `INV-${payBill.id}` })} onClose={closePaymentModal}>
          <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex justify-between"><span>Patient</span><span className="font-medium">{payBill.patient_name}</span></div>
                <div className="flex justify-between"><span>Invoice</span><span className="font-data">{payBill.invoice_no ?? `Bill #${payBill.id}`}</span></div>
                {batchPaymentBills.length > 1 ? (
                  <div className="mt-2 rounded-md border border-slate-200 bg-white">
                    {batchPaymentBills.map((bill) => (
                      <div key={bill.id} className="flex justify-between gap-3 border-b border-slate-100 px-2 py-1.5 text-xs last:border-b-0">
                        <span className="min-w-0 truncate">{bill.invoice_no ?? `Bill #${bill.id}`} - {getBillServiceLabel(bill)}</span>
                        <span className="font-data font-semibold text-red-600">{formatBDT(getBillOutstandingAmount(bill))}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex justify-between gap-4"><span>For</span><span className="max-w-[70%] text-right font-medium">{getBillServiceLabel(payBill)}</span></div>
                {payBill.doctor_name ? <div className="flex justify-between"><span>Doctor</span><span>{payBill.doctor_name}</span></div> : null}
                {payBill.visit_no ? <div className="flex justify-between"><span>Visit</span><span className="font-data">{payBill.visit_no}</span></div> : null}
                {payBill.created_by_name ? <div className="flex justify-between"><span>Added by</span><span>{payBill.created_by_name}</span></div> : null}
                <div className="flex justify-between"><span>Date</span><span>{formatDate(payBill.created_at)}</span></div>
                {Number(payBill.item_count ?? 0) > 0 ? <div className="flex justify-between"><span>Items</span><span>{Number(payBill.item_count)} item(s)</span></div> : null}
                <div className="flex justify-between"><span>Total</span><span className="font-data">{formatBDT(getBillTotalAmount(payBill))}</span></div>
                <div className="flex justify-between">
                  <span>{getBillDepositAdjustedAmount(payBill) > 0 ? 'Cash paid' : 'Paid'}</span>
                  <span className="font-data text-emerald-600">{formatBDT(getBillCashPaidAmount(payBill))}</span>
                </div>
                {getBillDepositAdjustedAmount(payBill) > 0 ? (
                  <>
                    <div className="flex justify-between"><span>Deposit adjusted</span><span className="font-data text-emerald-600">{formatBDT(getBillDepositAdjustedAmount(payBill))}</span></div>
                    <div className="flex justify-between"><span>Settled</span><span className="font-data text-emerald-600">{formatBDT(getBillSettledAmount(payBill))}</span></div>
                  </>
                ) : null}
                <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
                  <span>Due</span>
                  <span className="font-data text-red-600">{formatBDT(getBillOutstandingAmount(payBill))}</span>
                </div>
            </div>
            <div>
              <label className="label">Payment amount</label>
              <input className="input" type="number" min={1} value={payAmount} onChange={e => setPayAmount(e.target.value)} />
            </div>
            <div>
              <label className="label">Payment method</label>
              <select className="input" value={payMethod} onChange={e => {
                setPayMethod(e.target.value);
                if (e.target.value === 'cash') setPayReference('');
              }}>
                <option value="cash">Cash</option>
                <option value="bkash">bKash</option>
                <option value="nagad">Nagad</option>
                <option value="card">Card</option>
                <option value="bank">Bank</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            {requiresPaymentReference(payMethod, Number(payAmount)) ? (
              <div>
                <label className="label">Transaction / reference number</label>
                <input className="input" value={payReference} onChange={(event) => setPayReference(event.target.value)} placeholder="bKash/Nagad/card/bank reference" />
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <button onClick={closePaymentModal} className="btn-secondary">Cancel</button>
              <button
                className="btn-primary"
                disabled={collectPaymentMutation.isPending || isBatchPaymentCollecting || Number(payAmount) <= 0}
                onClick={() => {
                  if (batchPaymentBills.length > 1) {
                    void collectBatchPayment();
                    return;
                  }
                  if (requiresPaymentReference(payMethod, Number(payAmount)) && !payReference.trim()) {
                    toast.error('Transaction/reference number is required for non-cash payments.');
                    return;
                  }
                  collectPaymentMutation.mutate({
                    billId: payBill.id,
                    amount: Number(payAmount),
                    type: 'due',
                    paymentMethod: payMethod,
                    externalTransactionId: normalizeExternalTransactionId(payMethod, Number(payAmount), payReference),
                    idempotencyKey: `reception-due-payment-${payBill.id}-${crypto.randomUUID()}`,
                  });
                }}
              >
                {collectPaymentMutation.isPending || isBatchPaymentCollecting ? t('btn.collecting', { ns: 'reception' }) : t('btn.collectPayment', { ns: 'reception' })}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Waiting Queue Modal (from KPI click) ── */}
      {activeModal === 'waitingQueue' && (
        <Modal title={t('modal.waitingQueue', { ns: 'reception' })} onClose={() => setActiveModal('none')}>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded-lg bg-violet-50 p-3 text-center">
                <div className="font-data text-2xl font-bold text-violet-800">{queueStats.total ?? 0}</div>
                <div className="text-xs text-violet-600">Total</div>
              </div>
              <div className="rounded-lg bg-amber-50 p-3 text-center">
                <div className="font-data text-2xl font-bold text-amber-800">{queueStats.waiting ?? 0}</div>
                <div className="text-xs text-amber-600">Waiting</div>
              </div>
              <div className="rounded-lg bg-blue-50 p-3 text-center">
                <div className="font-data text-2xl font-bold text-blue-800">{queueStats.serving ?? queueStats.called ?? 0}</div>
                <div className="text-xs text-blue-600">In room</div>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3 text-center">
                <div className="font-data text-2xl font-bold text-emerald-800">{queueStats.completed ?? 0}</div>
                <div className="text-xs text-emerald-600">Completed</div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {waitingQueueLoading ? (
                <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="skeleton h-14 w-full rounded-lg" />)}</div>
              ) : waitingQueueTokens.length > 0 ? (
                waitingQueueTokens.map((token) => (
                  <div key={token.id} className="rounded-lg border border-[var(--color-border)] px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-data text-sm font-semibold text-violet-700">{token.token_no ?? `#${token.token_number ?? token.id}`}</span>
                          {(() => {
                            const status = String(token.status ?? 'waiting').toLowerCase();
                            if (status === 'serving') return <span className="badge bg-blue-50 text-blue-700">In room</span>;
                            if (status === 'completed') return <span className="badge bg-emerald-50 text-emerald-700">Ready / done</span>;
                            if (status === 'called') return <span className="badge bg-sky-50 text-sky-700">Called</span>;
                            return <span className="badge bg-amber-50 text-amber-700">Waiting</span>;
                          })()}
                        </div>
                        <div className="mt-1 font-medium text-sm">{token.patient_name ?? 'Unknown patient'}</div>
                        <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                          {[token.patient_code ? `PID-${token.patient_code}` : null, token.phone, token.doctor_name, token.department_name].filter(Boolean).join(' • ')}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <div className="text-right text-xs text-[var(--color-text-muted)]">
                          <div>Checked in</div>
                          <div className="font-data text-sm font-semibold text-[var(--color-text)]">{formatTime(token.check_in_time) ?? '-'}</div>
                        </div>
                        {['waiting', 'called'].includes(String(token.status ?? 'waiting').toLowerCase()) ? (
                          <button
                            type="button"
                            className="btn-primary px-3 py-2 text-xs"
                            disabled={updateQueueTokenStatusMutation.isPending}
                            onClick={() => updateQueueTokenStatusMutation.mutate({ id: token.id, status: 'serving' })}
                          >
                            Send to Room
                          </button>
                        ) : null}
                        {String(token.status ?? '').toLowerCase() === 'serving' ? (
                          <button
                            type="button"
                            className="btn-secondary px-3 py-2 text-xs"
                            disabled={updateQueueTokenStatusMutation.isPending}
                            onClick={() => updateQueueTokenStatusMutation.mutate({ id: token.id, status: 'completed' })}
                          >
                            Out of Room
                          </button>
                        ) : null}
                        {token.visit_id && ['serving', 'completed', 'concluded'].includes(String(token.status ?? '').toLowerCase()) ? (
                          <button
                            type="button"
                            className="btn-ghost px-3 py-2 text-xs text-[var(--color-primary)]"
                            onClick={() => {
                              const visit = visitFromQueueToken(token);
                              if (visit) openAddService(visit, 'service');
                            }}
                          >
                            Add Test
                          </button>
                        ) : null}
                        {['completed', 'concluded'].includes(String(token.status ?? '').toLowerCase()) && token.patient_id ? (
                          <button
                            type="button"
                            className="btn-ghost px-3 py-2 text-xs text-purple-600"
                            onClick={() => {
                              const patient = patientFromQueueToken(token);
                              if (patient) startReportShow(patient, token.doctor_id ?? null);
                            }}
                            disabled={createReportShowAppointmentMutation.isPending || checkInAppointmentMutation.isPending}
                          >
                            Report Show
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              ) : queueStatsLoading ? (
                <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}</div>
              ) : (
                <div className="text-sm text-[var(--color-text-muted)] text-center py-8">{t('empty.noActiveQueue', { ns: 'reception' })}</div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* ── Today's Collection Modal (from KPI click) ── */}
      {activeModal === 'dailyCollection' && dailyReportData && (
        <Modal title={t('modal.todaysCollectionBreakdown', { ns: 'reception' })} onClose={() => setActiveModal('none')}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="rounded-lg bg-cyan-50 p-4 text-center">
                <div className="text-xs font-semibold text-cyan-600">Total Cash Received</div>
                <div className="font-data text-xl font-bold text-cyan-800">{formatBDT(dailyReportData.summary.totalCashReceived ?? 0)}</div>
                <div className="text-xs text-cyan-500">Billing + due + deposit</div>
              </div>
              <div className="rounded-lg bg-emerald-50 p-4 text-center">
                <div className="text-xs font-semibold text-emerald-600">Billing Collection</div>
                <div className="font-data text-xl font-bold text-emerald-800">{formatBDT(dailyReportData.summary.totalPaid)}</div>
                <div className="text-xs text-emerald-500">Same-day bill payments</div>
              </div>
              <div className="rounded-lg bg-amber-50 p-4 text-center">
                <div className="text-xs font-semibold text-amber-600">Due Collection</div>
                <div className="font-data text-xl font-bold text-amber-800">{formatBDT(dailyReportData.summary.dueCollection ?? 0)}</div>
                <div className="text-xs text-amber-500">Old bill paid today</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-4 text-center">
                <div className="text-xs font-semibold text-slate-600">Deposit Received</div>
                <div className="font-data text-xl font-bold text-slate-800">{formatBDT(dailyReportData.summary.depositReceived ?? 0)}</div>
                <div className="text-xs text-slate-500">Patient deposit cash in</div>
              </div>
              <div className="rounded-lg bg-red-50 p-4 text-center">
                <div className="text-xs font-semibold text-red-600">Outstanding Due</div>
                <div className="font-data text-xl font-bold text-red-800">{formatBDT(dailyReportData.summary.totalDue)}</div>
                <div className="text-xs text-red-500">{t('info.billCount', { ns: 'reception', count: dailyReportData.summary.billCount })}</div>
              </div>
            </div>

            {dailyReportData.byCategory.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('heading.byCategory', { ns: 'reception' })}</h3>
                <div className="space-y-2">
                  {dailyReportData.byCategory.map((c) => (
                    <div key={c.item_category} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3">
                      <div className="flex items-center gap-2">
                        {serviceIcon(c.item_category)}
                        <div>
                          <div className="text-sm font-medium">{c.item_category}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{c.item_count} items</div>
                        </div>
                      </div>
                      <div className="font-data font-semibold">{formatBDT(c.total_amount)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {dailyReportData.byPaymentMethod.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('heading.byPaymentMethod', { ns: 'reception' })}</h3>
                <div className="space-y-2">
                  {dailyReportData.byPaymentMethod.map((m) => (
                    <div key={m.payment_method} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Banknote className="h-4 w-4 text-[var(--color-text-muted)]" />
                        <div>
                          <div className="text-sm font-medium capitalize">{m.payment_method}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{m.transaction_count} txns</div>
                        </div>
                      </div>
                      <div className="font-data font-semibold">{formatBDT(m.total_amount)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(dailyReportData.byDoctorConsultation ?? []).length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">By Doctor - Visit Fees</h3>
                <div className="space-y-2">
                  {(dailyReportData.byDoctorConsultation ?? []).map((d) => (
                    <div key={d.doctor_name} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Stethoscope className="h-4 w-4 text-[var(--color-text-muted)]" />
                        <div>
                          <div className="text-sm font-medium">{d.doctor_name}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{d.service_count} visits</div>
                        </div>
                      </div>
                      <div className="font-data font-semibold">{formatBDT(d.total_amount)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(dailyReportData.byDoctorTest ?? []).length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">By Doctor - Test / Diagnostic</h3>
                <div className="space-y-2">
                  {(dailyReportData.byDoctorTest ?? []).map((d) => (
                    <div key={d.doctor_name} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="h-4 w-4 text-[var(--color-text-muted)]" />
                        <div>
                          <div className="text-sm font-medium">{d.doctor_name}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{d.service_count} tests</div>
                        </div>
                      </div>
                      <div className="font-data font-semibold">{formatBDT(d.total_amount)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(dailyReportData.byDoctorOther ?? []).length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">By Doctor - Other Services</h3>
                <div className="space-y-2">
                  {(dailyReportData.byDoctorOther ?? []).map((d) => (
                    <div key={d.doctor_name} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-[var(--color-text-muted)]" />
                        <div>
                          <div className="text-sm font-medium">{d.doctor_name}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{d.service_count} services</div>
                        </div>
                      </div>
                      <div className="font-data font-semibold">{formatBDT(d.total_amount)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Doctor Fees Modal (from Today's Collection → Doctor Fees) ── */}
      {activeModal === 'doctorFees' && dailyReportData && (
        <Modal title={t('modal.doctorVisitFees', { ns: 'reception' })} onClose={() => setActiveModal('none')}>
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Doctor Visit Fees</h3>
              {(dailyReportData.byDoctorConsultation ?? []).length > 0 ? (
                <div className="space-y-2">
                  {(dailyReportData.byDoctorConsultation ?? []).map((d) => (
                    <div key={d.doctor_name} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Stethoscope className="h-4 w-4 text-[var(--color-text-muted)]" />
                        <span className="text-sm font-medium">{d.doctor_name}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-data font-semibold">{formatBDT(d.total_amount)}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{d.service_count} visits</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--color-border)] py-4 text-center text-sm text-[var(--color-text-muted)]">No doctor visit fee</div>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Test / Diagnostic by Doctor</h3>
              {(dailyReportData.byDoctorTest ?? []).length > 0 ? (
                <div className="space-y-2">
                  {(dailyReportData.byDoctorTest ?? []).map((d) => (
                    <div key={d.doctor_name} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="h-4 w-4 text-[var(--color-text-muted)]" />
                        <span className="text-sm font-medium">{d.doctor_name}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-data font-semibold">{formatBDT(d.total_amount)}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{d.service_count} tests</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--color-border)] py-4 text-center text-sm text-[var(--color-text-muted)]">No doctor-linked test collection</div>
              )}
            </div>
            {(dailyReportData.byDoctorOther ?? []).length > 0 ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Other Doctor-linked Services</h3>
                <div className="space-y-2">
                  {(dailyReportData.byDoctorOther ?? []).map((d) => (
                    <div key={d.doctor_name} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-[var(--color-text-muted)]" />
                        <span className="text-sm font-medium">{d.doctor_name}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-data font-semibold">{formatBDT(d.total_amount)}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{d.service_count} services</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      )}

      {/* ── Test Fees Modal (from Today's Collection → Test Fees) ── */}
      {activeModal === 'testFees' && dailyReportData && (
        <Modal title={t('modal.labTestFees', { ns: 'reception' })} onClose={() => setActiveModal('none')}>
          <div className="space-y-2">
            {dailyReportData.byCategory.length > 0 ? (
              dailyReportData.byCategory.map((c) => (
                <div key={c.item_category} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3">
                  <div className="flex items-center gap-2">
                    {serviceIcon(c.item_category)}
                    <div>
                      <div className="text-sm font-medium">{c.item_category}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{c.item_count} tests</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-data font-semibold">{formatBDT(c.total_amount)}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-sm text-[var(--color-text-muted)]">No lab test data</div>
            )}
          </div>
        </Modal>
      )}
      <ReceptionPatientDrawer
        patientId={drawerPatientId}
        basePath={basePath}
        onClose={() => setDrawerPatientId(null)}
      />
      {showBedsDrawer && (
        <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setShowBedsDrawer(false)}>
          <aside
            className="ml-auto flex h-full w-full max-w-xl flex-col bg-[var(--color-bg)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[var(--color-border)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Bed control</h2>
                  <p className="text-sm text-[var(--color-text-muted)]">Availability, cleaning and quick status management</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBedsDrawer(false)}
                  className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]"
                  aria-label="Close bed control"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {BED_FILTER_KEYS.map((key) => {
                  const isActive = bedStatusFilter === key;
                  const filterStyle = key === 'all' ? BED_STATUS_DEFAULT : getBedStatusStyle(key);
                  const value = getBedFilterValue(key, receptionBedSummary);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setBedStatusFilter(key)}
                      aria-pressed={isActive}
                      className={`relative flex items-center gap-2.5 rounded-lg border-2 px-3 py-2.5 text-left transition ${
                        isActive
                          ? `${filterStyle.pill} shadow-sm`
                          : 'border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-text-muted)]'
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                          isActive ? 'bg-white/70' : filterStyle.soft
                        }`}
                      >
                        <BedStatusIcon status={key} className={`h-4 w-4 ${filterStyle.icon}`} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[10px] font-semibold uppercase tracking-wide ${isActive ? '' : 'text-[var(--color-text-muted)]'}`}>
                          {BED_FILTER_LABELS[key]}
                        </span>
                        <span className={`block font-data text-lg font-bold leading-tight ${isActive ? '' : 'text-[var(--color-text-primary)]'}`}>
                          {value}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {receptionBedsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((item) => <div key={item} className="skeleton h-20 rounded-lg" />)}
                </div>
              ) : visibleDrawerBeds.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
                  No beds in this status.
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleDrawerBeds.map((bed) => {
                    const bedId = getReceptionBedId(bed);
                    const status = String(bed.status ?? '').toLowerCase();
                    const canQuickUpdate = Boolean(bedId) && status !== 'occupied';
                    const style = getBedStatusStyle(status);
                    return (
                      <div
                        key={`${bedId ?? bed.bed_number}-${bed.ward_name}`}
                        className={`relative overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] border-l-4 ${style.accent}`}
                      >
                        <div className="p-3 pl-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-[var(--color-text-primary)]">
                                  {bed.ward_name ?? 'Ward'} - Bed {bed.bed_number ?? bedId ?? '-'}
                                </span>
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${style.pill}`}>
                                  <BedStatusIcon status={status} className="h-3 w-3" />
                                  {formatBedStatusLabel(status)}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                                {[bed.bed_type || 'General', bed.floor ? `Floor ${bed.floor}` : '', bed.effective_rate || bed.rate_per_day ? `${formatBDT(Number(bed.effective_rate ?? bed.rate_per_day ?? 0))}/day` : ''].filter(Boolean).join(' · ')}
                              </div>
                              {bed.patient_name || bed.admission_no ? (
                                <div className="mt-1 inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                                  <UserRound className="h-3 w-3" aria-hidden="true" />
                                  {[bed.patient_name, bed.patient_code, bed.admission_no].filter(Boolean).join(' · ')}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          {canQuickUpdate && (
                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                              {status !== 'available' && (
                                <button
                                  type="button"
                                  disabled={!bedId || updateBedStatusMutation.isPending}
                                  onClick={() => bedId && updateBedStatusMutation.mutate({ bedId, status: 'available' })}
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  {status === 'cleaning' ? 'Mark available' : 'Available'}
                                </button>
                              )}
                              {status !== 'reserved' && (
                                <button
                                  type="button"
                                  disabled={updateBedStatusMutation.isPending}
                                  onClick={() => bedId && updateBedStatusMutation.mutate({ bedId, status: 'reserved' })}
                                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${getBedStatusStyle('reserved').pill} hover:brightness-95 disabled:opacity-50`}
                                >
                                  <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                                  Reserve
                                </button>
                              )}
                              {status !== 'cleaning' && (
                                <button
                                  type="button"
                                  disabled={updateBedStatusMutation.isPending}
                                  onClick={() => bedId && updateBedStatusMutation.mutate({ bedId, status: 'cleaning' })}
                                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${getBedStatusStyle('cleaning').pill} hover:brightness-95 disabled:opacity-50`}
                                >
                                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                                  Cleaning
                                </button>
                              )}
                              {status !== 'maintenance' && (
                                <button
                                  type="button"
                                  disabled={updateBedStatusMutation.isPending}
                                  onClick={() => bedId && updateBedStatusMutation.mutate({ bedId, status: 'maintenance' })}
                                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${getBedStatusStyle('maintenance').pill} hover:brightness-95 disabled:opacity-50`}
                                >
                                  <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                                  Maintenance
                                </button>
                              )}
                            </div>
                          )}
                          {status === 'occupied' && (
                            <div className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600">
                              <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                              Occupied beds change through admission/discharge
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
      {showReservationPanel && (
        <TokenReservationPanel
          doctors={doctors}
          onClose={() => setShowReservationPanel(false)}
        />
      )}
    </DashboardLayout>
  );
}

/* ═══════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════ */

function DeskStat({
  label,
  value,
  loading,
  icon,
  tone,
}: {
  label: string;
  value: number | string;
  loading?: boolean;
  icon: React.ReactNode;
  tone: 'blue' | 'violet' | 'amber' | 'emerald' | 'cyan' | 'slate';
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    cyan: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  }[tone];

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        {icon}
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide opacity-75">{label}</span>
      </div>
      {loading ? <div className="skeleton h-7 w-14 rounded" /> : <div className="font-data text-2xl font-bold leading-none">{value}</div>}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  size = 'default',
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  size?: 'default' | 'wide';
}) {
  const widthClass = size === 'wide' ? 'max-w-7xl' : 'max-w-4xl';
  const titleId = useId();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 pt-12 z-50 backdrop-blur-sm overflow-y-auto">
      <div
        className={`bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full ${widthClass} mb-8`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 id={titleId} className="font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Close dialog">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function LabTestSelector({ selected, onChange }: { selected: number[]; onChange: (ids: number[]) => void }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { t } = useTranslation(['billing', 'common', 'patients', 'sidebar']);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Fetch frequently used lab service items (already sorted by usage_count DESC)
  const { data: frequentData } = useApiQuery<{ services: Array<{ id: number; item_name: string; price: number; usage_count?: number }> }>(
    ['reception', 'frequent-lab'],
    '/api/reception/services?is_lab_catalog=1&limit=8',
    { staleTime: 300_000 },
  );
  const frequentTests = (frequentData?.services ?? []).slice(0, 8);

  const { data, isLoading } = useApiQuery<{ tests: Array<{ id: number; name: string; price: number; category?: string }> }>(
    ['lab', 'catalog', debouncedSearch],
    debouncedSearch.length >= 2 ? `/api/lab?search=${encodeURIComponent(debouncedSearch)}` : '',
    { enabled: debouncedSearch.length >= 2 },
  );
  const tests = data?.tests ?? [];

  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };

  return (
    <div>
      {/* Frequently Used Tests */}
      {frequentTests.length > 0 && !debouncedSearch && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
            {t('frequentTests', { defaultValue: 'Frequently Used' })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {frequentTests.map(test => (
              <button
                key={test.id}
                type="button"
                onClick={() => toggle(test.id)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  selected.includes(test.id)
                    ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                }`}
              >
                {test.item_name} <span className="opacity-70">({formatBDT(test.price)})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
        <input
          className="input pl-9"
          placeholder={t('searchTests', { defaultValue: 'Search lab tests...' })}
          aria-label={t('searchTests', { defaultValue: 'Search lab tests...' })}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      {isLoading ? (
        <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">{t('loading', { defaultValue: 'Loading...' })}</div>
      ) : tests.length === 0 ? (
        <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">{debouncedSearch.length >= 2 ? t('noTestsFound', { defaultValue: 'No tests found' }) : t('searchMinChars', { defaultValue: 'Type at least 2 characters to search' })}</div>
      ) : (
        tests.map(t => (
          <button key={t.id} onClick={() => toggle(t.id)}
            className={`w-full text-left px-3 py-2 flex justify-between items-center hover:bg-[var(--color-border-light)] border-b border-[var(--color-border)] last:border-0 ${selected.includes(t.id) ? 'bg-[var(--color-primary-light)]' : ''}`}>
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected.includes(t.id) ? 'bg-[var(--color-primary)] border-[var(--color-primary)]' : 'border-[var(--color-border)]'}`}>
                {selected.includes(t.id) && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
              <span className="text-sm">{t.name}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{t.category}</span>
            </div>
            <span className="font-data text-sm">{formatBDT(t.price)}</span>
          </button>
        ))
      )}
      {selected.length > 0 && <p className="text-xs text-[var(--color-text-muted)] mt-1">{selected.length} test(s) selected</p>}
    </div>
  );
}
