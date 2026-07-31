import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import radiologyOrders from '../../../src/routes/tenant/radiology/orders';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TENANT_ID = 'tenant-1';
const routeSource = readFileSync('src/routes/tenant/radiology/orders.ts', 'utf8');

function section(startToken: string, endToken: string): string {
  const start = routeSource.indexOf(startToken);
  const end = routeSource.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0) throw new Error(`Route section not found: ${startToken}`);
  return routeSource.slice(start, end);
}

const createHandler = section(
  "app.post('/', requireRole(...RAD_WRITE)",
  '// GET SINGLE REQUISITION',
);

describe('radiology order canonical source contract', () => {
  it('integrates the primary RIS create handler through the split financial coordinator', () => {
    expect(createHandler).toContain('executeStrictFinancialMutation');
    expect(createHandler).toContain("boundary: 'radiology.billing.create'");
    expect(createHandler).toContain('executeRadiologyOrderOriginalLegacy');
    expect(createHandler).toContain('prepareRadiologyOrderStrictContext');
    expect(createHandler).toContain('prepareRadiologyOrderStrictStatements');
    expect(createHandler).toContain('strictAuthoritativeStatements: async () =>');
    expect(createHandler).toContain('createRadiologyRequisitionBilling');
    expect(createHandler).not.toContain('assertStrictFinancialBoundaryDisabledOrSupported');
    expect(createHandler).not.toMatch(/INSERT INTO radiology_requisitions/i);
    expect(createHandler).not.toMatch(/INSERT INTO bills/i);
    expect(createHandler).not.toMatch(/INSERT INTO invoice_items/i);
    expect(createHandler).not.toMatch(/UPDATE radiology_requisitions/i);
  });

  it('keeps canonical projection lazy and passes strict authority into the command', () => {
    const callback = createHandler.indexOf('canonical: async (execution) => {');
    const command = createHandler.indexOf('createRadiologyRequisitionBilling(c.env.DB', callback);
    expect(callback).toBeGreaterThan(-1);
    expect(command).toBeGreaterThan(callback);
    expect(createHandler).toContain('authoritativeStatements: execution.authoritativeStatements');
  });

  it('reloads actual committed identities and preserves idempotency and response contracts', () => {
    const coordinator = createHandler.indexOf('executeStrictFinancialMutation');
    expect(createHandler.indexOf('FROM radiology_requisitions r', coordinator)).toBeGreaterThan(coordinator);
    expect(createHandler).toContain('completeMutationIdempotencyKey');
    expect(createHandler).toContain("mutationType: 'ris_requisition_create'");
    expect(createHandler).toContain("message: 'Requisition created'");
    expect(createHandler).toContain('requisitionId');
    expect(createHandler).toContain('billId');
    expect(createHandler).toContain('invoiceNo');
    expect(createHandler).toContain('total');
    expect(createHandler).toContain("financialExecution.mode === 'strict'");
    expect(createHandler).toContain('canonicalSourceLineId: buildLegacyLiveInvoiceSourceLineId');
    expect(createHandler).toContain('referenceId: context.imagingItem.billingServiceItemId');
  });
});

function mappedBillingRow() {
  return {
    id: 10,
    imaging_type_id: 2,
    imaging_type_name: 'X-Ray',
    name: 'Chest X-Ray',
    procedure_code: 'CXR',
    price: 1200,
    billing_service_item_id: 901,
  };
}

