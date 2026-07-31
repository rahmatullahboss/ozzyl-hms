import { describe, expect, it } from 'vitest';
import billingRoutes from '../../../src/routes/tenant/billing';
import { createTestApp, createTestAppNoRole } from '../helpers/test-app';
import type { InvoiceInspectorResponse } from '../../../src/services/billing/invoiceInspectorContract';

function inspectorQueryResult(sql: string, params: unknown[]) {
  const lower = sql.toLowerCase();
  if (lower.includes('invoice_inspector:summary')) {
    expect(params).toEqual(['tenant-1', 92]);
    return {
      first: {
        bill_id: 92,
        invoice_no: 'INV-92',
        status: 'partially_paid',
        bill_type: 'opd',
        patient_id: 41,
        patient_name: 'Patient One',
        patient_code: 'P-41',
        created_at: '2026-07-30 10:00:00',
        gross_amount: 1200,
        discount_amount: 200,
        net_amount: 1000,
        paid_amount: 600,
        deposit_applied_amount: 200,
        due_amount: 200,
        referred_by_type: 'doctor',
        referred_by_name: 'Dr. Referrer',
        discount_reason: 'Patient support',
        discount_reference: 'Welfare desk',
      },
    };
  }
  if (lower.includes('invoice_inspector:items')) {
    expect(params).toEqual(['tenant-1', 92]);
    return {
      results: [{
        id: 11,
        category: 'test',
        description: 'CBC',
        quantity: 1,
        rate: 1200,
        line_total: 1000,
        ordering_doctor_name: 'Dr. Ordering',
        referring_doctor_name: 'Dr. Referrer',
        performing_doctor_name: 'Dr. Performer',
        verifying_doctor_name: 'Dr. Verifier',
        status: 'completed',
      }],
    };
  }
  if (lower.includes('invoice_inspector:payments')) {
    expect(params).toEqual(['tenant-1', 92]);
    return {
      results: [{
        id: 21,
        receipt_no: 'RCPT-21',
        method: 'cash',
        payment_type: 'partial',
        amount: 600,
        collector_name: 'Cashier One',
        counter_name: 'Main Counter',
        paid_at: '2026-07-30 11:00:00',
        status: 'posted',
      }],
    };
  }
  if (lower.includes('invoice_inspector:deposits')) {
    expect(params).toEqual(['tenant-1', 92]);
    return {
      results: [{
        id: 31,
        amount: 200,
        adjustment_type: 'applied',
        reference_no: 'DEP-31',
        payment_method: 'cash',
        occurred_at: '2026-07-30 11:05:00',
        status: 'active',
      }],
    };
  }
  if (lower.includes('invoice_inspector:discounts')) {
    expect(params).toEqual(['tenant-1', 92]);
    return {
      results: [{
        id: 41,
        amount: 200,
        reference_name: 'Welfare desk',
        reason: 'Patient support',
        source_type: 'hospital_funded',
        funder_type: 'hospital',
        doctor_id: null,
        doctor_name: null,
        status: 'recorded',
      }],
    };
  }
  if (lower.includes('invoice_inspector:compensation')) {
    expect(params).toEqual(['tenant-1', 92]);
    return {
      results: [{
        id: 51,
        doctor_id: 7,
        doctor_name: 'Dr. Referrer',
        source_type: 'lab_test',
        incentive_type: 'prescriber',
        rule_id: 77,
        rule_version: 4,
        gross_amount: 1000,
        discount_amount: 200,
        performer_reserve_amount: 100,
        eligible_base_amount: 700,
        rate_label: '12.50%',
        earned_amount: 100,
        waiver_amount: 20,
        adjustment_amount: -5,
        payable_amount: 75,
        paid_amount: 30,
        outstanding_amount: 45,
        reason_code: 'doctor_waived',
        reason_label: 'Doctor waived commission',
        settlement_no: 'SET-7',
        status: 'partially_paid',
      }],
    };
  }
  if (lower.includes('invoice_inspector:audit')) {
    expect(params).toEqual(['tenant-1', 92]);
    return {
      results: [
        {
          id: 'audit:2',
          occurred_at: '2026-07-30 12:00:00',
          event_type: 'payment',
          actor_name: 'Cashier One',
          reference_no: 'RCPT-21',
          status: 'posted',
          description: 'Payment collected',
        },
        {
          id: 'audit:1',
          occurred_at: '2026-07-30 10:00:00',
          event_type: 'create',
          actor_name: 'Reception One',
          reference_no: 'INV-92',
          status: 'partially_paid',
          description: 'Invoice created',
        },
      ],
    };
  }
  if (lower.includes('from canonical_feature_flags')) {
    expect(params).toEqual(['tenant-1', 'canonical_invoice_provider_v1']);
    return { first: null };
  }
  if (lower.includes('as deposit_adjusted') && lower.includes('from bills b')) {
    expect(params).toEqual(['tenant-1', 'INV-92']);
    return {
      results: [{
        id: 92,
        invoice_no: 'INV-92',
        total: 1000,
        paid: 600,
        due: 200,
        deposit_adjusted: 200,
        status: 'partially_paid',
        cancelled_at: null,
        line_count: 1,
      }],
    };
  }
  return null;
}

