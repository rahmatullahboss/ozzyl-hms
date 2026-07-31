import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import settlementsRoute from '../../../src/routes/tenant/settlements';
import { createTestApp, jsonRequest } from '../helpers/test-app';

function postHandlerSource(): string {
  const source = readFileSync('src/routes/tenant/settlements.ts', 'utf8');
  const start = source.indexOf("settlements.post('/',");
  const end = source.indexOf("settlements.put('/:id/cancel'", start);
  if (start < 0 || end < 0) throw new Error('Could not locate settlement POST handler');
  return source.slice(start, end);
}

describe('settlement finalization canonical source contract', () => {
  it('integrates the POST boundary through the strict financial coordinator', () => {
    const route = readFileSync('src/routes/tenant/settlements.ts', 'utf8');
    const handler = postHandlerSource();

    expect(route).toContain('executeStrictFinancialMutation');
    expect(route).toContain('executeSettlementOriginalLegacy');
    expect(route).toContain('prepareSettlementStrictContext');
    expect(route).toContain('prepareSettlementStrictStatements');
    expect(route).toContain('finalizeSettlement');
    expect(handler).toContain("boundary: 'settlement.finalize'");
    expect(handler).not.toContain('assertStrictFinancialBoundaryDisabledOrSupported');
  });

  it('removes POST financial mutation SQL from route ownership', () => {
    const handler = postHandlerSource();

    for (const sql of [
      'INSERT INTO billing_settlements',
      'UPDATE bills\n        SET paid',
      'INSERT INTO payments',
      'INSERT INTO billing_deposits',
      'INSERT INTO bill_discount_allocations',
      'INSERT INTO emp_cash_transactions',
      'INSERT OR IGNORE INTO accounting_posting_events',
    ]) expect(handler).not.toContain(sql);
  });

  it('keeps strict preparation lazy and preserves mode-specific post-commit ordering', () => {
    const handler = postHandlerSource();
    const legacy = handler.indexOf('legacyExecutor: async () =>');
    const legacyPostCommit = handler.indexOf('legacyPostCommit: async () =>');
    const factory = handler.indexOf('strictAuthoritativeStatements: async () =>');
    const canonical = handler.indexOf('canonical: async (execution) =>');
    const command = handler.indexOf('finalizeSettlement', canonical);

    expect(legacy).toBeGreaterThan(0);
    expect(legacyPostCommit).toBeGreaterThan(legacy);
    expect(factory).toBeGreaterThan(legacyPostCommit);
    expect(canonical).toBeGreaterThan(factory);
    expect(command).toBeGreaterThan(canonical);
    expect(handler).toContain('authoritativeStatements: execution.authoritativeStatements');
    expect(handler).toContain("financialExecution.mode === 'strict'");
    expect(handler).toContain('billIds: [...context.requestedBillIds]');
  });
});

const TENANT = '100';
const PATIENT_ID = 501;
const BILL = {
  id: 1,
  tenant_id: TENANT,
  patient_id: PATIENT_ID,
  invoice_no: 'INV-1',
  total: 500,
  paid: 0,
  due: 500,
  status: 'due',
  settlement_id: null,
};

const REQUEST = {
  patient_id: PATIENT_ID,
  bill_ids: [1],
  paid_amount: 500,
  deposit_deducted: 0,
  discount_amount: 0,
  payment_mode: 'cash',
};

