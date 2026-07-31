import { getTodayGMT6 } from './date-utils';

export type DoctorDashboardStatus = 'waiting' | 'in_progress' | 'completed' | 'cancelled' | 'no_show' | 'pending_approval';

const IN_ROOM_QUEUE_STATUSES = new Set(['serving', 'called', 'engaged', 'in_room', 'in-room', 'arrived']);

export function resolveDoctorDashboardDate(requestedDate?: string | null, today = getTodayGMT6()): string {
  return requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;
}

export function deriveDoctorDashboardStatus(
  appointmentStatus?: string | null,
  queueStatus?: string | null,
): DoctorDashboardStatus {
  const appt = String(appointmentStatus ?? '').toLowerCase();
  const queue = String(queueStatus ?? '').toLowerCase();

  if (appt === 'cancelled' || queue === 'cancelled') return 'cancelled';
  if (appt === 'no_show' || queue === 'no_show') return 'no_show';
  if (appt === 'completed' || queue === 'completed') return 'completed';
  if (appt === 'in_progress' || IN_ROOM_QUEUE_STATUSES.has(queue)) return 'in_progress';
  if (appt === 'pending_approval') return 'pending_approval';
  return 'waiting';
}

export function appointmentStatusForDoctorAction(status: DoctorDashboardStatus): 'checked_in' | 'completed' | 'no_show' {
  if (status === 'completed') return 'completed';
  if (status === 'no_show') return 'no_show';
  return 'checked_in';
}

export function queueStatusForDoctorAction(status: DoctorDashboardStatus): 'waiting' | 'serving' | 'completed' | 'no_show' {
  if (status === 'completed') return 'completed';
  if (status === 'no_show') return 'no_show';
  if (status === 'in_progress') return 'serving';
  return 'waiting';
}

export function isAllowedDoctorDashboardAction(status: string): status is DoctorDashboardStatus {
  return ['waiting', 'in_progress', 'completed', 'no_show'].includes(status);
}

export function summarizeDoctorQueue(queue: Array<{ status?: string | null }>) {
  return queue.reduce(
    (acc, item) => {
      const rawStatus = String(item.status ?? '').toLowerCase();
      const status = isAllowedDoctorDashboardAction(rawStatus)
        ? rawStatus
        : deriveDoctorDashboardStatus(rawStatus);
      acc.total += 1;
      if (status === 'completed') acc.completed += 1;
      if (status === 'waiting') acc.waiting += 1;
      if (status === 'in_progress') acc.in_progress += 1;
      return acc;
    },
    { total: 0, completed: 0, waiting: 0, in_progress: 0 },
  );
}

export function doctorQueueSortRank(item: {
  status?: string | null;
  visit_type?: string | null;
  queue_priority?: string | null;
  clinical_priority_level?: string | null;
}): number {
  const status = String(item.status ?? '').toLowerCase();
  const visitType = String(item.visit_type ?? '').toLowerCase();
  const priority = String(item.queue_priority ?? '').toLowerCase();
  const clinicalLevel = String(item.clinical_priority_level ?? '').toLowerCase();

  if (status === 'in_progress') return 0;
  if (clinicalLevel === 'vitals_abnormal') return 0.5;
  if (visitType === 'emergency' || priority === 'emergency') return 1;
  if (clinicalLevel === 'elderly' || clinicalLevel === 'child' || clinicalLevel === 'pregnant') return 1.5;
  if (priority === 'urgent') return 2;
  if (status === 'waiting') return 3;
  if (status === 'pending_approval') return 4;
  if (status === 'completed') return 5;
  if (status === 'no_show' || status === 'cancelled') return 6;
  return 7;
}

export function formatAppointmentTypeLabel(value?: string | null): string {
  const normalized = String(value ?? '').toLowerCase();
  const labels: Record<string, string> = {
    new_patient: 'New',
    old_patient: 'Follow up',
    follow_up: 'Follow up',
    followup: 'Follow up',
    report_show: 'Report show',
    free_visit: 'Free approved',
    discounted_visit: 'Discounted',
    emergency: 'Emergency',
  };
  return labels[normalized] ?? (normalized ? normalized.replace(/_/g, ' ') : 'Visit');
}

// ─── Patient Medical Snapshot ─────────────────────────────────────────────────

export interface PatientSnapshotInput {
  date_of_birth?: string | null;
  blood_group?: string | null;
  active_problems?: Array<{ problem_name: string; status: string }>;
  allergies?: Array<{ allergen: string; severity: string }>;
  last_visit?: { visit_date: string; diagnosis: string } | null;
  recent_labs?: Array<{ test_name: string; result_value: string; test_date: string }>;
  vitals?: {
    systolic?: number | null;
    diastolic?: number | null;
    heart_rate?: number | null;
    temperature?: number | null;
    spo2?: number | null;
  } | null;
}

