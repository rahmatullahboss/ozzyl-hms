import { describe, it, expect } from 'vitest';
import { createPatientSchema, updatePatientSchema } from '../../src/schemas/patient';

describe('patient structured names', () => {
  describe('createPatientSchema', () => {
    const baseValid = {
      fatherHusband: 'Md Father',
      address: 'Dhaka',
      gender: 'male' as const,
      age: 30,
    };

    it('accepts firstName, middleName, lastName', () => {
      const result = createPatientSchema.safeParse({
        ...baseValid,
        name: 'Mohammad Karim Uddin',
        firstName: 'Mohammad',
        middleName: 'Karim',
        lastName: 'Uddin',
        mobile: '01712345678',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.firstName).toBe('Mohammad');
        expect(result.data.middleName).toBe('Karim');
        expect(result.data.lastName).toBe('Uddin');
      }
    });

    it('accepts firstName only (middleName and lastName optional)', () => {
      const result = createPatientSchema.safeParse({
        ...baseValid,
        name: 'Karim',
        firstName: 'Karim',
        mobile: '01712345678',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.firstName).toBe('Karim');
        expect(result.data.middleName).toBeUndefined();
        expect(result.data.lastName).toBeUndefined();
      }
    });

    it('auto-generates name from firstName + middleName + lastName if name not provided', () => {
      const result = createPatientSchema.safeParse({
        ...baseValid,
        firstName: 'Mohammad',
        middleName: 'Karim',
        lastName: 'Uddin',
        mobile: '01712345678',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Mohammad Karim Uddin');
      }
    });

    it('auto-generates name from firstName + lastName only', () => {
      const result = createPatientSchema.safeParse({
        ...baseValid,
        firstName: 'Mohammad',
        lastName: 'Uddin',
        mobile: '01712345678',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Mohammad Uddin');
      }
    });

    it('keeps existing name if provided alongside structured names', () => {
      const result = createPatientSchema.safeParse({
        ...baseValid,
        name: 'Custom Display Name',
        firstName: 'Mohammad',
        lastName: 'Uddin',
        mobile: '01712345678',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Custom Display Name');
      }
    });

    it('still works with legacy name-only format (backward compatible)', () => {
      const result = createPatientSchema.safeParse({
        ...baseValid,
        name: 'Mohammad Karim Uddin',
        mobile: '01712345678',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Mohammad Karim Uddin');
        expect(result.data.firstName).toBeUndefined();
      }
    });

    it('rejects if neither name nor firstName is provided', () => {
      const result = createPatientSchema.safeParse({
        ...baseValid,
        mobile: '01712345678',
      });
      expect(result.success).toBe(false);
    });

    it('trims whitespace from structured names', () => {
      const result = createPatientSchema.safeParse({
        ...baseValid,
        firstName: '  Mohammad  ',
        middleName: '  Karim  ',
        lastName: '  Uddin  ',
        mobile: '01712345678',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.firstName).toBe('Mohammad');
        expect(result.data.middleName).toBe('Karim');
        expect(result.data.lastName).toBe('Uddin');
      }
    });
  });

  describe('updatePatientSchema', () => {
    it('allows updating structured names independently', () => {
      const result = updatePatientSchema.safeParse({
        firstName: 'Updated',
      });
      expect(result.success).toBe(true);
    });

    it('allows clearing middleName', () => {
      const result = updatePatientSchema.safeParse({
        middleName: '',
      });
      expect(result.success).toBe(true);
    });
  });
});
