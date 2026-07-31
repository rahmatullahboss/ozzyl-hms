import { z } from 'zod';

export const clinicalAreaEnum = z.enum(['labs', 'prescriptions', 'vitals', 'allergies', 'visits', 'diagnoses', 'all']);
export const consentPurposeEnum = z.enum(['TREATMENT', 'PAYMENT', 'OPERATIONS', 'RESEARCH', 'MARKETING']);

export const globalConsentSchema = z.object({
  consent_type: z.enum(['view_summary', 'view_full', 'emergency_access']),
  granted_to_tenant_id: z.number().int().positive().optional(),
  duration_hours: z.number().int().min(1).max(8760).default(720),
  clinical_areas: z.array(clinicalAreaEnum).optional(),
  purpose: consentPurposeEnum.default('TREATMENT'),
});

export const globalShareTokenSchema = z.object({
  scope: z.enum(['summary', 'full']).default('summary'),
  duration_hours: z.number().int().min(1).max(720).default(24),
});
export const globalBlockListSchema = z.object({
  blocked_tenant_id: z.number().int().positive().nullable().optional(),
  blocked_doctor_id: z.number().int().positive().nullable().optional(),
  reason: z.string().optional(),
}).refine(data => data.blocked_tenant_id || data.blocked_doctor_id, {
  message: "Either blocked_tenant_id or blocked_doctor_id is required"
});

export const globalEmergencyAccessSchema = z.object({
  patient_id: z.number().int().positive(),
  emergency_reason_code: z.enum(['ETREAT', 'EMERGENCY', 'LEGAL', 'OTHER']),
  emergency_reason_details: z.string().min(10, 'Emergency reason details must be at least 10 characters').max(1000),
});
