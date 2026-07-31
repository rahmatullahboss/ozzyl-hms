import { z } from 'zod';

// ─── Prescriptions ───────────────────────────────────────────────────────────

const prescriptionItemSchema = z.object({
  medicine_name: z.string().min(1, 'Medicine name required'),
  dosage: z.string().optional(),
  frequency: z.string().optional(),
  duration: z.string().optional(),
  instructions: z.string().optional(),
  sort_order: z.number().int().min(0).optional(),
  quantity: z.number().int().positive().optional(),
  medicineId: z.number().int().positive().optional(),
});

const newPrescriptionStatusSchema = z.enum(['draft', 'final']);
const prescriptionTransitionStatusSchema = z.enum(['draft', 'final', 'cancelled']);

export const createPrescriptionSchema = z.object({
  patientId: z.number().int().positive('Patient ID required'),
  doctorId: z.number().int().positive().optional(),
  appointmentId: z.number().int().positive().optional(),
  admissionId: z.number().int().positive().optional(),
  sourceReconciliationId: z.number().int().positive().optional(),
  bp: z.string().optional(),
  temperature: z.string().optional(),
  weight: z.string().optional(),
  spo2: z.string().optional(),
  chiefComplaint: z.string().optional(),
  diagnosis: z.string().optional(),
  examinationNotes: z.string().optional(),
  advice: z.string().optional(),
  labTests: z.array(z.string()).optional(),
  followUpDate: z.string().optional(),
  status: newPrescriptionStatusSchema.optional(),
  safetyCheckId: z.number().int().positive().optional(),
  safetyOverrideReason: z.string().max(500).optional(),
  items: z.array(prescriptionItemSchema).optional(),
}).superRefine((value, ctx) => {
  if (value.sourceReconciliationId && !value.admissionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['admissionId'],
      message: 'Admission ID is required when creating a prescription from medication reconciliation',
    });
  }
});

export const updatePrescriptionSchema = z.object({
  bp: z.string().optional(),
  temperature: z.string().optional(),
  weight: z.string().optional(),
  spo2: z.string().optional(),
  chiefComplaint: z.string().optional(),
  diagnosis: z.string().optional(),
  examinationNotes: z.string().optional(),
  advice: z.string().optional(),
  labTests: z.array(z.string()).optional(),
  followUpDate: z.string().optional(),
  status: prescriptionTransitionStatusSchema.optional(),
  safetyCheckId: z.number().int().positive().optional(),
  safetyOverrideReason: z.string().max(500).optional(),
  items: z.array(prescriptionItemSchema).optional(),
  edit_reason: z.string().optional(),
}).strict();

// ─── Doctor Schedules ────────────────────────────────────────────────────────

export const createDoctorScheduleSchema = z.object({
  doctor_id: z.number().int().positive('Doctor ID required'),
  day_of_week: z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']),
  start_time: z.string().min(1, 'Start time required'),
  end_time: z.string().min(1, 'End time required'),
  session_type: z.string().optional(),
  chamber: z.string().optional(),
  max_patients: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

export const updateDoctorScheduleSchema = createDoctorScheduleSchema
  .partial()
  .omit({ doctor_id: true })
  .refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

// ─── Settings ────────────────────────────────────────────────────────────────

export const updateSettingSchema = z.object({
  value: z.string().min(1, 'Value required'),
});

const settingsObjectSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const bulkUpdateSettingsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), settingsObjectSchema]),
)
  .refine(obj => Object.keys(obj).length <= 100, { message: 'Maximum 100 settings per request' });

// ─── Tests (Lab Tests) ──────────────────────────────────────────────────────

export const createTestSchema = z.object({
  patientId: z.number().int().positive('Patient ID required'),
  testName: z.string().min(1, 'Test name required'),
});

export const updateTestResultSchema = z.object({
  result: z.string().min(1, 'Result required'),
});

// ─── Telemedicine ────────────────────────────────────────────────────────────

export const createTeleRoomSchema = z.object({
  name: z.string().optional().default(''),
  patientId: z.number().int().positive().optional(),
  doctorId: z.number().int().positive().optional(),
  patientName: z.string().optional(),
  doctorName: z.string().optional(),
});

// ─── Push Notifications (unsubscribe) ────────────────────────────────────────

export const unsubscribePushSchema = z.object({
  endpoint: z.string().url('Valid endpoint URL required'),
});

// ─── Type Exports ─────────────────────────────────────────────────────────────

export type CreatePrescriptionInput     = z.infer<typeof createPrescriptionSchema>;
export type UpdatePrescriptionInput     = z.infer<typeof updatePrescriptionSchema>;
export type CreateDoctorScheduleInput   = z.infer<typeof createDoctorScheduleSchema>;
export type UpdateDoctorScheduleInput   = z.infer<typeof updateDoctorScheduleSchema>;
export type CreateTestInput             = z.infer<typeof createTestSchema>;
export type UpdateTestResultInput       = z.infer<typeof updateTestResultSchema>;
export type CreateTeleRoomInput         = z.infer<typeof createTeleRoomSchema>;
