import { describe, expect, it } from 'vitest';
import {
  applyDoctorCommissionRulePreset,
  buildDoctorCommissionRulePayload,
  doctorCommissionRuleToForm,
  getInitialDoctorCommissionRuleForm,
  getMaximumDoctorWaiverValue,
  setDoctorCommissionRuleRateType,
} from './commissionRuleForm';

describe('commission rule form helpers', () => {
  it('defaults diagnostic test rules to the ordering/referring doctor role', () => {
    const form = getInitialDoctorCommissionRuleForm('2026-06-27');

    expect(form.serviceType).toBe('lab_test');
    expect(form.incentiveType).toBe('prescriber');
    expect(form.effectiveFrom).toBe('2026-06-27');
  });

  it('allows selecting lab performer rules without losing lab-specific filters', () => {
    const form = {
      ...getInitialDoctorCommissionRuleForm('2026-06-27'),
      labTestId: '12',
      category: 'hematology',
    };

    const next = applyDoctorCommissionRulePreset(form, 'lab_test:performer');

    expect(next.serviceType).toBe('lab_test');
    expect(next.incentiveType).toBe('performer');
    expect(next.labTestId).toBe('12');
    expect(next.category).toBe('hematology');
  });

  it('allows selecting consultation performer rules and clears lab-only filters', () => {
    const form = {
      ...getInitialDoctorCommissionRuleForm('2026-06-27'),
      labTestId: '12',
      category: 'hematology',
    };

    const next = applyDoctorCommissionRulePreset(form, 'consultation_fee:performer');

    expect(next.serviceType).toBe('consultation_fee');
    expect(next.incentiveType).toBe('performer');
    expect(next.labTestId).toBe('');
    expect(next.category).toBe('');
  });

  it('allows selecting external referrer rules and clears lab-only filters', () => {
    const form = {
      ...getInitialDoctorCommissionRuleForm('2026-06-27'),
      labTestId: '12',
      category: 'hematology',
    };

    const next = applyDoctorCommissionRulePreset(form, 'referral:referrer');

    expect(next.serviceType).toBe('referral');
    expect(next.incentiveType).toBe('referrer');
    expect(next.labTestId).toBe('');
    expect(next.category).toBe('');
  });

  it('defaults new rules to legacy full-earned waiver behavior', () => {
    const form = getInitialDoctorCommissionRuleForm('2026-07-26');

    expect(form.waiverPolicy).toBe('full_earned');
    expect(form.protectedRate).toBe('');
    expect(form.protectedFlatAmount).toBe('');
  });

  it('derives the maximum doctor-funded waiver from a protected percentage floor', () => {
    const form = {
      ...getInitialDoctorCommissionRuleForm('2026-07-26'),
      rateType: 'percent' as const,
      rateValue: '25',
      waiverPolicy: 'protected_floor' as const,
      protectedRate: '5',
    };

    expect(getMaximumDoctorWaiverValue(form)).toBe(20);
  });

  it('clears the incompatible protected value when the rate type changes', () => {
    const form = {
      ...getInitialDoctorCommissionRuleForm('2026-07-26'),
      protectedRate: '5',
      protectedFlatAmount: '50',
    };

    expect(setDoctorCommissionRuleRateType(form, 'flat')).toMatchObject({
      rateType: 'flat',
      protectedRate: '',
      protectedFlatAmount: '50',
    });
    expect(setDoctorCommissionRuleRateType(form, 'percent')).toMatchObject({
      rateType: 'percent',
      protectedRate: '5',
      protectedFlatAmount: '',
    });
  });

  it('loads a protected percentage procedure rule without losing waiver settings', () => {
    const form = doctorCommissionRuleToForm({
      doctor_id: 17,
      service_type: 'procedure',
      lab_test_id: null,
      category: null,
      rate_type: 'percent',
      rate_value: 2500,
      waiver_policy: 'protected_floor',
      protected_rate_bps: 500,
      protected_flat_amount: 0,
      incentive_type: 'performer',
      effective_from: '2026-07-18',
      notes: 'Procedure floor',
    });

    expect(form).toEqual({
      doctorId: '17',
      serviceType: 'procedure',
      labTestId: '',
      category: '',
      rateType: 'percent',
      rateValue: '25',
      waiverPolicy: 'protected_floor',
      protectedRate: '5',
      protectedFlatAmount: '',
      incentiveType: 'performer',
      effectiveFrom: '2026-07-18',
      notes: 'Procedure floor',
    });
  });

  it('loads a protected flat IPD round rule into editable form values', () => {
    const form = doctorCommissionRuleToForm({
      doctor_id: 9,
      service_type: 'ipd_round',
      lab_test_id: null,
      category: null,
      rate_type: 'flat',
      rate_value: 500,
      waiver_policy: 'protected_floor',
      protected_rate_bps: 0,
      protected_flat_amount: 200,
      incentive_type: 'performer',
      effective_from: null,
      notes: null,
    });

    expect(form).toMatchObject({
      doctorId: '9',
      serviceType: 'ipd_round',
      rateType: 'flat',
      rateValue: '500',
      waiverPolicy: 'protected_floor',
      protectedRate: '',
      protectedFlatAmount: '200',
      effectiveFrom: '',
      notes: '',
    });
  });

  it('builds an update payload that clears lab scope and preserves protected waiver settings', () => {
    const form = {
      ...getInitialDoctorCommissionRuleForm(''),
      doctorId: '7',
      serviceType: 'consultation_fee' as const,
      rateType: 'percent' as const,
      rateValue: '25',
      waiverPolicy: 'protected_floor' as const,
      protectedRate: '5',
      incentiveType: 'performer' as const,
      notes: '',
    };

    expect(buildDoctorCommissionRulePayload(form, { forUpdate: true })).toEqual({
      doctorId: 7,
      serviceType: 'consultation_fee',
      labTestId: null,
      category: null,
      rateType: 'percent',
      rateValue: 2500,
      waiverPolicy: 'protected_floor',
      protectedRate: 5,
      protectedFlatAmount: undefined,
      incentiveType: 'performer',
      effectiveFrom: null,
      notes: null,
    });
  });

  it('builds a create payload without nullable clearing markers', () => {
    const form = {
      ...getInitialDoctorCommissionRuleForm('2026-07-26'),
      doctorId: '9',
      rateValue: '10',
    };

    expect(buildDoctorCommissionRulePayload(form)).toMatchObject({
      doctorId: 9,
      serviceType: 'lab_test',
      labTestId: undefined,
      category: undefined,
      rateType: 'percent',
      rateValue: 1000,
      effectiveFrom: '2026-07-26',
      notes: undefined,
    });
  });
});
