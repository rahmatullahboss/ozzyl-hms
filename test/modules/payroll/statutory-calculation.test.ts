import { describe, expect, it } from 'vitest';
import {
  calculateStatutoryPreview,
  summarizeStatutoryYtd,
  type StatutoryCalculationInput,
  type StatutoryPolicy,
  type StatutoryRule,
} from '../../../src/modules/payroll/statutory';

const policy = (rule: StatutoryRule, changes: Partial<StatutoryPolicy> = {}): StatutoryPolicy => ({
  policyId: 'policy-' + rule.code,
  version: 1,
  tenantId: '102',
  jurisdiction: 'BD',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  status: 'approved',
  proposedBy: 'hr-1',
  legalValidation: {
    status: 'verified',
    validatedBy: 'legal-1',
    sourceRefs: ['source:official'],
    reviewedAt: '2026-01-02',
  },
  approval: { approvedBy: 'hr-2', approvedAt: '2026-01-03', evidenceRef: 'approval-record' },
  rules: [rule],
  ...changes,
});

const rule = (code: string, kind: StatutoryRule['kind'], changes: Partial<StatutoryRule> = {}): StatutoryRule => ({
  code,
  kind,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  enabled: true,
  validationStatus: 'verified',
  calculation: { mode: 'basis_points', basis: 'basic', rateBasisPoints: 1_000 },
  ...changes,
});

const input = (changes: Partial<StatutoryCalculationInput> = {}): StatutoryCalculationInput => ({
  tenantId: '102',
  jurisdiction: 'BD',
  legacyStaffId: 9,
  payrollPeriod: '2026-11',
  businessDate: '2026-11-30',
  basicMinor: 30_000_00,
  grossMinor: 40_000_00,
  taxableMinor: 35_000_00,
  projectedAnnualTaxableMinor: 420_000_00,
  remainingPayrollPeriods: 2,
  previousYtd: [],
  exemptions: [],
  policies: [],
  ...changes,
});