export interface PatientSnapshot {
  age: number | null;
  bloodGroup: string | null;
  chronicConditions: string[];
  allergies: Array<{ name: string; severity: string }>;
  lastVisitDate: string | null;
  lastDiagnosis: string | null;
  lastHbA1c: string | null;
  currentVitals: {
    bp: string;
    heartRate: number | null;
    temperature: number | null;
    spo2: number | null;
  } | null;
}

export function derivePatientMedicalSnapshot(input: PatientSnapshotInput | null | undefined): PatientSnapshot {
  const empty: PatientSnapshot = {
    age: null,
    bloodGroup: null,
    chronicConditions: [],
    allergies: [],
    lastVisitDate: null,
    lastDiagnosis: null,
    lastHbA1c: null,
    currentVitals: null,
  };
  if (!input) return empty;

  // Age from DOB
  let age: number | null = null;
  if (input.date_of_birth) {
    const dob = new Date(input.date_of_birth);
    if (!isNaN(dob.getTime())) {
      const today = new Date();
      age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    }
  }

  // Chronic conditions (active only)
  const chronicConditions = (input.active_problems ?? [])
    .filter(p => p.status === 'active')
    .map(p => p.problem_name);

  // Allergies
  const allergies = (input.allergies ?? []).map(a => ({
    name: a.allergen,
    severity: a.severity,
  }));

  // Last visit
  const lastVisitDate = input.last_visit?.visit_date ?? null;
  const lastDiagnosis = input.last_visit?.diagnosis ?? null;

  // Last HbA1c
  const hbA1c = (input.recent_labs ?? []).find(
    l => l.test_name.toLowerCase() === 'hba1c',
  );
  const lastHbA1c = hbA1c?.result_value ?? null;

  // Current vitals
  const v = input.vitals;
  const currentVitals = v
    ? {
        bp: v.systolic && v.diastolic ? `${v.systolic}/${v.diastolic}` : null,
        heartRate: v.heart_rate ?? null,
        temperature: v.temperature ?? null,
        spo2: v.spo2 ?? null,
      }
    : null;

  return {
    age,
    bloodGroup: input.blood_group ?? null,
    chronicConditions,
    allergies,
    lastVisitDate,
    lastDiagnosis,
    lastHbA1c,
    currentVitals: currentVitals
      ? {
          bp: currentVitals.bp ?? '-',
          heartRate: currentVitals.heartRate,
          temperature: currentVitals.temperature,
          spo2: currentVitals.spo2,
        }
      : null,
  };
}

// ─── Clinical Priority System ────────────────────────────────────────────────

export interface ClinicalPriorityInput {
  age?: number | null;
  is_pregnant?: boolean;
  vitals?: {
    systolic?: number | null;
    diastolic?: number | null;
    spo2?: number | null;
    temperature?: number | null;
  } | null;
}

export interface ClinicalPriority {
  level: 'normal' | 'elderly' | 'child' | 'pregnant' | 'vitals_abnormal';
  label: string | null;
  color: string | null;
}

export function deriveClinicalPriority(input: ClinicalPriorityInput): ClinicalPriority {
  const age = input.age ?? null;
  const v = input.vitals;

  // Vitals abnormal check (highest priority)
  if (v) {
    const bpCritical = (v.systolic != null && v.systolic >= 180) || (v.diastolic != null && v.diastolic >= 120);
    const spo2Critical = v.spo2 != null && v.spo2 < 90;
    const feverCritical = v.temperature != null && v.temperature >= 104;
    if (bpCritical || spo2Critical || feverCritical) {
      return { level: 'vitals_abnormal', label: 'Vitals Alert', color: 'red' };
    }
  }

  // Pregnant
  if (input.is_pregnant) {
    return { level: 'pregnant', label: 'গর্ভবতী', color: 'pink' };
  }

  // Elderly (65+)
  if (age != null && age >= 65) {
    return { level: 'elderly', label: 'বয়স্ক', color: 'amber' };
  }

  // Child (under 12)
  if (age != null && age < 12) {
    return { level: 'child', label: 'শিশু', color: 'blue' };
  }

  return { level: 'normal', label: null, color: null };
}

