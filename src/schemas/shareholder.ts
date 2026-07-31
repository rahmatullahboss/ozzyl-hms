import { z } from 'zod';

// ── Shareholder CRUD ──────────────────────────────────────────
// Required: name, type only. Everything else is optional.
export const createShareholderSchema = z.object({
  name: z.string().min(1, 'Name required'),
  type: z.enum(['profit', 'owner', 'investor', 'doctor', 'shareholder']),
  phone: z.string().optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  shareCount: z.number().int().min(0).default(0),
  investment: z.number().nonnegative().default(0),
  email: z.string().email().optional().or(z.literal('')),
  nid: z.string().optional().or(z.literal('')),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  bankName: z.string().optional().or(z.literal('')),
  bankAccountNo: z.string().optional().or(z.literal('')),
  bankBranch: z.string().optional().or(z.literal('')),
  routingNo: z.string().optional().or(z.literal('')),
  shareValueBdt: z.number().int().positive().optional(),
  isActive: z.boolean().default(true),
  nomineeName: z.string().optional().or(z.literal('')),
  nomineeContact: z.string().optional().or(z.literal('')),
});

export const updateShareholderSchema = createShareholderSchema.partial();

export const distributeMonthlyProfitSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM'),
});

export type CreateShareholderInput = z.infer<typeof createShareholderSchema>;
export type UpdateShareholderInput = z.infer<typeof updateShareholderSchema>;
export type DistributeMonthlyProfitInput = z.infer<typeof distributeMonthlyProfitSchema>;
