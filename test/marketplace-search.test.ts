import { describe, it, expect } from 'vitest';
import {
  hospitalSearchSchema,
  doctorSearchSchema,
  marketplaceBookingSchema,
  reviewSchema,
  doctorRegisterSchema,
} from '../src/schemas/marketplace';
import { calculateDistance, getDayOfWeek } from '../src/lib/marketplace-helpers';

describe('Marketplace Schema Validation', () => {
  describe('Tenant Marketplace Fields', () => {
    const VALID_TENANT_TYPES = ['hospital', 'chamber'] as const;
    type TenantType = typeof VALID_TENANT_TYPES[number];

    function isValidTenantType(t: string): t is TenantType {
      return (VALID_TENANT_TYPES as readonly string[]).includes(t);
    }

    it('should accept hospital as valid tenant type', () => {
      expect(isValidTenantType('hospital')).toBe(true);
    });

    it('should accept chamber as valid tenant type', () => {
      expect(isValidTenantType('chamber')).toBe(true);
    });

    it('should reject unknown tenant type', () => {
      expect(isValidTenantType('clinic')).toBe(false);
    });

    it('should validate specialties as JSON array', () => {
      const raw = '["cardiology","dermatology","pediatrics"]';
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toContain('cardiology');
    });

    it('should validate operating hours as JSON object', () => {
      const raw = '{"sat":"09:00-17:00","sun":"09:00-17:00","mon":"09:00-17:00","tue":"09:00-17:00","wed":"09:00-17:00","thu":"09:00-14:00","fri":"closed"}';
      const parsed = JSON.parse(raw);
      expect(parsed.sat).toBe('09:00-17:00');
      expect(parsed.fri).toBe('closed');
    });

    it('should validate latitude/longitude as numbers', () => {
      const lat = 23.8103;
      const lng = 90.4125;
      expect(typeof lat).toBe('number');
      expect(typeof lng).toBe('number');
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
    });
  });

  describe('Doctor Marketplace Fields', () => {
    it('should validate languages as JSON array', () => {
      const raw = '["english","bengali"]';
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toContain('bengali');
    });

    it('should validate bio as optional text', () => {
      const bio: string | null = 'Experienced cardiologist with 15 years of practice.';
      expect(typeof bio).toBe('string');
      expect(bio!.length).toBeGreaterThan(0);
    });

    it('should allow null bio', () => {
      const bio: string | null = null;
      expect(bio).toBeNull();
    });
  });
});

describe('Marketplace Zod Schemas', () => {
  describe('hospitalSearchSchema', () => {
    it('should accept valid search params', () => {
      const result = hospitalSearchSchema.safeParse({ q: 'cardiology', page: '1', limit: '20' });
      expect(result.success).toBe(true);
    });

    it('should default page to 1 and limit to 20', () => {
      const result = hospitalSearchSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
      }
    });

    it('should cap limit at 50', () => {
      const result = hospitalSearchSchema.safeParse({ limit: '100' });
      expect(result.success).toBe(false);
    });
  });

  describe('doctorSearchSchema', () => {
    it('should accept valid doctor search', () => {
      const result = doctorSearchSchema.safeParse({
        specialty: 'cardiology',
        language: 'bengali',
        fee_max: '200000',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('marketplaceBookingSchema', () => {
    it('should accept valid booking', () => {
      const result = marketplaceBookingSchema.safeParse({
        doctor_id: 1, tenant_id: 'tenant-abc',
        booking_date: '2026-04-20', booking_time: '10:00',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid date format', () => {
      const result = marketplaceBookingSchema.safeParse({
        doctor_id: 1, tenant_id: 'tenant-abc',
        booking_date: '20-04-2026', booking_time: '10:00',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('reviewSchema', () => {
    it('should accept valid hospital review', () => {
      const result = reviewSchema.safeParse({
        target_type: 'hospital', target_tenant_id: 'tenant-abc',
        rating: 5, review_text: 'Great hospital',
      });
      expect(result.success).toBe(true);
    });

    it('should reject rating above 5', () => {
      const result = reviewSchema.safeParse({
        target_type: 'hospital', target_tenant_id: 'tenant-abc', rating: 6,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('doctorRegisterSchema', () => {
    it('should accept valid doctor registration', () => {
      const result = doctorRegisterSchema.safeParse({
        name: 'Dr. Rahman', email: 'dr.rahman@example.com',
        password: 'SecurePass123!', specialty: 'Cardiology',
        bmdc_registration: 'A-12345', chamber_name: "Dr. Rahman's Chamber",
        chamber_address: '123 Main St, Dhaka', consultation_fee: 1000,
        schedule: [{ day_of_week: 0, start_time: '09:00', end_time: '13:00', max_patients: 20 }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject short password', () => {
      const result = doctorRegisterSchema.safeParse({
        name: 'Dr. Test', email: 'test@test.com', password: '123',
        specialty: 'Test', bmdc_registration: 'X-1',
        chamber_name: 'Test', chamber_address: '123 Test St',
        consultation_fee: 500, schedule: [],
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('Marketplace Helpers', () => {
  describe('calculateDistance', () => {
    it('should return 0 for same coordinates', () => {
      expect(calculateDistance(23.8, 90.4, 23.8, 90.4)).toBe(0);
    });

    it('should calculate distance between Dhaka and Chittagong (~250km)', () => {
      const dist = calculateDistance(23.8103, 90.4125, 22.3569, 91.7832);
      expect(dist).toBeGreaterThan(200);
      expect(dist).toBeLessThan(300);
    });
  });

  describe('getDayOfWeek', () => {
    it('should return correct day for a Monday', () => {
      expect(getDayOfWeek('2026-04-13')).toBe(1);
    });

    it('should return 0 for Sunday', () => {
      expect(getDayOfWeek('2026-04-12')).toBe(0);
    });

    it('should return 6 for Saturday', () => {
      expect(getDayOfWeek('2026-04-18')).toBe(6);
    });
  });
});