export function formatBillingStatusLabel(value?: string | null): string {
  const normalized = String(value ?? '').toLowerCase();
  const labels: Record<string, string> = {
    paid: 'Paid',
    due_approved: 'Due approved',
    no_charge: 'No charge',
    pending: 'Pending bill',
    unpaid: 'Unpaid',
    partial_paid: 'Partial paid',
    refunded: 'Refunded',
    cancelled: 'Cancelled',
  };
  return labels[normalized] ?? (normalized ? normalized.replace(/_/g, ' ') : 'Billing');
}

// ─── Prescription Safety Warning Bar ─────────────────────────────────────────

export interface PrescriptionWarning {
  field: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface PrescriptionValidationResult {
  warnings: PrescriptionWarning[];
  canSave: boolean;
}

export function validatePrescriptionBeforeSave(input: {
  diagnosis?: string;
  items?: Array<{ medicine: string; dose: string; frequency: string; duration: string }>;
  followUpDate?: string;
  patientAllergies?: string[];
}): PrescriptionValidationResult {
  const warnings: PrescriptionWarning[] = [];

  // Diagnosis check
  if (!input.diagnosis?.trim()) {
    warnings.push({ field: 'diagnosis', severity: 'warning', message: 'Diagnosis is empty' });
  }

  // Items check
  if (!input.items || input.items.length === 0) {
    warnings.push({ field: 'items', severity: 'warning', message: 'No medicines prescribed' });
  } else {
    for (const item of input.items) {
      if (!item.dose?.trim()) {
        warnings.push({ field: 'dose', severity: 'warning', message: `Dose missing for ${item.medicine}` });
      }
      if (!item.duration?.trim()) {
        warnings.push({ field: 'duration', severity: 'warning', message: `Duration missing for ${item.medicine}` });
      }
    }
  }

  // Follow-up check
  if (!input.followUpDate?.trim()) {
    warnings.push({ field: 'followUpDate', severity: 'info', message: 'No follow-up date set' });
  }

  // Allergy check
  const allergies = (input.patientAllergies ?? []).map(a => a.toLowerCase());
  for (const item of input.items ?? []) {
    const medLower = item.medicine.toLowerCase();
    for (const allergy of allergies) {
      if (medLower.includes(allergy) || allergy.includes(medLower)) {
        warnings.push({
          field: 'allergy',
          severity: 'error',
          message: `${item.medicine} may conflict with allergy: ${allergy}`,
        });
      }
    }
  }

  const canSave = !warnings.some(w => w.severity === 'error');
  return { warnings, canSave };
}

// ─── Test Packages ───────────────────────────────────────────────────────────

interface TestItem {
  name: string;
  category: string;
}

const TEST_PACKAGES: Record<string, { name: string; tests: TestItem[] }> = {
  fever: {
    name: 'Fever Panel',
    tests: [
      { name: 'CBC', category: 'hematology' },
      { name: 'CRP', category: 'chemistry' },
      { name: 'Blood Culture', category: 'microbiology' },
      { name: 'Dengue NS1', category: 'serology' },
      { name: 'Widal Test', category: 'serology' },
    ],
  },
  diabetes: {
    name: 'Diabetes Follow-up',
    tests: [
      { name: 'FBS', category: 'chemistry' },
      { name: '2HABF', category: 'chemistry' },
      { name: 'HbA1c', category: 'chemistry' },
      { name: 'Creatinine', category: 'chemistry' },
      { name: 'Urine R/E', category: 'urinalysis' },
    ],
  },
  cardiac: {
    name: 'Cardiac Panel',
    tests: [
      { name: 'ECG', category: 'cardiology' },
      { name: 'Troponin-I', category: 'chemistry' },
      { name: 'Lipid Profile', category: 'chemistry' },
      { name: 'CK-MB', category: 'chemistry' },
    ],
  },
  renal: {
    name: 'Renal Panel',
    tests: [
      { name: 'Creatinine', category: 'chemistry' },
      { name: 'BUN', category: 'chemistry' },
      { name: 'eGFR', category: 'chemistry' },
      { name: 'Electrolytes', category: 'chemistry' },
      { name: 'Urine R/E', category: 'urinalysis' },
    ],
  },
  thyroid: {
    name: 'Thyroid Panel',
    tests: [
      { name: 'TSH', category: 'endocrine' },
      { name: 'Free T3', category: 'endocrine' },
      { name: 'Free T4', category: 'endocrine' },
    ],
  },
  pregnancy: {
    name: 'Pregnancy Panel',
    tests: [
      { name: 'CBC', category: 'hematology' },
      { name: 'Blood Group', category: 'hematology' },
      { name: 'Urine R/E', category: 'urinalysis' },
      { name: 'VDRL', category: 'serology' },
      { name: 'HBsAg', category: 'serology' },
      { name: 'FBS', category: 'chemistry' },
    ],
  },
};

export function getTestPackage(key: string): TestItem[] {
  const normalized = key.toLowerCase().trim();
  return TEST_PACKAGES[normalized]?.tests ?? [];
}

export function listTestPackages(): Array<{ key: string; name: string; testCount: number }> {
  return Object.entries(TEST_PACKAGES).map(([key, pkg]) => ({
    key,
    name: pkg.name,
    testCount: pkg.tests.length,
  }));
}

// ─── One-Minute Prescription Mode ────────────────────────────────────────────

export interface PrescriptionTemplate {
  name: string;
  diagnosis: string;
  items: Array<{
    medicine: string;
    dose: string;
    frequency: string;
    duration: string;
    instruction?: string;
  }>;
  advice?: string[];
  followUpDays?: number;
  tests?: string[];
}

export interface TemplatePrescription {
  diagnosis: string;
  items: Array<{
    medicine: string;
    dose: string;
    frequency: string;
    duration: string;
    instruction: string;
  }>;
  advice: string[];
  followUpDays: number;
  followUpDate: string | null;
  tests: string[];
}

export function applyPrescriptionTemplate(
  template: PrescriptionTemplate,
  today?: string,
): TemplatePrescription {
  const todayDate = today ?? new Date().toISOString().slice(0, 10);
  let followUpDate: string | null = null;
  if (template.followUpDays) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() + template.followUpDays);
    followUpDate = d.toISOString().slice(0, 10);
  }

  return {
    diagnosis: template.diagnosis,
    items: template.items.map(item => ({
      medicine: item.medicine,
      dose: item.dose,
      frequency: item.frequency,
      duration: item.duration,
      instruction: item.instruction ?? '',
    })),
    advice: template.advice ?? [],
    followUpDays: template.followUpDays ?? 0,
    followUpDate,
    tests: template.tests ?? [],
  };
}

