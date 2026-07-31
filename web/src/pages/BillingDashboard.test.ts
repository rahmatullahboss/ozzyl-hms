import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyDoctorFeeToBillLine,
  applyServiceItemToBillLine,
  buildDirectBillDiscountPayload,
  findCollectPaymentBill,
  findInvalidManualBillLine,
  toCreateBillItems,
} from './BillingDashboard';

describe('BillingDashboard bill creation helpers', () => {
  it('uses doctor consultation fee in taka without dividing by 100', () => {
    const line = { category: 'doctor_visit', description: '', qty: '1', price: '' };

    expect(applyDoctorFeeToBillLine(line, 500)).toEqual({
      category: 'doctor_visit',
      description: '',
      qty: '1',
      price: '500',
    });
  });

  it('fills description, price, category, and service item id from selected catalog item', () => {
    const line = { category: 'other', description: '', qty: '1', price: '' };

    expect(applyServiceItemToBillLine(line, {
      id: 7,
      item_name: 'CBC',
      item_code: 'LAB-001',
      price: 350,
      department_name: 'Laboratory',
    })).toEqual({
      category: 'test',
      description: 'CBC',
      qty: '1',
      price: '350',
      serviceItemId: '7',
    });
  });

  it('includes service item id in create bill payload items', () => {
    expect(toCreateBillItems([
      { category: 'test', description: 'CBC', qty: '2', price: '350', serviceItemId: '7' },
    ])).toEqual([
      {
        itemCategory: 'test',
        description: 'CBC',
        quantity: 2,
        unitPrice: 350,
        serviceItemId: 7,
      },
    ]);
  });

  it('flags direct manual bill lines unless they are selected doctor consultations', () => {
    const manualTest = { category: 'test', description: 'CBC', qty: '1', price: '350' };
    const doctorVisit = { category: 'doctor_visit', description: '', qty: '1', price: '500' };

    expect(findInvalidManualBillLine([manualTest], '91')).toBe(manualTest);
    expect(findInvalidManualBillLine([doctorVisit], undefined)).toBe(doctorVisit);
    expect(findInvalidManualBillLine([doctorVisit], '91')).toBeUndefined();
  });

  it('requires reason and approving name for a positive direct-bill discount', () => {
    expect(buildDirectBillDiscountPayload({
      discount: 50,
      discountReason: '',
      discountByName: '',
    })).toBeNull();

    expect(buildDirectBillDiscountPayload({
      discount: 50,
      discountReason: 'Management approved',
      discountByName: 'Manager Rahman',
    })).toEqual({
      discount: 50,
      discountReason: 'Management approved',
      discountByName: 'Manager Rahman',
    });
  });

  it('omits discount metadata when the direct bill has no discount', () => {
    expect(buildDirectBillDiscountPayload({
      discount: 0,
      discountReason: '',
      discountByName: '',
    })).toEqual({ discount: 0 });
  });

  it('captures and sends a non-cash payment reference for due collection', () => {
    const source = readFileSync('src/pages/BillingDashboard.tsx', 'utf8');

    expect(source).toContain("from '../lib/paymentReference'");
    expect(source).toContain('const [payReference, setPayReference]');
    expect(source).toContain('requiresPaymentReference(payForm.method, amount)');
    expect(source).toContain('externalTransactionId: normalizeExternalTransactionId(payForm.method, amount, payReference)');
  });

  it('resolves an API-provided collection payment deep link from current or due bill data', () => {
    const current = [{ id: 10, invoice_no: 'INV-10' }];
    const dues = [{ id: 101, invoice_no: 'INV-101' }];

    expect(findCollectPaymentBill('101', current, dues)).toEqual(dues[0]);
    expect(findCollectPaymentBill('10', current, dues)).toEqual(current[0]);
    expect(findCollectPaymentBill('0', current, dues)).toBeNull();
    expect(findCollectPaymentBill('not-a-number', current, dues)).toBeNull();
    expect(findCollectPaymentBill('999', current, dues)).toBeNull();
  });
});
