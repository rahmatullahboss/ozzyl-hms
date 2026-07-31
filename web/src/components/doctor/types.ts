export interface Doctor {
  id: number;
  name: string;
  specialty?: string;
  department?: string;
  departmentId?: number;
  consultationFee?: number;
  consultation_fee?: number;
  ipdRoundFee?: number;
  ipd_round_fee?: number;
  mobileNumber?: string;
  mobile_number?: string;
  email?: string;
  bio?: string;
  publicBio?: string;
  public_bio?: string;
  bmdcRegNo?: string;
  bmdc_reg_no?: string;
  qualifications?: string;
  languages?: string[];
  visitingHours?: string;
  visiting_hours?: string;
  photoKey?: string;
  photo_key?: string;
  profilePhotoKey?: string;
  profile_photo_key?: string;
  isActive?: number;
  is_active?: number;
  isAvailable?: number;
  is_available?: number;
  isMarketplaceVisible?: number;
  is_marketplace_visible?: number;
  isPublic?: number;
  is_public?: number;
  displayOrder?: number;
  display_order?: number;
  userId?: number;
  user_id?: number;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

export interface Kpi {
  total: number;
  completed: number;
  waiting: number;
  in_progress: number;
  yesterday: number;
  avg_consult_time_min?: number | null;
}

export interface QueueItem {
  id: number;
  appointment_id?: number;
  patient_id: number;
  token_no: number;
  appt_time: string;
  visit_type: string;
  appointment_type?: string | null;
  appointment_type_label?: string | null;
  status: string;
  appointment_status?: string;
  queue_status?: string;
  queue_priority?: string | null;
  queue_called_at?: string | null;
  visit_id?: number | null;
  visit_status?: string | null;
  queue_entry_id?: number | null;
  billing_status?: string | null;
  billing_status_label?: string | null;
  days_elapsed?: number | null;
  final_fee?: number | null;
  discount_amount?: number | null;
  created_by?: number | null;
  created_by_name?: string | null;
  patient_name: string;
  patient_code: string;
  patient_mobile?: string;
  patient_age?: number | string | null;
  date_of_birth?: string;
  gender?: string;
  chief_complaint?: string;
  notes?: string | null;
  allergy_count?: number;
  allergy_summary?: string | null;
  vitals_count?: number;
  latest_vitals_summary?: string | null;
  active_rx_count?: number;
  current_medicine_summary?: string | null;
  lab_count?: number;
  pending_lab_count?: number;
  pending_imaging_count?: number;
  soap_count?: number;
  validity_badge?: 'valid_follow_up' | 'follow_up_expired' | 'valid_report_show' | 'report_show_expired' | null;
  is_expired_report_show?: boolean;
  last_visit_at?: string | null;
  last_diagnosis?: string | null;
  latest_abnormal_lab_summary?: string | null;
  vitals_bp_systolic?: number | null;
  vitals_bp_diastolic?: number | null;
  vitals_pulse?: number | null;
  vitals_temperature?: number | null;
  vitals_spo2?: number | null;
  medical_snapshot?: {
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
  } | null;

  clinical_priority?: {
    level: string;
    label: string | null;
    color: string | null;
    reason?: string;
    source?: string;
  } | null;
}

export interface VisitType {
  visit_type: string;
  count: number;
}

export interface RecentRx {
  id: number;
  rx_no: string;
  created_at: string;
  status: string;
  patient_name: string;
  patient_code: string;
}

export interface FollowUp {
  rx_id: number;
  follow_up_date: string;
  patient_name: string;
  patient_code: string;
  mobile?: string;
}

export interface PendingOrder {
  id: number;
  type: 'lab' | 'imaging';
  order_no: string;
  ordered_at: string;
  patient_name: string;
  patient_code: string;
  status: string;
  billing_status?: string | null;
  bill_id?: number | null;
  invoice_no?: string | null;
  total?: number;
  due?: number | null;
}

export interface Inpatient {
  id?: number;
  admission_id?: number;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  admission_no: string;
  ward?: string | null;
  bed_number?: string | null;
  admission_date?: string | null;
  diagnosis?: string | null;
  status: string;
  last_round_at?: string | null;
  last_round_status?: string | null;
  last_round_clinical_status?: string | null;
  last_patient_condition?: string | null;
  today_round_id?: number | null;
  today_round_clinical_status?: string | null;
  today_round_provisional_id?: number | null;
  needs_round_note?: boolean;
  not_rounded_today?: boolean;
  pending_lab_count?: number;
  pending_imaging_count?: number;
  allergy_count?: number;
  latest_vitals_summary?: string | null;
}

export interface LabInboxSummary {
  total_reports: number;
  pending: number;
  abnormal: number;
  critical: number;
  needs_review: number;
}

export interface DashData {
  doctor: Doctor;
  today: string;
  kpi: Kpi;
  queue: QueueItem[];
  visitTypes: VisitType[];
  recentRx: RecentRx[];
  followUps: FollowUp[];
  availableDoctors?: Doctor[];
  pendingOrders?: PendingOrder[];
  inpatients?: Inpatient[];
  labInbox?: LabInboxSummary;
}

export interface Shift {
  id: number;
  dayOfWeek: number;
  day_of_week: number;
  shiftName: string;
  shift_name: string;
  startTime: string;
  start_time: string;
  endTime: string;
  end_time: string;
}

export interface Availability {
  id: number;
  date: string;
  isAvailable: number;
  is_available: number;
  reason?: string;
}

export interface DoctorVisit {
  id: number;
  visitDate: string;
  visit_date: string;
  patientId: number;
  patient_id: number;
  patientName?: string;
  patient_name?: string;
  visitType: string;
  visit_type: string;
  diagnosis?: string;
  notes?: string;
}
