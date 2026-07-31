import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  assertStrictFinancialBoundaryDisabledOrSupported,
} from '../../src/lib/canonical/strict-financial-boundaries';
import { executeStrictFinancialMutation } from '../../src/lib/canonical/strict-financial-mutation';

type TestWritePolicy = 'legacy' | 'shadow' | 'strict' | 'canonical-only';

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly state: {
      legacyRows: number;
      canonicalRows: number;
      flagReads: number;
      batchCalls: number;
      writePolicy: TestWritePolicy;
    },
    private readonly sql: string,
  ) {}

  bind(): Statement {
    return this;
  }

  async run(): Promise<unknown> {
    if (/INSERT INTO legacy_financial/i.test(this.sql)) this.state.legacyRows += 1;
    return { success: true };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (!/canonical_feature_flags/i.test(this.sql)) return null;
    this.state.flagReads += 1;
    if (this.state.writePolicy === 'legacy') return null;
    const canonicalOnly = this.state.writePolicy === 'canonical-only';
    return {
      tenant_id: '100',
      flag_key: 'canonical_financial_dual_write_v1',
      domain: 'financial',
      mode: canonicalOnly ? 'canonical' : 'shadow',
      is_enabled: 1,
      config_json: JSON.stringify({
        writePolicy: canonicalOnly ? 'canonical-only' : this.state.writePolicy,
        tenantScope: ['100'],
      }),
    } as T;
  }
}

function harness(writePolicy: TestWritePolicy = 'legacy') {
  const state = { legacyRows: 0, canonicalRows: 0, flagReads: 0, batchCalls: 0, writePolicy };
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(state, sql);
    },
    async batch(statements) {
      state.batchCalls += 1;
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return { db, state };
}

describe('strict financial mutation coordinator', () => {
  it('runs the ordinary legacy batch for a tenant without an enabled flag', async () => {
    const { db, state } = harness('legacy');
    const legacyStatements = [db.prepare('INSERT INTO legacy_financial VALUES (1)')];

    const result = await executeStrictFinancialMutation({
      db,
      tenantId: '101',
      boundary: 'billing.create',
      legacyStatements,
      canonical: async () => {
        throw new Error('must not run');
      },
    });

    expect(result.mode).toBe('legacy');
    expect(state.legacyRows).toBe(1);
    expect(state.flagReads).toBe(1);
  });

  it('skips an empty legacy batch for a post-commit shadow projection', async () => {
    const { db, state } = harness('shadow');

    const result = await executeStrictFinancialMutation({
      db,
      tenantId: '100',
      boundary: 'reception.admission.deposit.collect',
      legacyStatements: [],
      canonical: async () => {
        state.canonicalRows += 1;
        return { depositPublicId: 'dep_1' };
      },
    });

    expect(result.mode).toBe('shadow');
    expect(state.batchCalls).toBe(0);
    expect(state.canonicalRows).toBe(1);
  });

  it('passes the same legacy statements to canonical execution for enabled tenant 100', async () => {
    const { db, state } = harness('strict');
    const legacyStatements = [db.prepare('INSERT INTO legacy_financial VALUES (1)')];

    const result = await executeStrictFinancialMutation({
      db,
      tenantId: '100',
      boundary: 'billing.create',
      legacyStatements,
      canonical: async (execution) => {
        expect(execution.authoritativeStatements).toBe(legacyStatements);
        return db.batch([...(execution.authoritativeStatements ?? [])]);
      },
    });

    expect(result.mode).toBe('strict');
    expect(state.legacyRows).toBe(1);
    expect(state.flagReads).toBe(1);
  });

  it('converts canonical failure into a safe strict error', async () => {
    const { db, state } = harness('strict');

    await expect(executeStrictFinancialMutation({
      db,
      tenantId: '100',
      boundary: 'billing.payment.collect',
      legacyStatements: [db.prepare('INSERT INTO legacy_financial VALUES (1)')],
      canonical: async () => {
        throw new Error('internal canonical detail');
      },
    })).rejects.toMatchObject({ code: 'CANONICAL_STRICT_WRITE_FAILED', status: 409 });

    expect(state.legacyRows).toBe(0);
  });

  it('rejects the retired canonical-only policy before either authority writes', async () => {
    const { db, state } = harness('canonical-only');

    await expect(executeStrictFinancialMutation({
      db,
      tenantId: '100',
      boundary: 'billing.create',
      legacyStatements: [db.prepare('INSERT INTO legacy_financial VALUES (1)')],
      canonical: async () => {
        state.canonicalRows += 1;
        return { canonicalId: 'inv_1' };
      },
    })).rejects.toMatchObject({ code: 'CANONICAL_STRICT_POLICY_INVALID', status: 409 });

    expect(state.legacyRows).toBe(0);
    expect(state.canonicalRows).toBe(0);
  });

  it('fails unsupported enabled tenant-100 boundaries before mutation', async () => {
    const { db } = harness('strict');

    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '100',
      'billing-cancellation.cancel',
    )).rejects.toMatchObject({ code: 'CANONICAL_STRICT_BOUNDARY_UNSUPPORTED' });
    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '100',
      'billing.create',
    )).resolves.toBeUndefined();
    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '100',
      'doctor-compensation.settle',
    )).resolves.toBeUndefined();
    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '100',
      'doctor-compensation.reverse',
    )).resolves.toBeUndefined();
    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '100',
      'deposit.collect',
    )).resolves.toBeUndefined();
    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '100',
      'reception.admission.deposit.collect',
    )).resolves.toBeUndefined();
    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '100',
      'deposit.refund',
    )).resolves.toBeUndefined();
    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '100',
      'deposit.apply',
    )).resolves.toBeUndefined();
    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '100',
      'credit-note.approve',
    )).resolves.toBeUndefined();
    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '100',
      'credit-note.cash-refund',
    )).resolves.toBeUndefined();
    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '100',
      'bill.cancel.unpaid',
    )).resolves.toBeUndefined();
  });

});
