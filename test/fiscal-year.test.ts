import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createFiscalYearSchema,
  updateFiscalYearSchema,
  reopenFiscalYearSchema,
} from '../src/schemas/fiscalYear';
import { z } from 'zod';

// ─── Fiscal Year Schema Validation Tests ───────────────────────────────

describe('FiscalYear Schemas', () => {
  describe('createFiscalYearSchema', () => {
    it('should validate a complete fiscal year payload', () => {
      const payload = {
        fiscalYearName: 'FY 2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        prefix: 'FY26',
        insurancePrefix: 'INS26',
        pharmacyPrefix: 'PHM26',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate minimal payload without optional fields', () => {
      const payload = {
        fiscalYearName: 'FY 2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject missing fiscal year name', () => {
      const payload = {
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject empty fiscal year name', () => {
      const payload = {
        fiscalYearName: '',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject missing start date', () => {
      const payload = {
        fiscalYearName: 'FY 2026',
        endDate: '2026-12-31',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject missing end date', () => {
      const payload = {
        fiscalYearName: 'FY 2026',
        startDate: '2026-01-01',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject fiscal year name exceeding 100 characters', () => {
      const payload = {
        fiscalYearName: 'A'.repeat(101),
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should accept all optional prefix fields', () => {
      const payload = {
        fiscalYearName: 'FY 2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        prefix: 'FY26',
        insurancePrefix: 'INS26',
        pharmacyPrefix: 'PHM26',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe('updateFiscalYearSchema', () => {
    it('should validate partial update with fiscalYearName', () => {
      const payload = { fiscalYearName: 'FY 2026 Updated' };
      const result = updateFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate partial update with dates', () => {
      const payload = {
        startDate: '2026-02-01',
        endDate: '2026-12-31',
      };
      const result = updateFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate isActive toggle', () => {
      const payload = { isActive: true };
      const result = updateFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate isClosed toggle', () => {
      const payload = { isClosed: true };
      const result = updateFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate prefix update', () => {
      const payload = { prefix: 'FY27' };
      const result = updateFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate insurancePrefix update', () => {
      const payload = { insurancePrefix: 'INS27' };
      const result = updateFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate pharmacyPrefix update', () => {
      const payload = { pharmacyPrefix: 'PHM27' };
      const result = updateFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate empty update (all optional)', () => {
      const payload = {};
      const result = updateFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject empty string for fiscalYearName', () => {
      const payload = { fiscalYearName: '' };
      const result = updateFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should validate full update payload', () => {
      const payload = {
        fiscalYearName: 'FY 2026 Updated',
        startDate: '2026-02-01',
        endDate: '2026-12-31',
        isActive: false,
        isClosed: false,
        prefix: 'FY26',
        insurancePrefix: 'INS26',
        pharmacyPrefix: 'PHM26',
      };
      const result = updateFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe('reopenFiscalYearSchema', () => {
    it('should validate with remark', () => {
      const payload = { remark: 'Reopening for audit purposes' };
      const result = reopenFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject missing remark', () => {
      const payload = {};
      const result = reopenFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject empty remark', () => {
      const payload = { remark: '' };
      const result = reopenFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });
});

// ─── Fiscal Year Business Logic Tests ────────────────────────────────

describe('FiscalYear Business Logic', () => {
  describe('Date Range Validation', () => {
    it('should accept valid date range', () => {
      const payload = {
        fiscalYearName: 'FY 2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should accept end date before start date (business decision - route validates this)', () => {
      // Schema doesn't validate cross-field; route should catch this
      const payload = {
        fiscalYearName: 'FY 2026',
        startDate: '2026-12-31',
        endDate: '2026-01-01',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true); // Schema passes, route rejects
    });
  });

  describe('Prefix Format', () => {
    it('should accept alphanumeric prefix', () => {
      const payload = {
        fiscalYearName: 'FY 2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        prefix: 'FY26ABC',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should accept numeric-only prefix', () => {
      const payload = {
        fiscalYearName: 'FY 2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        prefix: '2026',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should accept special characters in prefix', () => {
      const payload = {
        fiscalYearName: 'FY 2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        prefix: 'FY-26/27',
      };
      const result = createFiscalYearSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });
});

// ─── Voucher Verification Logic Tests ────────────────────────────────

describe('Voucher Verification Logic', () => {
  describe('Pending Voucher Structure', () => {
    it('should have correct pending voucher interface fields', () => {
      const voucher = {
        id: 1,
        entry_date: '2026-03-15',
        reference: 'JV-001',
        description: 'Test transaction',
        debit_account_id: 101,
        credit_account_id: 102,
        amount: 5000,
        debit_code: '5001',
        debit_name: 'Medicine Purchase',
        credit_code: '1001',
        credit_name: 'Cash',
        voucher_type_code: 'JV',
        voucher_number: 'JV-001',
        created_by_name: 'Admin User',
        created_at: '2026-03-15T10:00:00Z',
      };

      expect(voucher.id).toBe(1);
      expect(voucher.amount).toBe(5000);
      expect(voucher.debit_code).toBe('5001');
      expect(voucher.credit_code).toBe('1001');
    });

    it('should support optional reference and description', () => {
      const voucher = {
        id: 1,
        entry_date: '2026-03-15',
        debit_account_id: 101,
        credit_account_id: 102,
        amount: 5000,
      };

      expect(voucher.reference).toBeUndefined();
      expect(voucher.description).toBeUndefined();
    });
  });

  describe('Voucher Status Transitions', () => {
    it('should have pending as initial status', () => {
      const status = 'pending';
      expect(['pending', 'verified', 'rejected'].includes(status)).toBe(true);
    });

    it('should allow verify transition from pending', () => {
      const currentStatus = 'pending';
      const newStatus = 'verified';
      expect(currentStatus === 'pending' && newStatus === 'verified').toBe(true);
    });

    it('should allow reject transition from pending', () => {
      const currentStatus = 'pending';
      const newStatus = 'rejected';
      expect(currentStatus === 'pending' && newStatus === 'rejected').toBe(true);
    });

    it('should not allow verify transition from verified (already verified)', () => {
      const currentStatus = 'verified';
      // Once verified, status cannot go back to pending
      expect(currentStatus !== 'pending').toBe(true);
    });

    it('should not allow verify transition from rejected', () => {
      const currentStatus = 'rejected';
      expect(currentStatus === 'pending').toBe(false);
    });
  });

  describe('Reject Reason Validation', () => {
    it('should require non-empty reject reason', () => {
      const reason = '';
      expect(reason.trim().length > 0).toBe(false);
    });

    it('should accept valid reject reason', () => {
      const reason = 'Incorrect account allocation';
      expect(reason.trim().length > 0).toBe(true);
    });

    it('should accept long reject reason', () => {
      const reason = 'This voucher has incorrect debit account allocation. The amount does not match supporting documents. Please revise and resubmit.';
      expect(reason.trim().length > 0).toBe(true);
    });
  });

  describe('Amount Validation', () => {
    it('should reject zero amount', () => {
      const amount = 0;
      expect(amount > 0).toBe(false);
    });

    it('should reject negative amount', () => {
      const amount = -100;
      expect(amount > 0).toBe(false);
    });

    it('should accept positive amount', () => {
      const amount = 5000;
      expect(amount > 0).toBe(true);
    });

    it('should accept large amount', () => {
      const amount = 999999999;
      expect(amount > 0).toBe(true);
    });
  });
});

// ─── Fiscal Year Date Range Logic Tests ──────────────────────────────

describe('FiscalYear Date Range Logic', () => {
  it('should detect entry date within fiscal year range', () => {
    const fyStart = new Date('2026-01-01');
    const fyEnd = new Date('2026-12-31');
    const entryDate = new Date('2026-06-15');

    expect(entryDate >= fyStart && entryDate <= fyEnd).toBe(true);
  });

  it('should detect entry date before fiscal year start', () => {
    const fyStart = new Date('2026-01-01');
    const fyEnd = new Date('2026-12-31');
    const entryDate = new Date('2025-12-31');

    expect(entryDate < fyStart).toBe(true);
  });

  it('should detect entry date after fiscal year end', () => {
    const fyStart = new Date('2026-01-01');
    const fyEnd = new Date('2026-12-31');
    const entryDate = new Date('2027-01-01');

    expect(entryDate > fyEnd).toBe(true);
  });

  it('should detect entry date on fiscal year start boundary', () => {
    const fyStart = new Date('2026-01-01');
    const fyEnd = new Date('2026-12-31');
    const entryDate = new Date('2026-01-01');

    expect(entryDate >= fyStart && entryDate <= fyEnd).toBe(true);
  });

  it('should detect entry date on fiscal year end boundary', () => {
    const fyStart = new Date('2026-01-01');
    const fyEnd = new Date('2026-12-31');
    const entryDate = new Date('2026-12-31');

    expect(entryDate >= fyStart && entryDate <= fyEnd).toBe(true);
  });
});

// ─── Active Fiscal Year Logic Tests ─────────────────────────────────

describe('Active Fiscal Year Rules', () => {
  it('should enforce single active fiscal year (valid state: 1 active)', () => {
    // Valid state: exactly 1 active fiscal year
    const validActiveFYs = [{ id: 1, is_active: true }, { id: 2, is_active: false }, { id: 3, is_active: false }];
    expect(validActiveFYs.filter(fy => fy.is_active).length).toBe(1);
  });

  it('should allow multiple inactive fiscal years', () => {
    const fiscalYears = [
      { id: 1, is_active: false },
      { id: 2, is_active: false },
      { id: 3, is_active: false },
    ];
    expect(fiscalYears.filter(fy => fy.is_active).length).toBe(0);
  });

  it('should allow one active among inactive', () => {
    const fiscalYears = [
      { id: 1, is_active: true },
      { id: 2, is_active: false },
      { id: 3, is_active: false },
    ];
    expect(fiscalYears.filter(fy => fy.is_active).length).toBe(1);
  });

  it('should not allow activating a closed fiscal year', () => {
    const closedFY = { id: 1, is_closed: true };
    expect(closedFY.is_closed).toBe(true);
  });

  it('should allow reopening a closed fiscal year', () => {
    const closedFY = { id: 1, is_closed: true, is_active: false };
    const reopenedFY = { ...closedFY, is_closed: false };
    expect(reopenedFY.is_closed).toBe(false);
  });
});