export function buildQuickPrescription(input: {
  chiefComplaint: string;
  diagnosis: string;
  medicineName: string;
  frequency?: string;
  duration?: string;
  instruction?: string;
  includeCommonTests?: boolean;
  followUpDays?: number;
  today?: string;
  additionalMedicines?: Array<{
    medicine: string;
    frequency?: string;
    duration?: string;
    instruction?: string;
  }>;
}): {
  chiefComplaint: string;
  diagnosis: string;
  items: Array<{
    medicine: string;
    dose: string;
    frequency: string;
    duration: string;
    instruction: string;
  }>;
  tests: string[];
  followUpDate: string | null;
} {
  const defaultFreq = '1+0+1';
  const defaultDuration = '5 days';
  const defaultInstruction = 'খাবার পরে';

  const items = [
    {
      medicine: input.medicineName,
      dose: '1',
      frequency: input.frequency ?? defaultFreq,
      duration: input.duration ?? defaultDuration,
      instruction: input.instruction ?? defaultInstruction,
    },
    ...(input.additionalMedicines ?? []).map(m => ({
      medicine: m.medicine,
      dose: '1',
      frequency: m.frequency ?? defaultFreq,
      duration: m.duration ?? defaultDuration,
      instruction: m.instruction ?? defaultInstruction,
    })),
  ];

  let tests: string[] = [];
  if (input.includeCommonTests) {
    const diagLower = input.diagnosis.toLowerCase();
    if (diagLower.includes('dengue')) tests = ['CBC', 'Dengue NS1', 'Dengue IgM'];
    else if (diagLower.includes('typhoid')) tests = ['CBC', 'Widal Test', 'Blood Culture'];
    else if (diagLower.includes('malaria')) tests = ['CBC', 'MP Slide', 'Rapid Malaria Test'];
    else if (diagLower.includes('diabetes') || diagLower.includes('dm')) tests = ['FBS', 'HbA1c', 'Creatinine'];
    else tests = ['CBC', 'FBS', 'CRP'];
  }

  let followUpDate: string | null = null;
  if (input.followUpDays) {
    const todayDate = input.today ?? new Date().toISOString().slice(0, 10);
    const d = new Date(todayDate);
    d.setDate(d.getDate() + input.followUpDays);
    followUpDate = d.toISOString().slice(0, 10);
  }

  return {
    chiefComplaint: input.chiefComplaint,
    diagnosis: input.diagnosis,
    items,
    tests,
    followUpDate,
  };
}

// ─── Print Prescription Formatting ───────────────────────────────────────────

