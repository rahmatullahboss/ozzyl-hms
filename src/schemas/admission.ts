import { z } from 'zod';

// ─── Create Admission ─────────────────────────────────────────────────────────

export const createAdmissionSchema = z.object({
  patient_id: z.number().int().positive('Patient ID required'),
  bed_id: z.number().int().positive().optional(),
  doctor_id: z.number().int().positive().optional(),
  admission_type: z.enum(['general', 'emergency', 'planned', 'transfer']).default('planned'),
  admit_source: z.enum(['opd_referral', 'emergency', 'planned', 'doctor_referral', 'self', 'transfer', 'walk_in', 'other']).optional(),
  referral_doctor: z.string().max(200).optional(),
  admission_reason: z.string().max(1000).optional(),
  is_emergency: z.boolean().default(false),
  provisional_diagnosis: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  care_of_name: z.string().max(200).optional(),
  care_of_phone: z.string().max(20).optional(),
  care_of_relation: z.string().max(50).optional(),
  admission_date: z.string().max(30).optional(),
  department: z.string().max(100).optional(),
  admission_fee: z.number().int().min(0).default(0),
  package_id: z.number().int().positive().optional(),
  billing_mode: z.enum(['regular', 'package', 'package_plus_bed', 'package_included_days', 'corporate', 'emergency']).default('regular'),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

// ─── Update Admission ─────────────────────────────────────────────────────────

export const updateAdmissionSchema = z.object({
  status: z.enum(['admitted', 'discharged', 'critical', 'transferred', 'lama']),
  discharge_condition_id: z.number().int().positive().optional(),
  discharge_type: z.string().max(80).optional(),
});

// ─── Create Bed ───────────────────────────────────────────────────────────────

export const createBedSchema = z.object({
  ward_name: z.string().min(1, 'Ward name required').max(100),
  bed_number: z.string().min(1, 'Bed number required').max(50),
  bed_type: z.enum(['general', 'icu', 'nicu', 'hdu', 'cabin', 'vip']).default('general'),
  rate_per_day: z.number().min(0).default(0),
  floor: z.string().max(20).optional(),
  notes: z.string().max(500).optional(),
});

// ─── Update Bed ───────────────────────────────────────────────────────────────

export const updateBedSchema = z.object({
  ward_name: z.string().min(1).max(100).optional(),
  bed_number: z.string().min(1).max(50).optional(),
  bed_type: z.enum(['general', 'icu', 'nicu', 'hdu', 'cabin', 'vip']).optional(),
  floor: z.string().max(20).optional(),
  status: z.enum(['available', 'occupied', 'maintenance', 'reserved', 'cleaning']).optional(),
  rate_per_day: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

// ─── Transfer Bed ─────────────────────────────────────────────────────────────

export const transferBedSchema = z.object({
  new_bed_id: z.number().int().positive('New bed ID required'),
  reason: z.string().max(500).optional(),
  pending_receive: z.boolean().optional(),
});

// ─── Cancel Admission ─────────────────────────────────────────────────────────

export const cancelAdmissionSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required').max(1000),
});

// ─── Cancel Discharge ─────────────────────────────────────────────────────────

export const cancelDischargeSchema = z.object({
  reason: z.string().min(1, 'Reason for cancelling discharge is required').max(1000),
});

// ─── Provisional Discharge ───────────────────────────────────────────────────

export const provisionalDischargeSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const undoProvisionalDischargeSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(1000),
});

// ─── Bed Features / Reservations ─────────────────────────────────────────────

export const bedFeatureSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  rate_per_day: z.number().min(0).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

export const bedFeatureMapSchema = z.object({
  feature_ids: z.array(z.number().int().positive()).default([]),
});

export const bedReservationSchema = z.object({
  patient_id: z.number().int().positive(),
  bed_id: z.number().int().positive(),
  reserved_from: z.string().min(1),
  reserved_to: z.string().optional(),
  remarks: z.string().max(1000).optional(),
});

export const updateReservationSchema = z.object({
  status: z.enum(['reserved', 'admitted', 'cancelled', 'expired']),
  remarks: z.string().max(1000).optional(),
});

export const reasonSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export const remarkSchema = z.object({
  remark: z.string().min(1).max(2000),
});

export const doctorUpdateSchema = z.object({
  doctor_id: z.number().int().positive(),
});

export const procedureUpdateSchema = z.object({
  procedure_type: z.enum(['surgical', 'medical', 'obs_gyn', 'other']),
});

export const policeCaseSchema = z.object({
  is_police_case: z.boolean(),
});

export const hemodialysisReportSchema = z.object({
  admission_id: z.number().int().positive().optional(),
  patient_id: z.number().int().positive(),
  report_date: z.string().optional(),
  pre_weight: z.number().min(0).optional(),
  post_weight: z.number().min(0).optional(),
  pre_bp: z.string().max(40).optional(),
  post_bp: z.string().max(40).optional(),
  dialysis_duration_min: z.number().int().min(0).optional(),
  access_type: z.string().max(120).optional(),
  dialyzer: z.string().max(120).optional(),
  blood_flow_rate: z.string().max(80).optional(),
  dialysate_flow_rate: z.string().max(80).optional(),
  ultrafiltration: z.number().min(0).optional(),
  heparin_dose: z.string().max(80).optional(),
  complications: z.string().max(1000).optional(),
  notes: z.string().max(1000).optional(),
});

export const autoBillingItemSchema = z.object({
  bed_feature_id: z.number().int().positive(),
  billing_item_id: z.number().int().positive().optional(),
  item_name: z.string().max(200).optional(),
  price: z.number().min(0),
  is_active: z.number().int().min(0).max(1).optional(),
});

export const depositSettingSchema = z.object({
  admission_type: z.string().min(1).max(80),
  bed_feature_id: z.number().int().positive().optional(),
  min_deposit_amount: z.number().min(0),
  is_mandatory: z.boolean().default(false),
  is_active: z.number().int().min(0).max(1).optional(),
});

export const schemePriceMapSchema = z.object({
  bed_feature_id: z.number().int().positive(),
  scheme_id: z.number().int().positive().optional(),
  price_category_id: z.number().int().positive().optional(),
  price: z.number().min(0),
  is_active: z.number().int().min(0).max(1).optional(),
});

export const birthDetailSchema = z.object({
  patient_id: z.number().int().positive(),
  baby_name: z.string().max(160).optional(),
  birth_date: z.string().min(1),
  birth_time: z.string().optional(),
  birth_condition_id: z.number().int().positive().optional(),
  sex: z.enum(['Male', 'Female', 'Other']).optional(),
  weight_kg: z.number().min(0).optional(),
  apgar_score: z.string().max(40).optional(),
  birth_type: z.string().max(80).optional(),
  delivery_type: z.string().max(80).optional(),
  father_name: z.string().max(160).optional(),
  mother_name: z.string().max(160).optional(),
  remarks: z.string().max(1000).optional(),
});

// ─── Type Exports ─────────────────────────────────────────────────────────────

export type CreateAdmissionInput = z.infer<typeof createAdmissionSchema>;
export type UpdateAdmissionInput = z.infer<typeof updateAdmissionSchema>;
export type CreateBedInput = z.infer<typeof createBedSchema>;
export type UpdateBedInput = z.infer<typeof updateBedSchema>;
