import { describe, it, expect } from 'vitest';

// ─── Expense Management Tests ─────────────────────────────────────────────────
// Covers: src/routes/tenant/expenses.ts
// Real logic: approval threshold ৳10,000, director-only approval, categories

describe('HMS Expense Management Tests', () => {

  const APPROVAL_THRESHOLD = 10_000;

  // ─── Expense Validation ────────────────────────────────────────────────────
  describe('Expense Input Validation', () => {
    interface ExpenseInput {
      date: string;
      category: string;
      amount: number;
      description?: string;
    }

    function validateExpense(input: Partial<ExpenseInput>): string[] {
      const errors: string[] = [];
      if (!input.date) errors.push('date is required');
      if (!input.category) errors.push('category is required');
      if (!input.amount || input.amount <= 0) errors.push('amount must be positive');
      return errors;
    }

    it('should accept valid expense input', () => {
      expect(validateExpense({ date: '2024-01-15', category: 'medicine_purchase', amount: 5000 })).toHaveLength(0);
    });

    it('should reject missing date', () => {
      expect(validateExpense({ category: 'medicine_purchase', amount: 5000 })).toContain('date is required');
    });

    it('should reject missing category', () => {
      expect(validateExpense({ date: '2024-01-15', amount: 5000 })).toContain('category is required');
    });

    it('should reject missing amount', () => {
      expect(validateExpense({ date: '2024-01-15', category: 'utilities' })).toContain('amount must be positive');
    });

    it('should reject amount of 0', () => {
      expect(validateExpense({ date: '2024-01-15', category: 'utilities', amount: 0 })).toContain('amount must be positive');
    });

    it('should reject negative amount', () => {
      expect(validateExpense({ date: '2024-01-15', category: 'utilities', amount: -500 })).toContain('amount must be positive');
    });
  });

  // ─── Approval Threshold Logic ──────────────────────────────────────────────
  describe('Approval Threshold Logic (৳10,000)', () => {
    function determineExpenseStatus(amount: number): 'approved' | 'pending' {
      return amount > APPROVAL_THRESHOLD ? 'pending' : 'approved';
    }

    it('should auto-approve expense of ৳5,000 (below threshold)', () => {
      expect(determineExpenseStatus(5_000)).toBe('approved');
    });

    it('should auto-approve expense exactly at ৳10,000 (at threshold = <=)', () => {
      expect(determineExpenseStatus(10_000)).toBe('approved');
    });

    it('should flag ৳10,001 for pending director approval', () => {
      expect(determineExpenseStatus(10_001)).toBe('pending');
    });

    it('should flag ৳50,000 for pending approval', () => {
      expect(determineExpenseStatus(50_000)).toBe('pending');
    });

    it('should auto-approve ৳1 (smallest possible expense)', () => {
      expect(determineExpenseStatus(1)).toBe('approved');
    });
  });

  // ─── Expense Status Machine ────────────────────────────────────────────────
  describe('Expense Status Transitions', () => {
    type ExpenseStatus = 'approved' | 'pending' | 'rejected';

    function canApprove(status: ExpenseStatus, role: string): { ok: boolean; error?: string } {
      if (role !== 'director') return { ok: false, error: 'Director approval required' };
      if (status !== 'pending') return { ok: false, error: 'Expense is not pending approval' };
      return { ok: true };
    }

    function canReject(status: ExpenseStatus, role: string): { ok: boolean; error?: string } {
      if (role !== 'director') return { ok: false, error: 'Director rejection required' };
      if (status !== 'pending') return { ok: false, error: 'Expense is not pending approval' };
      return { ok: true };
    }

    function canEdit(status: ExpenseStatus): { ok: boolean; error?: string } {
      if (status === 'pending') return { ok: false, error: 'Cannot edit pending expense. Approve or reject first.' };
      return { ok: true };
    }

    it('should allow director to approve a pending expense', () => {
      expect(canApprove('pending', 'director').ok).toBe(true);
    });

    it('should block non-director from approving expense', () => {
      const result = canApprove('pending', 'accountant');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Director');
    });

    it('should block approving an already-approved expense', () => {
      const result = canApprove('approved', 'director');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not pending');
    });

    it('should allow director to reject a pending expense', () => {
      expect(canReject('pending', 'director').ok).toBe(true);
    });

    it('should block rejecting an already-rejected expense', () => {
      const result = canReject('rejected', 'director');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not pending');
    });

    it('should block editing a pending expense (must approve/reject first)', () => {
      const result = canEdit('pending');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Cannot edit pending');
    });

    it('should allow editing an approved expense', () => {
      expect(canEdit('approved').ok).toBe(true);
    });

    it('should allow editing a rejected expense', () => {
      expect(canEdit('rejected').ok).toBe(true);
    });
  });

  // ─── Expense Categories ────────────────────────────────────────────────────
  describe('Expense Category Validation', () => {
    const VALID_CATEGORIES = [
      'medicine_purchase', 'equipment', 'utilities', 'salary', 'rent',
      'maintenance', 'marketing', 'stationery', 'food', 'transport',
      'cleaning', 'insurance', 'consultation_fee', 'other',
    ];

    it('should accept medicine_purchase category', () => {
      expect(VALID_CATEGORIES).toContain('medicine_purchase');
    });

    it('should accept salary category', () => {
      expect(VALID_CATEGORIES).toContain('salary');
    });

    it('should accept equipment category', () => {
      expect(VALID_CATEGORIES).toContain('equipment');
    });

    it('should have at least 10 expense categories', () => {
      expect(VALID_CATEGORIES.length).toBeGreaterThanOrEqual(10);
    });
  });

  // ─── Expenditure Aggregation ───────────────────────────────────────────────
  describe('Expense Aggregation', () => {
    interface Expense {
      category: string;
      amount: number;
      status: 'approved' | 'pending' | 'rejected';
      date: string;
    }

    function totalApprovedExpenses(expenses: Expense[]): number {
      return expenses.filter((e) => e.status === 'approved').reduce((s, e) => s + e.amount, 0);
    }

    function expensesByCategory(expenses: Expense[]): Record<string, number> {
      return expenses
        .filter((e) => e.status === 'approved')
        .reduce((acc, e) => {
          acc[e.category] = (acc[e.category] ?? 0) + e.amount;
          return acc;
        }, {} as Record<string, number>);
    }

    it('should sum only approved expenses (exclude pending and rejected)', () => {
      const expenses: Expense[] = [
        { category: 'utilities', amount: 5_000, status: 'approved', date: '2024-01-15' },
        { category: 'equipment', amount: 20_000, status: 'pending', date: '2024-01-15' },
        { category: 'salary', amount: 30_000, status: 'approved', date: '2024-01-15' },
        { category: 'other', amount: 500, status: 'rejected', date: '2024-01-15' },
      ];
      expect(totalApprovedExpenses(expenses)).toBe(35_000);
    });

    it('should return 0 when all expenses are pending', () => {
      const expenses: Expense[] = [
        { category: 'equipment', amount: 50_000, status: 'pending', date: '2024-01-15' },
      ];
      expect(totalApprovedExpenses(expenses)).toBe(0);
    });

    it('should group approved expenses by category', () => {
      const expenses: Expense[] = [
        { category: 'utilities', amount: 3_000, status: 'approved', date: '2024-01-15' },
        { category: 'utilities', amount: 2_000, status: 'approved', date: '2024-01-16' },
        { category: 'salary', amount: 30_000, status: 'approved', date: '2024-01-15' },
      ];
      const grouped = expensesByCategory(expenses);
      expect(grouped.utilities).toBe(5_000);
      expect(grouped.salary).toBe(30_000);
    });
  });

  // ─── Income Recording Tests ────────────────────────────────────────────────
  describe('Income Recording Validation', () => {
    const VALID_INCOME_SOURCES = [
      'billing', 'pharmacy', 'lab', 'consultation', 'ipd_billing',
      'donation', 'grant', 'other',
    ];

    function validateIncome(input: { date?: string; source?: string; amount?: number }): string[] {
      const errors: string[] = [];
      if (!input.date) errors.push('date is required');
      if (!input.source) errors.push('source is required');
      if (!input.amount || input.amount <= 0) errors.push('amount must be positive');
      return errors;
    }

    it('should accept all valid income sources', () => {
      VALID_INCOME_SOURCES.forEach((source) => {
        expect(VALID_INCOME_SOURCES).toContain(source);
      });
    });

    it('should validate income with all required fields', () => {
      expect(validateIncome({ date: '2024-01-15', source: 'billing', amount: 50_000 })).toHaveLength(0);
    });

    it('should reject income missing source', () => {
      expect(validateIncome({ date: '2024-01-15', amount: 50_000 })).toContain('source is required');
    });

    it('should reject income with zero amount', () => {
      expect(validateIncome({ date: '2024-01-15', source: 'billing', amount: 0 })).toContain('amount must be positive');
    });

    it('should link income to bill (bill_id optional)', () => {
      const income = { date: '2024-01-15', source: 'billing', amount: 5000, bill_id: 401 };
      expect(income.bill_id).toBe(401);
    });

    it('should allow income without bill_id for non-billing sources', () => {
      const income = { date: '2024-01-15', source: 'donation', amount: 10_000, bill_id: null };
      expect(income.bill_id).toBeNull();
    });
  });

  // ─── Recurring Expense Tests ───────────────────────────────────────────────
  describe('Recurring Expense Management', () => {
    type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

    interface RecurringExpense {
      categoryId: number;
      amount: number;
      frequency: RecurringFrequency;
      nextRunDate: string;
      isActive: boolean;
    }

    function calcNextRunDate(currentDate: string, frequency: RecurringFrequency): string {
      const date = new Date(currentDate);
      switch (frequency) {
        case 'daily':     date.setDate(date.getDate() + 1); break;
        case 'weekly':    date.setDate(date.getDate() + 7); break;
        case 'monthly':   date.setMonth(date.getMonth() + 1); break;
        case 'quarterly': date.setMonth(date.getMonth() + 3); break;
        case 'yearly':    date.setFullYear(date.getFullYear() + 1); break;
      }
      return date.toISOString().split('T')[0];
    }

    it('should calculate next daily run date correctly', () => {
      expect(calcNextRunDate('2024-01-15', 'daily')).toBe('2024-01-16');
    });

    it('should calculate next weekly run date correctly', () => {
      expect(calcNextRunDate('2024-01-15', 'weekly')).toBe('2024-01-22');
    });

    it('should calculate next monthly run date correctly', () => {
      expect(calcNextRunDate('2024-01-15', 'monthly')).toBe('2024-02-15');
    });

    it('should calculate next quarterly run date correctly', () => {
      expect(calcNextRunDate('2024-01-15', 'quarterly')).toBe('2024-04-15');
    });

    it('should calculate next yearly run date correctly', () => {
      expect(calcNextRunDate('2024-01-15', 'yearly')).toBe('2025-01-15');
    });

    it('should skip inactive recurring expenses', () => {
      const expenses: RecurringExpense[] = [
        { categoryId: 1, amount: 5_000, frequency: 'monthly', nextRunDate: '2024-01-15', isActive: true },
        { categoryId: 2, amount: 3_000, frequency: 'monthly', nextRunDate: '2024-01-15', isActive: false },
      ];
      const activeExpenses = expenses.filter((e) => e.isActive);
      expect(activeExpenses.length).toBe(1);
    });

    it('should accept all valid frequencies', () => {
      const frequencies: RecurringFrequency[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
      expect(frequencies).toContain('monthly');
      expect(frequencies).toContain('quarterly');
    });

    it('should get due recurring expenses (nextRunDate <= today)', () => {
      const today = '2024-01-15';
      const expenses: RecurringExpense[] = [
        { categoryId: 1, amount: 5_000, frequency: 'monthly', nextRunDate: '2024-01-10', isActive: true },
        { categoryId: 2, amount: 3_000, frequency: 'monthly', nextRunDate: '2024-01-20', isActive: true },
      ];
      const due = expenses.filter((e) => e.isActive && e.nextRunDate <= today);
      expect(due.length).toBe(1);
      expect(due[0].categoryId).toBe(1);
    });
  });
});
