import { describe, expect, it } from 'vitest';
import {
  calculateDoctorCommissionWaiver,
  normalizeDoctorCommissionWaiverConfiguration,
} from '../src/lib/doctor-commission-waiver-policy';

describe('doctor commission waiver policy', () => {
  it('protects 5% of the commission base from a 25% commission rule', () => {
    expect(calculateDoctorCommissionWaiver({
      commissionBaseAmount: 1000,
      earnedCommissionAmount: 250,
      rateType: 'percent',
      commissionRateValue: 2500,
      waiverPolicy: 'protected_floor',
      protectedRateBps: 500,
      requestedWaiverAmount: 500,
    })).toEqual({
      earnedCommissionAmount: 250,
      protectedCommissionAmount: 50,
      maximumWaiverAmount: 200,
      requestedWaiverAmount: 500,
      doctorWaiverAmount: 200,
      payableCommissionAmount: 50,
      overflowWaiverAmount: 300,
    });
  });

  it('preserves legacy full-earned waiver behavior by default', () => {
    expect(calculateDoctorCommissionWaiver({
      commissionBaseAmount: 1000,
      earnedCommissionAmount: 250,
      rateType: 'percent',
      commissionRateValue: 2500,
      requestedWaiverAmount: 500,
    })).toMatchObject({
      protectedCommissionAmount: 0,
      maximumWaiverAmount: 250,
      doctorWaiverAmount: 250,
      payableCommissionAmount: 0,
      overflowWaiverAmount: 250,
    });
  });

  it('protects all earned commission when doctor waiver is disabled', () => {
    expect(calculateDoctorCommissionWaiver({
      commissionBaseAmount: 1000,
      earnedCommissionAmount: 250,
      rateType: 'percent',
      commissionRateValue: 2500,
      waiverPolicy: 'no_doctor_waiver',
      requestedWaiverAmount: 500,
    })).toMatchObject({
      protectedCommissionAmount: 250,
      maximumWaiverAmount: 0,
      doctorWaiverAmount: 0,
      payableCommissionAmount: 250,
      overflowWaiverAmount: 500,
    });
  });

  it('supports a protected flat amount for flat commission rules', () => {
    expect(calculateDoctorCommissionWaiver({
      commissionBaseAmount: 1000,
      earnedCommissionAmount: 250,
      rateType: 'flat',
      commissionRateValue: 250,
      waiverPolicy: 'protected_floor',
      protectedFlatAmount: 50,
      requestedWaiverAmount: 300,
    })).toMatchObject({
      protectedCommissionAmount: 50,
      maximumWaiverAmount: 200,
      doctorWaiverAmount: 200,
      payableCommissionAmount: 50,
      overflowWaiverAmount: 100,
    });
  });

  it('normalizes percentage policy values and rejects a floor above commission', () => {
    expect(normalizeDoctorCommissionWaiverConfiguration({
      rateType: 'percent',
      commissionRateValue: 2500,
      waiverPolicy: 'protected_floor',
      protectedRate: 5,
    })).toEqual({
      waiverPolicy: 'protected_floor',
      protectedRateBps: 500,
      protectedFlatAmount: 0,
    });

    expect(() => normalizeDoctorCommissionWaiverConfiguration({
      rateType: 'percent',
      commissionRateValue: 2500,
      waiverPolicy: 'protected_floor',
      protectedRate: 30,
    })).toThrow('Protected commission rate cannot exceed the commission rate');
  });

  it('rejects a protected flat amount above the flat commission', () => {
    expect(() => normalizeDoctorCommissionWaiverConfiguration({
      rateType: 'flat',
      commissionRateValue: 250,
      waiverPolicy: 'protected_floor',
      protectedFlatAmount: 300,
    })).toThrow('Protected commission amount cannot exceed the flat commission');
  });
});