function runtimeApp(
  policy: 'shadow' | 'strict',
  mapped: boolean,
  canonicalRecovery: 'fail' | 'pass' = 'fail',
) {
  const tenantId = policy === 'strict' ? '100' : TENANT_ID;
  return createTestApp({
    route: radiologyOrders,
    routePath: '/radiology/orders',
    role: 'doctor',
    tenantId,
    universalFallback: true,
    queryOverride: (sql) => {
      const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
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
      if (normalized.includes('from radiology_imaging_items') && normalized.includes('where i.id = ?')) {
        return { first: mapped ? mappedBillingRow() : { ...mappedBillingRow(), billing_service_item_id: null } };
      }
      if (normalized.includes('from radiology_imaging_items') && normalized.includes('where id = ?')) {
        return { first: { id: 10 } };
      }
      if (normalized.includes('from radiology_imaging_types') && normalized.includes('select name')) {
        return { first: { name: 'X-Ray' } };
      }
      if (normalized.includes('from canonical_source_mappings')) return { first: null };
      if (normalized.includes('from canonical_service_catalog_items') && normalized.includes('canonical_code')) {
        return { first: null };
      }
      if (normalized.includes('from billing_service_items i') && normalized.includes('left join billing_service_departments')) {
        return canonicalRecovery === 'pass'
          ? {
              first: {
                id: 901,
                service_department_id: 90,
                item_code: 'CXR',
                item_name: 'Chest X-Ray',
                price: 1200,
                is_active: 1,
                department_code: 'RAD',
                department_name: 'Radiology',
              },
            }
          : { first: null };
      }
      if (normalized.includes('select r.id as requisition_id')) {
        return { first: { requisition_id: 41, bill_id: 71, invoice_item_id: 81 } };
      }
      return null;
    },
  });
}

const mappedRequest = {
  patient_id: 1,
  visit_id: 11,
  imaging_type_id: 2,
  imaging_item_id: 10,
  imaging_date: '2026-07-24',
  urgency: 'urgent',
  idempotencyKey: 'ris-canonical-001',
};

describe('radiology order canonical runtime policy', () => {
  it('preserves legacy free-text zero-value success', async () => {
    const { app } = createTestApp({
      route: radiologyOrders,
      routePath: '/radiology/orders',
      role: 'doctor',
      tenantId: TENANT_ID,
      universalFallback: true,
    });
    const res = await jsonRequest(app, '/radiology/orders', {
      method: 'POST',
      body: {
        patient_id: 1,
        imaging_type_name: 'Outside Scan',
        imaging_item_name: 'Imported MRI',
        procedure_code: 'EXT-MRI',
        imaging_date: '2026-07-24',
        idempotencyKey: 'ris-free-text-001',
      },
    });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ total: 0, message: 'Requisition created' });
  });

  it('preserves legacy success and records an issue when shadow projection fails', async () => {
    const { app, mockDB } = runtimeApp('shadow', true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await jsonRequest(app, '/radiology/orders', {
        method: 'POST',
        body: mappedRequest,
      });
      expect(res.status).toBe(201);
      expect(mockDB.queries.some((query) => /INSERT INTO canonical_processing_issues/i.test(query.sql))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('runs strict preflight and fails before sequences or legacy mutation when mapping is absent', async () => {
    const { app, mockDB } = runtimeApp('strict', false);
    const res = await jsonRequest(app, '/radiology/orders', {
      method: 'POST',
      body: { ...mappedRequest, idempotencyKey: 'ris-strict-missing-001' },
    });
    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('FROM radiology_imaging_items i') && query.params.includes(10)
    )).toBe(true);
    expect(mockDB.queries.some((query) => /INSERT INTO sequence_counters/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO radiology_requisitions/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO bills/i.test(query.sql))).toBe(false);
  });

  it('commits guarded legacy and canonical radiology authority in one strict batch', async () => {
    const { app, mockDB } = runtimeApp('strict', true, 'pass');
    const res = await jsonRequest(app, '/radiology/orders', {
      method: 'POST',
      body: { ...mappedRequest, idempotencyKey: 'ris-strict-mapped-001' },
    });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      id: 41,
      billId: 71,
      total: 1200,
      message: 'Requisition created',
    });
    expect(mockDB.batchCalls.some((statements) => (
      statements.some((sql) => /INSERT INTO radiology_requisitions/i.test(sql))
      && statements.some((sql) => /INSERT INTO bills/i.test(sql))
      && statements.some((sql) => /INSERT INTO canonical_service_requests/i.test(sql))
      && statements.some((sql) => /INSERT INTO canonical_invoices/i.test(sql))
    ))).toBe(true);
    expect(mockDB.queries.some((query) =>
      /UPDATE billing_mutation_idempotency_keys/i.test(query.sql)
      && query.params.some((param) => typeof param === 'string' && param.includes('Requisition created'))
    )).toBe(true);
  });
});
