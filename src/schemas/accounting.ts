import { z } from 'zod';

// ─── Income ───────────────────────────────────────────────────────────────────

export const createIncomeSchema = z.object({
  date: z.string().min(1, 'Date required'),
  source: z.string().min(1, 'Source required'),
  amount: z.number().positive('Amount must be positive'),
  description: z.string().optional(),
  bill_id: z.number().int().positive().optional(),
});

export const updateIncomeSchema = createIncomeSchema.partial();

export const reverseIncomeSchema = z.object({
  date: z.string().min(1, 'Reversal date required').optional(),
  reason: z.string().min(1, 'Reason required').max(1000).optional(),
  paymentMethod: z.string().min(1).optional(),
});

// ─── Expenses ─────────────────────────────────────────────────────────────────

export const createExpenseSchema = z.object({
  date: z.string().min(1, 'Date required'),
  category: z.string().min(1, 'Category required'),
  amount: z.number().positive('Amount must be positive'),
  description: z.string().optional(),
  payeeName: z.string().trim().max(160).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  paidFromDrawer: z.boolean().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

// ─── Journal Entries ──────────────────────────────────────────────────────────

export const createJournalEntrySchema = z.object({
  entry_date: z.string().min(1, 'Entry date required'),
  reference: z.string().optional(),
  description: z.string().optional(),
  debit_account_id: z.number().int().positive('Debit account required'),
  credit_account_id: z.number().int().positive('Credit account required'),
  amount: z.number().positive('Amount must be positive'),
});

// ─── Chart of Accounts ───────────────────────────────────────────────────────

export const createAccountSchema = z.object({
  code: z.string().min(1, 'Account code required').max(20),
  name: z.string().min(1, 'Account name required').max(100),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  parent_id: z.number().int().positive().optional(),
});

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']).optional(),
  is_active: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
});

// ─── Recurring Expenses ──────────────────────────────────────────────────────

export const createRecurringExpenseSchema = z.object({
  category_id: z.number().int().positive('Category required'),
  amount: z.number().positive('Amount must be positive'),
  description: z.string().optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  next_run_date: z.string().min(1, 'Next run date required'),
  end_date: z.string().optional(),
});

export const updateRecurringExpenseSchema = z.object({
  category_id: z.number().int().positive().optional(),
  amount: z.number().positive().optional(),
  description: z.string().optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  next_run_date: z.string().optional(),
  end_date: z.string().nullable().optional(),
  is_active: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
});

// ─── Profit Distribution ────────────────────────────────────────────────────

export const distributeProfitSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM format').optional(),
});

// ─── Payment Verification ────────────────────────────────────────────────────

export const verifyPaymentSchema = z.object({
  paymentId: z.string().min(1, 'Payment ID required'),
  gateway: z.enum(['bkash', 'nagad']),
});

// ─── Type Exports ─────────────────────────────────────────────────────────────

export type CreateIncomeInput            = z.infer<typeof createIncomeSchema>;
export type UpdateIncomeInput            = z.infer<typeof updateIncomeSchema>;
export type ReverseIncomeInput           = z.infer<typeof reverseIncomeSchema>;
export type CreateExpenseInput           = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput           = z.infer<typeof updateExpenseSchema>;
export type CreateJournalEntryInput      = z.infer<typeof createJournalEntrySchema>;
export type CreateAccountInput           = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput           = z.infer<typeof updateAccountSchema>;
export type CreateRecurringExpenseInput  = z.infer<typeof createRecurringExpenseSchema>;
export type UpdateRecurringExpenseInput  = z.infer<typeof updateRecurringExpenseSchema>;
export type DistributeProfitInput        = z.infer<typeof distributeProfitSchema>;
export type VerifyPaymentInput           = z.infer<typeof verifyPaymentSchema>;
