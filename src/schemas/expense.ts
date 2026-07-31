import { z } from 'zod';

export const createExpenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  category: z.string().min(1, 'Category required'),
  amount: z.number().positive('Amount must be positive'),
  description: z.string().optional(),
  payeeName: z.string().trim().max(160).optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
