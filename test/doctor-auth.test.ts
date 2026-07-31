import { describe, it, expect } from 'vitest';
import { doctorRegisterSchema, doctorLoginSchema } from '../src/schemas/marketplace';

describe('Doctor Auth', () => {
  describe('Registration Validation', () => {
    it('should accept valid registration with email', () => {
      const result = doctorRegisterSchema.safeParse({
        name: 'Dr. Rahman',
        email: 'dr.rahman@example.com',
        password: 'SecurePass123!',
        specialty: 'Cardiology',
        bmdc_registration: 'A-12345',
        chamber_name: "Dr. Rahman's Chamber",
        chamber_address: '123 Main St, Dhaka',
        consultation_fee: 1000,
        schedule: [
          { day_of_week: 0, start_time: '09:00', end_time: '13:00', max_patients: 20 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should accept registration with phone instead of email', () => {
      const result = doctorRegisterSchema.safeParse({
        name: 'Dr. Karim',
        phone: '+8801712345678',
        password: 'SecurePass123!',
        specialty: 'Dermatology',
        bmdc_registration: 'B-67890',
        chamber_name: "Dr. Karim's Skin Clinic",
        chamber_address: '456 Park Ave, Dhaka',
        consultation_fee: 800,
        schedule: [],
      });
      expect(result.success).toBe(true);
    });

    it('should reject short password', () => {
      const result = doctorRegisterSchema.safeParse({
        name: 'Dr. Test',
        email: 'test@test.com',
        password: '123',
        specialty: 'Test',
        bmdc_registration: 'X-1',
        chamber_name: 'Test Chamber',
        chamber_address: '123 Test St',
        consultation_fee: 500,
        schedule: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative consultation fee', () => {
      const result = doctorRegisterSchema.safeParse({
        name: 'Dr. Test',
        email: 'test@test.com',
        password: 'SecurePass123!',
        specialty: 'Test',
        bmdc_registration: 'X-1',
        chamber_name: 'Test Chamber',
        chamber_address: '123 Test St',
        consultation_fee: -1000,
        schedule: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Login Validation', () => {
    it('should accept login with email', () => {
      const result = doctorLoginSchema.safeParse({
        email: 'dr.rahman@example.com',
        password: 'SecurePass123!',
      });
      expect(result.success).toBe(true);
    });

    it('should accept login with phone', () => {
      const result = doctorLoginSchema.safeParse({
        phone: '+8801712345678',
        password: 'SecurePass123!',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Tenant Slug Generation', () => {
    function generateSlug(name: string): string {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 50);
    }

    it('should generate slug from chamber name', () => {
      expect(generateSlug("Dr. Rahman's Chamber")).toBe('dr-rahmans-chamber');
    });

    it('should handle special characters', () => {
      expect(generateSlug('Dr. ABC (Cardio) Clinic!')).toBe('dr-abc-cardio-clinic');
    });

    it('should handle multiple spaces', () => {
      expect(generateSlug('My   Chamber   Name')).toBe('my-chamber-name');
    });
  });
});
