import { beforeEach, describe, expect, it, vi } from 'vitest';

const canonicalMocks = vi.hoisted(() => ({
  executeStrictFinancialMutation: vi.fn(),
  buildLiveDepositProjection: vi.fn(),
  recordDeposit: vi.fn(),
  refundAvailableDeposits: vi.fn(),
  applyAvailableDeposits: vi.fn(),
}));

vi.mock('../../../src/lib/canonical/strict-financial-mutation', () => ({
  executeStrictFinancialMutation: canonicalMocks.executeStrictFinancialMutation,
}));

vi.mock('../../../src/lib/canonical/live-financial-projection', () => ({
  buildLiveDepositProjection: canonicalMocks.buildLiveDepositProjection,
}));

vi.mock('../../../src/lib/canonical/commands/apply-deposit', () => ({
  recordDeposit: canonicalMocks.recordDeposit,
}));

vi.mock('../../../src/lib/canonical/commands/allocate-deposit-balance', () => ({
  refundAvailableDeposits: canonicalMocks.refundAvailableDeposits,
  applyAvailableDeposits: canonicalMocks.applyAvailableDeposits,
}));

import depositsRoute from '../../../src/routes/tenant/deposits';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { ACTIVE_BILLING_COUNTER_TABLES, PATIENT_1, TENANT_1 } from '../helpers/fixtures';

const canonicalInput = {
  tenantId: String(TENANT_1.id),
  depositPublicId: 'dep_test',
  depositNumber: 'DEP-TEST',
  receiptPublicId: 'payrcpt_test',
  sourceType: 'legacy_live_deposit',
  sourcePublicId: 'DEP-TEST',
  sourceTable: 'billing_deposits',
  sourceEvidenceSha256: 'a'.repeat(64),
  idempotencyKey: 'legacy_live_deposit:DEP-TEST',
  outboxEventPublicId: 'outevt_test',
};

function appHarness(queryOverride?: (sql: string, params: unknown[]) => any | null) {
  return createTestApp({
    route: depositsRoute,
    routePath: '/deposits',
    role: 'receptionist',
    tenantId: TENANT_1.id,
    tables: {
      ...ACTIVE_BILLING_COUNTER_TABLES,
      patients: [PATIENT_1],
      billing_deposits: [],
      sequences: [],
      cash_ledger_entries: [],
      sequence_counters: [],
    },
    queryOverride,
  });
}

function refundHarness() {
  return createTestApp({
    route: depositsRoute,
    routePath: '/deposits',
    role: 'hospital_admin',
    tenantId: TENANT_1.id,
    tables: {
      ...ACTIVE_BILLING_COUNTER_TABLES,
      patients: [PATIENT_1],
      billing_deposits: [{
        id: 801,
        tenant_id: TENANT_1.id,
        patient_id: PATIENT_1.id,
        deposit_receipt_no: 'DEP-OLD',
        amount: 5000,
        transaction_type: 'deposit',
        payment_method: 'cash',
        is_active: 1,
      }],
      sequences: [],
      cash_ledger_entries: [],
      sequence_counters: [],
    },
  });
}

function applicationHarness(options: { includeCanonicalMapping?: boolean } = {}) {
  return createTestApp({
    route: depositsRoute,
    routePath: '/deposits',
    role: 'receptionist',
    tenantId: TENANT_1.id,
    tables: {
      ...ACTIVE_BILLING_COUNTER_TABLES,
      patients: [PATIENT_1],
      bills: [{
        id: 901,
        tenant_id: TENANT_1.id,
        invoice_no: 'INV-901',
        patient_id: PATIENT_1.id,
        total: 5000,
        paid: 0,
        due: 5000,
        status: 'open',
      }],
      billing_deposits: [{
        id: 801,
        tenant_id: TENANT_1.id,
        patient_id: PATIENT_1.id,
        deposit_receipt_no: 'DEP-OLD',
        amount: 5000,
        transaction_type: 'deposit',
        payment_method: 'cash',
        is_active: 1,
      }],
      sequences: [],
      cash_ledger_entries: [],
      sequence_counters: [],
    },
    queryOverride(sql) {
      if (
        options.includeCanonicalMapping !== false
        && sql.includes('FROM canonical_source_mappings')
        && sql.includes("entity_type='invoice'")
      ) {
        return { first: { canonical_public_id: 'inv-canonical-901' } };
      }
      return null;
    },
  });
}

