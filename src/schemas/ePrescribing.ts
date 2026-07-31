import { z } from 'zod';

// ─── Formulary Categories ─────────────────────────────────────────────────────

export const createFormularyCategorySchema = z.object({
  name: z.string().min(1, 'Category name required').max(100),
  description: z.string().max(500).optional(),
  parent_id: z.number().int().positive().optional(),
  sort_order: z.number().int().nonnegative().default(0),
});

export const updateFormularyCategorySchema = createFormularyCategorySchema.partial();

// ─── Formulary Items (Drug Catalog) ───────────────────────────────────────────

export const createFormularyItemSchema = z.object({
  name: z.string().min(1, 'Drug name required').max(200),
  generic_name: z.string().min(1, 'Generic name required').max(200),
  category_id: z.number().int().positive().optional(),
  strength: z.string().max(50).optional(),
  dosage_form: z.enum([
    'Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection',
    'Ointment', 'Cream', 'Gel', 'Drops', 'Inhaler',
    'Suppository', 'Patch', 'Powder', 'Solution', 'Spray', 'Other',
  ]).optional(),
  route: z.enum([
    'Oral', 'IV', 'IM', 'SC', 'Topical', 'Rectal',
    'Inhalation', 'Ophthalmic', 'Otic', 'Nasal', 'Sublingual', 'Other',
  ]).optional(),
  manufacturer: z.string().max(200).optional(),
  common_dosages: z.array(z.string()).optional(),
  default_frequency: z.string().max(50).optional(),
  default_duration: z.string().max(50).optional(),
  max_daily_dose_mg: z.number().positive().optional(),
  default_instructions: z.string().max(500).optional(),
  is_antibiotic: z.boolean().default(false),
  is_controlled: z.boolean().default(false),
  requires_prior_auth: z.boolean().default(false),
  unit_price: z.number().nonnegative().default(0),
  medicine_id: z.number().int().positive().optional(),
});

export const updateFormularyItemSchema = createFormularyItemSchema.partial();

// ─── Drug Interaction Pairs ───────────────────────────────────────────────────

export const createDrugInteractionSchema = z.object({
  drug_a_name: z.string().min(1, 'Drug A name required').max(200),
  drug_b_name: z.string().min(1, 'Drug B name required').max(200),
  severity: z.enum(['minor', 'moderate', 'major', 'contraindicated']),
  description: z.string().min(1, 'Description required').max(1000),
  recommendation: z.string().max(1000).optional(),
  evidence_level: z.enum(['established', 'theoretical', 'case_report']).optional(),
});

// ─── Patient Active Medications ───────────────────────────────────────────────

export const addPatientMedicationSchema = z.object({
  patient_id: z.number().int().positive(),
  formulary_item_id: z.number().int().positive().optional(),
  medication_name: z.string().min(1, 'Medication name required').max(200),
  generic_name: z.string().max(200).optional(),
  strength: z.string().max(50).optional(),
  dosage_form: z.string().max(50).optional(),
  dosage: z.string().max(100).optional(),
  frequency: z.string().max(50).optional(),
  duration: z.string().max(50).optional(),
  instructions: z.string().max(500).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  source: z.enum(['prescribed', 'patient_reported', 'imported', 'pharmacy']).default('prescribed'),
  prescription_id: z.number().int().positive().optional(),
});

export const updatePatientMedicationSchema = z.object({
  status: z.enum(['active', 'discontinued', 'completed', 'on_hold', 'suspended']).optional(),
  status_reason: z.string().max(500).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  dosage: z.string().max(100).optional(),
  frequency: z.string().max(50).optional(),
  instructions: z.string().max(500).optional(),
});

// ─── Safety Check Request ─────────────────────────────────────────────────────

export const safetyCheckRequestSchema = z.object({
  patient_id: z.number().int().positive(),
  medication_name: z.string().min(1, 'Medication name required').optional(),
  generic_name: z.string().optional(),
  dose_mg: z.number().positive().optional(),
  frequency_per_day: z.number().int().positive().optional(),
  prescription_id: z.number().int().positive().optional(),
  patient_context: z.object({
    age_years: z.number().nonnegative().optional(),
    weight_kg: z.number().positive().optional(),
    sex: z.enum(['M', 'F']).optional(),
    is_pregnant: z.boolean().optional(),
    is_breastfeeding: z.boolean().optional(),
    egfr: z.number().positive().optional(),
    child_pugh_score: z.enum(['A', 'B', 'C']).optional(),
    diagnoses: z.array(z.string().max(200)).optional(),
  }).optional(),
  medications: z.array(z.object({
    medication_name: z.string().min(1, 'Medication name required'),
    generic_name: z.string().optional(),
    dose_mg: z.number().positive().optional(),
    frequency_per_day: z.number().int().positive().optional(),
  })).min(1).optional(),
}).refine((data) => {
  return Boolean(data.medications?.length) || Boolean(data.medication_name?.trim());
}, {
  message: 'Provide medication_name or medications[]',
  path: ['medications'],
});

// ─── Safety Check Override ────────────────────────────────────────────────────

export const safetyCheckOverrideSchema = z.object({
  safety_check_id: z.number().int().positive(),
  action_taken: z.enum(['overridden', 'prescription_modified', 'prescription_cancelled']),
  override_reason: z.string().min(1, 'Override reason required').max(500),
});

// ─── Type Exports ─────────────────────────────────────────────────────────────

export type CreateFormularyCategoryInput = z.infer<typeof createFormularyCategorySchema>;
export type CreateFormularyItemInput = z.infer<typeof createFormularyItemSchema>;
export type CreateDrugInteractionInput = z.infer<typeof createDrugInteractionSchema>;
export type AddPatientMedicationInput = z.infer<typeof addPatientMedicationSchema>;
export type UpdatePatientMedicationInput = z.infer<typeof updatePatientMedicationSchema>;
export type SafetyCheckRequest = z.infer<typeof safetyCheckRequestSchema>;
export type SafetyCheckOverride = z.infer<typeof safetyCheckOverrideSchema>;