function runtimeApp(policy: 'shadow' | 'strict', mapped: boolean) {
  return createTestApp({
    route: settlementsRoute,
    routePath: '/settlements',
    role: 'accountant',
    tenantId: TENANT,
    userId: 1,
    tables: {
      bills: [BILL],
      billing_counters: [{
        id: 7,
        tenant_id: TENANT,
        counter_name: 'Main Counter',
        counter_code: 'C-1',
        counter_type: 'billing',
        is_active: 1,
      }],
      billing_counter_sessions: [{
        id: 8,
        tenant_id: TENANT,
        employee_id: 1,
        counter_id: 7,
        counter_type: 'billing',
        opening_cash: 0,
        opened_at: '2026-07-24T08:00:00.000Z',
        status: 'active',
        workstation_id: null,
        heartbeat_at: null,
        variance_approval_status: null,
      }],
    },
    universalFallback: true,
    queryOverride(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.includes('from canonical_feature_flags')) {
        return {
          first: {
            tenant_id: TENANT,
            flag_key: 'canonical_financial_dual_write_v1',
            domain: 'financial',
            mode: 'shadow',
            is_enabled: 1,
            config_json: JSON.stringify({ writePolicy: policy, tenantScope: [TENANT] }),
          },
        };
      }
      if (normalized.includes('from fiscal_years')) return { first: null };
      if (normalized.includes('from accounting_period_closes')) return { first: null };
      if (normalized.includes('insert into sequence_counters')) return { first: { current_value: 1 } };
      if (normalized.includes('from canonical_outbox_events')) return { first: null };
      if (
        normalized.includes('from canonical_source_mappings')
        && normalized.includes("entity_type='invoice'")
      ) {
        if (normalized.includes('canonical_public_id<>?')) return { first: null };
        return mapped ? { first: { canonical_public_id: 'inv-1' } } : { first: null };
      }
      if (
        normalized.includes('from canonical_invoices')
        && normalized.includes('legacy_patient_id')
      ) {
        return mapped
          ? {
              first: {
                legacy_patient_id: PATIENT_ID,
                currency_code: 'BDT',
                total_minor: 50_000,
                paid_minor: 0,
                due_minor: 50_000,
                credited_minor: 0,
                net_due_minor: 50_000,
                status: 'posted',
              },
            }
          : { first: null };
      }
      if (
        normalized.includes('from billing_deposits')
        && normalized.includes(' as balance')
      ) return { first: { balance: 0 } };
      if (normalized.includes('from canonical_deposits')) return { first: null };
      if (
        normalized.includes('from billing_settlements')
        && normalized.includes('settlement_receipt_no=?')
        && normalized.startsWith('select id')
      ) return { first: { id: 41 } };
      return null;
    },
  });
}

describe('settlement finalization canonical runtime policy', () => {
  it('preserves legacy success and records an issue when shadow projection fails', async () => {
    const { app, mockDB } = runtimeApp('shadow', false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await jsonRequest(app, '/settlements', {
        method: 'POST',
        body: REQUEST,
      });
      expect(res.status).toBe(201);
      await expect(res.json()).resolves.toMatchObject({
        message: 'Settlement created',
        receipt_no: expect.any(String),
      });
      expect(mockDB.queries.some((query) => (
        /INSERT INTO canonical_processing_issues/i.test(query.sql)
      ))).toBe(true);
      const cashLedgerIndex = mockDB.queries.findIndex((query) => (
        /INSERT INTO cash_ledger_entries/i.test(query.sql)
      ));
      const canonicalMappingIndex = mockDB.queries.findIndex((query) => (
        /FROM canonical_source_mappings/i.test(query.sql)
      ));
      expect(cashLedgerIndex).toBeGreaterThanOrEqual(0);
      expect(canonicalMappingIndex).toBeGreaterThan(cashLedgerIndex);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('fails strict mode before sequence or legacy mutation when invoice mapping is missing', async () => {
    const { app, mockDB } = runtimeApp('strict', false);
    const res = await jsonRequest(app, '/settlements', {
      method: 'POST',
      body: REQUEST,
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) => /INSERT INTO sequence_counters/i.test(query.sql))).toBe(false);
    expect(mockDB.batchCalls.some((statements) => (
      statements.some((sql) => /INSERT INTO billing_settlements/i.test(sql))
    ))).toBe(false);
  });

  it('commits legacy settlement and canonical payment authority in one strict batch', async () => {
    const { app, mockDB } = runtimeApp('strict', true);
    const res = await jsonRequest(app, '/settlements', {
      method: 'POST',
      body: REQUEST,
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      id: 41,
      message: 'Settlement created',
      receipt_no: expect.any(String),
    });
    expect(mockDB.batchCalls.some((statements) => (
      statements.some((sql) => /INSERT INTO billing_settlements/i.test(sql))
      && statements.some((sql) => /UPDATE bills/i.test(sql))
      && statements.some((sql) => /INSERT INTO canonical_payment_receipts/i.test(sql))
      && statements.some((sql) => /UPDATE canonical_invoices/i.test(sql))
    ))).toBe(true);
  });
});
