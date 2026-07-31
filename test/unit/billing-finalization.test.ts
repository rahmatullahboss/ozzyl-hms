import { describe, expect, it } from 'vitest';
import {
  buildBillCommissionItems,
  buildBillCreatedAccountingPayload,
  buildCanonicalBillCommissionItems,
  reconcileDoctorWaiverCommissionItems,
} from '../../src/lib/billing-finalization';

describe('billing finalization helpers', () => {
  it('builds one canonical bill-created accounting payload for billing routes', () => {
    const payload = buildBillCreatedAccountingPayload({
      tenantId: 'tenant-1',
      userId: 12,
      patientId: 34,
      visitId: 56,
      billId: 78,
      invoiceNo: 'INV-78',
      referringDoctorId: 91,
      billDate: '2026-05-10',
      subtotal: 1200,
      discount: 100,
      total: 1100,
      categoryTotals: {
        testBill: 600,
        doctorVisitBill: 500,
        admissionBill: 0,
        operationBill: 0,
        medicineBill: 0,
      },
      counterId: 7,
      counterSessionId: 17,
      extraPayload: { admissionId: 123 },
      items: [],
    });

    expect(payload).toEqual({
      admissionId: 123,
      billId: 78,
      invoiceNo: 'INV-78',
      patientId: 34,
      visitId: 56,
      referringDoctorId: 91,
      subtotal: 1200,
      discount: 100,
      total: 1100,
      counterId: 7,
      counterSessionId: 17,
      testBill: 600,
      doctorVisitBill: 500,
      admissionBill: 0,
      operationBill: 0,
      medicineBill: 0,
    });
  });

  it('uses finalized line totals for commission accrual inputs', () => {
    expect(buildBillCommissionItems([
      {
        itemCategory: 'doctor_visit',
        description: 'Consultation',
        lineTotal: 500,
        referenceId: 91,
      },
      {
        itemCategory: 'test',
        description: null,
        lineTotal: 850,
      },
    ])).toEqual([
      {
        itemCategory: 'doctor_visit',
        description: 'Consultation',
        lineTotal: 500,
        grossLineTotal: null,
        taxAmount: 0,
        canonicalSourceLineId: '1:doctor_visit:91',
        referenceId: 91,
        billItemId: null,
        labTestId: null,
        performerDoctorId: null,
        prescriberDoctorId: null,
        commissionBaseAmount: null,
        performerReserveAmount: null,
        hasPerformerReserve: false,
      },
      {
        itemCategory: 'test',
        description: null,
        lineTotal: 850,
        grossLineTotal: null,
        taxAmount: 0,
        canonicalSourceLineId: '2:test:none',
        referenceId: null,
        billItemId: null,
        labTestId: null,
        performerDoctorId: null,
        prescriberDoctorId: null,
        commissionBaseAmount: null,
        performerReserveAmount: null,
        hasPerformerReserve: false,
      },
    ]);
  });

  it('hydrates canonical bill item IDs and reserve-reduced commission metadata', () => {
    const items = buildCanonicalBillCommissionItems(
      [{
        itemCategory: 'usg',
        description: 'USG Whole Abdomen',
        lineTotal: 1000,
        referenceId: 501,
        performerDoctorId: 7,
        prescriberDoctorId: 3,
      }],
      [{
        patientId: 10,
        visitId: 20,
        billDiscount: 100,
        billItemId: 301,
        itemCategory: 'test',
        description: 'USG Whole Abdomen',
        quantity: 1,
        lineTotal: 900,
        grossServiceAmount: 1000,
        taxAmount: 0,
        referenceId: 501,
        billingServiceItemId: 501,
        diagnosticKind: 'radiology',
        labTestId: null,
        radiologyImagingItemId: 71,
        testCode: 'RAD-USG-WA',
        testName: 'USG Whole Abdomen',
      }],
      new Map([[301, {
        billItemId: 301,
        netServiceAmount: 900,
        performerReserveAmount: 200,
        commissionBaseAmount: 700,
        reserveIds: [701],
      }]]),
    );

    expect(items).toEqual([expect.objectContaining({
      billItemId: 301,
      lineTotal: 900,
      grossLineTotal: 1000,
      commissionBaseAmount: 700,
      performerReserveAmount: 200,
      hasPerformerReserve: true,
      performerDoctorId: 7,
      prescriberDoctorId: 3,
    })]);
  });

  it('removes the residual BDT 9 when a BDT 100 doctor waiver is only partly represented in test bases', () => {
    const doctorId = 3;
    const items = buildCanonicalBillCommissionItems(
      [
        {
          itemCategory: 'test',
          description: 'Test A',
          lineTotal: 636,
          prescriberDoctorId: doctorId,
        },
        {
          itemCategory: 'test',
          description: 'Test B',
          lineTotal: 1000,
          prescriberDoctorId: doctorId,
        },
      ],
      [
        {
          patientId: 10,
          visitId: 20,
          billDiscount: 100,
          billItemId: 301,
          itemCategory: 'test',
          description: 'Test A',
          quantity: 1,
          lineTotal: 636,
          grossServiceAmount: 700,
          taxAmount: 0,
          referenceId: 501,
          billingServiceItemId: 501,
          diagnosticKind: 'lab',
          labTestId: 51,
          radiologyImagingItemId: null,
          testCode: 'TEST-A',
          testName: 'Test A',
        },
        {
          patientId: 10,
          visitId: 20,
          billDiscount: 100,
          billItemId: 302,
          itemCategory: 'test',
          description: 'Test B',
          quantity: 1,
          lineTotal: 1000,
          grossServiceAmount: 1000,
          taxAmount: 0,
          referenceId: 502,
          billingServiceItemId: 502,
          diagnosticKind: 'lab',
          labTestId: 52,
          radiologyImagingItemId: null,
          testCode: 'TEST-B',
          testName: 'Test B',
        },
      ],
      new Map([
        [301, {
          billItemId: 301,
          netServiceAmount: 636,
          performerReserveAmount: 200,
          commissionBaseAmount: 436,
          reserveIds: [701],
        }],
        [302, {
          billItemId: 302,
          netServiceAmount: 1000,
          performerReserveAmount: 200,
          commissionBaseAmount: 800,
          reserveIds: [702],
        }],
      ]),
    );

    const reconciled = reconcileDoctorWaiverCommissionItems(
      items,
      [{ doctorId, amount: 100 }],
      doctorId,
    );

    expect(reconciled.map((item) => item.lineTotal)).toEqual([600, 1000]);
    expect(reconciled.map((item) => item.commissionBaseAmount)).toEqual([400, 800]);

    const earnedCommission = reconciled.reduce(
      (sum, item) => sum + Number(item.commissionBaseAmount ?? 0) * 0.25,
      0,
    );
    expect(earnedCommission).toBe(300);
    expect(earnedCommission - 100).toBe(200);
  });
});
