import { z } from 'zod';

// ─── Common Query Schema ─────────────────────────────────────────────────────
export const NursingQuerySchema = z.object({
  patient_id: z.coerce.number().optional(),
  visit_id: z.coerce.number().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── 1. Care Plan ─────────────────────────────────────────────────────────────
export const createCarePlanSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  problem: z.string().optional(),
  goal: z.string().optional(),
  intervention: z.string().optional(),
  evaluation: z.string().optional(),
});
export const updateCarePlanSchema = createCarePlanSchema.partial();

// ─── 2. Nursing Notes ────────────────────────────────────────────────────────
export const createNursingNoteSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  note_type: z.string().min(1),
  note: z.string().min(1),
});
export const updateNursingNoteSchema = createNursingNoteSchema.partial();

// ─── 3. MAR ──────────────────────────────────────────────────────────────────
export const createMARSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  medication_name: z.string().min(1),
  dose: z.string().optional(),
  route: z.string().optional(),
  frequency: z.string().optional(),
  administered_on: z.string().optional(),
  administered_by: z.number().int().optional(),
  remarks: z.string().optional(),
  status: z.string().default('given'),
  // New clinical MAR fields
  order_id: z.number().int().optional(),
  formulary_item_id: z.number().int().optional(),
  generic_name: z.string().optional(),
  strength: z.string().optional(),
  scheduled_time: z.string().optional(),
});
export const updateMARSchema = createMARSchema.partial();

// ─── 4. Intake/Output ────────────────────────────────────────────────────────
export const createIntakeOutputSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  intake_type: z.string().optional(),
  intake_amount: z.number().optional(),
  intake_unit: z.string().default('ml'),
  output_type: z.string().optional(),
  output_amount: z.number().optional(),
  output_unit: z.string().default('ml'),
  remarks: z.string().optional(),
  recorded_on: z.string().optional(),
});
export const updateIntakeOutputSchema = createIntakeOutputSchema.partial();

// ─── 5. Patient Monitoring ───────────────────────────────────────────────────
export const createMonitoringSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  temperature: z.number().optional(),
  temperature_unit: z.string().default('F'),
  pulse: z.number().int().optional(),
  respiration: z.number().int().optional(),
  bp_systolic: z.number().int().optional(),
  bp_diastolic: z.number().int().optional(),
  spo2: z.number().optional(),
  pain_scale: z.number().int().optional(),
  remarks: z.string().optional(),
  recorded_on: z.string().optional(),
});
export const updateMonitoringSchema = createMonitoringSchema.partial();

// ─── 6. IV Drug ──────────────────────────────────────────────────────────────
export const createIVDrugSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  drug_name: z.string().min(1),
  dosing: z.string().optional(),
  rate: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  status: z.string().default('running'),
  note: z.string().optional(),
});
export const updateIVDrugSchema = createIVDrugSchema.partial();

// ─── 7. Wound Care ───────────────────────────────────────────────────────────
export const createWoundCareSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  wound_site: z.string().optional(),
  wound_type: z.string().optional(),
  size: z.string().optional(),
  depth: z.string().optional(),
  exudate: z.string().optional(),
  description: z.string().optional(),
  treatment: z.string().optional(),
  next_dressing_due: z.string().optional(),
});
export const updateWoundCareSchema = createWoundCareSchema.partial();

// ─── 8. Handover ─────────────────────────────────────────────────────────────
export const createHandoverSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  shift: z.string().min(1),
  given_by: z.number().int(),
  taken_by: z.number().int(),
  content: z.string().min(1),
  // SBAR structured fields (optional alongside free-text content)
  situation: z.string().optional(),
  background: z.string().optional(),
  assessment: z.string().optional(),
  recommendation: z.string().optional(),
});
export const updateHandoverSchema = createHandoverSchema.partial();

// ─── 9. Clinical Info (Triage) ───────────────────────────────────────────────
export const createClinicalInfoSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  key_name: z.string().min(1),
  value: z.string(),
});
export const updateClinicalInfoSchema = z.object({
  value: z.string().optional(),
  is_active: z.number().int().optional(),
});

// ─── 10. Employee Preferences ────────────────────────────────────────────────
export const createPreferenceSchema = z.object({
  employee_id: z.number().int(),
  preference_value: z.string().min(1),
});

// ─── OPD Check-in/Check-out ──────────────────────────────────────────────────
export const checkInSchema = z.object({
  visit_id: z.number().int(),
  chief_complaint: z.string().max(2000).optional(),
});
export const checkOutSchema = z.object({
  visit_id: z.number().int(),
  visit_status: z.string().default('concluded'),
});
export const exchangeDoctorSchema = z.object({
  visit_id: z.number().int(),
  performer_id: z.number().int(),
  performer_name: z.string().min(1),
  department_id: z.number().int().optional(),
});
export const opdReferSchema = z.object({
  visit_id: z.number().int().positive(),
  to_doctor_id: z.number().int().positive().optional(),
  to_department_id: z.number().int().positive().optional(),
  reason: z.string().max(1000).optional(),
}).refine((data) => !!data.to_doctor_id || !!data.to_department_id, {
  message: 'Doctor or department is required',
});
export const finalDiagnosisSchema = z.object({
  visit_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  final_diagnosis: z.string().min(1).max(2000),
  icd10_code: z.string().max(20).optional(),
});
export const freeReferralSchema = z.object({
  patient_id: z.number().int(),
  referred_by_id: z.number().int(),
  department_id: z.number().int().optional(),
});

