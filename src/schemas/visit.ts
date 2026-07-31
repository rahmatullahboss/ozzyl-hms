import { z } from 'zod';

// ICD-10 code pattern: letter + 2 digits + optional dot + 1-4 chars
// Examples: J06, J06.9, A09.0, Z87.891
const icd10Pattern = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;

// ICD-11 code pattern: 2-6 alphanumeric + optional dot + 1-4 alphanumeric
// Examples: BA00, CA40.Z, 5A11, MG30.0
const icd11Pattern = /^[A-Z0-9]{2,6}(\.[A-Z0-9]{1,4})?$/;

export const createVisitSchema = z.object({
  patientId: z.number().int().positive('Patient ID required'),
  doctorId: z.number().int().positive().optional(),
  visitType: z.enum(['opd', 'ipd', 'emergency']).default('opd'),
  admissionFlag: z.boolean().default(false),
  admissionDate: z.string().optional(),
  notes: z.string().optional(),
  // ICD-10 diagnosis — optional at creation, can be set after consultation
  icd10Code: z.string().regex(icd10Pattern, 'Invalid ICD-10 code (e.g. J06, A09.0)').optional(),
  icd10Description: z.string().max(255).optional(),
  // ICD-11 diagnosis — preferred for BD-Core compliance
  icd11Code: z.string().regex(icd11Pattern, 'Invalid ICD-11 code (e.g. BA00, CA40.Z)').optional(),
  icd11Description: z.string().max(255).optional(),
});

export const updateVisitSchema = z.object({
  doctorId: z.number().int().positive().optional(),
  notes: z.string().optional(),
  dischargeDate: z.string().optional(),
  // Allow updating ICD-10 code (e.g. after lab results confirm diagnosis)
  icd10Code: z.string().regex(icd10Pattern, 'Invalid ICD-10 code (e.g. J06, A09.0)').optional(),
  icd10Description: z.string().max(255).optional(),
  // ICD-11 code update
  icd11Code: z.string().regex(icd11Pattern, 'Invalid ICD-11 code (e.g. BA00, CA40.Z)').optional(),
  icd11Description: z.string().max(255).optional(),
});

export const dischargeSchema = z.object({
  dischargeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Discharge date must be YYYY-MM-DD'),
  notes: z.string().optional(),
  // Final diagnosis code at discharge
  icd10Code: z.string().regex(icd10Pattern, 'Invalid ICD-10 code').optional(),
  icd10Description: z.string().max(255).optional(),
  // Final ICD-11 code at discharge
  icd11Code: z.string().regex(icd11Pattern, 'Invalid ICD-11 code').optional(),
  icd11Description: z.string().max(255).optional(),
});

export type CreateVisitInput  = z.infer<typeof createVisitSchema>;
export type UpdateVisitInput  = z.infer<typeof updateVisitSchema>;
export type DischargeInput    = z.infer<typeof dischargeSchema>;
