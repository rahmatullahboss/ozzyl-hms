import { describe, expect, it } from 'vitest';
import {
  buildFinancialStrictFlagSql,
  executeFinancialStrictFlagChange,
  FINANCIAL_STRICT_FLAG_KEY,
  validateFinancialStrictActivationEvidence,
  type FinancialStrictActivationEvidence,
} from '../../scripts/canonical/set-production-financial-dual-write-flag';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

function evidence(): FinancialStrictActivationEvidence {
  return {
    schemaVersion: 1,
    authorizationId: '[REDACTED_SECRET]',
    tenantId: '100',
    operator: 'Rahmatullah Zisan',
    productionDatabaseId: CDB101_PRODUCTION_DATABASE_ID,
    candidateVersionId: 'candidate-version-placeholder',
    candidateCommit: 'a'.repeat(40),
    observedAtUtc: '2026-07-18T08:00:00.000Z',
    expiresAtUtc: '2026-07-18T12:00:00.000Z',
    baselineBundleSha256: 'b'.repeat(64),
    sourceExportSha256: 'c'.repeat(64),
    reconciliationReady: true,
    tenant101LegacySmokePassed: true,
    tenant100DualWriteAtomicSmokePassed: true,
    rollbackRehearsalPassed: true,
  };
}

describe('tenant financial flag', () => {
  it('writes only the exact tenant-100 strict shadow policy', () => {
    const sql = buildFinancialStrictFlagSql({
      action: 'enable',
      evidence: evidence(),
      effectiveAtUtc: '2026-07-18T08:00:00.000Z',
    });
    expect(sql).toContain("tenant_id = '100'");
    expect(sql).toContain("'canonical_financial_dual_write_v1'");
    expect(sql).toContain("'financial'");
    expect(sql).toContain("'shadow'");
    expect(sql).toContain('{"tenantScope":["100"],"writePolicy":"strict"}');
    expect(sql).not.toMatch(/canonical_reporting_v1|tenant_id\s*!=/);
  });

  it('fails closed when reconciliation is not ready', () => {
    const invalid = evidence();
    invalid.reconciliationReady = false;
    const result = validateFinancialStrictActivationEvidence(invalid, '2026-07-18T08:01:00.000Z');
    expect(result).toContain('CDB101_FINANCIAL_RECONCILIATION_NOT_READY');
  });

  it('rejects a retired canonical-only previous state before writing the strict flag', async () => {
    const valid = evidence();
    let writes = 0;
    const canonicalOnly = {
      tenant_id: '100',
      flag_key: FINANCIAL_STRICT_FLAG_KEY,
      domain: 'financial',
      mode: 'canonical',
      is_enabled: 1,
      config_json: '{"tenantScope":["100"],"writePolicy":"canonical-only"}',
    };

    await expect(executeFinancialStrictFlagChange({
      action: 'enable',
      evidence: valid,
      atUtc: '2026-07-18T08:01:00.000Z',
      effectiveAtUtc: '2026-07-18T08:00:00.000Z',
      approval: valid.authorizationId,
      execute: true,
    }, {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readDeploymentVersions() {
        return [
          { versionId: 'active-baseline', percentage: 100 },
          { versionId: valid.candidateVersionId, percentage: 0 },
        ];
      },
      async readFlag() {
        return [canonicalOnly];
      },
      async writeFlag() {
        writes += 1;
        return { changes: 1, rowsWritten: 1 };
      },
    })).rejects.toThrow('Financial strict flag previous state is unsafe');

    expect(writes).toBe(0);
  });

  it('fails before flag reads or writes when the zero-traffic deployment candidate does not match evidence', async () => {
    const valid = evidence();
    let flagReads = 0;
    let writes = 0;

    await expect(executeFinancialStrictFlagChange({
      action: 'enable',
      evidence: valid,
      atUtc: '2026-07-18T08:01:00.000Z',
      effectiveAtUtc: '2026-07-18T08:00:00.000Z',
      approval: valid.authorizationId,
      execute: true,
    }, {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readDeploymentVersions() {
        return [
          { versionId: 'active-baseline', percentage: 100 },
          { versionId: 'different-production-worker', percentage: 0 },
        ];
      },
      async readFlag() {
        flagReads += 1;
        return [];
      },
      async writeFlag() {
        writes += 1;
        return { changes: 1, rowsWritten: 1 };
      },
    })).rejects.toThrow('one 100-percent baseline and the evidence candidate at zero traffic');

    expect(flagReads).toBe(0);
    expect(writes).toBe(0);
  });

  it('does not call production commands without execute and an approval receipt', async () => {
    let calls = 0;
    const result = await executeFinancialStrictFlagChange({
      action: 'enable',
      evidence: evidence(),
      atUtc: '2026-07-18T08:01:00.000Z',
      effectiveAtUtc: '2026-07-18T08:00:00.000Z',
      approval: null,
      execute: false,
    }, {
      async readDatabaseIdentity() {
        calls += 1;
        throw new Error('must not run');
      },
      async readDeploymentVersions() {
        calls += 1;
        throw new Error('must not run');
      },
      async readFlag() {
        calls += 1;
        throw new Error('must not run');
      },
      async writeFlag() {
        calls += 1;
        throw new Error('must not run');
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'CDB101_FINANCIAL_EXECUTE_SWITCH_MISSING',
      'CDB101_FINANCIAL_APPROVAL_MISMATCH',
    ]));
    expect(calls).toBe(0);
  });
});