// ─── OPD Query Schemas ───────────────────────────────────────────────────────
export const opdVisitsQuerySchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const clinicalInfoQuerySchema = z.object({
  visit_id: z.coerce.number().int(),
});
export const favoritesQuerySchema = z.object({
  employee_id: z.coerce.number().int(),
});

// ─── 11. Clinical Medication Orders (CPOE) ──────────────────────────────────
export const createMedicationOrderSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive(),
  formulary_item_id: z.number().int().positive().optional(),
  medication_name: z.string().trim().min(1).max(255),
  generic_name: z.string().trim().max(255).optional(),
  strength: z.string().trim().max(100).optional(),
  dosage_form: z.string().trim().max(100).optional(),
  dose: z.string().trim().min(1).max(100),
  route: z.string().trim().min(1).max(100).default('Oral'),
  frequency: z.string().trim().min(1).max(100),
  duration: z.string().trim().max(100).optional(),
  instructions: z.string().trim().max(1000).optional(),
  priority: z.enum(['stat', 'urgent', 'routine', 'prn']).default('routine'),
  start_datetime: z.string().datetime().optional(),
  end_datetime: z.string().datetime().optional(),
  idempotency_key: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9:._-]+$/).optional(),
}).superRefine((value, ctx) => {
  if (value.start_datetime && value.end_datetime && value.end_datetime <= value.start_datetime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_datetime'],
      message: 'End datetime must be after start datetime',
    });
  }
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['active', 'completed', 'discontinued', 'on_hold', 'cancelled']),
  status_reason: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  if (['discontinued', 'on_hold', 'cancelled'].includes(value.status) && !value.status_reason?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status_reason'],
      message: 'A clinical reason is required for this medication order status',
    });
  }
});

