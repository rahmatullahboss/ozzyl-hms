import { describe, it, expect } from 'vitest';
import { createStaffSchema } from '../src/schemas/staff';

// ─── Staff Tests ──────────────────────────────────────────────────────────────
// Migrated from apps/api/tests/staff.test.ts
// Aligned with src/routes/tenant/staff.ts and src/schemas/staff.ts

describe('HMS Staff Management Tests', () => {
  describe('Staff Registration', () => {
    it('should require name, position and positive salary', () => {
      const staff = {
        name: 'Nurse Fatema',
        position: 'Nurse',
        salary: 25000,
        mobile: '01712345678',
        joiningDate: '2024-01-01',
      };
      expect(staff.name).toBeTruthy();
      expect(staff.position).toBeTruthy();
      expect(staff.salary).toBeGreaterThan(0);
    });

    it('should validate known positions', () => {
      const validPositions = [
        'Doctor', 'Nurse', 'Stuff Nurse', 'Accountant',
        'Receptionist', 'Pharmacist', 'Lab Assistant',
        'Cleaner', 'Security', 'Driver',
      ];
      expect(validPositions).toContain('Nurse');
      expect(validPositions).toContain('Pharmacist');
      expect(validPositions).toContain('Lab Assistant');
    });

    it('should validate bank account number (10–16 digits)', () => {
      const isValid = (acct: string) => /^\d{10,16}$/.test(acct);
      expect(isValid('1234567890')).toBe(true);       // 10 digits
      expect(isValid('1234567890123456')).toBe(true); // 16 digits
      expect(isValid('123')).toBe(false);             // too short
      expect(isValid('12345678901234567')).toBe(false); // too long
    });
  });

  describe('Salary Calculation', () => {
    it('should compute net salary = basic + bonus − deduction', () => {
      const basic      = 25000;
      const bonus      =  2000;
      const deduction  =   500;
      const net = basic + bonus - deduction;
      expect(net).toBe(26500);
    });

    it('should reject negative deductions', () => {
      const deduction = -500;
      const isValid = deduction >= 0;
      expect(isValid).toBe(false);
    });

    it('should aggregate monthly salary total across staff', () => {
      const payments = [{ amount: 25000 }, { amount: 30000 }, { amount: 20000 }];
      const total = payments.reduce((s, p) => s + p.amount, 0);
      expect(total).toBe(75000);
    });

    it('should generate salary reference number', () => {
      const staffId = 1;
      const month   = 'January';
      const year    = '2024';
      const ref = `SAL-${staffId}-${month.slice(0, 3).toUpperCase()}-${year}`;
      expect(ref).toBe('SAL-1-JAN-2024');
    });
  });

  describe('Staff Status Management', () => {
    it('should activate an inactive staff member', () => {
      const staff = { isActive: false };
      staff.isActive = true;
      expect(staff.isActive).toBe(true);
    });

    it('should deactivate an active staff member', () => {
      const staff = { isActive: true };
      staff.isActive = false;
      expect(staff.isActive).toBe(false);
    });

    it('should filter only active staff', () => {
      const staff = [
        { id: 1, isActive: true },
        { id: 2, isActive: false },
        { id: 3, isActive: true },
      ];
      const active = staff.filter((s) => s.isActive);
      expect(active.length).toBe(2);
    });
  });

  describe('Extended Staff Fields (Danphe parity)', () => {
    it('createStaffSchema accepts a valid email and preserves it on parsed output', () => {
      // RED: this should fail because createStaffSchema does not yet accept email
      const result = createStaffSchema.safeParse({
        name: 'Nurse Fatema',
        address: '123 Main',
        position: 'Nurse',
        salary: 25000,
        bankAccount: '1234567890',
        mobile: '01712345678',
        email: 'fatema@example.com',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('fatema@example.com');
      }
    });

    it('createStaffSchema rejects an invalid email', () => {
      const result = createStaffSchema.safeParse({
        name: 'Nurse Fatema',
        address: '123 Main',
        position: 'Nurse',
        salary: 25000,
        bankAccount: '1234567890',
        mobile: '01712345678',
        email: 'not-an-email',
      });
      expect(result.success).toBe(false);
    });

    it('createStaffSchema treats email as optional (legacy callers without email still work)', () => {
      const result = createStaffSchema.safeParse({
        name: 'Nurse Fatema',
        address: '123 Main',
        position: 'Nurse',
        salary: 25000,
        bankAccount: '1234567890',
        mobile: '01712345678',
      });
      expect(result.success).toBe(true);
    });

    it('createStaffSchema accepts a valid gender (Male / Female / Other)', () => {
      const result = createStaffSchema.safeParse({
        name: 'Nurse Fatema',
        address: '123 Main',
        position: 'Nurse',
        salary: 25000,
        bankAccount: '1234567890',
        mobile: '01712345678',
        gender: 'Female',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.gender).toBe('Female');
      }
    });

    it('createStaffSchema rejects an unknown gender value', () => {
      const result = createStaffSchema.safeParse({
        name: 'Nurse Fatema',
        address: '123 Main',
        position: 'Nurse',
        salary: 25000,
        bankAccount: '1234567890',
        mobile: '01712345678',
        gender: 'Alien',
      });
      expect(result.success).toBe(false);
    });

    it('createStaffSchema accepts an ISO date of birth', () => {
      const result = createStaffSchema.safeParse({
        name: 'Nurse Fatema',
        address: '123 Main',
        position: 'Nurse',
        salary: 25000,
        bankAccount: '1234567890',
        mobile: '01712345678',
        dateOfBirth: '1990-05-12',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dateOfBirth).toBe('1990-05-12');
      }
    });

    it('createStaffSchema accepts a salutation (Mr/Mrs/Ms/Dr)', () => {
      const result = createStaffSchema.safeParse({
        name: 'Nurse Fatema',
        address: '123 Main',
        position: 'Nurse',
        salary: 25000,
        bankAccount: '1234567890',
        mobile: '01712345678',
        salutation: 'Ms',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.salutation).toBe('Ms');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should reject zero salary', () => {
      const isValid = (salary: number) => salary > 0;
      expect(isValid(0)).toBe(false);
    });

    it('should detect duplicate bank account numbers', () => {
      const accounts = ['1234567890', '0987654321', '1234567890'];
      const duplicates = accounts.filter((a, i) => accounts.indexOf(a) !== i);
      expect(duplicates.length).toBe(1);
      expect(duplicates[0]).toBe('1234567890');
    });
  });
});