interface PrintPrescriptionInput {
  rx_no?: string;
  patient_name?: string;
  patient_code?: string;
  patient_age?: number | null;
  patient_gender?: string | null;
  patient_phone?: string | null;
  doctor_name?: string;
  doctor_degree?: string | null;
  doctor_bmdc?: string | null;
  doctor_specialty?: string | null;
  hospital_name?: string;
  hospital_address?: string | null;
  diagnosis?: string;
  items?: Array<{
    medicine: string;
    dose?: string;
    frequency?: string;
    duration?: string;
    instruction?: string;
  }>;
  advice?: string | null;
  follow_up_date?: string | null;
  tests?: string[];
  created_at?: string;
}

export interface PrintPrescriptionOutput {
  header: {
    doctorName: string;
    doctorDegree: string;
    bmdc: string;
    specialty: string;
    hospitalName: string;
    hospitalAddress: string;
  };
  patient: {
    name: string;
    code: string;
    age: number | null;
    gender: string | null;
    phone: string | null;
  };
  date: string;
  rxNo: string;
  diagnosis: string;
  items: Array<{
    number: number;
    medicine: string;
    doseInstruction: string;
  }>;
  advice: string;
  tests: string[];
  followUpDate: string | null;
}

export function formatPrescriptionForPrint(input: PrintPrescriptionInput): PrintPrescriptionOutput {
  const dateStr = input.created_at
    ? new Date(input.created_at).toLocaleDateString('en-BD', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : new Date().toLocaleDateString('en-BD', {
        year: 'numeric', month: 'long', day: 'numeric',
      });

  return {
    header: {
      doctorName: input.doctor_name ?? '',
      doctorDegree: input.doctor_degree ?? '',
      bmdc: input.doctor_bmdc ?? '',
      specialty: input.doctor_specialty ?? '',
      hospitalName: input.hospital_name ?? '',
      hospitalAddress: input.hospital_address ?? '',
    },
    patient: {
      name: input.patient_name ?? '',
      code: input.patient_code ?? '',
      age: input.patient_age ?? null,
      gender: input.patient_gender ?? null,
      phone: input.patient_phone ?? null,
    },
    date: dateStr,
    rxNo: input.rx_no ?? '',
    diagnosis: input.diagnosis ?? '',
    items: (input.items ?? []).map((item, i) => ({
      number: i + 1,
      medicine: item.medicine,
      doseInstruction: [item.dose, item.frequency, item.duration, item.instruction]
        .filter(Boolean)
        .join(' · '),
    })),
    advice: input.advice ?? '',
    tests: input.tests ?? [],
    followUpDate: input.follow_up_date ?? null,
  };
}

export function generatePrescriptionQRData(input: {
  rxNo: string;
  patientCode: string;
  baseUrl: string;
}): string {
  const { rxNo, patientCode, baseUrl } = input;
  // Simple hash for verification (not cryptographic)
  const verify = Buffer.from(`${rxNo}:${patientCode}`).toString('base64url').slice(0, 12);
  return `${baseUrl}/rx/verify?rx=${encodeURIComponent(rxNo)}&p=${encodeURIComponent(patientCode)}&verify=${verify}`;
}

const BENGALI_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

function toBengaliNumber(num: string | number): string {
  return String(num).replace(/[0-9]/g, d => BENGALI_DIGITS[parseInt(d)]);
}

const BENGALI_DURATION_MAP: Record<string, string> = {
  '1 day': '১ দিন',
  '3 days': '৩ দিন',
  '5 days': '৫ দিন',
  '7 days': '৭ দিন',
  '10 days': '১০ দিন',
  '14 days': '১৪ দিন',
  '21 days': '২১ দিন',
  '30 days': '৩০ দিন',
  '1 month': '১ মাস',
  '3 months': '৩ মাস',
  'continue': 'চলবে',
};

export function formatPrescriptionItemsForPrint(
  items: Array<{ medicine: string; dose?: string; frequency?: string; duration?: string; instruction?: string }>,
): Array<{ number: number; line: string }> {
  return items.map((item, i) => {
    const freqBn = toBengaliNumber(item.frequency ?? '');
    const durationBn = BENGALI_DURATION_MAP[item.duration?.toLowerCase() ?? ''] ?? toBengaliNumber(item.duration ?? '');
    const doseBn = toBengaliNumber(item.dose ?? '');

    const parts = [
      `${i + 1}. ${item.medicine}`,
      doseBn ? `ডোজ: ${doseBn}` : '',
      freqBn ? `ফ্রিকোয়েন্সি: ${freqBn}` : '',
      durationBn ? `মেয়াদ: ${durationBn}` : '',
      item.instruction,
    ].filter(Boolean);

    return {
      number: i + 1,
      line: parts.join(' · '),
    };
  });
}
