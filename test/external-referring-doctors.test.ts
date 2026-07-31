import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ─── Appointment schema with external referring doctor ──────────────────────
import { createAppointmentSchema } from '../src/schemas/appointment';

function expectValid<T>(schema: z.ZodType<T>, data: unknown, label?: string): T {
  const result = schema.safeParse(data);
  expect(result.success, `${label ?? 'schema'} should be valid — errors: ${
    result.success ? '' : JSON.stringify(result.error.flatten())
  }`).toBe(true);
  return (result as z.SafeParseSuccess<T>).data;
}

function expectInvalid<T>(schema: z.ZodType<T>, data: unknown, label?: string): void {
  const result = schema.safeParse(data);
  expect(result.success, `${label ?? 'schema'} should be invalid`).toBe(false);
}

describe('External Referring Doctors', () => {

  // ─── Create Schema Validation ─────────────────────────────────────────────
  describe('Create External Referring Doctor Schema', () => {
    const createSchema = z.object({
      name: z.string().trim().min(1).max(200),
      phone: z.string().trim().max(20).optional(),
      chamber: z.string().trim().max(300).optional(),
      specialty: z.string().trim().max(100).optional(),
    });

    it('accepts valid data with all fields', () => {
      const data = {
        name: 'Dr. Karim',
        phone: '01712345678',
        chamber: 'Dhaka Medical',
        specialty: 'Cardiology',
      };
      expectValid(createSchema, data, 'createSchema (all fields)');
    });

    it('accepts valid data with only name', () => {
      const data = { name: 'Dr. Rahim' };
      expectValid(createSchema, data, 'createSchema (name only)');
    });

    it('rejects empty name', () => {
      const data = { name: '' };
      expectInvalid(createSchema, data, 'createSchema (empty name)');
    });

    it('rejects missing name', () => {
      const data = { phone: '01712345678' };
      expectInvalid(createSchema, data, 'createSchema (no name)');
    });

    it('rejects name over 200 chars', () => {
      const data = { name: 'A'.repeat(201) };
      expectInvalid(createSchema, data, 'createSchema (long name)');
    });

    it('rejects phone over 20 chars', () => {
      const data = { name: 'Dr. Test', phone: '1'.repeat(21) };
      expectInvalid(createSchema, data, 'createSchema (long phone)');
    });

    it('rejects chamber over 300 chars', () => {
      const data = { name: 'Dr. Test', chamber: 'A'.repeat(301) };
      expectInvalid(createSchema, data, 'createSchema (long chamber)');
    });

    it('rejects specialty over 100 chars', () => {
      const data = { name: 'Dr. Test', specialty: 'A'.repeat(101) };
      expectInvalid(createSchema, data, 'createSchema (long specialty)');
    });
  });

  // ─── Update Schema Validation ─────────────────────────────────────────────
  describe('Update External Referring Doctor Schema', () => {
    const updateSchema = z.object({
      name: z.string().trim().min(1).max(200).optional(),
      phone: z.string().trim().max(20).optional(),
      chamber: z.string().trim().max(300).optional(),
      specialty: z.string().trim().max(100).optional(),
    });

    it('accepts partial update with name only', () => {
      expectValid(updateSchema, { name: 'Updated Name' }, 'updateSchema (name)');
    });

    it('accepts partial update with phone only', () => {
      expectValid(updateSchema, { phone: '01812345678' }, 'updateSchema (phone)');
    });

    it('accepts empty update', () => {
      expectValid(updateSchema, {}, 'updateSchema (empty)');
    });

    it('rejects empty name if provided', () => {
      expectInvalid(updateSchema, { name: '' }, 'updateSchema (empty name)');
    });
  });

  // ─── Appointment Schema with externalReferringDoctorId ────────────────────
  describe('Appointment Schema - externalReferringDoctorId', () => {
    const validBase = {
      patientId: 1,
      apptDate: '2026-05-19',
    };

    it('accepts appointment without externalReferringDoctorId', () => {
      expectValid(createAppointmentSchema, validBase, 'no externalRefDoctor');
    });

    it('accepts appointment with externalReferringDoctorId', () => {
      const data = { ...validBase, externalReferringDoctorId: 5 };
      const result = expectValid(createAppointmentSchema, data, 'with externalRefDoctor');
      expect(result.externalReferringDoctorId).toBe(5);
    });

    it('accepts appointment with externalReferringDoctorId as undefined', () => {
      const data = { ...validBase, externalReferringDoctorId: undefined };
      expectValid(createAppointmentSchema, data, 'externalRefDoctor undefined');
    });

    it('rejects externalReferringDoctorId of 0', () => {
      const data = { ...validBase, externalReferringDoctorId: 0 };
      expectInvalid(createAppointmentSchema, data, 'externalRefDoctor 0');
    });

    it('rejects negative externalReferringDoctorId', () => {
      const data = { ...validBase, externalReferringDoctorId: -1 };
      expectInvalid(createAppointmentSchema, data, 'externalRefDoctor negative');
    });

    it('rejects non-integer externalReferringDoctorId', () => {
      const data = { ...validBase, externalReferringDoctorId: 1.5 };
      expectInvalid(createAppointmentSchema, data, 'externalRefDoctor float');
    });

    it('accepts appointment with both doctorId and externalReferringDoctorId', () => {
      const data = {
        ...validBase,
        doctorId: 10,
        externalReferringDoctorId: 5,
      };
      const result = expectValid(createAppointmentSchema, data, 'both doctors');
      expect(result.doctorId).toBe(10);
      expect(result.externalReferringDoctorId).toBe(5);
    });
  });
});
