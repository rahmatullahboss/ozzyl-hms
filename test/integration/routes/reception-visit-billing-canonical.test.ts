import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import receptionRoute from '../../../src/routes/tenant/reception';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const source = readFileSync('src/routes/tenant/reception.ts', 'utf8');
const start = source.indexOf("receptionRoutes.post('/visits/:visitId/generate-bill'");
const end = source.indexOf('// 8. RECEPTIONIST DAILY REPORT', start);
if (start < 0 || end < 0) throw new Error('Reception generate-bill handler not found');
const handler = source.slice(start, end);

describe('reception visit billing canonical source contract', () => {
  it('integrates the boundary through the split financial coordinator', () => {
    expect(handler).toContain('executeStrictFinancialMutation');
    expect(handler).toContain("boundary: 'reception.visit-billing.create'");
    expect(handler).toContain('executeReceptionVisitBillingOriginalLegacy');
    expect(handler).toContain('prepareReceptionVisitBillingStrictContext');
    expect(handler).toContain('prepareReceptionVisitBillingStrictStatements');
    expect(handler).toContain('strictAuthoritativeStatements: async () =>');
    expect(handler).toContain('createReceptionVisitBilling');
    expect(handler).not.toContain('assertStrictFinancialBoundaryDisabledOrSupported');
  });

  it('removes create-handler financial SQL and keeps strict preparation lazy', () => {
    expect(handler).not.toMatch(/INSERT INTO bills/i);
    expect(handler).not.toMatch(/INSERT INTO invoice_items/i);
    expect(handler).not.toMatch(/SET status = 'billing'/i);
    const strictFactory = handler.indexOf('strictAuthoritativeStatements: async () =>');
    const strictContext = handler.indexOf('prepareReceptionVisitBillingStrictContext', strictFactory);
    const canonicalCallback = handler.indexOf('canonical: async (execution) => {');
    const command = handler.indexOf('createReceptionVisitBilling(c.env.DB', canonicalCallback);
    expect(strictFactory).toBeGreaterThan(-1);
    expect(strictContext).toBeGreaterThan(strictFactory);
    expect(command).toBeGreaterThan(canonicalCallback);
    expect(handler).toContain('authoritativeStatements: execution.authoritativeStatements');
    expect(handler).toContain('issuedAtUtc: new Date().toISOString()');
    expect(handler).toContain('service.service_item_id == null ? null : Number(service.service_item_id)');
  });

  it('reloads committed bill and ordered invoice-item identities before side effects', () => {
    const coordinator = handler.indexOf('executeStrictFinancialMutation');
    const billReload = handler.indexOf('SELECT id FROM bills', coordinator);
    const itemReload = handler.indexOf('FROM invoice_items', coordinator);
    const sideEffects = handler.indexOf('recordBillFinalizationSideEffects', coordinator);
    expect(billReload).toBeGreaterThan(coordinator);
    expect(itemReload).toBeGreaterThan(billReload);
    expect(sideEffects).toBeGreaterThan(itemReload);
    expect(handler).toContain("skipBillAccountingEvent: financialExecution.mode === 'strict'");
    expect(handler).toContain("financialExecution.mode === 'strict'");
    expect(handler).toContain('billItemId: committedInvoiceItems[index]?.id');
  });

  it('preserves request idempotency, scheme usage and response contracts', () => {
    expect(handler).toContain("const mutationType = 'reception_visit_bill'");
    expect(handler).toContain('readMutationIdempotencyReplay');
    expect(handler).toContain('reserveMutationIdempotencyKey');
    expect(handler).toContain('completeMutationIdempotencyKey');
    expect(handler).toContain('recordBillingSchemeUsage');
    expect(handler).toContain("message: 'Bill generated from visit services'");
    expect(handler).toContain('serviceCount: services.length');
  });
});

const VISIT = {
  id: 1,
  tenant_id: '100',
  patient_id: 1,
  doctor_id: 1,
};

const PENDING_SERVICE = {
  id: 31,
  tenant_id: '100',
  visit_id: 1,
  patient_id: 1,
  service_type: 'doctor_visit',
  description: 'Consultation',
  service_item_id: 901,
  doctor_id: 1,
  amount: 500,
  discount_amount: 0,
  quantity: 1,
  total_amount: 500,
  reference_type: null,
  reference_id: null,
  status: 'pending',
  bill_id: null,
};