describe('HR-08 statutory preview (never a payroll writer)', () => {
  it('defaults to no statutory deductions or employer expenses', () => {
    const preview = calculateStatutoryPreview(input());
    expect(preview.employeeDeductionMinor).toBe(0);
    expect(preview.employerExpenseMinor).toBe(0);
    expect(preview.items).toEqual([]);
  });

  it('excludes unverified and unapproved rules even when enabled and carries pending evidence', () => {
    const pending = policy(rule('TAX', 'income_tax_withholding', { validationStatus: 'pending_validation' }));
    const noApproval = policy(rule('PF', 'provident_fund_employee'), { approval: null });
    const preview = calculateStatutoryPreview(input({ policies: [pending, noApproval] }));
    expect(preview.items).toEqual([]);
    expect(preview.excluded.map((x) => x.code)).toEqual(['TAX', 'PF']);
    expect(preview.excluded.map((x) => x.reason)).toEqual(['RULE_UNVERIFIED', 'POLICY_NOT_APPROVED']);
  });

  it('separates employee withholding, employer cost and employee benefits', () => {
    const preview = calculateStatutoryPreview(input({ policies: [
      policy(rule('EPF', 'provident_fund_employee')),
      policy(rule('ERPF', 'provident_fund_employer', { calculation: { mode: 'basis_points', basis: 'basic', rateBasisPoints: 500 } })),
      policy(rule('BONUS', 'employee_benefit', { calculation: { mode: 'fixed_minor', amountMinor: 700_00 } })),
      policy(rule('AUTH', 'authorized_deduction', { calculation: { mode: 'fixed_minor', amountMinor: 200_00 } })),
    ] }));
    expect(preview.employeeDeductionMinor).toBe(3_200_00);
    expect(preview.employerExpenseMinor).toBe(1_500_00);
    expect(preview.employeeBenefitMinor).toBe(700_00);
    expect(preview.items.map((x) => x.policyVersion)).toEqual([1, 1, 1, 1]);
    expect(preview.items.find((x) => x.code === 'ERPF')?.treatment).toBe('employer_expense');
  });

  it('uses effective dates and rejects overlapping approved rules for one code', () => {
    const oldP = policy(rule('PF', 'provident_fund_employee', { effectiveTo: '2026-06-30' }), { effectiveTo: '2026-06-30' });
    const newP = policy(rule('PF', 'provident_fund_employee', { effectiveFrom: '2026-07-01', calculation: { mode: 'basis_points', basis: 'basic', rateBasisPoints: 2_000 } }), { policyId: 'pf-v2', version: 2, effectiveFrom: '2026-07-01' });
    expect(calculateStatutoryPreview(input({ businessDate: '2026-06-30', policies: [oldP, newP] })).employeeDeductionMinor).toBe(3_000_00);
    expect(calculateStatutoryPreview(input({ policies: [oldP, newP] })).employeeDeductionMinor).toBe(6_000_00);
    expect(() => calculateStatutoryPreview(input({ policies: [newP, newP] }))).toThrow(/overlap|duplicate/i);
  });

  it('honours employee eligibility and effective-dated exemptions', () => {
    const pf = policy(rule('PF', 'provident_fund_employee', { eligibleStaffIds: [9] }));
    const other = policy(rule('ONLY_OTHER', 'authorized_deduction', { eligibleStaffIds: [10] }));
    const preview = calculateStatutoryPreview(input({
      policies: [pf, other],
      exemptions: [{ ruleCode: 'PF', legacyStaffId: 9, effectiveFrom: '2026-11-01', effectiveTo: '2026-11-30', exemptBaseMinor: 10_000_00, evidenceRef: 'exemption-approval' }],
    }));
    expect(preview.employeeDeductionMinor).toBe(2_000_00);
    expect(preview.excluded.find((x) => x.code === 'ONLY_OTHER')?.reason).toBe('EMPLOYEE_INELIGIBLE');
    expect(calculateStatutoryPreview(input({ policies: [pf], exemptions: [{
      ruleCode: 'PF', legacyStaffId: 9, effectiveFrom: '2026-11-01', effectiveTo: null, fullyExempt: true, evidenceRef: 'exemption-approval',
    }] })).employeeDeductionMinor).toBe(0);
  });

  it('calculates annual progressive withholding minus prior same-year deductions without inventing a rate', () => {
    const tax = policy(rule('TAX', 'income_tax_withholding', {
      calculation: { mode: 'annual_brackets', brackets: [
        { upToMinor: 300_000_00, rateBasisPoints: 0 },
        { upToMinor: null, rateBasisPoints: 1_000 },
      ] },
    }));
    const preview = calculateStatutoryPreview(input({
      taxableMinor: 50_000_00,
      projectedAnnualTaxableMinor: 500_000_00,
      previousYtd: [{
        tenantId: '102', jurisdiction: 'BD', legacyStaffId: 9, payrollPeriod: '2026-10',
        code: 'TAX', treatment: 'employee_deduction', amountMinor: 7_000_00,
        sourceSnapshotId: 'certified-october',
      }],
      policies: [tax],
    }));
    // Synthetic progressive bands: (500,000 - 300,000) * 10% = 20,000; 20,000-7,000 / 2 periods.
    expect(preview.employeeDeductionMinor).toBe(6_500_00);
    expect(preview.items[0].sourceYtdMinor).toBe(7_000_00);
  });

  it('uses integer half-up rounding for fractional minor units', () => {
    const fee = policy(rule('ROUND', 'authorized_deduction', { calculation: { mode: 'basis_points', basis: 'basic', rateBasisPoints: 5_000 } }));
    expect(calculateStatutoryPreview(input({ basicMinor: 1, policies: [fee] })).employeeDeductionMinor).toBe(1);
  });

  it('isolates hospitals and rejects foreign YTD evidence', () => {
    const hospitalA = policy(rule('PF', 'provident_fund_employee'));
    const hospitalB = policy(rule('PF', 'provident_fund_employee', { calculation: { mode: 'fixed_minor', amountMinor: 500 } }), { tenantId: '105' });
    expect(calculateStatutoryPreview(input({ tenantId: '105', policies: [hospitalA, hospitalB] })).employeeDeductionMinor).toBe(500);
    expect(calculateStatutoryPreview(input({ policies: [hospitalA, hospitalB] })).employeeDeductionMinor).toBe(3_000_00);
    expect(() => calculateStatutoryPreview(input({ policies: [hospitalA], previousYtd: [{
      tenantId: '105', jurisdiction: 'BD', legacyStaffId: 9, payrollPeriod: '2026-10',
      code: 'PF', treatment: 'employee_deduction', amountMinor: 100, sourceSnapshotId: 'cross-hospital',
    }] }))).toThrow(/scope|tenant/i);
  });

  it('rejects unsigned, malformed or cross-period evidence and nonsensical amounts', () => {
    const p = policy(rule('PF', 'provident_fund_employee'));
    expect(() => calculateStatutoryPreview(input({ basicMinor: -1, policies: [p] }))).toThrow();
    expect(() => calculateStatutoryPreview(input({ businessDate: '2026-13-40', policies: [p] }))).toThrow();
    expect(() => calculateStatutoryPreview(input({ previousYtd: [{
      tenantId: '102', jurisdiction: 'BD', legacyStaffId: 9, payrollPeriod: '2026-11',
      code: 'PF', treatment: 'employee_deduction', amountMinor: 100, sourceSnapshotId: 'current-period',
    }], policies: [p] }))).toThrow(/period/i);
    expect(calculateStatutoryPreview(input({ policies: [policy(rule('PF', 'provident_fund_employee'), { legalValidation: {
      status: 'verified', validatedBy: 'legal-1', sourceRefs: [], reviewedAt: '2026-01-02',
    } })] })).items).toEqual([]);
  });

  it('aggregates YTD by employee and employer category with safe scope checks', () => {
    const result = summarizeStatutoryYtd({
      tenantId: '102', jurisdiction: 'BD', legacyStaffId: 9, taxYear: '2026',
      records: [
        { tenantId: '102', jurisdiction: 'BD', legacyStaffId: 9, payrollPeriod: '2026-01', code: 'PF', treatment: 'employee_deduction', amountMinor: 200, sourceSnapshotId: 's1' },
        { tenantId: '102', jurisdiction: 'BD', legacyStaffId: 9, payrollPeriod: '2026-02', code: 'PF', treatment: 'employer_expense', amountMinor: 300, sourceSnapshotId: 's2' },
      ],
    });
    expect(result).toEqual([
      { code: 'PF', treatment: 'employee_deduction', amountMinor: 200 },
      { code: 'PF', treatment: 'employer_expense', amountMinor: 300 },
    ]);
  });
});
