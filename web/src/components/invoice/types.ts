export interface InvoiceHospitalInfo {
  name: string;
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  registrationNumber?: string;
  binTin?: string;
  footerText?: string;
  logoUrl?: string | null;
}

export interface InvoicePatientInfo {
  name: string;
  code?: string | null;
  mobile?: string | null;
  address?: string | null;
  age?: string | null;
  gender?: string | null;
}

export interface InvoiceAppointmentInfo {
  number?: string | null;
  date?: string | null;
  time?: string | null;
  doctorName?: string | null;
  appointmentType?: string | null;
  specialty?: string | null;
  department?: string | null;
}

export interface InvoiceAdmissionInfo {
  id?: number | null;
  admission_no?: string | null;
  admission_date?: string | null;
  discharge_date?: string | null;
  status?: string | null;
  admission_type?: string | null;
  ward_name?: string | null;
  bed_number?: string | null;
  bed_type?: string | null;
  consultant_name?: string | null;
  diagnosis?: string | null;
  final_diagnosis?: string | null;
  provisional_diagnosis?: string | null;
}

export interface InvoicePrintItem {
  id: number;
  item_category: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  tax_amount: number | null;
  original_line_amount?: number | null;
  refunded_quantity?: number | null;
  refunded_amount?: number | null;
  net_line_amount?: number | null;
  refund_status?: 'refund_requested' | 'refunded_pending_approval' | 'refunded' | null;
  credit_note_nos?: string | null;
}

export interface InvoicePaymentInfo {
  amount: number;
  receipt_no?: string | null;
  payment_method?: string | null;
  received_by_name?: string | null;
  created_at?: string | null;
}

export interface InvoicePaymentLedgerEntry {
  id: string;
  kind: 'payment' | 'deposit';
  amount: number;
  paymentMethod?: string | null;
  reference?: string | null;
  createdAt: string;
  isDischargeSettlement: boolean;
}

export interface InvoiceReferredBy {
  type: string;
  hospitalName?: string | null;
  doctorName?: string | null;
}
