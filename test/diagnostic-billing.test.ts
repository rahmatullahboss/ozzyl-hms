import { describe, expect, it } from 'vitest';
import {
  getDiagnosticBillingClearance,
  getDiagnosticBillingColumns,
  getDiagnosticBillPaidUpdateSql,
} from '../src/lib/diagnostic-billing';

describe('diagnostic billing clearance', () => {
  it('allows legacy or zero-charge orders without a linked bill', () => {
    expect(getDiagnosticBillingClearance({ billId: null }).cleared).toBe(true);
    expect(getDiagnosticBillingClearance({ billId: 7, billStatus: 'open', billTotal: 0, billPaid: 0 }).cleared).toBe(true);
  });

  it('blocks lab and radiology work while the linked bill is unpaid or partial', () => {
    expect(getDiagnosticBillingClearance({ billId: 7, billStatus: 'open', billTotal: 50000, billPaid: 0 })).toMatchObject({
      cleared: false,
      paymentStatus: 'unpaid',
      outstanding: 50000,
    });

    expect(getDiagnosticBillingClearance({ billId: 7, billStatus: 'partially_paid', billTotal: 50000, billPaid: 20000 })).toMatchObject({
      cleared: false,
      paymentStatus: 'partially_paid',
      outstanding: 30000,
    });
  });

  it('allows work only when the linked bill is fully paid', () => {
    expect(getDiagnosticBillingClearance({ billId: 7, billStatus: 'paid', billTotal: 50000, billPaid: 50000 })).toMatchObject({
      cleared: true,
      paymentStatus: 'paid',
      outstanding: 0,
    });
  });

  it('allows reception-approved credit diagnostic work while preserving outstanding amount', () => {
    expect(getDiagnosticBillingClearance({
      billId: 7,
      diagnostic_billing_status: 'approved_credit',
      billStatus: 'open',
      billTotal: 50000,
      billPaid: 0,
    })).toMatchObject({
      cleared: true,
      paymentStatus: 'approved_credit',
      outstanding: 50000,
    });
  });

  it('blocks prescription-origin items that reception has not selected for billing', () => {
    expect(getDiagnosticBillingClearance({
      billId: null,
      diagnostic_billing_status: 'pending_selection',
      billTotal: 0,
      billPaid: 0,
    })).toMatchObject({
      cleared: false,
      paymentStatus: 'pending_selection',
    });
  });

  it('treats cancelled or refunded bills as blocked', () => {
    expect(getDiagnosticBillingClearance({ billId: 7, billStatus: 'cancelled', billTotal: 50000, billPaid: 0 })).toMatchObject({
      cleared: false,
      paymentStatus: 'cancelled',
    });
    expect(getDiagnosticBillingClearance({ billId: 7, billStatus: 'refunded', billTotal: 50000, billPaid: 50000 })).toMatchObject({
      cleared: false,
      paymentStatus: 'refunded',
    });
  });
});

describe('diagnostic billing SQL helpers', () => {
  it('uses defensive column expressions so old migrations stay readable', () => {
    expect(getDiagnosticBillingColumns('lo')).toContain('lo.bill_id as bill_id');
    expect(getDiagnosticBillingColumns('r')).toContain('r.bill_id as bill_id');
  });

  it('updates only diagnostic orders linked to a paid bill', () => {
    const sql = getDiagnosticBillPaidUpdateSql('lab_orders');
    expect(sql).toContain("billing_status = 'paid'");
    expect(sql).toContain('WHERE bill_id = ? AND tenant_id = ?');
  });
});
