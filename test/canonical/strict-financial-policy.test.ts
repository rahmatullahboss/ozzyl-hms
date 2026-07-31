import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  resolveStrictFinancialPolicy,
  STRICT_FINANCIAL_FLAG_KEY,
} from '../../src/lib/canonical/strict-financial-policy';

interface FlagRow {
  tenant_id: string;
  flag_key: string;
  domain: string;
  mode: string;
  is_enabled: number;
  config_json: string | null;
}

class RecordingStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly row: FlagRow | null,
    private readonly failure: Error | null,
    readonly sql: string,
    readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): RecordingStatement {
    return new RecordingStatement(this.row, this.failure, this.sql, values);
  }

  async run(): Promise<unknown> {
    throw new Error('run is not supported by the policy test database');
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (this.failure) throw this.failure;
    return this.row as T | null;
  }
}

function recordingDb(row: FlagRow | null = null, failure: Error | null = null): {
  db: CanonicalBatchDatabase;
  queries: string[];
} {
  const queries: string[] = [];
  return {
    queries,
    db: {
      prepare(sql: string) {
        queries.push(sql);
        return new RecordingStatement(row, failure, sql);
      },
      async batch() {
        throw new Error('batch is not supported by the policy test database');
      },
    },
  };
}

function enabledFlag(patch: Partial<FlagRow> = {}): FlagRow {
  return {
    tenant_id: '100',
    flag_key: STRICT_FINANCIAL_FLAG_KEY,
    domain: 'financial',
    mode: 'shadow',
    is_enabled: 1,
    config_json: JSON.stringify({ writePolicy: 'strict', tenantScope: ['100'] }),
    ...patch,
  };
}

function canonicalOnlyFlag(patch: Partial<FlagRow> = {}): FlagRow {
  return enabledFlag({
    mode: 'canonical',
    config_json: JSON.stringify({ writePolicy: 'canonical-only', tenantScope: ['100'] }),
    ...patch,
  });
}

describe('tenant-scoped financial shadow/strict policy', () => {
  it('reads the tenant-specific flag and treats an absent row as legacy-only', async () => {
    const { db, queries } = recordingDb();

    await expect(resolveStrictFinancialPolicy(db, '99')).resolves.toEqual({
      enabled: false,
      writePolicy: 'legacy',
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/canonical_feature_flags/);
  });

  it('treats an absent or disabled tenant-100 flag as legacy-only', async () => {
    await expect(resolveStrictFinancialPolicy(recordingDb().db, '100')).resolves.toEqual({
      enabled: false,
      writePolicy: 'legacy',
    });
    await expect(
      resolveStrictFinancialPolicy(recordingDb(enabledFlag({ mode: 'disabled', is_enabled: 0 })).db, '100'),
    ).resolves.toEqual({ enabled: false, writePolicy: 'legacy' });
  });

  it('accepts only the exact tenant-100 strict shadow configuration', async () => {
    const { db, queries } = recordingDb(enabledFlag());

    await expect(resolveStrictFinancialPolicy(db, '100')).resolves.toEqual({
      enabled: true,
      writePolicy: 'strict',
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/effective_at_utc/);
    expect(queries[0]).toMatch(/expires_at_utc/);
  });

  it('rejects the retired tenant-100 canonical-only configuration', async () => {
    await expect(
      resolveStrictFinancialPolicy(recordingDb(canonicalOnlyFlag()).db, '100'),
    ).rejects.toMatchObject({
      code: 'CANONICAL_STRICT_POLICY_INVALID',
      status: 409,
    });
  });

  it.each<Partial<FlagRow>>([
    { tenant_id: '101' },
    { flag_key: 'canonical_reporting_v1' },
    { mode: 'canonical' },
    { domain: 'reporting' },
    { config_json: '{"writePolicy":"async","tenantScope":["100"]}' },
    { config_json: '{"writePolicy":"strict","tenantScope":["100","101"]}' },
    { config_json: '{"writePolicy":"strict","tenantScope":["100"],"extra":true}' },
    { config_json: 'not-json' },
  ])('fails closed for malformed enabled policy %#', async (patch) => {
    await expect(resolveStrictFinancialPolicy(recordingDb(enabledFlag(patch)).db, '100')).rejects.toMatchObject({
      code: 'CANONICAL_STRICT_POLICY_INVALID',
      status: 409,
    });
  });

  it.each<Partial<FlagRow>>([
    { mode: 'shadow' },
    { config_json: '{"writePolicy":"strict","tenantScope":["100"]}' },
    { config_json: '{"writePolicy":"canonical-only","tenantScope":["100","101"]}' },
    { config_json: '{"writePolicy":"canonical-only","tenantScope":["100"],"extra":true}' },
  ])('fails closed for malformed canonical-only policy %#', async (patch) => {
    await expect(
      resolveStrictFinancialPolicy(recordingDb(canonicalOnlyFlag(patch)).db, '100'),
    ).rejects.toMatchObject({
      code: 'CANONICAL_STRICT_POLICY_INVALID',
      status: 409,
    });
  });

  it('fails closed when tenant-100 policy storage cannot be read', async () => {
    const storageError = new Error('policy storage unavailable');

    await expect(resolveStrictFinancialPolicy(recordingDb(null, storageError).db, '100')).rejects.toBe(storageError);
  });
});
