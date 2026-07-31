import { z } from 'zod';
import { clinicalAreaEnum, consentPurposeEnum } from './globalHealth';
import { validateBDNationalId } from '../lib/nid-validation';

export const nationalIdSchema = z.string().superRefine((value, ctx) => {
  const result = validateBDNationalId(value);
  if (!result.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.error ?? 'Invalid National ID',
    });
  }
});

export const updateNationalIdSchema = z.object({
  national_id: nationalIdSchema,
});

export const createConsentSchema = z.object({
  consent_type: z.enum(['view_summary', 'view_full', 'emergency_access']),
  granted_to_tenant_id: z.number().int().positive().optional(),
  duration_hours: z.number().int().min(1).max(8760).default(720), // max 1 year, default 30 days
  clinical_areas: z.array(clinicalAreaEnum).optional(),
  purpose: consentPurposeEnum.default('TREATMENT'),
});

export const revokeConsentSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const generateTokenSchema = z.object({
  scope: z.enum(['summary', 'full']).default('summary'),
  duration_hours: z.number().int().min(1).max(720).default(24), // max 30 days, default 24h
});

export const nidLookupSchema = z.object({
  national_id: nationalIdSchema,
});

export const emergencyAccessSchema = z.object({
  national_id: nationalIdSchema,
  justification: z.string().min(10, 'Emergency justification must be at least 10 characters').max(1000),
});
