import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { billingCounterInvoiceSchema } from '../src/schemas/billingCounter';

const baseInvoice = {
  patientId: 1,
  createWalkInVisit: true,
  billMode: 'credit' as const,
  items: [{ serviceItemId: 1, quantity: 1, discountAmount: 0, discountPercent: 0 }],
  payment: {
    paymentMethod: 'cash',
    paidAmount: 0,
    depositDeducted: 0,
    creditAmount: 100,
  },
};

describe('billing counter referrer', () => {
  it('accepts a named external doctor or other referrer without an internal doctor id', () => {
    expect(billingCounterInvoiceSchema.safeParse({
      ...baseInvoice,
      referredByType: 'doctor',
      referredByName: 'Dr. External Doctor',
    }).success).toBe(true);

    expect(billingCounterInvoiceSchema.safeParse({
      ...baseInvoice,
      referredByType: 'other',
      referredByName: 'Local Health Worker',
    }).success).toBe(true);
  });

  it('requires a name for other referrers', () => {
    expect(billingCounterInvoiceSchema.safeParse({
      ...baseInvoice,
      referredByType: 'other',
    }).success).toBe(false);
  });

  it('rejects internal prescriber commission data unless the bill has an internal doctor referral', () => {
    for (const referral of [
      { referredByType: 'self' as const },
      { referredByType: 'hospital' as const, referredByHospitalId: 7 },
      { referredByType: 'other' as const, referredByName: 'Community source' },
      { referredByType: 'doctor' as const, referredByName: 'Dr. External Doctor' },
    ]) {
      const result = billingCounterInvoiceSchema.safeParse({
        ...baseInvoice,
        ...referral,
        items: [{ ...baseInvoice.items[0], prescriberDoctorId: 131 }],
      });
      expect(result.success).toBe(false);
    }
  });

  it('requires explicit referral selection provenance for dashboard quick bills', () => {
    const dashboardInvoice = {
      ...baseInvoice,
      idempotencyKey: 'dashboard-service-bill-test-1234',
      referredByType: 'doctor' as const,
      referringDoctorId: 131,
      items: [{ ...baseInvoice.items[0], prescriberDoctorId: 132 }],
    };

    expect(billingCounterInvoiceSchema.safeParse(dashboardInvoice).success).toBe(false);
    expect(billingCounterInvoiceSchema.safeParse({
      ...dashboardInvoice,
      referrerSelectionSource: 'manual',
    }).success).toBe(true);
    expect(billingCounterInvoiceSchema.safeParse({
      ...dashboardInvoice,
      referrerSelectionSource: 'patient_context',
    }).success).toBe(true);
  });

  it('stores the general referrer name with the bill', () => {
    const source = readFileSync('src/routes/tenant/billingCounter.legacy.ts', 'utf8');

    expect(source).toContain('referred_by_name');
    expect(source).toContain("data.referredByName?.trim() || null");
  });
});