describe('deposit collection canonical strict adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canonicalMocks.buildLiveDepositProjection.mockResolvedValue(canonicalInput);
    canonicalMocks.recordDeposit.mockResolvedValue({
      replayed: false,
      result: { depositPublicId: 'dep_test', amountMinor: 300_000, availableMinor: 300_000 },
    });
    canonicalMocks.refundAvailableDeposits.mockResolvedValue({
      status: 'applied',
      result: {
        operationPublicId: 'depop_test',
        refundedMinor: 100_000,
        allocations: [{
          refundPublicId: 'depref_test',
          depositPublicId: 'dep_test',
          amountMinor: 100_000,
          availableMinor: 200_000,
        }],
      },
    });
    canonicalMocks.applyAvailableDeposits.mockResolvedValue({
      status: 'applied',
      result: {
        operationPublicId: 'depop_apply_test',
        appliedMinor: 100_000,
        invoiceNetDueMinor: 200_000,
        allocations: [],
      },
    });
  });

  it('composes legacy collection statements with recordDeposit in shadow mode', async () => {
    canonicalMocks.executeStrictFinancialMutation.mockImplementation(async (input: any) => {
      const result = await input.db.batch([...input.legacyStatements]);
      const canonicalResult = await input.canonical({});
      return {
        mode: 'shadow',
        result,
        canonicalSucceeded: true,
        canonicalResult,
      };
    });
    const { app } = appHarness();

    const response = await jsonRequest(app, '/deposits', {
      method: 'POST',
      body: {
        patient_id: PATIENT_1.id,
        amount: 3000,
        payment_method: 'cash',
        remarks: 'Canonical shadow deposit',
      },
    });

    expect(response.status).toBe(201);
    expect(canonicalMocks.executeStrictFinancialMutation).toHaveBeenCalledTimes(1);
    const executionInput = canonicalMocks.executeStrictFinancialMutation.mock.calls[0][0];
    expect(executionInput.boundary).toBe('deposit.collect');
    expect(executionInput.tenantId).toBe(String(TENANT_1.id));
    expect(executionInput.legacyStatements).toHaveLength(4);
    expect(canonicalMocks.buildLiveDepositProjection).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: String(TENANT_1.id),
      patientId: PATIENT_1.id,
      amount: 3000,
      tenderType: 'cash',
      methodCode: 'cash',
    }));
    expect(canonicalMocks.recordDeposit).toHaveBeenCalledWith(
      expect.anything(),
      canonicalInput,
      {},
    );
  });

  it('passes the legacy statements into recordDeposit for one strict atomic batch', async () => {
    canonicalMocks.recordDeposit.mockImplementation(async (db: D1Database, input: unknown, options: any) => {
      expect(input).toBe(canonicalInput);
      expect(options.authoritativeStatements).toHaveLength(4);
      await db.batch([...options.authoritativeStatements]);
      return {
        replayed: false,
        result: { depositPublicId: 'dep_test', amountMinor: 300_000, availableMinor: 300_000 },
      };
    });
    canonicalMocks.executeStrictFinancialMutation.mockImplementation(async (input: any) => ({
      mode: 'strict',
      result: await input.canonical({ authoritativeStatements: input.legacyStatements }),
    }));
    const { app, mockDB } = appHarness((sql) => {
      if (sql.includes('SELECT id FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ?')) {
        return { first: { id: 1201 } };
      }
      return null;
    });

    const response = await jsonRequest(app, '/deposits', {
      method: 'POST',
      body: {
        patient_id: PATIENT_1.id,
        amount: 3000,
        payment_method: 'bkash',
        remarks: 'Canonical strict deposit',
      },
    });

    expect(response.status).toBe(201);
    expect(canonicalMocks.buildLiveDepositProjection).toHaveBeenCalledWith(expect.objectContaining({
      tenderType: 'mobile_wallet',
      methodCode: 'bkash',
    }));
    expect(canonicalMocks.recordDeposit).toHaveBeenCalledTimes(1);
    expect(mockDB.batchCalls.some((call) => call.some((sql) => sql.includes('INSERT INTO billing_deposits')))).toBe(true);
  });

  it('composes aggregate legacy refund statements with the oldest-source canonical refund command', async () => {
    canonicalMocks.executeStrictFinancialMutation.mockImplementation(async (input: any) => {
      const result = await input.db.batch([...input.legacyStatements]);
      const canonicalResult = await input.canonical({});
      return {
        mode: 'shadow',
        result,
        canonicalSucceeded: true,
        canonicalResult,
      };
    });
    const { app } = refundHarness();

    const response = await jsonRequest(app, '/deposits/refund', {
      method: 'POST',
      body: {
        patient_id: PATIENT_1.id,
        amount: 1000,
        payment_method: 'cash',
        remarks: 'Canonical deposit refund',
      },
    });

    expect(response.status).toBe(201);
    const executionInput = canonicalMocks.executeStrictFinancialMutation.mock.calls[0][0];
    expect(executionInput.boundary).toBe('deposit.refund');
    expect(executionInput.legacyStatements).toHaveLength(4);
    expect(canonicalMocks.refundAvailableDeposits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: String(TENANT_1.id),
        legacyPatientId: PATIENT_1.id,
        amountMinor: 100_000,
        tenderType: 'cash',
        methodCode: 'cash',
        sourceType: 'legacy_live_deposit_refund_operation',
        sourceTable: 'billing_deposits',
      }),
      {},
    );
  });

  it('keeps legacy deposit adjustment working when canonical mode is disabled and no invoice mapping exists', async () => {
    canonicalMocks.executeStrictFinancialMutation.mockImplementation(async (input: any) => ({
      mode: 'legacy',
      result: await input.db.batch([...input.legacyStatements]),
    }));
    const { app } = applicationHarness({ includeCanonicalMapping: false });

    const response = await jsonRequest(app, '/deposits/adjust', {
      method: 'POST',
      body: {
        patient_id: PATIENT_1.id,
        bill_id: 901,
        amount: 1000,
        remarks: 'Legacy-only deposit application',
      },
    });

    expect(response.status).toBe(201);
    expect(canonicalMocks.executeStrictFinancialMutation).toHaveBeenCalledTimes(1);
    expect(canonicalMocks.applyAvailableDeposits).not.toHaveBeenCalled();
  });

  it('composes deposit adjustment, bill update and custody evidence with the mapped canonical invoice', async () => {
    canonicalMocks.executeStrictFinancialMutation.mockImplementation(async (input: any) => {
      const result = await input.db.batch([...input.legacyStatements]);
      const canonicalResult = await input.canonical({});
      return {
        mode: 'shadow',
        result,
        canonicalSucceeded: true,
        canonicalResult,
      };
    });
    const { app } = applicationHarness();

    const response = await jsonRequest(app, '/deposits/adjust', {
      method: 'POST',
      body: {
        patient_id: PATIENT_1.id,
        bill_id: 901,
        amount: 1000,
        remarks: 'Canonical deposit application',
      },
    });

    expect(response.status).toBe(201);
    const executionInput = canonicalMocks.executeStrictFinancialMutation.mock.calls[0][0];
    expect(executionInput.boundary).toBe('deposit.apply');
    expect(executionInput.legacyStatements).toHaveLength(5);
    expect(canonicalMocks.applyAvailableDeposits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: String(TENANT_1.id),
        legacyPatientId: PATIENT_1.id,
        amountMinor: 100_000,
        invoicePublicId: 'inv-canonical-901',
        invoiceLinePublicId: null,
        sourceType: 'legacy_live_deposit_application_operation',
        sourceTable: 'billing_deposits',
      }),
      {},
    );
  });
});
