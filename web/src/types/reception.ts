export interface Patient {
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

export interface Doctor { id: number; name: string; specialty?: string; consultation_fee?: number; }

export interface ServiceItem { id: number; item_name: string; item_code?: string; price: number; department_name?: string; service_department_id?: number; category_name?: string; usage_count?: number; is_lab_catalog?: number; is_radiology?: number; }

export interface ServiceDept { id: number; department_name: string; }

export interface QuickBillLine extends ServiceItem { quantity: number; discountAmount: number; }

export interface Visit {
  id: number; patient_id: number; patient_name: string; patient_code?: string; mobile?: string; age?: number | string | null; date_of_birth?: string | null;
  appointment_id?: number | null;
  doctor_id?: number | null; doctor_name?: string; visit_date?: string; visit_type?: string; pending_services?: number; pending_amount?: number;
  referred_by_type?: string | null; referred_by_name?: string | null; referring_doctor_id?: number | null; referred_by_doctor_name?: string | null;
  pending_doctor_visit_services?: number | null; pending_doctor_visit_amount?: number | null;
  status?: string | null; created_at?: string | null;
  bill_id?: number | null; invoice_no?: string | null; bill_total?: number | null; bill_paid?: number | null; bill_due?: number | null; bill_status?: string | null;
}

export interface VisitService {
  id: number; service_type: string; description: string; service_name?: string; amount: number;
  quantity: number; total_amount: number; status: string; doctor_name?: string; created_at?: string | null; item_code?: string | null;
}

export interface BillRecord {
  id: number; invoice_no?: string; patient_name: string; total: number; paid?: number; paid_amount?: number; total_amount?: number; due?: number; status: string; created_at: string;
  settled_amount?: number | null; outstanding?: number | null; pending_amount?: number | null; deposit_adjusted?: number | null; deposit_deducted?: number | null;
  service_summary?: string | null; item_count?: number | null; doctor_name?: string | null; visit_no?: string | null; created_by_name?: string | null;
  test_bill?: number | null; doctor_visit_bill?: number | null; admission_bill?: number | null; operation_bill?: number | null; medicine_bill?: number | null;
}

export interface AppointmentSummary {
  id: number; status?: string | null; billing_status?: string | null; fee?: number | null; consultation_fee?: number | null; total_amount?: number | null;
  patient_id?: number; patient_name?: string; patient_code?: string | null; patient_mobile?: string | null; patient_age?: number | string | null; patient_date_of_birth?: string | null; doctor_id?: number | null; doctor_name?: string | null; appt_time?: string | null; token_no?: number | null;
  appointment_type?: AppointmentType | null; visit_type?: string | null; discount_amount?: number | null; original_fee?: number | null; final_fee?: number | null;
  created_at?: string | null;
  bill_id?: number | null;
  invoice_no?: string | null;
  bill_total?: number | null;
  bill_paid?: number | null;
  bill_due?: number | null;
  bill_status?: string | null;
}

export interface QueueStats {
  total?: number; waiting?: number; called?: number; serving?: number; completed?: number;
}

export interface QueueTokenRow {
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

export interface DailyReport {
  date: string; summary: {
    totalBilled: number;
    totalPaid: number;
    dueCollection?: number;
    totalDue: number;
    billCount: number;
    paidBillCount?: number;
    billPaymentTotal?: number;
    depositCollected?: number;
    depositRefunded?: number;
    depositReceived?: number;
    totalCashReceived?: number;
  };
  byCategory: Array<{ item_category: string; total_amount: number; item_count: number }>;
  byPaymentMethod: Array<{ payment_method: string; total_amount: number; transaction_count: number }>;
  byDoctor: Array<{ doctor_name: string; total_amount: number; service_count: number }>;
  collectionBreakdown?: Array<{ collectionType: string; totalAmount: number; transactionCount: number }>;
}

export interface AvailableBedsResponse {
  beds: Array<{ id: number; ward_name?: string | null; bed_number?: string | null; bed_type?: string | null; effective_rate?: number | null }>;
}

export interface DoctorTodayStatus {
  id: number; name: string; specialty?: string | null; is_available: number; max_serial?: number | null; serial_count?: number | null;
}

export interface ReportDeliveryLookup {
  invoice: { id: number; invoiceNo?: string | null; status?: string | null; totalAmount: number; paidAmount: number; dueAmount: number; depositAdjusted?: number | null; createdAt?: string | null };
  patient: { id: number; name: string; patientCode?: string | null; mobile?: string | null };
  reports: Array<{ id: number; test_name?: string | null; status?: string | null; order_no?: string | null }>;
  canPrint: boolean;
  needsPayment: boolean;
  allReady: boolean;
}

export interface PendingBillSummary {
  bill_id: number;
  invoice_no?: string | null;
  patient_name: string;
  patient_code?: string | null;
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
}

export interface PendingAppointmentCharge {
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

export interface GlobalPatientSearchResult {
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

export type AppointmentType = 'new_patient' | 'old_patient' | 'follow_up' | 'report_show' | 'free_visit' | 'discounted_visit' | 'emergency';

export interface NewPatientFormState {
  name: string;
  mobile: string;
  age: string;
  gender: string;
  fatherHusband: string;
  address: string;
  guardianMobile: string;
  dateOfBirth: string;
  bloodGroup: string;
}

export interface AppointmentFeePreviewResponse {
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

export const APPOINTMENT_TYPE_OPTIONS: Array<{ value: AppointmentType; label: string }> = [
  { value: 'new_patient', label: 'select.newPatient' },
  { value: 'old_patient', label: 'select.followUp' },
  { value: 'report_show', label: 'select.reportShow' },
  { value: 'free_visit', label: 'select.freeVisit' },
  { value: 'emergency', label: 'select.emergency' },
];

export const EMPTY_NEW_PATIENT_FORM: NewPatientFormState = {
  name: '',
  mobile: '',
  age: '',
  gender: 'male',
  fatherHusband: '',
  address: '',
  guardianMobile: '',
  dateOfBirth: '',
  bloodGroup: '',
};
