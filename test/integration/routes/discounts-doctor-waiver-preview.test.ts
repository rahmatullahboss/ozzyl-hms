import { describe, expect, it } from 'vitest';
import discountsRoutes from '../../../src/routes/tenant/discounts';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TENANT_ID = 'tenant-1';
const DOCTOR_ID = 3;
const SERVICE_ITEM_ID = 501;

function createPreviewApp(commissionRateBps = 2500, protectedRateBps = 0) {
  let doctorCommissionRuleQueryCount = 0;
  const testApp = createTestApp({
    route: discountsRoutes,
    routePath: '/discounts',
    role: 'reception',
    tenantId: TENANT_ID,
    universalFallback: true,
    queryOverride: (sql) => {
      const normalized = sql.toLowerCase();
      if (normalized.includes('from diagnostic_performer_payout_rules')) {
        return {
          results: [{
            id: 91,
            billing_service_item_id: SERVICE_ITEM_ID,
            diagnostic_kind: 'radiology',
            rate_type: 'flat',
            rate_value: 200,
            effective_from: '2026-07-01',
            effective_to: null,
            is_active: 1,
          }],
        };
      }
      if (normalized.includes('from doctor_commission_rules')) {
        doctorCommissionRuleQueryCount += 1;
        return {
          results: [{
            id: 801,
            doctor_id: DOCTOR_ID,
            service_type: 'lab_test',
            incentive_type: 'prescriber',
            category: null,
            lab_test_id: null,
            rate_type: 'percent',
            rate_value: commissionRateBps,
            waiver_policy: protectedRateBps > 0 ? 'protected_floor' : 'full_earned',
            protected_rate_bps: protectedRateBps,
            protected_flat_amount: 0,
            effective_from: '2026-07-01',
            effective_to: null,
            is_active: 1,
          }],
        };
      }
      return null;
    },
  });
  return {
    ...testApp,
    getDoctorCommissionRuleQueryCount: () => doctorCommissionRuleQueryCount,
  };
}

describe('POST /discounts/doctor-waiver-preview', () => {
  it('deducts the server-resolved performer reserve before previewing doctor commission', async () => {
    const { app } = createPreviewApp();

    const response = await jsonRequest(app, '/discounts/doctor-waiver-preview', {
      method: 'POST',
      body: {
        doctorId: DOCTOR_ID,
        billDate: '2026-07-25',
        totalDiscount: 100,
        items: [{
          itemCategory: 'test',
          description: 'USG Whole Abdomen',
          lineTotal: 900,
          grossLineTotal: 1000,
          quantity: 1,
          referenceId: SERVICE_ITEM_ID,
        }],
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      eligibleCommissionAmount: number;
      doctorWaiverAmount: number;
      hospitalFundedAmount: number;
      lines: Array<{ grossAmount: number; commissionAmount: number }>;
    };
    expect(body.eligibleCommissionAmount).toBe(175);
    expect(body.doctorWaiverAmount).toBe(100);
    expect(body.hospitalFundedAmount).toBe(0);
    expect(body.lines).toMatchObject([{ grossAmount: 700, commissionAmount: 175 }]);
  });

  it('preserves two-decimal commission precision in the preview response', async () => {
    const { app } = createPreviewApp(3333);

    const response = await jsonRequest(app, '/discounts/doctor-waiver-preview', {
      method: 'POST',
      body: {
        doctorId: DOCTOR_ID,
        billDate: '2026-07-25',
        totalDiscount: 250,
        items: [{
          itemCategory: 'test',
          description: 'USG Whole Abdomen',
          lineTotal: 900,
          grossLineTotal: 1000,
          quantity: 1,
          referenceId: SERVICE_ITEM_ID,
        }],
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { eligibleCommissionAmount: number; doctorWaiverAmount: number };
    expect(body.eligibleCommissionAmount).toBe(233.31);
    expect(body.doctorWaiverAmount).toBe(233.31);
  });

  it('loads the doctor commission rules once for a multi-item preview', async () => {
    const { app, getDoctorCommissionRuleQueryCount } = createPreviewApp();

    const response = await jsonRequest(app, '/discounts/doctor-waiver-preview', {
      method: 'POST',
      body: {
        doctorId: DOCTOR_ID,
        billDate: '2026-07-26',
        totalDiscount: 200,
        items: [
          { itemCategory: 'test', description: 'CBC', lineTotal: 400, grossLineTotal: 500, quantity: 1, referenceId: 901 },
          { itemCategory: 'test', description: 'Creatinine', lineTotal: 300, grossLineTotal: 400, quantity: 1, referenceId: 902 },
          { itemCategory: 'radiology', description: 'ECG', lineTotal: 200, grossLineTotal: 200, quantity: 1, referenceId: SERVICE_ITEM_ID },
        ],
      },
    });

    expect(response.status).toBe(200);
    expect(getDoctorCommissionRuleQueryCount()).toBe(1);
  });

  it('caps doctor-funded discount at the rule waiver capacity', async () => {
    const { app } = createPreviewApp(2500, 500);

    const response = await jsonRequest(app, '/discounts/doctor-waiver-preview', {
      method: 'POST',
      body: {
        doctorId: DOCTOR_ID,
        billDate: '2026-07-26',
        totalDiscount: 500,
        items: [{
          itemCategory: 'test',
          description: 'CBC',
          lineTotal: 1000,
          grossLineTotal: 1000,
          quantity: 1,
          referenceId: 999,
        }],
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      eligibleCommissionAmount: 250,
      protectedCommissionAmount: 50,
      maximumDoctorWaiverAmount: 200,
      doctorWaiverAmount: 200,
      hospitalFundedAmount: 300,
      payableCommissionAmount: 50,
    });
  });
});
