function parsePatientDisplayDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatPatientDateMonthYear(value: unknown, fallback = '—'): string {
  if (!value) return fallback;
  const parsed = parsePatientDisplayDate(value);
  if (!parsed) return String(value);
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  return `${day}-${month}-${year}`;
}

export function formatPatientDateTimeMonthYear(value: unknown, fallback = '—'): string {
  const parsed = parsePatientDisplayDate(value);
  if (!parsed) return value ? String(value) : fallback;
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${formatPatientDateMonthYear(value, fallback)} ${hours}:${minutes}`;
}

export interface PatientGuidanceSummary {
  headline: string;
  status: 'attention' | 'watch' | 'stable';
  summary: string;
  what_changed: string[];
  next_steps: string[];
  trust_notes: string[];
  care_reminders: string[];
  counts: {
    pending_review_items: number;
    verified_items: number;
    vault_documents: number;
    active_visit_pass: number;
  };
}

export interface PatientGuidanceMetric {
  key: 'pending' | 'verified' | 'vault' | 'hospitals';
  value: number;
}

export interface PatientDashboardPayload {
  hospitalsCount?: number;
  appointments?: any[];
  prescriptions?: any[];
  reports?: any[];
  labResults?: any[];
  bills?: any[];
  patient_guidance?: PatientGuidanceSummary;
}

export interface PatientAiSavedPlan {
  id: number | string;
  headline: string;
  summary: string;
  confidence: string;
  created_at: string;
  completion_percent?: number;
  completed_items: string[];
  plan: {
    focus_areas?: string[];
    action_checklist: string[];
    eat_more?: string[];
    avoid_or_reduce?: string[];
    daily_routine?: string[];
    exercise_plan?: string[];
    follow_up_actions?: string[];
    warning_signs?: string[];
    doctor_consultation_advice?: string[];
    data_gaps?: string[];
    disclaimer?: string;
  };
  source_snapshot?: {
    vault_documents?: Array<{ title?: string; document_date?: string; entered_at?: string }>;
    vitals?: Array<{ blood_sugar?: number; systolic?: number; diastolic?: number; logged_on?: string }>;
    lifestyle_logs?: Array<{ sleep_hours?: number; exercise_minutes?: number; diet_notes?: string; logged_on?: string }>;
    wellness_tracker?: {
      adherence_percent_today?: number;
      medication_reminders?: any[];
      daily_routines?: any[];
      completed_items_today?: any[];
    };
  };
}

export interface PatientAiPlannerPayload {
  plans: PatientAiSavedPlan[];
  latestPlan: PatientAiSavedPlan | null;
  remainingGenerationsToday: number;
  dailyLimit: number;
}

export interface PatientHospitalRecordSnapshot {
  selectedHospital?: {
    tenantId: string;
    hospitalName: string;
  } | null;
  appointments?: any[];
  prescriptions?: any[];
  labResults?: any[];
  documents?: any[];
  diagnoses?: any[];
  conversations?: any[];
  reviews?: any[];
  bills?: any[];
  timeline?: any[];
  refillRequests?: any[];
}

export interface PatientSyncedAppointmentStatus {
  label: string;
  tone: 'slate' | 'amber' | 'cyan' | 'blue' | 'emerald' | 'rose';
  details: string[];
}

export interface PatientLiveVisitSummary {
  status: string;
  appointment_status?: string | null;
  doctor_specialization?: string | null;
  chief_complaint?: string | null;
  current_serving_token_no?: string | null;
  patients_ahead?: number;
  estimated_wait_minutes?: number | null;
  last_updated_at?: string | null;
  next_step_label?: string | null;
  arrival_guidance?: {
    action: string;
    label: string;
  } | null;
  journey?: Array<{
    key: string;
    state: 'done' | 'current' | 'upcoming';
    label: string;
  }> | null;
  appointment?: {
    id: number;
    appt_date: string;
    appt_time?: string | null;
    doctor_name?: string | null;
    status?: string | null;
  } | null;
  visit?: {
    id: number;
    status: string;
    visit_date?: string | null;
  } | null;
  queue?: {
    id: number;
    token_no: string;
    token_number: number;
    status: string;
    counter_no?: string | null;
    called_at?: string | null;
    serve_start_time?: string | null;
    serve_end_time?: string | null;
  } | null;
}

export type PatientQuickActionKey =
  | 'book_appointment'
  | 'complete_profile'
  | 'report_health_data'
  | 'upload_document'
  | 'review_bills'
  | 'manage_prescriptions'
  | 'create_visit_pass'
  | 'create_emergency_pack'
  | 'manage_family'
  | 'open_global_records'
  | 'mental_health'
  | 'womens_health';

export type PatientPortalSectionId =
  | 'overview'
  | 'find-care'
  | 'hospital-services'
  | 'global-records'
  | 'family'
  | 'vault'
  | 'data'
  | 'privacy';

export interface PatientPortalSection {
  id: PatientPortalSectionId;
  label: string;
  description: string;
}

export const PATIENT_LOGIN_ASSURANCE_TITLE = 'একটি নিরাপদ রোগী অ্যাকাউন্ট';
export const PATIENT_LOGIN_ASSURANCE_BODY =
  'লগইন, রেজিস্ট্রেশন, পাসওয়ার্ড রিসেট, স্বাস্থ্য কার্ড, আর আপনার ব্যক্তিগত স্বাস্থ্য তথ্য এখন এক জায়গা থেকেই ব্যবহার করা যায়।';
export const PATIENT_DASHBOARD_ASSURANCE =
  'এখান থেকেই নিজের তথ্য আপডেট, রিপোর্ট যোগ, self-reported health data জমা, আর hospital visit-এর আগে share-ready pass তৈরি করা যাবে।';
export const LEGACY_PATIENT_PORTAL_REDIRECT_PATH = '/patient/dashboard';
export const PATIENT_TENANT_PORTAL_API_BASE = '/api/patient-portal';
export const PATIENT_GLOBAL_HEALTH_API_BASE = '/api/global-health';
export const PATIENT_SELECTED_HOSPITAL_STORAGE_KEY = 'ozzyl_patient_selected_hospital';


type PatientClinicalRecord = Record<string, unknown>;

const PATIENT_VISIBLE_PRESCRIPTION_STATUSES = new Set(['final', 'active', 'completed', 'dispensed']);
const PATIENT_BLOCKED_PRESCRIPTION_STATUSES = new Set(['draft', 'void', 'voided', 'cancelled', 'canceled', 'deleted', 'inactive', 'stopped']);
const PATIENT_VISIBLE_LAB_STATUSES = new Set(['verified', 'released', 'completed', 'final']);
const PATIENT_BLOCKED_LAB_STATUSES = new Set(['draft', 'pending', 'unverified', 'preliminary', 'cancelled', 'canceled', 'void', 'voided']);

function normalizeClinicalStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function getFirstClinicalStatus(record: PatientClinicalRecord | null | undefined, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const status = normalizeClinicalStatus(record[key]);
    if (status) return status;
  }
  return '';
}

export function isPatientVisiblePrescription(record: PatientClinicalRecord | null | undefined): boolean {
  const status = getFirstClinicalStatus(record, ['status', 'prescription_status', 'state']);
  if (!status || PATIENT_BLOCKED_PRESCRIPTION_STATUSES.has(status)) return false;
  return PATIENT_VISIBLE_PRESCRIPTION_STATUSES.has(status);
}

export function isPatientVisibleLabResult(record: PatientClinicalRecord | null | undefined): boolean {
  const status = getFirstClinicalStatus(record, ['status', 'result_status', 'report_status', 'order_status', 'verification_status']);
  if (!status || PATIENT_BLOCKED_LAB_STATUSES.has(status)) return false;
  return PATIENT_VISIBLE_LAB_STATUSES.has(status);
}

export function normalizePatientClinicalDataForDisplay<T extends {
  appointments?: PatientClinicalRecord[];
  prescriptions?: PatientClinicalRecord[];
  labs?: PatientClinicalRecord[];
  labResults?: PatientClinicalRecord[];
  bills?: PatientClinicalRecord[];
}>(input: T | null | undefined) {
  const labResults = input?.labResults ?? input?.labs ?? [];
  return {
    appointments: input?.appointments ?? [],
    prescriptions: (input?.prescriptions ?? []).filter(isPatientVisiblePrescription),
    labs: labResults.filter(isPatientVisibleLabResult),
    labResults: labResults.filter(isPatientVisibleLabResult),
    bills: input?.bills ?? [],
  };
}


export const PATIENT_PORTAL_SECTIONS: PatientPortalSection[] = [
  { id: 'overview', label: 'patientDashboard.overviewTab', description: 'patientDashboard.overviewDesc' },
  { id: 'find-care', label: 'patientDashboard.findCareTab', description: 'patientDashboard.findCareDesc' },
  { id: 'hospital-services', label: 'patientDashboard.hospitalServicesTab', description: 'patientDashboard.hospitalServicesDesc' },
  { id: 'global-records', label: 'patientDashboard.globalRecordsTab', description: 'patientDashboard.globalRecordsDesc' },
  { id: 'family', label: 'patientDashboard.familyTab', description: 'patientDashboard.familyDesc' },
  { id: 'vault', label: 'patientDashboard.vaultTab', description: 'patientDashboard.vaultDesc' },
  { id: 'data', label: 'patientDashboard.selfReportedDataTab', description: 'patientDashboard.selfReportedDataDesc' },
  { id: 'privacy', label: 'patientDashboard.privacyAccessTab', description: 'patientDashboard.privacyAccessDesc' },
];

export function normalizePatientDashboardPayload(input: PatientDashboardPayload | null | undefined) {
  const reports = input?.reports ?? input?.labResults ?? [];
  return {
    hospitalsCount: input?.hospitalsCount ?? 0,
    appointments: input?.appointments ?? [],
    prescriptions: input?.prescriptions ?? [],
    reports,
    labResults: reports,
    bills: input?.bills ?? [],
    patient_guidance: input?.patient_guidance,
  };
}

export function normalizePatientAiPlannerPayload(input: any): PatientAiPlannerPayload {
  if (!input) {
    return { plans: [], latestPlan: null, remainingGenerationsToday: 3, dailyLimit: 3 };
  }
  const plans: PatientAiSavedPlan[] = Array.isArray(input.plans) ? input.plans : [];
  const latestPlan = input.latestPlan ?? input.latest_plan ?? plans[0] ?? null;
  return {
    plans,
    latestPlan,
    remainingGenerationsToday: input.remainingGenerationsToday ?? input.remaining_generations_today ?? 3,
    dailyLimit: input.dailyLimit ?? input.daily_limit ?? 3,
  };
}

export function buildPatientGuidanceChecklist(guidance: PatientGuidanceSummary | null | undefined): string[] {
  if (!guidance) return [];
  return Array.from(
    new Set(
      [...guidance.next_steps, ...guidance.care_reminders]
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 3);
}

export function buildPatientGuidanceMetrics(input: {
  pendingReviewItems: number;
  verifiedItems: number;
  vaultDocuments: number;
  hospitalsCount: number;
}): PatientGuidanceMetric[] {
  const metrics: PatientGuidanceMetric[] = [
    { key: 'pending', value: input.pendingReviewItems },
    { key: 'verified', value: input.verifiedItems },
    { key: 'vault', value: input.vaultDocuments },
    { key: 'hospitals', value: input.hospitalsCount },
  ];

  return metrics.some((metric) => metric.value > 0) ? metrics : [];
}

export function getPatientGuidanceBadge(
  status: PatientGuidanceSummary['status'] | undefined,
  taskCount: number,
): string {
  if (status === 'attention') return 'Needs action';
  if (status === 'watch') return taskCount > 0 ? `${taskCount} tasks to finish` : 'Prepare next visit';
  return 'All set';
}

export function normalizePatientHospitalRecordSnapshot(input: PatientHospitalRecordSnapshot) {
  return {
    selectedHospital: input.selectedHospital ?? null,
    appointments: input.appointments ?? [],
    prescriptions: input.prescriptions ?? [],
    labResults: input.labResults ?? [],
    documents: input.documents ?? [],
    diagnoses: input.diagnoses ?? [],
    conversations: input.conversations ?? [],
    reviews: input.reviews ?? [],
    bills: input.bills ?? [],
    timeline: input.timeline ?? [],
    refillRequests: input.refillRequests ?? [],
  };
}

export interface PatientPrescriptionActionState {
  id: number | string | null;
  title: string;
  doctorLabel: string;
  dateLabel: string;
  followUpLabel: string;
  diagnosis: string;
  advice: string;
  canRequestRefill: boolean;
  detailPath: string;
  itemsPath: string;
  pdfPath: string;
  refillPath: string;
  shareText: string;
}

export function buildPatientPrescriptionActionState(prescription: PatientClinicalRecord | null | undefined): PatientPrescriptionActionState {
  const rawId = prescription?.id;
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
  const title = String(prescription?.rx_no ?? prescription?.prescription_no ?? prescription?.id ?? 'Prescription');
  const doctorLabel = String(prescription?.doctor_name ?? prescription?.provider_name ?? 'Doctor');
  const dateLabel = formatPatientDateMonthYear(prescription?.created_at ?? prescription?.prescribed_date ?? prescription?.date);
  const followUpLabel = formatPatientDateMonthYear(prescription?.follow_up_date ?? prescription?.followup_date, '—');
  const status = getFirstClinicalStatus(prescription, ['status', 'prescription_status', 'state']);
  const canRequestRefill = Boolean(id) && !PATIENT_BLOCKED_PRESCRIPTION_STATUSES.has(status || '');
  const detailPath = id ? buildPatientTenantPortalPath(`/prescriptions/${id}`) : '';
  const itemsPath = id ? buildPatientTenantPortalPath(`/prescriptions/${id}/items`) : '';
  const pdfPath = id ? buildPatientTenantPortalPath(`/prescriptions/${id}/pdf`) : '';
  const refillPath = id ? buildPatientTenantPortalPath(`/prescriptions/${id}/refill`) : '';

  return {
    id,
    title,
    doctorLabel,
    dateLabel,
    followUpLabel,
    diagnosis: String(prescription?.diagnosis ?? ''),
    advice: String(prescription?.advice ?? ''),
    canRequestRefill,
    detailPath,
    itemsPath,
    pdfPath,
    refillPath,
    shareText: `${title} from ${doctorLabel}${dateLabel !== '—' ? ` on ${dateLabel}` : ''}`,
  };
}

export interface PatientAppointmentBookingGuard {
  hasDate: boolean;
  bookedCount: number;
  bookedTimes: string[];
  availableTimes: string[];
  hasGeneratedSlots: boolean;
  isSelectedTimeBooked: boolean;
  isSelectedTimeOutsideGeneratedSlots: boolean;
  canSubmit: boolean;
  message: string;
}

export interface PatientAppointmentMvpState {
  id: number | string | null;
  title: string;
  subtitle: string;
  dateLabel: string;
  timeLabel: string;
  chiefComplaint: string;
  status: PatientSyncedAppointmentStatus;
  canCancel: boolean;
  reschedule: {
    enabled: boolean;
    label: string;
  };
  queue: {
    token: string | null;
    counter: string | null;
    estimatedWaitMinutes: number | null;
  };
}

function normalizePatientAppointmentTime(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function buildPatientAppointmentBookingGuard(
  slotData: { bookedCount?: number | null; bookedSlots?: Array<{ appt_time?: unknown; token_no?: unknown }> | null; bookedTimes?: unknown[] | null; availableSlots?: Array<{ time?: unknown; label?: unknown }> | null; hasSchedule?: boolean | null } | null | undefined,
  selectedTime: string | null | undefined,
): PatientAppointmentBookingGuard {
  const bookedTimes = ((slotData?.bookedTimes && slotData.bookedTimes.length > 0)
    ? slotData.bookedTimes
    : (slotData?.bookedSlots ?? []).map((slot) => slot.appt_time))
    .map((time) => normalizePatientAppointmentTime(time))
    .filter(Boolean);
  const availableTimes = (slotData?.availableSlots ?? [])
    .map((slot) => normalizePatientAppointmentTime(slot.time))
    .filter(Boolean);
  const hasGeneratedSlots = Boolean(slotData?.hasSchedule && Array.isArray(slotData.availableSlots));
  const normalizedSelectedTime = normalizePatientAppointmentTime(selectedTime);
  const hasDate = Boolean(slotData && (Array.isArray(slotData.bookedSlots) || Array.isArray(slotData.bookedTimes) || Array.isArray(slotData.availableSlots)));
  const isSelectedTimeBooked = Boolean(normalizedSelectedTime && bookedTimes.includes(normalizedSelectedTime));
  const isSelectedTimeOutsideGeneratedSlots = Boolean(
    hasGeneratedSlots && normalizedSelectedTime && !availableTimes.includes(normalizedSelectedTime),
  );
  return {
    hasDate,
    bookedCount: slotData?.bookedCount ?? bookedTimes.length,
    bookedTimes,
    availableTimes,
    hasGeneratedSlots,
    isSelectedTimeBooked,
    isSelectedTimeOutsideGeneratedSlots,
    canSubmit: Boolean(normalizedSelectedTime) && !isSelectedTimeBooked && !isSelectedTimeOutsideGeneratedSlots,
    message: !hasDate
      ? 'Select a doctor and date to check booked slots.'
      : isSelectedTimeBooked
        ? 'This time is already booked. Choose another time.'
        : isSelectedTimeOutsideGeneratedSlots
          ? 'Choose an available slot from the doctor schedule.'
          : normalizedSelectedTime
            ? 'This time looks available based on current booked slots.'
            : 'Choose a time to continue.',
  };
}

export function buildPatientSyncedAppointmentStatus(appointment: any): PatientSyncedAppointmentStatus {
  const appointmentStatus = String(appointment?.status ?? '').toLowerCase();
  const queueStatus = String(appointment?.queue_status ?? '').toLowerCase();
  const visitStatus = String(appointment?.visit_status ?? '').toLowerCase();
  const details: string[] = [];

  if (appointment?.live_token_no) details.push(`Token ${appointment.live_token_no}`);
  if (appointment?.live_counter_no) details.push(`Counter ${appointment.live_counter_no}`);
  if (appointment?.live_estimated_wait_minutes !== null && appointment?.live_estimated_wait_minutes !== undefined) {
    details.push(`${appointment.live_estimated_wait_minutes} min wait`);
  }

  if (queueStatus === 'serving') return { label: 'In consultation', tone: 'emerald', details };
  if (queueStatus === 'called') return { label: 'Go now', tone: 'blue', details };
  if (queueStatus === 'waiting') return { label: 'Waiting in queue', tone: 'cyan', details };
  if (visitStatus === 'checked-in' || visitStatus === 'initiated' || visitStatus === 'engaged') {
    return { label: 'Checked in', tone: 'cyan', details };
  }
  if (appointmentStatus === 'confirmed' || appointmentStatus === 'booked') {
    return { label: 'Confirmed', tone: 'blue', details };
  }
  if (appointmentStatus === 'completed' || queueStatus === 'completed' || visitStatus === 'concluded') {
    return { label: 'Completed', tone: 'emerald', details };
  }
  if (appointmentStatus === 'cancelled' || queueStatus === 'cancelled') {
    return { label: 'Cancelled', tone: 'rose', details };
  }
  if (appointmentStatus === 'no_show' || queueStatus === 'no_show') {
    return { label: 'Missed visit', tone: 'rose', details };
  }

  return { label: 'Booked', tone: 'amber', details };
}

function getPatientAppointmentDateValue(appointment: any): string {
  return String(appointment?.appointment_date ?? appointment?.appt_date ?? appointment?.date ?? '').trim();
}

function getPatientAppointmentStatusValue(appointment: any): string {
  return normalizeClinicalStatus(appointment?.status ?? appointment?.appointment_status ?? appointment?.queue_status ?? appointment?.visit_status);
}

function isPatientAppointmentPast(appointment: any): boolean {
  const dateValue = getPatientAppointmentDateValue(appointment);
  if (!dateValue) return false;
  const parsed = new Date(`${dateValue}T${String(appointment?.appointment_time ?? appointment?.appt_time ?? '23:59')}`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() < Date.now();
}

export function buildPatientAppointmentMvpState(appointment: any): PatientAppointmentMvpState {
  const status = buildPatientSyncedAppointmentStatus(appointment);
  const rawStatus = getPatientAppointmentStatusValue(appointment);
  const terminalStatuses = new Set(['completed', 'cancelled', 'canceled', 'no_show', 'void', 'voided']);
  const canCancel = !terminalStatuses.has(rawStatus) && !isPatientAppointmentPast(appointment);
  const title = String(appointment?.doctor_name ?? appointment?.provider_name ?? appointment?.department_name ?? appointment?.department ?? 'Hospital visit');
  const specialty = String(appointment?.specialty ?? appointment?.department_name ?? appointment?.department ?? '').trim();
  const reason = String(appointment?.chief_complaint ?? appointment?.reason ?? '').trim();
  const dateLabel = getPatientAppointmentDateValue(appointment) || 'Date not set';
  const timeLabel = String(appointment?.appointment_time ?? appointment?.appt_time ?? '').trim();

  return {
    id: appointment?.id ?? null,
    title,
    subtitle: [specialty, reason].filter(Boolean).join(' · ') || 'Appointment detail',
    dateLabel,
    timeLabel,
    chiefComplaint: reason,
    status,
    canCancel,
    reschedule: {
      enabled: false,
      label: 'Reschedule coming soon',
    },
    queue: {
      token: appointment?.live_token_no ? String(appointment.live_token_no) : null,
      counter: appointment?.live_counter_no ? String(appointment.live_counter_no) : null,
      estimatedWaitMinutes: appointment?.live_estimated_wait_minutes ?? null,
    },
  };
}

export function normalizePatientLiveVisitSummary(input: PatientLiveVisitSummary | null | undefined) {
  return input
    ? {
        ...input,
        patients_ahead: input.patients_ahead ?? 0,
        estimated_wait_minutes: input.estimated_wait_minutes ?? null,
        last_updated_at: input.last_updated_at ?? null,
        next_step_label: input.next_step_label ?? null,
        arrival_guidance: input.arrival_guidance ?? null,
        journey: input.journey ?? [],
        appointment: input.appointment ?? null,
        visit: input.visit ?? null,
        queue: input.queue ?? null,
      }
    : null;
}

function parsePatientDateValue(value: unknown): number {
  if (!value) return 0;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function pickLatestPatientRecord(records: PatientClinicalRecord[], dateKeys: string[]): PatientClinicalRecord | null {
  if (records.length === 0) return null;
  return [...records].sort((a, b) => {
    const aTime = Math.max(...dateKeys.map((key) => parsePatientDateValue(a[key])));
    const bTime = Math.max(...dateKeys.map((key) => parsePatientDateValue(b[key])));
    return bTime - aTime;
  })[0] ?? null;
}

function pickNextPatientAppointment(records: PatientClinicalRecord[]): PatientClinicalRecord | null {
  if (records.length === 0) return null;
  const now = Date.now();
  const sorted = [...records].sort((a, b) => {
    const aTime = parsePatientDateValue(a.appointment_date ?? a.appt_date ?? a.date ?? a.created_at);
    const bTime = parsePatientDateValue(b.appointment_date ?? b.appt_date ?? b.date ?? b.created_at);
    const aFuture = aTime >= now;
    const bFuture = bTime >= now;
    if (aFuture !== bFuture) return aFuture ? -1 : 1;
    return aFuture ? aTime - bTime : bTime - aTime;
  });
  return sorted[0] ?? null;
}

function getPatientBillTotal(record: PatientClinicalRecord): number {
  return Number(record.total_amount ?? record.grand_total ?? record.total ?? record.amount ?? 0) || 0;
}

function getPatientBillPaid(record: PatientClinicalRecord): number {
  return Number(record.paid_amount ?? record.paid ?? record.amount_paid ?? 0) || 0;
}

function getPatientBillDue(record: PatientClinicalRecord): number {
  const explicitDue = Number(record.due_amount ?? record.due ?? record.balance ?? 0);
  if (Number.isFinite(explicitDue) && explicitDue > 0) return explicitDue;
  return Math.max(0, getPatientBillTotal(record) - getPatientBillPaid(record));
}

function isPatientBillDue(record: PatientClinicalRecord): boolean {
  const status = normalizeClinicalStatus(record.payment_status ?? record.status);
  if (status === 'paid' || status === 'settled' || status === 'refunded' || status === 'cancelled' || status === 'canceled') return false;
  return getPatientBillDue(record) > 0;
}

export interface SelectedHospitalCareOverview {
  hasSelectedHospital: boolean;
  hospitalName: string | null;
  liveVisit: PatientLiveVisitSummary | null;
  nextAppointment: PatientClinicalRecord | null;
  recentPrescription: PatientClinicalRecord | null;
  latestLabResult: PatientClinicalRecord | null;
  billSummary: {
    dueCount: number;
    totalDue: number;
    latestDueBill: PatientClinicalRecord | null;
  };
  counts: {
    appointments: number;
    prescriptions: number;
    labResults: number;
    bills: number;
  };
}

export function buildSelectedHospitalCareOverview(input: {
  hospitalName?: string | null;
  clinicalData?: {
    appointments?: PatientClinicalRecord[];
    prescriptions?: PatientClinicalRecord[];
    labs?: PatientClinicalRecord[];
    labResults?: PatientClinicalRecord[];
    bills?: PatientClinicalRecord[];
  } | null;
  liveVisit?: PatientLiveVisitSummary | null;
}): SelectedHospitalCareOverview {
  const clinicalData = normalizePatientClinicalDataForDisplay(input.clinicalData ?? {});
  const dueBills = clinicalData.bills.filter(isPatientBillDue);
  return {
    hasSelectedHospital: Boolean(input.hospitalName),
    hospitalName: input.hospitalName ?? null,
    liveVisit: normalizePatientLiveVisitSummary(input.liveVisit),
    nextAppointment: pickNextPatientAppointment(clinicalData.appointments),
    recentPrescription: pickLatestPatientRecord(clinicalData.prescriptions, ['prescribed_date', 'date', 'created_at']),
    latestLabResult: pickLatestPatientRecord(clinicalData.labResults, ['result_date', 'collected_date', 'created_at']),
    billSummary: {
      dueCount: dueBills.length,
      totalDue: dueBills.reduce((sum, bill) => sum + getPatientBillDue(bill), 0),
      latestDueBill: pickLatestPatientRecord(dueBills, ['bill_date', 'created_at']),
    },
    counts: {
      appointments: clinicalData.appointments.length,
      prescriptions: clinicalData.prescriptions.length,
      labResults: clinicalData.labResults.length,
      bills: clinicalData.bills.length,
    },
  };
}

export function buildPatientTenantPortalPath(path: `/${string}`) {
  return `${PATIENT_TENANT_PORTAL_API_BASE}${path}`;
}

export function buildPatientGlobalHealthPath(path: `/${string}`) {
  return `${PATIENT_GLOBAL_HEALTH_API_BASE}${path}`;
}

export function getPatientQuickActionKeys(input: {
  profileNeedsCompletion: boolean;
  hasPatientData: boolean;
  hasVaultDocuments: boolean;
  hasActiveVisitPass: boolean;
  hasLinkedHospitals?: boolean;
  hasFamilyProfiles?: boolean;
  hasOutstandingBills?: boolean;
  hasRecentPrescriptions?: boolean;
}): PatientQuickActionKey[] {
  const actions: PatientQuickActionKey[] = [];

  if (input.profileNeedsCompletion) {
    actions.push('complete_profile');
  }

  if (input.hasLinkedHospitals) {
    actions.push('book_appointment');
  }

  if (input.hasOutstandingBills) {
    actions.push('review_bills');
  }

  if (input.hasRecentPrescriptions) {
    actions.push('manage_prescriptions');
  }

  actions.push('report_health_data');

  if (!input.hasVaultDocuments || !input.hasPatientData) {
    actions.push('upload_document');
  }

  if (!input.hasActiveVisitPass) {
    actions.push('create_visit_pass');
  }

  actions.push('create_emergency_pack');

  if (input.hasLinkedHospitals) {
    actions.push('open_global_records');
  }

  // Suggest Wellness actions
  actions.push('mental_health');
  actions.push('womens_health');

  if (input.hasFamilyProfiles) {
    actions.push('manage_family');
  }

  return Array.from(new Set(actions)).slice(0, 4);
}
