import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import advancedPharmacyRoute from '../../../src/routes/tenant/pharmacy/advanced';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { PATIENT_1, TENANT_1 } from '../helpers/fixtures';

const source = readFileSync('src/routes/tenant/pharmacy/advanced.ts', 'utf8');

function section(startToken: string, endToken: string): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  if (start < 0 || end < 0) throw new Error(`Route section not found: ${startToken}`);
  return source.slice(start, end);
}

const provisional = section(
  "advancedRoutes.post('/provisional-invoices/:id/convert'",
  "advancedRoutes.get('/prescriptions'",
);
const prescription = section(
  "advancedRoutes.post('/prescriptions/:id/dispense-invoice'",
  "advancedRoutes.get('/narcotics'",
);

describe('pharmacy canonical finalization source contract', () => {
  it('integrates provisional conversion through the strict financial coordinator', () => {
    expect(provisional).toContain('executeStrictFinancialMutation');
    expect(provisional).toContain("boundary: 'pharmacy.billing.finalize'");
    expect(provisional).toContain('executePharmacyProvisionalOriginalLegacy');
    expect(provisional).toContain('preparePharmacyProvisionalStrictContext');
    expect(provisional).toContain('preparePharmacyProvisionalStrictStatements');
    expect(provisional).toContain('strictAuthoritativeStatements: async () =>');
    expect(provisional).toContain('settlePharmacySale');
    expect(provisional).toContain('hydratePharmacySaleCanonicalAuthority');
    expect(provisional).not.toContain('assertStrictFinancialBoundaryDisabledOrSupported');
    expect(provisional).not.toMatch(/INSERT INTO pharmacy_invoices/i);
    expect(provisional).not.toMatch(/UPDATE pharmacy_stock/i);
    expect(provisional).not.toMatch(/INSERT INTO billing_deposits/i);
  });

  it('integrates prescription dispense through the same canonical command', () => {
    expect(prescription).toContain('executeStrictFinancialMutation');
    expect(prescription).toContain("boundary: 'pharmacy.billing.finalize'");
    expect(prescription).toContain('executePharmacyPrescriptionOriginalLegacy');
    expect(prescription).toContain('preparePharmacyPrescriptionStrictContext');
    expect(prescription).toContain('preparePharmacyPrescriptionStrictStatements');
    expect(prescription).toContain('strictAuthoritativeStatements: async () =>');
    expect(prescription).toContain('settlePharmacySale');
    expect(prescription).toContain('hydratePharmacySaleCanonicalAuthority');
    expect(prescription).not.toContain('assertStrictFinancialBoundaryDisabledOrSupported');
    expect(prescription).not.toMatch(/INSERT INTO pharmacy_invoices/i);
    expect(prescription).not.toMatch(/UPDATE pharmacy_stock/i);
    expect(prescription).not.toMatch(/INSERT INTO billing_deposits/i);
  });

  it('keeps canonical projection lazy and passes strict authority to the command', () => {
    for (const route of [provisional, prescription]) {
      const callback = route.indexOf('canonical: async (execution) => {');
      const hydrate = route.indexOf('hydratePharmacySaleCanonicalAuthority', callback);
      const command = route.indexOf('settlePharmacySale(c.env.DB', callback);
      expect(callback).toBeGreaterThan(-1);
      expect(hydrate).toBeGreaterThan(callback);
      expect(command).toBeGreaterThan(hydrate);
      expect(route).toContain('authoritativeStatements: execution.authoritativeStatements');
    }
  });

  it('reloads committed invoice identity and preserves the existing response contracts', () => {
    for (const route of [provisional, prescription]) {
      const coordinator = route.indexOf('executeStrictFinancialMutation');
      const reload = route.indexOf('SELECT id FROM pharmacy_invoices', coordinator);
      expect(reload).toBeGreaterThan(coordinator);
      expect(route).toContain('invoiceId');
      expect(route).toContain('invoiceNo');
      expect(route).toContain('totalAmount');
    }
    expect(provisional).toContain('Provisional invoice converted to final invoice');
    expect(prescription).toContain('Prescription dispensed and invoice created');
  });
});

