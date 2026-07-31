import { describe, expect, it } from 'vitest';
import {
  calculateAppointmentCharge,
  normalizeAppointmentType,
} from '../../src/lib/appointment-daily-flow';
import { normalizeCommissionRuleRateValue } from '../../src/lib/lab-finance';

describe('basic daily appointment calculations', () => {
  it('resolves new patient, old patient, follow up, report show, free, and emergency fees', () => {
    expect(calculateAppointmentCharge({
      baseFee: 500,
      configuredFee: null,
      appointmentType: 'new_patient',
      discountAmount: 0,
    })).toMatchObject({ originalFee: 500, discountAmount: 0, finalFee: 500, billingStatus: 'unpaid' });

    expect(calculateAppointmentCharge({
      baseFee: 500,
      configuredFee: 450,
      appointmentType: 'old_patient',
      discountAmount: 0,
    })).toMatchObject({ originalFee: 450, discountAmount: 0, finalFee: 450, billingStatus: 'unpaid' });

    expect(calculateAppointmentCharge({
      baseFee: 500,
      configuredFee: 300,
      appointmentType: 'follow_up',
      discountAmount: 0,
    })).toMatchObject({ originalFee: 300, discountAmount: 0, finalFee: 300, billingStatus: 'unpaid' });

    expect(calculateAppointmentCharge({
      baseFee: 500,
      configuredFee: null,
      appointmentType: 'report_show',
      discountAmount: 0,
    })).toMatchObject({ originalFee: 0, discountAmount: 0, finalFee: 0, billingStatus: 'no_charge' });

    expect(calculateAppointmentCharge({
      baseFee: 500,
      configuredFee: 400,
      appointmentType: 'free_visit',
      discountAmount: 0,
    })).toMatchObject({ originalFee: 400, discountAmount: 400, finalFee: 0, billingStatus: 'no_charge' });

    expect(calculateAppointmentCharge({
      baseFee: 500,
      configuredFee: 800,
      appointmentType: 'emergency',
      discountAmount: 0,
    })).toMatchObject({ originalFee: 800, discountAmount: 0, finalFee: 800, billingStatus: 'unpaid' });
  });

  it('saves original fee, discount, and final payable for discounted appointments', () => {
    expect(calculateAppointmentCharge({
      baseFee: 500,
      configuredFee: null,
      appointmentType: 'discounted_visit',
      discountAmount: 100,
    })).toMatchObject({
      originalFee: 500,
      discountAmount: 100,
      finalFee: 400,
      billingStatus: 'unpaid',
    });
  });

  it('normalizes old visit types without expanding the constrained visit_type column', () => {
    expect(normalizeAppointmentType('opd')).toBe('new_patient');
    expect(normalizeAppointmentType('old')).toBe('old_patient');
    expect(normalizeAppointmentType('followup')).toBe('follow_up');
    expect(normalizeAppointmentType('report_show')).toBe('report_show');
    expect(normalizeAppointmentType('emergency')).toBe('emergency');
  });
});

describe('commission rule rate normalization', () => {
  it('treats user-entered percent values as percentages while preserving basis points', () => {
    expect(normalizeCommissionRuleRateValue('percent', 20)).toBe(2000);
    expect(normalizeCommissionRuleRateValue('percent', 1250)).toBe(1250);
    expect(normalizeCommissionRuleRateValue('flat', 200)).toBe(200);
  });
});