function runtimeApp(policy: 'shadow' | 'strict', mapped: boolean) {
  const tenantId = policy === 'strict' ? '100' : 'tenant-1';
  const visit = { ...VISIT, tenant_id: tenantId };
  const service = { ...PENDING_SERVICE, tenant_id: tenantId };
  return createTestApp({
    route: receptionRoute,
    routePath: '/reception',
    role: 'receptionist',
    tenantId,
    tables: {
      visits: [visit],
      visit_services: [service],
    },
    universalFallback: true,
    queryOverride(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
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
      if (normalized.includes('from canonical_command_executions')) return { first: null };
      if (normalized.includes('from canonical_outbox_events')) return { first: null };
      if (normalized.includes('from fiscal_years')) return { first: null };
      if (normalized.includes('from accounting_period_closes')) return { first: null };
      if (normalized.includes('insert into sequence_counters')) {
        return { first: { current_value: 1 } };
      }
      if (
        normalized.includes('from canonical_source_mappings')
        && normalized.includes("entity_type='encounter'")
      ) {
        return mapped
          ? { first: { canonical_public_id: 'enc-visit-1', mapping_status: 'mapped' } }
          : { first: null };
      }
      if (normalized.includes('from canonical_source_mappings')) return { first: null };
      if (normalized.includes('from canonical_encounters')) {
        return mapped
          ? { first: { legacy_patient_id: 1, status: 'in_progress' } }
          : { first: null };
      }
      if (
        normalized.includes('from visit_services vs')
        && normalized.includes('join billing_service_items si')
      ) {
        return mapped
          ? {
              first: {
                id: 31,
                service_department_id: 90,
                item_code: 'CONSULT',
                item_name: 'Consultation',
                price: 500,
                department_code: 'OPD',
                department_name: 'Outpatient',
              },
            }
          : { first: null };
      }
      if (
        normalized.includes('from billing_service_items i')
        && normalized.includes('left join billing_service_departments d')
      ) {
        return mapped
          ? {
              first: {
                id: 901,
                service_department_id: 90,
                item_code: 'CONSULT',
                item_name: 'Consultation',
                price: 500,
                is_active: 1,
                department_code: 'OPD',
                department_name: 'Outpatient',
              },
            }
          : { first: null };
      }
      if (
        normalized.includes('from canonical_service_catalog_items')
        && normalized.includes('canonical_code')
      ) return { first: null };
      if (normalized === 'select id from bills where tenant_id = ? and invoice_no = ? limit 1') {
        return { first: { id: 41 } };
      }
      if (normalized.includes('from invoice_items') && normalized.includes('order by id asc')) {
        return { results: [{ id: 51 }] };
      }
      return null;
    },
  });
}

const BILL_REQUEST = {
  discount: 500,
  discountByName: 'Manager',
};

describe('reception visit billing canonical runtime policy', () => {
  it('preserves legacy success and records an issue when shadow projection fails', async () => {
    const { app, mockDB } = runtimeApp('shadow', false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
        method: 'POST',
        body: BILL_REQUEST,
      });
      expect(res.status).toBe(201);
      await expect(res.json()).resolves.toMatchObject({
        message: 'Bill generated from visit services',
        total: 0,
        serviceCount: 1,
      });
      expect(mockDB.queries.some((query) => (
        /INSERT INTO canonical_processing_issues/i.test(query.sql)
      ))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('preserves the legacy reference fallback when service_item_id is null', async () => {
    const tenantId = 'tenant-1';
    const { app, mockDB } = createTestApp({
      route: receptionRoute,
      routePath: '/reception',
      role: 'receptionist',
      tenantId,
      tables: {
        visits: [{ ...VISIT, tenant_id: tenantId }],
        visit_services: [{
          ...PENDING_SERVICE,
          tenant_id: tenantId,
          service_item_id: null,
          reference_type: 'manual_service',
          reference_id: 777,
        }],
      },
      universalFallback: true,
      queryOverride(sql) {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized.includes('from canonical_feature_flags')) return { first: null };
        if (normalized.includes('from fiscal_years')) return { first: null };
        if (normalized.includes('from accounting_period_closes')) return { first: null };
        if (normalized.includes('insert into sequence_counters')) {
          return { first: { current_value: 1 } };
        }
        if (normalized === 'select id from bills where tenant_id = ? and invoice_no = ? limit 1') {
          return { first: { id: 41 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
      method: 'POST',
      body: BILL_REQUEST,
    });
    expect(res.status).toBe(201);
    const invoiceItem = mockDB.queries.find((query) => /INSERT INTO invoice_items/i.test(query.sql));
    expect(invoiceItem?.params).toContain(777);
    expect(invoiceItem?.params).not.toContain(0);
  });

  it('fails strict mode before invoice allocation or legacy mutation when encounter mapping is missing', async () => {
    const { app, mockDB } = runtimeApp('strict', false);
    const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
      method: 'POST',
      body: BILL_REQUEST,
    });
    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) => /INSERT INTO sequence_counters/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO bills/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /UPDATE visit_services/i.test(query.sql))).toBe(false);
  });

  it('commits guarded visit-service and canonical invoice authority in one strict batch', async () => {
    const { app, mockDB } = runtimeApp('strict', true);
    const res = await jsonRequest(app, '/reception/visits/1/generate-bill', {
      method: 'POST',
      body: BILL_REQUEST,
    });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      billId: 41,
      total: 0,
      serviceCount: 1,
      message: 'Bill generated from visit services',
    });
    expect(mockDB.batchCalls.some((statements) => (
      statements.some((sql) => /UPDATE visit_services/i.test(sql))
      && statements.some((sql) => /INSERT INTO bills/i.test(sql))
      && statements.some((sql) => /INSERT INTO canonical_service_requests/i.test(sql))
      && statements.some((sql) => /INSERT INTO canonical_invoices/i.test(sql))
    ))).toBe(true);
  });
});
