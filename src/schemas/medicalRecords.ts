import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// Medical Record (Main)
// ═══════════════════════════════════════════════════════════════════════════════

export const createMedicalRecordSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  admission_id: z.number().int().positive().optional(),
  doctor_id: z.number().int().positive().optional(),
  file_number: z.string().max(50).optional(),
  discharge_type: z.enum(['normal', 'lama', 'absconded', 'referred', 'expired']).optional(),
  discharge_condition: z.enum(['improved', 'unchanged', 'worsened', 'cured']).optional(),
  is_operation_conducted: z.boolean().optional(),
  operation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)').optional(),
  operation_diagnosis: z.string().max(500).optional(),
  gestational_week: z.number().int().min(0).max(45).optional(),
  gestational_day: z.number().int().min(0).max(6).optional(),
  number_of_babies: z.number().int().min(0).max(10).optional(),
  blood_lost_ml: z.number().int().min(0).optional(),
  gravita: z.string().max(20).optional(),
  referred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)').optional(),
  referred_time: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)').optional(),
  referred_to: z.string().max(200).optional(),
  referred_reason: z.string().max(500).optional(),
  remarks: z.string().max(1000).optional(),
});

export const updateMedicalRecordSchema = createMedicalRecordSchema.partial().extend({
  is_file_cleared: z.boolean().optional(),
});

export const medicalRecordQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  patient_id: z.coerce.number().int().optional(),
  file_number: z.string().optional(),
  discharge_type: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Baby Birth Details
// ═══════════════════════════════════════════════════════════════════════════════

export const createBirthSchema = z.object({
  medical_record_id: z.number().int().positive().optional(),
  patient_id: z.number().int().positive(), // Mother
  visit_id: z.number().int().positive().optional(),
  certificate_number: z.string().max(50).optional(),
  baby_name: z.string().max(100).optional(),
  sex: z.enum(['Male', 'Female', 'Other']).optional(),
  weight_kg: z.number().min(0).max(15).optional(),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  birth_time: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)').optional(),
  birth_type: z.enum(['Single', 'Twin', 'Triplet', 'Quadruplet']).optional(),
  birth_condition: z.enum(['Alive', 'Stillborn']).optional(),
  delivery_type: z.enum(['Normal', 'Cesarean', 'Forceps', 'Vacuum']).optional(),
  birth_order: z.enum(['First', 'Second', 'Third', 'Fourth']).optional(),
  father_name: z.string().max(100).optional(),
  mother_name: z.string().max(100).optional(),
  issued_by: z.string().optional(),
  certified_by: z.string().optional(),
});

export const updateBirthSchema = createBirthSchema.partial().extend({
  print_count: z.number().int().min(0).optional(),
  printed_on: z.string().optional(),
});

export const birthListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  sex: z.string().optional(),
  birth_type: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Death Details
// ═══════════════════════════════════════════════════════════════════════════════

export const createDeathSchema = z.object({
  medical_record_id: z.number().int().positive().optional(),
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  certificate_number: z.string().max(50).optional(),
  death_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  death_time: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)').optional(),
  cause_of_death: z.string().max(500).optional(),
  secondary_cause: z.string().max(500).optional(),
  manner_of_death: z.enum(['Natural', 'Accident', 'Suicide', 'Homicide', 'Undetermined']).optional(),
  place_of_death: z.enum(['Ward', 'ICU', 'Emergency', 'OT', 'Other']).optional(),
  age_at_death: z.string().max(20).optional(),
  father_name: z.string().max(100).optional(),
  mother_name: z.string().max(100).optional(),
  spouse_name: z.string().max(100).optional(),
  certified_by: z.string().optional(),
});

export const updateDeathSchema = createDeathSchema.partial().extend({
  print_count: z.number().int().min(0).optional(),
  printed_on: z.string().optional(),
});

export const deathListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  manner_of_death: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Final Diagnosis
// ═══════════════════════════════════════════════════════════════════════════════

export const createDiagnosisSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  medical_record_id: z.number().int().positive().optional(),
  icd10_id: z.number().int().positive(),
  is_primary: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

export const createDiagnosisBulkSchema = z.array(createDiagnosisSchema).min(1).max(20);

// ═══════════════════════════════════════════════════════════════════════════════
// ICD-10 Search
// ═══════════════════════════════════════════════════════════════════════════════

export const icd10QuerySchema = z.object({
  search: z.string().optional(),
  disease_group_id: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

// Alias for backward compatibility with tests
export const icd10SearchSchema = icd10QuerySchema;

// ═══════════════════════════════════════════════════════════════════════════════
// Document Records
// ═══════════════════════════════════════════════════════════════════════════════

export const createDocumentRecordSchema = z.object({
  patient_id: z.number().int().positive(),
  medical_record_id: z.number().int().positive().optional(),
  document_type: z.enum(['lab_report', 'discharge_summary', 'referral_letter', 'imaging', 'consent', 'other']),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  file_key: z.string().optional(),
  file_name: z.string().max(255).optional(),
  file_size: z.number().int().min(0).optional(),
  mime_type: z.string().max(100).optional(),
});
