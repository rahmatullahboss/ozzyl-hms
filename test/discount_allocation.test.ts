import { describe, expect, it } from 'vitest';
import {
  applyDoctorCommissionWaiver,
  normalizeDiscountReason,
  splitDiscountAllocation,
} from '../src/lib/discount_allocation';
import { createSchemeSchema, updateSchemeSchema } from '../src/schemas/billingMaster';
import { evaluateBillingSchemeEligibility } from '../src/lib/billing-scheme-eligibility';
import { createMockDB } from './integration/helpers/mock-db';

describe('discount allocation utility', () => {
  it('normalizes unknown reasons to normal hospital discount', () => {
    expect(normalizeDiscountReason('bad-value')).toBe('normal_hospital_discount');
  });

  it('maps normal discount to hospital-funded allocation', () => {
    const result = splitDiscountAllocation({
      billGrossAmount: 1000,
      totalDiscount: 100,
      discountReason: 'normal_hospital_discount',
      referenceName: 'Manager',
    });

    expect(result.allocations).toEqual([
      expect.objectContaining({
        allocationType: 'hospital_discount',
        discountReason: 'normal_hospital_discount',
        amount: 100,
        percent: 10,
        referenceName: 'Manager',
      }),
    ]);
    expect(result.hospitalFundedAmount).toBe(100);
    expect(result.doctorWaiverAmount).toBe(0);
  });

  it('maps charity, management, and reference reasons to separate allocation types', () => {
    expect(splitDiscountAllocation({ totalDiscount: 50, discountReason: 'poor_patient_charity' }).allocations[0].allocationType)
      .toBe('charity_discount');
    expect(splitDiscountAllocation({ totalDiscount: 50, discountReason: 'management_approved' }).allocations[0].allocationType)
      .toBe('management_discount');
    expect(splitDiscountAllocation({ totalDiscount: 50, discountReason: 'reference_discount' }).allocations[0].allocationType)
      .toBe('reference_discount');
  });

  it('allocates doctor waiver fully when it is within eligible commission', () => {
    const result = splitDiscountAllocation({
      billGrossAmount: 1000,
      totalDiscount: 200,
      discountReason: 'doctor_commission_waiver',
      discountDoctorId: 7,
      eligibleDoctorCommission: 250,
      requestedDoctorWaiverAmount: 200,
    });

    expect(result.allocations).toEqual([
      expect.objectContaining({
        allocationType: 'doctor_commission_waiver',
        doctorId: 7,
        amount: 200,
        percent: 20,
      }),
    ]);
    expect(result.doctorWaiverAmount).toBe(200);
    expect(result.hospitalFundedAmount).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('splits excess doctor waiver into hospital-funded discount', () => {
    const result = splitDiscountAllocation({
      billGrossAmount: 1000,
      totalDiscount: 300,
      discountReason: 'doctor_commission_waiver',
      discountDoctorId: 7,
      eligibleDoctorCommission: 200,
      requestedDoctorWaiverAmount: 300,
    });

    expect(result.allocations).toHaveLength(2);
    expect(result.allocations[0]).toMatchObject({ allocationType: 'doctor_commission_waiver', amount: 200, doctorId: 7 });
    expect(result.allocations[1]).toMatchObject({ allocationType: 'hospital_discount', amount: 100, doctorId: null });
    expect(result.doctorWaiverAmount).toBe(200);
    expect(result.hospitalFundedAmount).toBe(100);
    expect(result.warnings).toContain('Doctor waiver was capped by eligible commission; remaining discount is hospital-funded.');
  });

  it('maps enterprise benefit and contract reasons to source-specific allocation types', () => {
    expect(splitDiscountAllocation({ totalDiscount: 50, discountReason: 'staff_benefit_discount' }).allocations[0].allocationType)
      .toBe('staff_benefit_discount');
    expect(splitDiscountAllocation({ totalDiscount: 50, discountReason: 'vip_benefit_discount' }).allocations[0].allocationType)
      .toBe('vip_benefit_discount');
    expect(splitDiscountAllocation({ totalDiscount: 50, discountReason: 'shareholder_benefit_discount' }).allocations[0].allocationType)
      .toBe('shareholder_benefit_discount');
    expect(splitDiscountAllocation({ totalDiscount: 50, discountReason: 'corporate_contract_discount' }).allocations[0].allocationType)
      .toBe('corporate_contract_discount');
  });

  it('does not create allocation rows for zero or negative discount', () => {
    expect(splitDiscountAllocation({ totalDiscount: 0 }).allocations).toEqual([]);
    expect(splitDiscountAllocation({ totalDiscount: -5 }).allocations).toEqual([]);
  });

  it('caps doctor waiver so payable commission never becomes negative', () => {
    expect(applyDoctorCommissionWaiver({ earnedCommissionAmount: 200, requestedWaiverAmount: 500 })).toEqual({
      earnedCommissionAmount: 200,
      doctorWaiverAmount: 200,
      payableCommissionAmount: 0,
      overflowWaiverAmount: 300,
    });
  });

  it('rejects doctor commission waiver as a Billing Master scheme source', () => {
    const baseScheme = {
      scheme_name: 'Staff benefit',
      default_discount_percent: 10,
      default_discount_source: 'doctor_commission_waiver',
    };

    expect(createSchemeSchema.safeParse(baseScheme).success).toBe(false);
    expect(updateSchemeSchema.safeParse({ default_discount_source: 'doctor_commission_waiver' }).success).toBe(false);
  });

  it('blocks stale Billing Master schemes configured as doctor commission waiver', async () => {
    const { db } = createMockDB({
      queryOverride: (sql) => {
        const query = sql.toLowerCase();
        if (query.includes('select count(1)') && query.includes('from billing_scheme_members')) return { first: { count: 0 } };
        if (query.includes('from billing_schemes s')) return { first: null, results: [] };
        if (query.includes('from billing_scheme_members')) return { first: null, results: [] };
        if (query.includes('from billing_schemes')) {
          return {
            first: {
              id: 1,
              scheme_name: 'Bad doctor waiver scheme',
              scheme_code: 'BAD-DR-WAIVER',
              scheme_type: 'general',
              default_discount_percent: 10,
              default_price_category_id: null,
              default_discount_source: 'doctor_commission_waiver',
              valid_from: '2020-01-01',
              valid_to: '2099-12-31',
              max_discount_amount_per_bill: 0,
              max_discount_amount_per_month: 0,
              max_discount_amount_per_year: 0,
              approval_required_over_percent: 0,
              requires_reference: 0,
              is_auto_apply: 0,
              is_active: 1,
            },
          };
        }
        return null;
      },
    });

    const preview = await evaluateBillingSchemeEligibility(db, {
      tenantId: 'tenant-1',
      schemeCode: 'BAD-DR-WAIVER',
      subtotal: 1000,
    });

    expect(preview.eligible).toBe(false);
    expect(preview.suggested_discount).toBe(0);
    expect(preview.allocation_type).toBe('doctor_commission_waiver');
    expect(preview.blockers).toContain('Doctor commission waiver is not supported as a Billing Master scheme source');
  });
});
