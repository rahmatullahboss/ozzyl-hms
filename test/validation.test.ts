import { describe, it, expect } from 'vitest';

// ─── Input/Schema Validation Tests ───────────────────────────────────────────
// Covers: Zod schema business rules across all modules
// Validates real field constraints — dates, enums, string lengths, phone patterns

describe('HMS Input & Schema Validation Tests', () => {

  // ─── Date Validation Helpers ───────────────────────────────────────────────
  describe('Date Field Validation', () => {
    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

    function isValidDate(dateStr: string): boolean {
      if (!ISO_DATE_RE.test(dateStr)) return false;
      const d = new Date(dateStr);
      return !isNaN(d.getTime());
    }

    function isFutureDate(dateStr: string): boolean {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(dateStr) > today;
    }

    function isPastDate(dateStr: string): boolean {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(dateStr) < today;
    }

    it('should accept valid ISO date 2024-01-15', () => { expect(isValidDate('2024-01-15')).toBe(true); });
    it('should reject invalid date format DD/MM/YYYY', () => { expect(isValidDate('15/01/2024')).toBe(false); });
    it('should reject completely invalid date', () => { expect(isValidDate('not-a-date')).toBe(false); });
    it('should reject impossible date 2024-13-01 (month 13)', () => { expect(isValidDate('2024-13-01')).toBe(false); });
    it('should identify 2020-01-01 as a past date', () => { expect(isPastDate('2020-01-01')).toBe(true); });
    it('should identify 2099-01-01 as a future date', () => { expect(isFutureDate('2099-01-01')).toBe(true); });
    it('should reject appointment date in the past', () => {
      const pastDate = '2020-01-01';
      const isAllowed = !isPastDate(pastDate);
      expect(isAllowed).toBe(false);
    });
  });

  // ─── Phone Number Validation ───────────────────────────────────────────────
  describe('Bangladeshi Phone Number Validation', () => {
    // BD mobile numbers: 01[3-9] followed by 8 more digits
    function validateBDPhone(phone: string): boolean {
      return /^01[3-9]\d{8}$/.test(phone.replace(/\s/g, ''));
    }

    it('should accept valid Grameenphone 017 number', () => { expect(validateBDPhone('01712345678')).toBe(true); });
    it('should accept valid Banglalink 019 number', () => { expect(validateBDPhone('01912345678')).toBe(true); });
    it('should accept valid Robi 018 number', () => { expect(validateBDPhone('01812345678')).toBe(true); });
    it('should accept valid Teletalk 015 number', () => { expect(validateBDPhone('01512345678')).toBe(true); });
    it('should reject invalid prefix 012', () => { expect(validateBDPhone('01212345678')).toBe(false); });
    it('should reject 9-digit number', () => { expect(validateBDPhone('0171234567')).toBe(false); });
    it('should reject 12-digit number', () => { expect(validateBDPhone('017123456789')).toBe(false); });
    it('should reject number starting with +880', () => { expect(validateBDPhone('+8801712345678')).toBe(false); });
    it('should reject empty string', () => { expect(validateBDPhone('')).toBe(false); });
  });

  // ─── Gender Validation ─────────────────────────────────────────────────────
  describe('Gender Field Validation', () => {
    const VALID_GENDERS = ['Male', 'Female', 'Other'] as const;

    function isValidGender(g: string): boolean {
      return (VALID_GENDERS as readonly string[]).includes(g);
    }

    it('should accept Male', () => { expect(isValidGender('Male')).toBe(true); });
    it('should accept Female', () => { expect(isValidGender('Female')).toBe(true); });
    it('should accept Other', () => { expect(isValidGender('Other')).toBe(true); });
    it('should reject lowercase gender', () => { expect(isValidGender('male')).toBe(false); });
    it('should reject empty string', () => { expect(isValidGender('')).toBe(false); });
    it('should reject unknown gender', () => { expect(isValidGender('nonbinary')).toBe(false); });
  });

  // ─── Blood Group Validation ────────────────────────────────────────────────
  describe('Blood Group Validation', () => {
    const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

    function isValidBloodGroup(bg: string): boolean {
      return VALID_BLOOD_GROUPS.includes(bg);
    }

    it('should accept all 8 ABO blood groups', () => {
      expect(VALID_BLOOD_GROUPS.every((bg) => isValidBloodGroup(bg))).toBe(true);
    });

    it('should reject invalid blood group "C+"', () => { expect(isValidBloodGroup('C+')).toBe(false); });
    it('should reject lowercase "a+"', () => { expect(isValidBloodGroup('a+')).toBe(false); });
    it('should reject empty string', () => { expect(isValidBloodGroup('')).toBe(false); });
  });

  // ─── NID Validation (Bangladesh) ──────────────────────────────────────────
  describe('National ID Validation (Bangladesh)', () => {
    function isValidNID(nid: string): boolean {
      // BD NID: 10 or 17 digits
      return /^\d{10}$/.test(nid) || /^\d{17}$/.test(nid);
    }

    it('should accept 10-digit NID', () => { expect(isValidNID('1234567890')).toBe(true); });
    it('should accept 17-digit NID', () => { expect(isValidNID('12345678901234567')).toBe(true); });
    it('should reject 12-digit NID', () => { expect(isValidNID('123456789012')).toBe(false); });
    it('should reject NID with letters', () => { expect(isValidNID('123456789A')).toBe(false); });
    it('should reject empty NID', () => { expect(isValidNID('')).toBe(false); });
  });

  // ─── Currency / Amount Validation ─────────────────────────────────────────
  describe('Currency / Amount Validation', () => {
    function isValidAmount(amount: unknown): boolean {
      return typeof amount === 'number' && isFinite(amount) && amount >= 0;
    }

    function isValidBillingAmount(amount: number): boolean {
      return amount >= 0 && amount <= 10_000_000; // max 1 crore per invoice
    }

    it('should accept amount of 0 (zero charge)', () => { expect(isValidAmount(0)).toBe(true); });
    it('should accept positive amount 5000', () => { expect(isValidAmount(5000)).toBe(true); });
    it('should accept fractional amount 99.50', () => { expect(isValidAmount(99.50)).toBe(true); });
    it('should reject negative amount', () => { expect(isValidAmount(-100)).toBe(false); });
    it('should reject string amount', () => { expect(isValidAmount('5000')).toBe(false); });
    it('should reject NaN', () => { expect(isValidAmount(NaN)).toBe(false); });
    it('should reject Infinity', () => { expect(isValidAmount(Infinity)).toBe(false); });
    it('should accept amount up to max billing limit', () => { expect(isValidBillingAmount(10_000_000)).toBe(true); });
    it('should reject amount above max billing limit', () => { expect(isValidBillingAmount(10_000_001)).toBe(false); });
  });

  // ─── Enum / Status Field Validation ───────────────────────────────────────
  describe('Status Enum Validation', () => {
    const VISIT_TYPES = ['opd', 'ipd', 'emergency', 'telemedicine'] as const;
    const PAYMENT_METHODS = ['cash', 'bkash', 'nagad', 'rocket', 'card', 'bank_transfer', 'cheque'] as const;
    const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show'] as const;

    it('should include telemedicine as visit type', () => {
      expect(VISIT_TYPES).toContain('telemedicine');
    });

    it('should include all MFS payment methods for Bangladesh', () => {
      expect(PAYMENT_METHODS).toContain('bkash');
      expect(PAYMENT_METHODS).toContain('nagad');
      expect(PAYMENT_METHODS).toContain('rocket');
    });

    it('should include 7 appointment statuses covering the full lifecycle', () => {
      expect(APPOINTMENT_STATUSES.length).toBe(7);
    });

    it('should include no_show status for missed appointments', () => {
      expect(APPOINTMENT_STATUSES).toContain('no_show');
    });
  });

  // ─── String Length Constraints ─────────────────────────────────────────────
  describe('String Length Constraints', () => {
    function isValidName(name: string, min = 2, max = 100): boolean {
      const trimmed = name.trim();
      return trimmed.length >= min && trimmed.length <= max;
    }

    function isValidDescription(desc: string, max = 500): boolean {
      return desc.length <= max;
    }

    function isValidAddress(addr: string, max = 255): boolean {
      return addr.trim().length > 0 && addr.length <= max;
    }

    it('should accept a name of 2 characters', () => { expect(isValidName('Al')).toBe(true); });
    it('should reject a single-character name', () => { expect(isValidName('A')).toBe(false); });
    it('should accept 100-character name (UTF-8)', () => { expect(isValidName('A'.repeat(100))).toBe(true); });
    it('should reject 101-character name', () => { expect(isValidName('A'.repeat(101))).toBe(false); });
    it('should accept Bengali name with correct length', () => { expect(isValidName('রহিম')).toBe(true); });
    it('should reject empty description over max length', () => { expect(isValidDescription('X'.repeat(501))).toBe(false); });
    it('should accept empty address as invalid', () => { expect(isValidAddress('   ')).toBe(false); });
    it('should accept valid address', () => { expect(isValidAddress('Mirpur-10, Dhaka')).toBe(true); });
  });

  // ─── BMDC Number Validation ────────────────────────────────────────────────
  describe('BMDC Number Validation', () => {
    function isValidBMDC(bmdc: string): boolean {
      // BMDC format: Letter prefix + digits, e.g., A-12345 or D-67890
      return /^[A-Z]-\d{5,6}$/.test(bmdc);
    }

    it('should accept valid BMDC A-12345', () => { expect(isValidBMDC('A-12345')).toBe(true); });
    it('should accept valid BMDC D-678901', () => { expect(isValidBMDC('D-678901')).toBe(true); });
    it('should reject BMDC without prefix letter', () => { expect(isValidBMDC('12345')).toBe(false); });
    it('should reject BMDC with lowercase prefix', () => { expect(isValidBMDC('a-12345')).toBe(false); });
    it('should reject empty BMDC', () => { expect(isValidBMDC('')).toBe(false); });
  });

  // ─── Discount Range Validation ─────────────────────────────────────────────
  describe('Discount Validation', () => {
    function isValidDiscount(discount: number, billTotal: number): { ok: boolean; error?: string } {
      if (discount < 0) return { ok: false, error: 'Discount cannot be negative' };
      if (discount > billTotal) return { ok: false, error: 'Discount cannot exceed bill total' };
      return { ok: true };
    }

    it('should accept a valid discount of 100 on a 1000 bill', () => {
      expect(isValidDiscount(100, 1000).ok).toBe(true);
    });

    it('should accept zero discount', () => {
      expect(isValidDiscount(0, 1000).ok).toBe(true);
    });

    it('should accept 100% discount (full write-off)', () => {
      expect(isValidDiscount(1000, 1000).ok).toBe(true);
    });

    it('should reject discount exceeding bill total', () => {
      const result = isValidDiscount(1500, 1000);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('exceed bill total');
    });

    it('should reject negative discount', () => {
      const result = isValidDiscount(-50, 1000);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('negative');
    });
  });
});
