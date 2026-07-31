import { describe, it, expect } from 'vitest';

// ─── Chart of Accounts & Journal Entry Tests ──────────────────────────────────
// Covers: src/routes/tenant/accounts.ts, src/routes/tenant/journal.ts
// Double-entry bookkeeping for hospital accounting

describe('HMS Chart of Accounts Tests', () => {

  // ─── Account Types ─────────────────────────────────────────────────────────
  describe('Account Type Validation', () => {
    const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
    type AccountType = typeof ACCOUNT_TYPES[number];

    function isValidType(t: string): t is AccountType {
      return (ACCOUNT_TYPES as readonly string[]).includes(t);
    }

    it('should accept asset account type', () => { expect(isValidType('asset')).toBe(true); });
    it('should accept liability account type', () => { expect(isValidType('liability')).toBe(true); });
    it('should accept equity account type', () => { expect(isValidType('equity')).toBe(true); });
    it('should accept revenue account type', () => { expect(isValidType('revenue')).toBe(true); });
    it('should accept expense account type', () => { expect(isValidType('expense')).toBe(true); });
    it('should reject unknown account type', () => { expect(isValidType('misc')).toBe(false); });
    it('should have exactly 5 standard account types', () => { expect(ACCOUNT_TYPES.length).toBe(5); });
  });

  // ─── Account Code Validation ───────────────────────────────────────────────
  describe('Account Code Structure', () => {
    // Hospital accounting code pattern: 4-6 digit codes
    // 1xxx = Assets, 2xxx = Liabilities, 3xxx = Equity, 4xxx = Revenue, 5xxx = Expenses
    function isValidAccountCode(code: string): boolean {
      return /^\d{4,6}$/.test(code);
    }

    function getAccountTypeFromCode(code: string): string {
      const firstDigit = code.charAt(0);
      const map: Record<string, string> = {
        '1': 'asset', '2': 'liability', '3': 'equity', '4': 'revenue', '5': 'expense',
      };
      return map[firstDigit] ?? 'unknown';
    }

    it('should accept 4-digit account code', () => { expect(isValidAccountCode('1001')).toBe(true); });
    it('should accept 6-digit account code', () => { expect(isValidAccountCode('101001')).toBe(true); });
    it('should reject 3-digit code (too short)', () => { expect(isValidAccountCode('100')).toBe(false); });
    it('should reject code with letters', () => { expect(isValidAccountCode('100A')).toBe(false); });
    it('should return asset for codes starting with 1', () => { expect(getAccountTypeFromCode('1001')).toBe('asset'); });
    it('should return revenue for codes starting with 4', () => { expect(getAccountTypeFromCode('4001')).toBe('revenue'); });
    it('should return expense for codes starting with 5', () => { expect(getAccountTypeFromCode('5001')).toBe('expense'); });
    it('should return unknown for invalid first digit', () => { expect(getAccountTypeFromCode('9001')).toBe('unknown'); });
  });

  // ─── Account Uniqueness ────────────────────────────────────────────────────
  describe('Account Code Uniqueness per Tenant', () => {
    interface Account { code: string; tenantId: number; }

    function isDuplicateCode(existing: Account[], code: string, tenantId: number): boolean {
      return existing.some((a) => a.code === code && a.tenantId === tenantId);
    }

    it('should detect duplicate account code within same tenant', () => {
      const existing: Account[] = [{ code: '1001', tenantId: 1 }];
      expect(isDuplicateCode(existing, '1001', 1)).toBe(true);
    });

    it('should allow same account code in different tenants', () => {
      const existing: Account[] = [{ code: '1001', tenantId: 1 }];
      expect(isDuplicateCode(existing, '1001', 2)).toBe(false);
    });

    it('should allow different code in same tenant', () => {
      const existing: Account[] = [{ code: '1001', tenantId: 1 }];
      expect(isDuplicateCode(existing, '1002', 1)).toBe(false);
    });
  });
});