function makeRuntimeApp(policy: 'shadow' | 'strict') {
  const tenantId = TENANT_1.id;
  return createTestApp({
    route: advancedPharmacyRoute,
    routePath: '/pharmacy',
    role: 'pharmacist',
    tenantId,
    tables: {
      pharmacy_provisional_invoices: [{
        id: 10, tenant_id: tenantId, patient_id: PATIENT_1.id,
        patient_visit_id: null, prescriber_id: null, counter_id: null,
        discount_pct: 0, status: 'active', is_active: 1,
      }],
      pharmacy_provisional_items: [{
        id: 11, tenant_id: tenantId, provisional_id: 10, item_id: 20,
        stock_id: 30, batch_no: 'B-001', expiry_date: '2027-01-01',
        quantity: 1, price: 100, sale_price: 100,
        discount_pct: 0, vat_pct: 0, total_amount: 100,
      }],
      pharmacy_prescriptions: [{
        id: 15, tenant_id: tenantId, patient_id: PATIENT_1.id,
        patient_visit_id: null, prescriber_id: null, status: 'active',
      }],
      pharmacy_prescription_items: [{
        id: 16, tenant_id: tenantId, prescription_id: 15,
        item_id: 25, item_name: 'Test medicine', quantity: 1,
      }],
      pharmacy_stock: [
        {
          id: 30, tenant_id: tenantId, item_id: 20, batch_no: 'B-001',
          mrp: 100, sale_price: 100, cost_price: 50,
          available_qty: 10, expiry_date: '2027-01-01', is_active: 1,
        },
        {
          id: 35, tenant_id: tenantId, item_id: 25, batch_no: 'B-002',
          mrp: 100, sale_price: 100, cost_price: 50,
          available_qty: 10, expiry_date: '2027-01-01', is_active: 1,
        },
      ],
      sequences: [],
    },
    queryOverride: (sql) => {
      const normalized = sql.toLowerCase();
      if (normalized.includes('from canonical_feature_flags')) {
        return {
          first: {
            tenant_id: tenantId,
            flag_key: 'canonical_financial_dual_write_v1',
            domain: 'financial',
            mode: 'shadow',
            is_enabled: 1,
            config_json: JSON.stringify({ writePolicy: policy, tenantScope: [tenantId] }),
          },
        };
      }
      if (normalized.includes('from pharmacy_items') && normalized.includes('canonical_inventory_items')) {
        return { first: null };
      }
      if (
        normalized.includes('update pharmacy_stock set available_qty = available_qty -')
        || normalized.includes('update pharmacy_stock set available_qty=available_qty-')
      ) {
        return { meta: { changes: 1 } };
      }
      return null;
    },
  });
}

describe('pharmacy canonical finalization runtime policy', () => {
  it('preserves provisional legacy success when shadow canonical projection fails', async () => {
    const { app, mockDB } = makeRuntimeApp('shadow');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await jsonRequest(app, '/pharmacy/provisional-invoices/10/convert', {
        method: 'POST',
        body: {
          paymentMode: 'card', paidAmount: 100, creditAmount: 0,
          depositDeductAmount: 0, tender: 0, discountAmount: 0,
        },
      });
      expect(res.status).toBe(201);
      expect(mockDB.queries.some((query) => /INSERT INTO canonical_processing_issues/i.test(query.sql))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('preserves prescription legacy success when shadow canonical projection fails', async () => {
    const { app, mockDB } = makeRuntimeApp('shadow');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await jsonRequest(app, '/pharmacy/prescriptions/15/dispense-invoice', {
        method: 'POST',
        body: {
          paymentMode: 'mobile', paidAmount: 100, creditAmount: 0,
          depositDeductAmount: 0, tender: 0, discountAmount: 0,
        },
      });
      expect(res.status).toBe(201);
      expect(mockDB.queries.some((query) => /INSERT INTO canonical_processing_issues/i.test(query.sql))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('fails provisional strict preflight before sequence or legacy mutation', async () => {
    const { app, mockDB } = makeRuntimeApp('strict');
    const res = await jsonRequest(app, '/pharmacy/provisional-invoices/10/convert', {
      method: 'POST',
      body: {
        paymentMode: 'cash', paidAmount: 100, creditAmount: 0,
        depositDeductAmount: 0, tender: 100, discountAmount: 0,
      },
    });
    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) => /INSERT INTO sequence_counters/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO pharmacy_invoices/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /available_qty\s*=\s*available_qty\s*-/i.test(query.sql))).toBe(false);
  });

  it('fails prescription strict preflight before sequence or legacy mutation', async () => {
    const { app, mockDB } = makeRuntimeApp('strict');
    const res = await jsonRequest(app, '/pharmacy/prescriptions/15/dispense-invoice', {
      method: 'POST',
      body: {
        paymentMode: 'cash', paidAmount: 100, creditAmount: 0,
        depositDeductAmount: 0, tender: 100, discountAmount: 0,
      },
    });
    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) => /INSERT INTO sequence_counters/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO pharmacy_invoices/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /available_qty\s*=\s*available_qty\s*-/i.test(query.sql))).toBe(false);
  });
});
