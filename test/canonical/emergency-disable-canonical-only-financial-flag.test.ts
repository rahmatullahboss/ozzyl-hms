import { describe, expect, it } from 'vitest';
import {
  buildEmergencyCanonicalOnlyDisableSql,
  executeEmergencyCanonicalOnlyRollback,
  type EmergencyCanonicalOnlyRollbackEvidence,
  type EmergencyCanonicalOnlyRollbackGateway,
} from '../../scripts/canonical/emergency-disable-canonical-only-financial-flag';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

const AUTHORIZATION = 'CDB101-RESTORE-ORIGINAL-STRICT-DUAL-WRITE-20260718';

function evidence(): EmergencyCanonicalOnlyRollbackEvidence {
  return {
    schemaVersion: 1,
    authorizationId: AUTHORIZATION,
    tenantId: '100',
    operator: 'Rahmatullah Zisan',
    productionDatabaseId: CDB101_PRODUCTION_DATABASE_ID,
    activeWorkerVersionId: '773c19f6-e992-4a75-a734-bb1f90eff376',
    expectedFlagVersion: 1,
    expectedEffectiveAtUtc: '2026-07-18T07:25:09Z',
    activationLocalTimestamp: '2026-07-18 13:25:09',
    observedAtUtc: '2026-07-18T13:50:00.000Z',
    expiresAtUtc: '2026-07-18T15:00:00.000Z',
  };
}

function activeRow() {
  return {
    tenant_id: '100',
    flag_key: 'canonical_financial_dual_write_v1',
    domain: 'financial',
    mode: 'canonical',
    is_enabled: 1,
    version: 1,
    config_json: '{"tenantScope":["100"],"writePolicy":"canonical-only"}',
    effective_at_utc: '2026-07-18T07:25:09Z',
  };
}

function disabledRow() {
  return { ...activeRow(), mode: 'disabled', is_enabled: 0, version: 2 };
}

function gateway(patch: Partial<EmergencyCanonicalOnlyRollbackGateway> = {}) {
  let reads = 0;
  let writes = 0;
  const value: EmergencyCanonicalOnlyRollbackGateway = {
    async readDatabaseIdentity() {
      return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
    },
    async readActiveWorkerVersion() {
      return evidence().activeWorkerVersionId;
    },
    async readFlag() {
      reads += 1;
      return reads === 1 ? [activeRow()] : [disabledRow()];
    },
    async readPostActivationImpact() {
      return {
        legacyBills: 0,
        legacyPayments: 0,
        legacyDeposits: 0,
        legacyCreditNotes: 0,
        canonicalBusinessRows: 0,
      };
    },
    async writeFlag(sql) {
      writes += 1;
      expect(sql).toContain("tenant_id = '100'");
      expect(sql).toContain("mode = 'canonical'");
      expect(sql).toContain('version = 1');
      expect(sql).toContain("effective_at_utc = '2026-07-18T07:25:09Z'");
      return { changes: 1, rowsWritten: 1 };
    },
    ...patch,
  };
  return { value, writes: () => writes };
}

describe('emergency canonical-only financial rollback', () => {
  it('builds an exact one-row canonical-only disable statement', () => {
    const sql = buildEmergencyCanonicalOnlyDisableSql(evidence());
    expect(sql).toContain("flag_key = 'canonical_financial_dual_write_v1'");
    expect(sql).toContain("config_json = '{\"tenantScope\":[\"100\"],\"writePolicy\":\"canonical-only\"}'");
    expect(sql).toContain("SET mode = 'disabled'");
    expect(sql).not.toMatch(/tenant_id\s*!=|canonical_reporting_v1/);
  });

  it('changes exactly the verified flag after zero-write evidence', async () => {
    const harness = gateway();
    const result = await executeEmergencyCanonicalOnlyRollback({
      evidence: evidence(),
      atUtc: '2026-07-18T13:55:00.000Z',
      approval: AUTHORIZATION,
      execute: true,
    }, harness.value);

    expect(result).toEqual({
      allowed: true,
      issues: [],
      externalCommandCount: 6,
      productionMutationPerformed: true,
      beforeMode: 'canonical',
      afterMode: 'disabled',
      postActivationWriteCount: 0,
    });
    expect(harness.writes()).toBe(1);
  });

  it('starts no external work without execute and matching approval', async () => {
    let calls = 0;
    const result = await executeEmergencyCanonicalOnlyRollback({
      evidence: evidence(),
      atUtc: '2026-07-18T13:55:00.000Z',
      approval: null,
      execute: false,
    }, {
      async readDatabaseIdentity() { calls += 1; throw new Error('must not run'); },
      async readActiveWorkerVersion() { calls += 1; throw new Error('must not run'); },
      async readFlag() { calls += 1; throw new Error('must not run'); },
      async readPostActivationImpact() { calls += 1; throw new Error('must not run'); },
      async writeFlag() { calls += 1; throw new Error('must not run'); },
    });

    expect(result.allowed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'CDB101_EMERGENCY_ROLLBACK_EXECUTE_SWITCH_MISSING',
      'CDB101_EMERGENCY_ROLLBACK_APPROVAL_MISMATCH',
    ]));
    expect(calls).toBe(0);
  });

  it('refuses to write when any post-activation financial row exists', async () => {
    const harness = gateway({
      async readPostActivationImpact() {
        return {
          legacyBills: 1,
          legacyPayments: 0,
          legacyDeposits: 0,
          legacyCreditNotes: 0,
          canonicalBusinessRows: 0,
        };
      },
    });

    await expect(executeEmergencyCanonicalOnlyRollback({
      evidence: evidence(),
      atUtc: '2026-07-18T13:55:00.000Z',
      approval: AUTHORIZATION,
      execute: true,
    }, harness.value)).rejects.toThrow('post-activation financial writes');
    expect(harness.writes()).toBe(0);
  });

  it('refuses to write when the active Worker or flag state drifts', async () => {
    const workerMismatch = gateway({ async readActiveWorkerVersion() { return 'different-version'; } });
    await expect(executeEmergencyCanonicalOnlyRollback({
      evidence: evidence(),
      atUtc: '2026-07-18T13:55:00.000Z',
      approval: AUTHORIZATION,
      execute: true,
    }, workerMismatch.value)).rejects.toThrow('Worker version mismatch');
    expect(workerMismatch.writes()).toBe(0);

    const flagMismatch = gateway({ async readFlag() { return [{ ...activeRow(), version: 2 }]; } });
    await expect(executeEmergencyCanonicalOnlyRollback({
      evidence: evidence(),
      atUtc: '2026-07-18T13:55:00.000Z',
      approval: AUTHORIZATION,
      execute: true,
    }, flagMismatch.value)).rejects.toThrow('flag pre-state mismatch');
    expect(flagMismatch.writes()).toBe(0);
  });
});