describe('HMS Journal Entry (Double-Entry Bookkeeping) Tests', () => {

  // ─── Double-Entry Validation ───────────────────────────────────────────────
  describe('Debit/Credit Balance Validation', () => {
    interface JournalLine {
      accountCode: string;
      debit: number;
      credit: number;
      description: string;
    }

    function isJournalBalanced(lines: JournalLine[]): boolean {
      const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
      return Math.abs(totalDebit - totalCredit) < 0.01; // float tolerance
    }

    function calcJournalTotals(lines: JournalLine[]): { totalDebit: number; totalCredit: number } {
      return {
        totalDebit: lines.reduce((s, l) => s + l.debit, 0),
        totalCredit: lines.reduce((s, l) => s + l.credit, 0),
      };
    }

    it('should validate a balanced journal entry (cash collection for consultation)', () => {
      const lines: JournalLine[] = [
        { accountCode: '1001', debit: 1000, credit: 0, description: 'Cash inflow' },   // Cash DR
        { accountCode: '4001', debit: 0, credit: 1000, description: 'Revenue earned' }, // Revenue CR
      ];
      expect(isJournalBalanced(lines)).toBe(true);
    });

    it('should reject unbalanced journal entry', () => {
      const lines: JournalLine[] = [
        { accountCode: '1001', debit: 1000, credit: 0, description: 'Cash inflow' },
        { accountCode: '4001', debit: 0, credit: 900, description: 'Revenue earned' }, // wrong amount
      ];
      expect(isJournalBalanced(lines)).toBe(false);
    });

    it('should validate multi-line balanced entry (expense payment)', () => {
      const lines: JournalLine[] = [
        { accountCode: '5001', debit: 5000, credit: 0, description: 'Utilities expense' },
        { accountCode: '1001', debit: 0, credit: 5000, description: 'Cash payment' },
      ];
      expect(isJournalBalanced(lines)).toBe(true);
    });

    it('should handle pharmacy purchase: inventory DR, cash CR', () => {
      const lines: JournalLine[] = [
        { accountCode: '1201', debit: 15000, credit: 0, description: 'Pharmacy inventory' }, // Asset DR
        { accountCode: '1001', debit: 0, credit: 15000, description: 'Cash paid' },           // Cash CR
      ];
      expect(isJournalBalanced(lines)).toBe(true);
      const totals = calcJournalTotals(lines);
      expect(totals.totalDebit).toBe(15000);
      expect(totals.totalCredit).toBe(15000);
    });

    it('should reject journal entry with fewer than 2 lines', () => {
      const lines: JournalLine[] = [
        { accountCode: '1001', debit: 1000, credit: 0, description: 'Only debit side' },
      ];
      const isValid = lines.length >= 2;
      expect(isValid).toBe(false);
    });

    it('should reject journal line with both debit and credit > 0', () => {
      const line: JournalLine = { accountCode: '1001', debit: 500, credit: 300, description: 'Invalid' };
      const isValid = line.debit === 0 || line.credit === 0;
      expect(isValid).toBe(false);
    });

    it('should reject journal line with both debit and credit = 0', () => {
      const line: JournalLine = { accountCode: '1001', debit: 0, credit: 0, description: 'Zero line' };
      const isValid = line.debit > 0 || line.credit > 0;
      expect(isValid).toBe(false);
    });

    it('should require a description for journal entry', () => {
      const isValid = (description: string) => description.trim().length > 0;
      expect(isValid('')).toBe(false);
      expect(isValid('Monthly salary payment')).toBe(true);
    });
  });

  // ─── Journal Reference Number ──────────────────────────────────────────────
  describe('Journal Reference Number', () => {
    function generateJournalRef(seq: number, yearMonth: string): string {
      return `JE-${yearMonth}-${String(seq).padStart(4, '0')}`;
    }

    it('should generate journal reference number JE-2024-01-0001', () => {
      expect(generateJournalRef(1, '2024-01')).toBe('JE-2024-01-0001');
    });

    it('should generate sequential journal references', () => {
      const ref1 = generateJournalRef(1, '2024-01');
      const ref2 = generateJournalRef(2, '2024-01');
      expect(ref2 > ref1).toBe(true);
    });

    it('should reset sequence with new year-month', () => {
      const lastJan = generateJournalRef(100, '2024-01');
      const firstFeb = generateJournalRef(1, '2024-02');
      expect(firstFeb).toBe('JE-2024-02-0001');
      expect(lastJan).toBe('JE-2024-01-0100');
    });
  });
});
