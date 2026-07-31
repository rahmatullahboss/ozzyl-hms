import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDoctorSchema, updateDoctorSchema } from '../src/schemas/doctor';

describe('Doctor consultationFee minimum validation', () => {
  it('accepts fee of 100 BDT (minimum boundary)', () => {
    const result = createDoctorSchema.safeParse({ name: 'Dr. A', consultationFee: 100 });
    expect(result.success).toBe(true);
  });

  it('accepts fee above 100 BDT', () => {
    const result = createDoctorSchema.safeParse({ name: 'Dr. A', consultationFee: 500 });
    expect(result.success).toBe(true);
  });

  it('rejects fee of 0 BDT', () => {
    const result = createDoctorSchema.safeParse({ name: 'Dr. A', consultationFee: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects fee below 100 BDT', () => {
    const result = createDoctorSchema.safeParse({ name: 'Dr. A', consultationFee: 50 });
    expect(result.success).toBe(false);
  });

  it('rejects fee of 99 BDT', () => {
    const result = createDoctorSchema.safeParse({ name: 'Dr. A', consultationFee: 99 });
    expect(result.success).toBe(false);
  });

  it('rejects negative fee', () => {
    const result = createDoctorSchema.safeParse({ name: 'Dr. A', consultationFee: -100 });
    expect(result.success).toBe(false);
  });

  it('update schema also enforces minimum 100 BDT', () => {
    const result = updateDoctorSchema.safeParse({ consultationFee: 50 });
    expect(result.success).toBe(false);
  });

  it('update schema accepts fee >= 100 BDT', () => {
    const result = updateDoctorSchema.safeParse({ consultationFee: 200 });
    expect(result.success).toBe(true);
  });
});

describe('Doctor IPD round fee validation', () => {
  it('accepts zero or a positive whole-BDT round fee', () => {
    expect(createDoctorSchema.safeParse({ name: 'Dr. A', consultationFee: 500, ipdRoundFee: 0 }).success).toBe(true);
    expect(createDoctorSchema.safeParse({ name: 'Dr. A', consultationFee: 500, ipdRoundFee: 700 }).success).toBe(true);
  });

  it('rejects negative and fractional round fees', () => {
    expect(createDoctorSchema.safeParse({ name: 'Dr. A', consultationFee: 500, ipdRoundFee: -1 }).success).toBe(false);
    expect(updateDoctorSchema.safeParse({ ipdRoundFee: 700.5 }).success).toBe(false);
  });

  it('persists the round fee in doctor create and update SQL', () => {
    const route = readFileSync(new URL('../src/routes/tenant/doctors.ts', import.meta.url), 'utf8');

    expect(route).toMatch(/INSERT INTO doctors[\s\S]+ipd_round_fee/);
    expect(route).toMatch(/UPDATE doctors SET[\s\S]+ipd_round_fee = \?/);
    expect(route).toMatch(/SELECT[\s\S]+ipd_round_fee[\s\S]+FROM doctors/);
  });
});
