import { describe, expect, it, vi } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { executeStrictFinancialMutation } from '../../src/lib/canonical/strict-financial-mutation';
import { assertStrictFinancialBoundaryDisabledOrSupported } from '../../src/lib/canonical/strict-financial-boundaries';

type FlagMode = 'none' | 'shadow' | 'strict' | 'invalid-scope';

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly state: {
      tenantId: string;
      flagMode: FlagMode;
      legacyRows: number;
      flagReads: number;
      issueWrites: Array<{ sql: string; values: unknown[] }>;
      failIssueWrites: boolean;
    },
    private readonly sql: string,
    private values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    this.values = values;
    if (/canonical_feature_flags/i.test(this.sql) && values.length > 0) {
      this.state.tenantId = String(values[0]);
    }
    return this;
  }

  async run(): Promise<unknown> {
    if (/INSERT INTO legacy_financial/i.test(this.sql)) this.state.legacyRows += 1;
    if (/canonical_processing_issues/i.test(this.sql)) {
      if (this.state.failIssueWrites) throw new Error('issue table unavailable');
      this.state.issueWrites.push({ sql: this.sql, values: this.values });
    }
    return { success: true, meta: { changes: 1 } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (!/canonical_feature_flags/i.test(this.sql)) return null;
    this.state.flagReads += 1;
    if (this.state.flagMode === 'none') return null;

    const writePolicy = this.state.flagMode === 'strict' ? 'strict' : 'shadow';
    const tenantScope = this.state.flagMode === 'invalid-scope'
      ? ['100']
      : [this.state.tenantId];

    return {
      tenant_id: this.state.tenantId,
      flag_key: 'canonical_financial_dual_write_v1',
      domain: 'financial',
      mode: 'shadow',
      is_enabled: 1,
      config_json: JSON.stringify({ tenantScope, writePolicy }),
    } as T;
  }
}

function harness(tenantId: string, flagMode: FlagMode, options: { failIssueWrites?: boolean } = {}) {
  const state = {
    tenantId,
    flagMode,
    legacyRows: 0,
    flagReads: 0,
    issueWrites: [] as Array<{ sql: string; values: unknown[] }>,
    failIssueWrites: options.failIssueWrites ?? false,
  };
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(state, sql);
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return { db, state };
}

describe('all-tenant non-blocking financial shadow mode', () => {
  it('enables shadow writes for an opted-in live tenant other than tenant 100', async () => {
    const { db, state } = harness('101', 'shadow');
    let canonicalRuns = 0;

    const result = await executeStrictFinancialMutation({
      db,
      tenantId: '101',
      boundary: 'billing.create',
      legacyStatements: [db.prepare('INSERT INTO legacy_financial VALUES (1)')],
      canonical: async (options) => {
        canonicalRuns += 1;
        expect(options.authoritativeStatements).toBeUndefined();
        return { canonicalId: 'invoice_101' };
      },
    });

    expect(result).toMatchObject({ mode: 'shadow', canonicalSucceeded: true });
    expect(state.legacyRows).toBe(1);
    expect(state.flagReads).toBe(1);
    expect(canonicalRuns).toBe(1);
  });

  it('records a safe canonical issue without blocking the authoritative legacy transaction', async () => {
    const { db, state } = harness('102', 'shadow');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const canonicalError = Object.assign(
      new Error('patient 01712345678 canonical unavailable'),
      { code: 'D1_CANONICAL_WRITE_FAILED' },
    );

    const result = await executeStrictFinancialMutation({
      db,
      tenantId: '102',
      boundary: 'billing.payment.collect',
      legacyStatements: [db.prepare('INSERT INTO legacy_financial VALUES (1)')],
      canonical: async () => {
        throw canonicalError;
      },
    });

    expect(result).toMatchObject({
      mode: 'shadow',
      canonicalSucceeded: false,
      canonicalErrorCode: 'CANONICAL_SHADOW_WRITE_FAILED',
    });
    expect(state.legacyRows).toBe(1);
    expect(state.issueWrites).toHaveLength(1);
    expect(state.issueWrites[0].sql).toContain('canonical_processing_issues');
    expect(state.issueWrites[0].sql).toContain('occurrence_count = canonical_processing_issues.occurrence_count + 1');
    const recordedValues = JSON.stringify(state.issueWrites[0].values);
    expect(recordedValues).toContain('billing.payment.collect');
    expect(recordedValues).toContain('D1_CANONICAL_WRITE_FAILED');
    expect(recordedValues).not.toContain('01712345678');
    expect(recordedValues).not.toContain('patient 01712345678 canonical unavailable');
    expect(errorSpy).toHaveBeenCalledWith(
      'Canonical financial shadow write failed',
      expect.objectContaining({
        tenantId: '102',
        boundary: 'billing.payment.collect',
        causeName: 'Error',
        causeCode: 'D1_CANONICAL_WRITE_FAILED',
        causeMessageHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    errorSpy.mockRestore();
  });

  it('still returns legacy success when canonical issue recording is unavailable', async () => {
    const { db, state } = harness('102', 'shadow', { failIssueWrites: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await executeStrictFinancialMutation({
      db,
      tenantId: '102',
      boundary: 'billing.payment.collect',
      legacyStatements: [db.prepare('INSERT INTO legacy_financial VALUES (1)')],
      canonical: async () => {
        throw new Error('canonical unavailable');
      },
    });

    expect(result).toMatchObject({
      mode: 'shadow',
      canonicalSucceeded: false,
      canonicalErrorCode: 'CANONICAL_SHADOW_WRITE_FAILED',
    });
    expect(state.legacyRows).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Canonical financial shadow issue recording failed',
      expect.objectContaining({ tenantId: '102', boundary: 'billing.payment.collect' }),
    );
    errorSpy.mockRestore();
  });

  it('rejects a cross-tenant or malformed shadow scope before any financial mutation', async () => {
    const { db, state } = harness('101', 'invalid-scope');

    await expect(executeStrictFinancialMutation({
      db,
      tenantId: '101',
      boundary: 'billing.create',
      legacyStatements: [db.prepare('INSERT INTO legacy_financial VALUES (1)')],
      canonical: async () => ({ canonicalId: 'must-not-run' }),
    })).rejects.toMatchObject({ code: 'CANONICAL_STRICT_POLICY_INVALID', status: 409 });

    expect(state.legacyRows).toBe(0);
  });

  it('does not block unsupported boundaries while a tenant is in non-blocking shadow mode', async () => {
    const { db } = harness('104', 'shadow');

    await expect(assertStrictFinancialBoundaryDisabledOrSupported(
      db,
      '104',
      'billing-cancellation.cancel',
    )).resolves.toBeUndefined();
  });

  it('preserves ordinary legacy-only behavior for a tenant without an enabled flag', async () => {
    const { db, state } = harness('103', 'none');

    const result = await executeStrictFinancialMutation({
      db,
      tenantId: '103',
      boundary: 'billing.create',
      legacyStatements: [db.prepare('INSERT INTO legacy_financial VALUES (1)')],
      canonical: async () => {
        throw new Error('must not run');
      },
    });

    expect(result.mode).toBe('legacy');
    expect(state.legacyRows).toBe(1);
    expect(state.flagReads).toBe(1);
  });
});
