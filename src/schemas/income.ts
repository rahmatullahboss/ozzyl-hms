import { z } from 'zod';

export const createIncomeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  source: z.enum(['pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other']),
  amount: z.number().int().positive('Amount must be positive'),
  description: z.string().optional(),
  billId: z.number().int().positive().optional(),
});

export type CreateIncomeInput = z.infer<typeof createIncomeSchema>;
