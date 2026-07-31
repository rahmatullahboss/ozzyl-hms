import { describe, expect, it, vi } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { executeStrictFinancialMutation } from '../../src/lib/canonical/strict-financial-mutation';

type WritePolicy = 'legacy' | 'shadow' | 'strict';

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly writePolicy: WritePolicy,
    private readonly sql: string,
  ) {}

  bind(): Statement {
    return this;
  }

  async run(): Promise<unknown> {
    return { success: true, sql: this.sql };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (!/canonical_feature_flags/i.test(this.sql) || this.writePolicy === 'legacy') return null;
    return {
      tenant_id: '100',
      flag_key: 'canonical_financial_dual_write_v1',
      domain: 'financial',
      mode: 'shadow',
      is_enabled: 1,
      config_json: JSON.stringify({
        writePolicy: this.writePolicy,
        tenantScope: ['100'],
      }),
    } as T;
  }
}

function harness(writePolicy: WritePolicy) {
  let batchCalls = 0;
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(writePolicy, sql);
    },
    async batch(statements) {
      batchCalls += 1;
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  return { db, getBatchCalls: () => batchCalls };
}

describe('strict financial mutation legacy/shadow isolation', () => {
  it('keeps shadow canonical failure isolated from the original legacy executor', async () => {
    const { db, getBatchCalls } = harness('shadow');
    const legacyResult = [{ success: true, legacy: 'unchanged' }];
    const legacyExecutor = vi.fn(async () => legacyResult);
    const legacyPostCommit = vi.fn(async () => {
      throw new Error('legacy accounting side effect unavailable');
    });
    const strictAuthoritativeStatements = vi.fn(async () => {
      throw new Error('strict statements must stay lazy in shadow mode');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await executeStrictFinancialMutation({
      db,
      tenantId: '100',
      boundary: 'appointment.billing.finalize',
      legacyExecutor,
      legacyPostCommit,
      strictAuthoritativeStatements,
      canonical: async (execution) => {
        expect(execution.authoritativeStatements).toBeUndefined();
        throw new Error('canonical projection unavailable');
      },
    });

    expect(result).toMatchObject({
      mode: 'shadow',
      canonicalSucceeded: false,
      canonicalErrorCode: 'CANONICAL_SHADOW_WRITE_FAILED',
    });
    expect(result.result).toBe(legacyResult);
    expect(legacyExecutor).toHaveBeenCalledTimes(1);
    expect(legacyPostCommit).toHaveBeenCalledTimes(1);
    expect(strictAuthoritativeStatements).not.toHaveBeenCalled();
    expect(getBatchCalls()).toBe(0);
    errorSpy.mockRestore();
  });

  it('uses strict authoritative statements without invoking the legacy executor', async () => {
    const { db } = harness('strict');
    const legacyExecutor = vi.fn(async () => [{ success: true, legacy: true }]);
    const legacyPostCommit = vi.fn(async () => undefined);
    const strictStatements = [db.prepare('INSERT INTO strict_only VALUES (1)')];
    const strictAuthoritativeStatements = vi.fn(() => strictStatements);

    const result = await executeStrictFinancialMutation({
      db,
      tenantId: '100',
      boundary: 'appointment.billing.finalize',
      legacyExecutor,
      legacyPostCommit,
      strictAuthoritativeStatements,
      canonical: async (execution) => {
        expect(execution.authoritativeStatements).toBe(strictStatements);
        return { invoicePublicId: 'invoice_1' };
      },
    });

    expect(result.mode).toBe('strict');
    expect(strictAuthoritativeStatements).toHaveBeenCalledTimes(1);
    expect(legacyExecutor).not.toHaveBeenCalled();
    expect(legacyPostCommit).not.toHaveBeenCalled();
  });

  it('awaits asynchronous strict statement preparation before canonical execution', async () => {
    const { db } = harness('strict');
    const legacyExecutor = vi.fn(async () => [{ success: true, legacy: true }]);
    const strictStatements = [db.prepare('INSERT INTO strict_async_only VALUES (1)')];
    let factoryResolved = false;
    const strictAuthoritativeStatements = vi.fn(async () => {
      await Promise.resolve();
      factoryResolved = true;
      return strictStatements;
    });

    const result = await executeStrictFinancialMutation({
      db,
      tenantId: '100',
      boundary: 'appointment.billing.finalize',
      legacyExecutor,
      strictAuthoritativeStatements,
      canonical: async (execution) => {
        expect(factoryResolved).toBe(true);
        expect(execution.authoritativeStatements).toBe(strictStatements);
        return { invoicePublicId: 'invoice_async' };
      },
    });

    expect(result).toMatchObject({
      mode: 'strict',
      result: { invoicePublicId: 'invoice_async' },
    });
    expect(strictAuthoritativeStatements).toHaveBeenCalledTimes(1);
    expect(legacyExecutor).not.toHaveBeenCalled();
  });

  it('reads a bundled strict statement set while legacy mode executes only the original array', async () => {
    const strictHarness = harness('strict');
    const originalLegacyStatements = [strictHarness.db.prepare('INSERT INTO legacy_only VALUES (1)')];
    const strictAuthoritativeStatements = [strictHarness.db.prepare('INSERT INTO strict_only VALUES (1)')];
    const bundledStrictFactory = vi.fn(() => strictAuthoritativeStatements);
    const strictLegacyPostCommit = vi.fn(async () => undefined);
    Object.defineProperties(originalLegacyStatements, {
      strictAuthoritativeStatements: {
        value: bundledStrictFactory,
        enumerable: false,
      },
      legacyPostCommit: {
        value: strictLegacyPostCommit,
        enumerable: false,
      },
    });

    await executeStrictFinancialMutation({
      db: strictHarness.db,
      tenantId: '100',
      boundary: 'appointment.billing.finalize',
      legacyStatements: originalLegacyStatements,
      canonical: async (execution) => {
        expect(execution.authoritativeStatements).toBe(strictAuthoritativeStatements);
        return { invoicePublicId: 'invoice_2' };
      },
    });

    expect(strictHarness.getBatchCalls()).toBe(0);
    expect(bundledStrictFactory).toHaveBeenCalledTimes(1);
    expect(strictLegacyPostCommit).not.toHaveBeenCalled();

    const legacyHarness = harness('legacy');
    const legacyStatements = [legacyHarness.db.prepare('INSERT INTO legacy_only VALUES (1)')];
    const bundledLegacyStrictFactory = vi.fn(() => {
      throw new Error('bundled strict statements must stay lazy in legacy mode');
    });
    const bundledLegacyPostCommit = vi.fn(async () => undefined);
    Object.defineProperties(legacyStatements, {
      strictAuthoritativeStatements: {
        value: bundledLegacyStrictFactory,
        enumerable: false,
      },
      legacyPostCommit: {
        value: bundledLegacyPostCommit,
        enumerable: false,
      },
    });

    await executeStrictFinancialMutation({
      db: legacyHarness.db,
      tenantId: '101',
      boundary: 'appointment.billing.finalize',
      legacyStatements,
      canonical: async () => ({ invoicePublicId: 'must-not-run' }),
    });

    expect(legacyHarness.getBatchCalls()).toBe(1);
    expect(bundledLegacyStrictFactory).not.toHaveBeenCalled();
    expect(bundledLegacyPostCommit).toHaveBeenCalledTimes(1);
  });

  it('uses the original legacy executor when canonical financial writes are disabled', async () => {
    const { db } = harness('legacy');
    const legacyResult = [{ success: true, legacy: 'unchanged' }];
    const legacyExecutor = vi.fn(async () => legacyResult);
    const strictAuthoritativeStatements = vi.fn(async () => {
      throw new Error('strict statements must stay lazy in legacy mode');
    });

    const result = await executeStrictFinancialMutation({
      db,
      tenantId: '101',
      boundary: 'appointment.billing.finalize',
      legacyExecutor,
      strictAuthoritativeStatements,
      canonical: async () => {
        throw new Error('must not run');
      },
    });

    expect(result).toEqual({ mode: 'legacy', result: legacyResult });
    expect(legacyExecutor).toHaveBeenCalledTimes(1);
    expect(strictAuthoritativeStatements).not.toHaveBeenCalled();
  });
});
