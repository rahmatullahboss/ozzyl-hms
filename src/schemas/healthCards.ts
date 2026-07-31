import { z } from 'zod';

export const issueCardSchema = z.object({
  patient_id: z.number().int().positive(),
  card_type: z.enum(['hospital', 'global', 'emergency']).default('hospital'),
  activation_mode: z.enum(['claim_code', 'staff_assisted']).default('claim_code'),
  duration_hours: z.number().int().min(1).max(8760).default(24),
});

export const revokeCardSchema = z.object({
  reason: z.string().min(1, 'Revocation reason is required'),
  issue_replacement: z.boolean().default(false),
});
