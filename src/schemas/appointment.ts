import { z } from 'zod';

const appointmentDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(parsed.getTime())) return false;
    return parsed.toISOString().slice(0, 10) === value;
  }, 'Invalid appointment date');

const appointmentTimeSchema = z.string()
  .regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM')
  .refine((value) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
  }, 'Invalid appointment time');

const appointmentTypeSchema = z.enum([
  'new_patient',
  'old_patient',
  'follow_up',
  'report_show',
  'free_visit',
  'discounted_visit',
  'emergency',
]);

export const createAppointmentSchema = z.object({
  patientId:      z.number().int().positive(),
  doctorId:       z.number().int().positive().optional(),
  apptDate:       appointmentDateSchema,
  apptTime:       appointmentTimeSchema.optional(),
  visitType:      z.enum(['opd', 'followup', 'emergency']).default('opd'),
  appointmentType: appointmentTypeSchema.optional(),
  discountAmount: z.number().int().min(0).default(0),
  discountReason: z.string().trim().max(300).optional(),
  discountByName: z.string().trim().max(200).optional(),
  chiefComplaint: z.string().max(500).optional(),
  notes:          z.string().max(1000).optional(),
  fee:            z.number().int().min(0).default(0),
  source:         z.enum(['scheduled', 'walk_in', 'online', 'phone']).default('scheduled'),
  externalReferringDoctorId: z.number().int().positive().optional(),
  requestedTokenNo: z.number().int().min(1).optional(),
  /** When set, the appointment is created with this exact token number, bypassing
   *  the auto-assign / reserved-range logic. The caller is responsible for uniqueness. */
  forceTokenNo: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export const updateAppointmentSchema = z.object({
  status:         z.enum(['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval']).optional(),
  apptDate:       appointmentDateSchema.optional(),
  apptTime:       appointmentTimeSchema.optional(),
  notes:          z.string().max(1000).optional(),
  chiefComplaint: z.string().max(500).optional(),
  doctorId:       z.number().int().positive().optional(),
  fee:            z.number().int().min(0).optional(),
  appointmentType: appointmentTypeSchema.optional(),
  discountAmount: z.number().int().min(0).optional(),
  discountReason: z.string().trim().max(300).optional(),
  discountByName: z.string().trim().max(200).optional(),
});

export const appointmentFeePreviewSchema = z.object({
  doctorId: z.coerce.number().int().positive(),
  appointmentType: appointmentTypeSchema.default('new_patient'),
  discountAmount: z.coerce.number().int().min(0).default(0),
  patientId: z.coerce.number().int().positive().optional(),
  apptDate: appointmentDateSchema.optional(),
});

export const upsertDoctorAppointmentFeesSchema = z.object({
  fees: z.array(z.object({
    appointmentType: appointmentTypeSchema,
    fee: z.number().int().min(0),
    notes: z.string().trim().max(300).optional(),
    isActive: z.boolean().default(true),
    eligibilityDays: z.number().int().min(1).max(365).optional(),
  })).min(1),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