describe('GET /billing/:billId/inspector', () => {
  it('returns a tenant-scoped composite invoice with separate evidence sections', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      permissions: ['patients:read', 'billing:read'],
      queryOverride: inspectorQueryResult,
    });

    const response = await app.request('/billing/92/inspector');
    expect(response.status).toBe(200);
    const body = await response.json() as InvoiceInspectorResponse;

    expect(body.summary).toMatchObject({
      billId: 92,
      invoiceNo: 'INV-92',
      patientId: 41,
      patientName: 'Patient One',
      patientIdentityRedacted: false,
      grossAmount: 1200,
      discountAmount: 200,
      netAmount: 1000,
      paidAmount: 600,
      depositAppliedAmount: 200,
      dueAmount: 200,
    });
    expect(body.items[0]).toMatchObject({
      category: 'test',
      description: 'CBC',
      orderingDoctorName: 'Dr. Ordering',
      referringDoctorName: 'Dr. Referrer',
      performingDoctorName: 'Dr. Performer',
      verifyingDoctorName: 'Dr. Verifier',
    });
    expect(body.payments[0]).toMatchObject({ receiptNo: 'RCPT-21', amount: 600, counterName: 'Main Counter' });
    expect(body.deposits[0]).toMatchObject({ referenceNo: 'DEP-31', amount: 200, adjustmentType: 'applied' });
    expect(body.discounts[0]).toMatchObject({ sourceType: 'hospital_funded', funderType: 'hospital', amount: 200 });
    expect(body.compensation[0]).toMatchObject({
      ruleId: 77,
      ruleVersion: 4,
      performerReserveAmount: 100,
      eligibleBaseAmount: 700,
      earnedAmount: 100,
      waiverAmount: 20,
      adjustmentAmount: -5,
      payableAmount: 75,
      paidAmount: 30,
      outstandingAmount: 45,
      reasonCode: 'doctor_waived',
    });
    expect(body.audit.map((event) => event.id)).toEqual(['audit:2', 'audit:1']);
    for (const event of body.audit) {
      expect(event).not.toHaveProperty('oldValue');
      expect(event).not.toHaveProperty('newValue');
      expect(event).not.toHaveProperty('payload');
      expect(event).not.toHaveProperty('metadata');
    }
    expect(body.reconciliation.invoice.status).toBe('reconciled');
    expect(body.reconciliation.settlement.status).toBe('reconciled');
    expect(body.reconciliation.compensation.status).toBe('reconciled');
    expect(body.actions).toMatchObject({
      fullBillingUrl: '/api/billing/92',
      printUrl: '/api/pdf/bill/92',
    });

    const inspectorQueries = mockDB.queries.filter((query) => query.sql.includes('invoice_inspector:'));
    expect(inspectorQueries).toHaveLength(7);
    expect(inspectorQueries.every((query) => query.params[0] === 'tenant-1' && query.params[1] === 92)).toBe(true);
  });

  it('redacts patient identity server-side for billing-only users', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: inspectorQueryResult,
    });

    const response = await app.request('/billing/92/inspector');
    expect(response.status).toBe(200);
    const body = await response.json() as InvoiceInspectorResponse;
    expect(body.summary).toMatchObject({
      patientId: null,
      patientName: null,
      patientIdentityRedacted: true,
    });
    expect(body.summary).not.toHaveProperty('patientCode');
  });

  it('keeps valid sections when an optional source is unavailable', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        if (sql.includes('invoice_inspector:discounts')) throw new Error('no such table: bill_discount_allocations');
        return inspectorQueryResult(sql, params);
      },
    });

    const response = await app.request('/billing/92/inspector');
    expect(response.status).toBe(200);
    const body = await response.json() as InvoiceInspectorResponse;
    expect(body.summary.invoiceNo).toBe('INV-92');
    expect(body.items).toHaveLength(1);
    expect(body.discounts).toEqual([]);
    expect(body.warnings).toContain('Discount allocation source is unavailable.');
  });

  it('rejects invalid IDs and unauthorized callers before invoice queries', async () => {
    const invalid = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });
    expect((await invalid.app.request('/billing/0/inspector')).status).toBe(400);
    expect((await invalid.app.request('/billing/not-a-number/inspector')).status).toBe(400);
    expect(invalid.mockDB.queries.some((query) => query.sql.includes('invoice_inspector:'))).toBe(false);

    const unauthorized = createTestAppNoRole({
      route: billingRoutes,
      routePath: '/billing',
      tenantId: 'tenant-1',
    });
    expect((await unauthorized.app.request('/billing/92/inspector')).status).toBe(403);
    expect(unauthorized.mockDB.queries.some((query) => query.sql.includes('invoice_inspector:'))).toBe(false);
  });

  it('returns 404 for a missing or wrong-tenant bill and preserves the existing bill route', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: 'tenant-2',
      queryOverride: (sql) => sql.includes('invoice_inspector:summary') ? { first: null } : null,
    });
    expect((await app.request('/billing/92/inspector')).status).toBe(404);

    const existing = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('FROM bills b JOIN patients p')) {
          return { first: { id: 92, patient_id: 41, invoice_no: 'INV-92', total: 1000, discount: 0, paid: 1000, due: 0 } };
        }
        return { results: [] };
      },
    });
    const existingResponse = await existing.app.request('/billing/92');
    expect(existingResponse.status).toBe(200);
    expect(await existingResponse.json()).toMatchObject({ bill: { id: 92, invoice_no: 'INV-92' } });
  });
});
