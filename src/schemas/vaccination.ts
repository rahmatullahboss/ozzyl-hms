import { z } from 'zod';

// ─── Vaccine Master ───────────────────────────────────────────────────────

export const createVaccineSchema = z.object({
  code: z.string().min(1, 'Vaccine code is required').max(50),
  name: z.string().min(1, 'Vaccine name is required').max(200),
  name_bn: z.string().max(200).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  number_of_doses: z.number().int().min(1).default(1),
  dose_interval_days: z.number().int().min(0).optional().nullable(),
  target_age_group: z.string().max(100).optional().nullable(),
  is_active: z.number().int().min(0).max(1).default(1),
});

export const updateVaccineSchema = createVaccineSchema.partial();

// ─── Patient Vaccination Record ───────────────────────────────────────────

const routeEnum = z.enum(['IM', 'SC', 'ID', 'PO', 'IN']);
const statusEnum = z.enum(['completed', 'scheduled', 'missed', 'cancelled']);

export const createPatientVaccinationSchema = z.object({
  patient_id: z.number().int().positive('Patient ID is required'),
  vaccine_id: z.number().int().positive('Vaccine ID is required'),
  dose_number: z.number().int().min(1).default(1),
  administered_date: z.string().regex(
    /^\d{4}-\d{2}-\d{2}/,
    'Date must be in YYYY-MM-DD format'
  ),
  administered_by: z.number().int().positive().optional().nullable(),
  batch_number: z.string().max(100).optional().nullable(),
  manufacturer: z.string().max(200).optional().nullable(),
  route: routeEnum.optional().nullable(),
  administration_site: z.string().max(200).optional().nullable(),
  adverse_effects: z.string().max(2000).optional().nullable(),
  remarks: z.string().max(2000).optional().nullable(),
  next_dose_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Date must be in YYYY-MM-DD format').optional().nullable(),
  status: statusEnum.default('completed'),
});

export const updatePatientVaccinationSchema = createPatientVaccinationSchema.partial().omit({ patient_id: true });

// ─── Query Params ─────────────────────────────────────────────────────────

export const vaccinationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  is_active: z.coerce.number().int().min(0).max(1).optional(),
});

export const vaccinationReportQuerySchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  vaccine_id: z.coerce.number().int().optional(),
  status: z.enum(['completed', 'scheduled', 'missed', 'cancelled']).optional(),
});

export const dueVaccinationsQuerySchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vaccine_id: z.coerce.number().int().optional(),
});

// ─── Types ────────────────────────────────────────────────────────────────

export type CreateVaccineInput = z.infer<typeof createVaccineSchema>;
export type UpdateVaccineInput = z.infer<typeof updateVaccineSchema>;
export type CreatePatientVaccinationInput = z.infer<typeof createPatientVaccinationSchema>;
export type UpdatePatientVaccinationInput = z.infer<typeof updatePatientVaccinationSchema>;
