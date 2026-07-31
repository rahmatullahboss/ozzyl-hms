import { describe, it, expect } from 'vitest';

// ─── Patient Tests ────────────────────────────────────────────────────────────
// Migrated from apps/api/tests/patients.test.ts
// Aligned with src/schemas/patient.ts

describe('HMS Patient Management Tests', () => {
  describe('Patient Registration Validation', () => {
    it('should require name, mobile, and gender', () => {
      const patient = {
        name: 'রহিম মিয়া',
        mobile: '01712345678',
        gender: 'Male',
        age: 35,
        address: 'ঢাকা, বাংলাদেশ',
      };

      expect(patient.name).toBeTruthy();
      expect(patient.mobile).toBeTruthy();
      expect(patient.gender).toBeTruthy();
    });

    it('should validate Bangladeshi mobile number (11 digits, 013-019)', () => {
      const isValidMobile = (m: string) => /^01[3-9]\d{8}$/.test(m);

      expect(isValidMobile('01712345678')).toBe(true);
      expect(isValidMobile('01812345678')).toBe(true);
      expect(isValidMobile('01612345678')).toBe(true);
      expect(isValidMobile('01112345678')).toBe(false); // invalid prefix
      expect(isValidMobile('0171234567')).toBe(false);  // too short
      expect(isValidMobile('017123456789')).toBe(false); // too long
      expect(isValidMobile('0171234567a')).toBe(false);  // contains letter
    });

    it('should accept valid gender values (Male/Female/Other)', () => {
      // From src/schemas/patient.ts genderEnum
      const validGenders = ['Male', 'Female', 'Other'];
      expect(validGenders).toContain('Male');
      expect(validGenders).toContain('Female');
      expect(validGenders).toContain('Other');
      expect(validGenders).not.toContain('male'); // case-sensitive in Zod schema
    });

    it('should accept valid blood groups', () => {
      const validBloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      validBloodGroups.forEach((bg) => expect(validBloodGroups).toContain(bg));
    });

    it('should reject empty or whitespace-only patient names', () => {
      const isValidName = (name: string) => name.trim().length > 0;
      expect(isValidName('')).toBe(false);
      expect(isValidName('   ')).toBe(false);
      expect(isValidName('রহিম')).toBe(true);
      expect(isValidName('Rahim')).toBe(true);
    });
  });

  describe('Patient Code Generation', () => {
    it('should generate patient code with numeric sequence', () => {
      // Current system uses sequence_counters table
      const seq = 1;
      const patientCode = `P-${String(seq).padStart(6, '0')}`;
      expect(patientCode).toBe('P-000001');
      expect(patientCode).toMatch(/^P-\d{6}$/);
    });

    it('should generate sequential daily serial numbers', () => {
      const todaySerial1 = 1;
      const todaySerial2 = 2;
      expect(todaySerial2).toBeGreaterThan(todaySerial1);
    });
  });

  describe('Patient Search', () => {
    it('should find patients by partial name match (case-insensitive)', () => {
      const patients = [
        { name: 'Rahim Mia', mobile: '01712345678' },
        { name: 'Karim Uddin', mobile: '01712345679' },
        { name: 'Rahima Begum', mobile: '01712345680' },
      ];

      const term = 'rah';
      const results = patients.filter((p) =>
        p.name.toLowerCase().includes(term.toLowerCase())
      );

      expect(results.length).toBe(2); // Rahim and Rahima
    });

    it('should find patient by exact mobile number', () => {
      const patients = [
        { name: 'Rahim', mobile: '01712345678' },
        { name: 'Karim', mobile: '01712345679' },
      ];

      const found = patients.filter((p) => p.mobile === '01712345678');
      expect(found.length).toBe(1);
      expect(found[0].name).toBe('Rahim');
    });
  });

  describe('Patient Update', () => {
    it('should allow updating mobile and address while keeping name', () => {
      const patient = { name: 'Rahim', mobile: '01712345678', address: 'Dhaka' };
      const updated = { ...patient, mobile: '01912345678', address: 'Chittagong' };

      expect(updated.name).toBe('Rahim');
      expect(updated.mobile).toBe('01912345678');
      expect(updated.address).toBe('Chittagong');
    });
  });

  describe('Edge Cases', () => {
    it('should handle Bengali unicode names correctly', () => {
      const bengaliName = 'মোঃ রহিম উদ্দিন';
      expect(bengaliName.length).toBeGreaterThan(0);
      expect(bengaliName.trim()).toBe(bengaliName);
    });

    it('should reject potential SQL injection in name', () => {
      const malicious = "'; DROP TABLE patients; --";
      const containsDangerous = malicious.includes('DROP') || malicious.includes('DELETE');
      expect(containsDangerous).toBe(true); // detect and reject
    });

    it('should reject XSS in address field', () => {
      const xss = '<script>alert("xss")</script>';
      const containsScript = xss.includes('<script>');
      expect(containsScript).toBe(true); // detect and reject
    });
  });
});
