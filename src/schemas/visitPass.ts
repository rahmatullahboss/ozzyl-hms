import { z } from 'zod';

export const createVisitPassSchema = z.object({
  duration_hours: z.number().int().min(1).max(72).default(24),
  managed_identity_id: z.number().int().positive().optional(),
});

export const redeemVisitPassSchema = z.object({
  token: z.string().min(32).optional(),
  pass_code: z.string().regex(/^VP-[A-Z2-9]{6}$/).optional(),
}).refine((data) => data.token || data.pass_code, {
  message: 'token or pass_code is required',
  path: ['token'],
});
