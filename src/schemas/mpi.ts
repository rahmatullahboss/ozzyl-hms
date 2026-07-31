import { z } from 'zod';

// ─── Guardian Schemas ───────────────────────────────────────────────────────

export const createGuardianSchema = z.object({
  guardian_name: z.string().min(1, 'Guardian name is required'),
  relationship: z.enum([
    'mother', 'father', 'grandparent', 'uncle', 'aunt',
    'sibling', 'spouse', 'legal_guardian', 'other',
  ]),
  national_id: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  is_primary: z.boolean().default(false),
});

export const updateGuardianSchema = createGuardianSchema.partial();

// ─── Alias Schemas ──────────────────────────────────────────────────────────

export const createAliasSchema = z.object({
  alias_type: z.enum(['name', 'phone', 'nid', 'brn', 'email', 'address']),
  alias_value: z.string().min(1),
  valid_from: z.string().optional(),
  valid_to: z.string().optional(),
  reason: z.string().optional(),
});

// ─── Duplicate Resolution ───────────────────────────────────────────────────

export const resolveDuplicateSchema = z.object({
  action: z.enum(['confirmed', 'rejected']),
  notes: z.string().optional(),
});

// ─── Verification ───────────────────────────────────────────────────────────

export const verifyPatientSchema = z.object({
  level: z.number().int().min(1).max(3),
  verification_method: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Unmerge ────────────────────────────────────────────────────────────────

export const unmergeSchema = z.object({
  merge_log_id: z.number().int().positive(),
  unmerge_reason: z.string().min(1, 'Reason is required'),
});
