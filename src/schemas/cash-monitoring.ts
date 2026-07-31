import { z } from 'zod';

export const cashReconciliationSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
  actualCash: z.number().min(0),
  notes: z.string().trim().max(500).optional(),
});

export const expenseBudgetSchema = z.object({
  category: z.string().trim().min(1).max(100),
  monthlyBudget: z.number().min(0),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Year-month must be YYYY-MM format'),
});

export const paymentReminderSchema = z.object({
  billId: z.number().int().positive(),
  method: z.enum(['sms', 'email', 'both', 'manual']),
});
