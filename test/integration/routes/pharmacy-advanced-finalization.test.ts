import { describe, expect, it } from 'vitest';
import advancedPharmacyRoute from '../../../src/routes/tenant/pharmacy/advanced';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { PATIENT_1, TENANT_1 } from '../helpers/fixtures';

describe('Pharmacy advanced finalization payment validation', () => {
  it('allows card provisional conversion with paid amount and zero tender', async () => {
    const { app } = createTestApp({
      route: advancedPharmacyRoute,
      routePath: '/pharmacy',
      role: 'pharmacist',
      tenantId: TENANT_1.id,
      tables: {
        pharmacy_provisional_invoices: [{
          id: 10,
          tenant_id: TENANT_1.id,
          patient_id: PATIENT_1.id,
          patient_visit_id: null,
          prescriber_id: null,
          counter_id: null,
          discount_pct: 0,
          status: 'active',
          is_active: 1,
        }],
        pharmacy_provisional_items: [{
          id: 11,
          tenant_id: TENANT_1.id,
          provisional_id: 10,
          item_id: 20,
          stock_id: 30,
          batch_no: 'B-001',
          expiry_date: '2027-01-01',
          quantity: 1,
          price: 100,
          sale_price: 100,
          discount_pct: 0,
          vat_pct: 0,
          total_amount: 100,
        }],
        pharmacy_stock: [{
          id: 30,
          tenant_id: TENANT_1.id,
          item_id: 20,
          available_qty: 10,
          cost_price: 50,
          is_active: 1,
        }],
        sequences: [],
      },
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('update pharmacy_stock set available_qty = available_qty -')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/pharmacy/provisional-invoices/10/convert', {
      method: 'POST',
      body: {
        paymentMode: 'card',
        paidAmount: 100,
        creditAmount: 0,
        depositDeductAmount: 0,
        tender: 0,
        discountAmount: 0,
      },
    });

    expect(res.status).toBe(201);
  });

  it('allows mobile prescription dispense-invoice with paid amount and zero tender', async () => {
    const { app } = createTestApp({
      route: advancedPharmacyRoute,
      routePath: '/pharmacy',
      role: 'pharmacist',
      tenantId: TENANT_1.id,
      tables: {
        pharmacy_prescriptions: [{
          id: 15,
          tenant_id: TENANT_1.id,
          patient_id: PATIENT_1.id,
          prescriber_id: null,
          status: 'active',
        }],
        pharmacy_prescription_items: [{
          id: 16,
          tenant_id: TENANT_1.id,
          prescription_id: 15,
          item_id: 25,
          item_name: 'Test medicine',
          quantity: 1,
        }],
        pharmacy_stock: [{
          id: 35,
          tenant_id: TENANT_1.id,
          item_id: 25,
          batch_no: 'B-002',
          mrp: 100,
          sale_price: 100,
          cost_price: 50,
          available_qty: 10,
          expiry_date: '2027-01-01',
          is_active: 1,
        }],
        sequences: [],
      },
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('update pharmacy_stock set available_qty = available_qty -')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/pharmacy/prescriptions/15/dispense-invoice', {
      method: 'POST',
      body: {
        paymentMode: 'mobile',
        paidAmount: 100,
        creditAmount: 0,
        depositDeductAmount: 0,
        tender: 0,
        discountAmount: 0,
      },
    });

    expect(res.status).toBe(201);
  });

  it('rolls back earlier stock deductions when a later provisional item stock guard fails', async () => {
    const { app, mockDB } = createTestApp({
      route: advancedPharmacyRoute,
      routePath: '/pharmacy',
      role: 'pharmacist',
      tenantId: TENANT_1.id,
      tables: {
        pharmacy_provisional_invoices: [{
          id: 10,
          tenant_id: TENANT_1.id,
          patient_id: PATIENT_1.id,
          patient_visit_id: null,
          prescriber_id: null,
          counter_id: null,
          discount_pct: 0,
          status: 'active',
          is_active: 1,
        }],
        pharmacy_provisional_items: [
          {
            id: 11,
            tenant_id: TENANT_1.id,
            provisional_id: 10,
            item_id: 20,
            stock_id: 30,
            batch_no: 'B-001',
            expiry_date: '2027-01-01',
            quantity: 1,
            price: 100,
            sale_price: 100,
            discount_pct: 0,
            vat_pct: 0,
            total_amount: 100,
          },
          {
            id: 12,
            tenant_id: TENANT_1.id,
            provisional_id: 10,
            item_id: 21,
            stock_id: 31,
            batch_no: 'B-002',
            expiry_date: '2027-01-01',
            quantity: 1,
            price: 100,
            sale_price: 100,
            discount_pct: 0,
            vat_pct: 0,
            total_amount: 100,
          },
        ],
        pharmacy_stock: [
          {
            id: 30,
            tenant_id: TENANT_1.id,
            item_id: 20,
            available_qty: 10,
            cost_price: 50,
            is_active: 1,
          },
          {
            id: 31,
            tenant_id: TENANT_1.id,
            item_id: 21,
            available_qty: 10,
            cost_price: 50,
            is_active: 1,
          },
        ],
      },
      queryOverride: (sql, params) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('update pharmacy_stock set available_qty = available_qty -')) {
          return { meta: { changes: params[1] === 31 ? 0 : 1 } };
        }
        if (normalized.includes('update pharmacy_stock set available_qty = available_qty +')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/pharmacy/provisional-invoices/10/convert', {
      method: 'POST',
      body: {
        paymentMode: 'cash',
        paidAmount: 200,
        creditAmount: 0,
        depositDeductAmount: 0,
        tender: 200,
        discountAmount: 0,
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some(q =>
      q.sql.includes('available_qty = available_qty +') && q.params[1] === 30
    )).toBe(true);
  });
});