export const medicationOrderQuerySchema = z.object({
  patient_id: z.coerce.number().int().optional(),
  visit_id: z.coerce.number().int().optional(),
  status: z.enum(['active', 'acknowledged', 'in_progress', 'delayed', 'completed', 'discontinued', 'on_hold', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── 12. MAR Administration ─────────────────────────────────────────────────
export const administerMedicationSchema = z.object({
  status: z.enum(['given', 'withheld', 'refused', 'not_given', 'late', 'hold', 'not_available', 'cancelled']),
  dose: z.string().optional(),
  route: z.string().optional(),
  actual_time: z.string().optional(),
  reason_not_given: z.string().optional(),
  remarks: z.string().optional(),
  barcode_scanned: z.number().int().default(0),
}).refine(
  (data) => {
    if (data.status === 'given' || data.status === 'late') {
      return !!data.dose && !!data.route;
    }
    return true;
  },
  {
    message: 'dose and route are required when status is "given" or "late"',
    path: ['dose'],
  }
);

export const marScheduleQuerySchema = z.object({
  patient_id: z.coerce.number().int().positive(),
  visit_id: z.coerce.number().int().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD').optional(),
});

// ─── 13. Medication Reconciliation ──────────────────────────────────────────
export const createReconciliationSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  reconciliation_type: z.enum(['admission', 'transfer', 'discharge']),
  notes: z.string().optional(),
});

export const reconciliationItemSchema = z.object({
  medication_name: z.string().min(1),
  generic_name: z.string().optional(),
  dose: z.string().optional(),
  route: z.string().optional(),
  frequency: z.string().optional(),
  source: z.enum(['home', 'inpatient', 'new']).default('home'),
  action: z.enum(['continue', 'modify', 'discontinue', 'add']),
  action_reason: z.string().optional(),
  new_dose: z.string().optional(),
  new_route: z.string().optional(),
  new_frequency: z.string().optional(),
});

export const reconciliationQuerySchema = z.object({
  patient_id: z.coerce.number().int().optional(),
  visit_id: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── 14. Diet Sheet ────────────────────────────────────────────────────────
export const createDietTypeSchema = z.object({
  diet_code: z.string().min(1).max(20),
  diet_name: z.string().min(1).max(100),
  display_order: z.number().int().default(0),
});

export const updateDietTypeSchema = createDietTypeSchema.partial();

export const createPatientDietSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  diet_type_id: z.number().int(),
  extra_diet: z.string().max(500).optional(),
  ward_id: z.number().int().optional(),
  remarks: z.string().max(1000).optional(),
});

export const dietSheetQuerySchema = z.object({
  ward_id: z.coerce.number().int().positive().optional(),
  patient_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── 15. Blood Sugar Monitoring ─────────────────────────────────────────────
export const createBloodSugarSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  rbs_value: z.number().min(0).max(1000),
  insulin: z.number().min(0).optional(),
  remarks: z.string().max(1000).optional(),
  entry_datetime: z.string().optional(),
});

export const updateBloodSugarSchema = createBloodSugarSchema.partial();

export const bloodSugarQuerySchema = z.object({
  patient_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── 16. Consultation Requests ──────────────────────────────────────────────
export const createConsultationRequestSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  ward_id: z.number().int().optional(),
  bed_id: z.number().int().optional(),
  requesting_doctor_id: z.number().int(),
  requesting_department_id: z.number().int().optional(),
  purpose: z.string().min(1).max(2000),
  consulting_doctor_id: z.number().int(),
  consulting_department_id: z.number().int().optional(),
});

export const respondConsultationSchema = z.object({
  consultant_response: z.string().min(1).max(2000),
  status: z.enum(['accepted', 'responded']).default('responded'),
});

export const consultationQuerySchema = z.object({
  patient_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  consulting_doctor_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'accepted', 'responded', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── 17. Patient Transfer ───────────────────────────────────────────────────
export const createTransferSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  from_ward_id: z.number().int(),
  from_bed_id: z.number().int().optional(),
  to_ward_id: z.number().int(),
  to_bed_id: z.number().int().optional(),
  transfer_reason: z.string().max(1000).optional(),
});

export const receiveTransferSchema = z.object({
  received_by: z.string().min(1),
});

export const transferQuerySchema = z.object({
  visit_id: z.coerce.number().int().positive().optional(),
  to_ward_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'received', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── 18. Nursing Orders ─────────────────────────────────────────────────────
export const createNursingOrderSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  order_type: z.enum(['lab', 'radiology', 'procedure', 'other']),
  item_name: z.string().min(1).max(200),
  item_id: z.number().int().optional(),
  service_department_id: z.number().int().optional(),
  quantity: z.number().int().min(1).default(1),
  priority: z.enum(['stat', 'urgent', 'routine']).default('routine'),
  instructions: z.string().max(2000).optional(),
  ordered_by: z.number().int(),
});

export const updateNursingOrderStatusSchema = z.object({
  status: z.enum(['pending', 'accepted', 'completed', 'cancelled']),
});

export const nursingOrderQuerySchema = z.object({
  patient_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'accepted', 'completed', 'cancelled']).optional(),
  order_type: z.enum(['lab', 'radiology', 'procedure', 'other']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── 19. Drug Requisition ───────────────────────────────────────────────────
export const drugRequisitionItemSchema = z.object({
  drug_name: z.string().min(1).max(200),
  generic_name: z.string().max(200).optional(),
  quantity: z.number().int().min(1).default(1),
  unit: z.string().max(50).default('tablets'),
  remarks: z.string().max(500).optional(),
});

export const createDrugRequisitionSchema = z.object({
  patient_id: z.number().int().optional(),
  visit_id: z.number().int().optional(),
  ward_id: z.number().int().optional(),
  remarks: z.string().max(1000).optional(),
  items: z.array(drugRequisitionItemSchema).min(1),
});

export const drugRequisitionQuerySchema = z.object({
  ward_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'dispensed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── 20. Respiratory (Oxygen & Nebulization) ──────────────────────────────
export const createRespiratorySchema = z.object({
  patient_id: z.number().int(),
  admission_id: z.number().int().optional(),
  entry_type: z.enum(['oxygen', 'nebulization']),
  // Oxygen fields
  delivery_mode: z.enum(['Nasal Cannula', 'Face Mask', 'Non-rebreather', 'HFNC']).optional(),
  flow_rate: z.number().min(0).max(70).optional(),
  start_time: z.string().optional(),
  spo2_before: z.number().min(0).max(100).optional(),
  spo2_after: z.number().min(0).max(100).optional(),
  status: z.enum(['active', 'stopped']).default('active'),
  // Nebulization fields
  medicine_name: z.string().max(200).optional(),
  dose: z.string().max(100).optional(),
  time_given: z.string().optional(),
  given_by: z.string().max(200).optional(),
  response: z.enum(['improved', 'no_change', 'worse']).optional(),
  notes: z.string().max(1000).optional(),
});

export const respiratoryQuerySchema = z.object({
  patient_id: z.coerce.number().int().positive(),
  admission_id: z.coerce.number().int().positive().optional(),
  entry_type: z.enum(['oxygen', 'nebulization']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── 21. Ward Billing ──────────────────────────────────────────────────────
export const createWardBillingRequestSchema = z.object({
  patient_id: z.number().int(),
  visit_id: z.number().int(),
  item_name: z.string().min(1).max(200),
  item_id: z.number().int().optional(),
  service_department_id: z.number().int().optional(),
  quantity: z.number().int().min(1).default(1),
  price: z.number().min(0).optional(),
  total_amount: z.number().min(0).optional(),
});

export const wardBillingQuerySchema = z.object({
  patient_id: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'approved', 'billed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
