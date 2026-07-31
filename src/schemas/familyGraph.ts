import { z } from 'zod';

export const familyRelationshipSchema = z.enum([
  'child',
  'parent',
  'spouse',
  'sibling',
  'caregiver',
  'legal_guardian',
  'grandparent',
  'grandchild',
  'other',
]);

export const createDependentSchema = z.object({
  name: z.string().min(1).max(120),
  relationship: familyRelationshipSchema,
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  phone: z.string().min(1).max(20).optional(),
  national_id: z.string().min(10).max(32).optional(),
  notes: z.string().max(500).optional(),
});

export const linkExistingFamilySchema = z.object({
  uhid: z.string().min(3).max(32),
  relationship: familyRelationshipSchema,
  claim_code: z.string().min(4).max(32).optional(),
  phone: z.string().min(1).max(20).optional(),
  national_id: z.string().min(10).max(32).optional(),
  notes: z.string().max(500).optional(),
}).refine((data) => Boolean(data.claim_code || data.phone || data.national_id), {
  message: 'claim_code, phone, or national_id is required',
  path: ['claim_code'],
});

export const createFamilyProxyInviteSchema = z.object({
  uhid: z.string().min(3).max(32),
  relationship: familyRelationshipSchema,
  notes: z.string().max(500).optional(),
});

export const respondFamilyProxyInviteSchema = z.object({
  action: z.enum(['accept', 'decline']),
});
