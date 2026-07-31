import { describe, expect, it } from 'vitest';
import { buildReceptionBillPayload, getRoleBasePath } from '../../web/src/lib/handover';

describe('handover helpers', () => {
  it('uses the reception-prefixed base path for reception users', () => {
    expect(getRoleBasePath('demo-hospital', 'reception')).toBe('/h/demo-hospital/reception');
  });

  it('uses the default hospital base path for admin users', () => {
    expect(getRoleBasePath('demo-hospital', 'hospital_admin')).toBe('/h/demo-hospital');
  });

  it('builds an itemized reception billing payload including admission and fire service', () => {
    expect(
      buildReceptionBillPayload({
        patientId: 7,
        fireServiceCharge: 50,
        form: {
          testBill: 500,
          doctorVisitBill: 700,
          operationBill: 1200,
          admissionBill: 900,
          medicineBill: 300,
          discount: 100,
        },
      }),
    ).toEqual({
      patientId: 7,
      discount: 100,
      items: [
        { itemCategory: 'test', quantity: 1, unitPrice: 500 },
        { itemCategory: 'doctor_visit', quantity: 1, unitPrice: 700 },
        { itemCategory: 'operation', quantity: 1, unitPrice: 1200 },
        { itemCategory: 'admission', quantity: 1, unitPrice: 900 },
        { itemCategory: 'medicine', quantity: 1, unitPrice: 300 },
        { itemCategory: 'fire_service', description: 'Fire Service', quantity: 1, unitPrice: 50 },
      ],
    });
  });

  it('omits zero-value line items', () => {
    expect(
      buildReceptionBillPayload({
        patientId: 7,
        fireServiceCharge: 0,
        form: {
          testBill: 0,
          doctorVisitBill: 0,
          operationBill: 0,
          admissionBill: 0,
          medicineBill: 0,
          discount: 0,
        },
      }),
    ).toEqual({
      patientId: 7,
      discount: 0,
      items: [],
    });
  });
});
