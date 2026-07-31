import { describe, expect, it } from 'vitest';
import {
  CUTOVER_STEP_ORDER,
  evaluateCutoverReadiness,
  type CutoverReadinessEvidence,
  type CutoverRehearsalEvidence,
} from '../../scripts/canonical/cutover-check';

const PRODUCTION_DATABASE_ID = 'c68a5360-a2c1-44cc-9e71-f21057bea102';
const CLONE_DATABASE_ID = '6f9a17af-8e3e-4b26-85b7-08c653a706db';
const MANIFEST_CHECKSUM = `sha256:${'a'.repeat(64)}`;
const EXPORT_SHA256 = 'b'.repeat(64);
const GENERATED_AT = '2026-07-14T10:00:00.000Z';

function rehearsal(number: 1 | 2): CutoverRehearsalEvidence {
  const offsetMinutes = number * 20;
  return {
    rehearsalId: `cdb100-rehearsal-${number}`,
    rehearsalNumber: number,
    environment: 'staging_clone',
    productionIdentity: {
      expectedDatabaseId: PRODUCTION_DATABASE_ID,
      observedDatabaseId: PRODUCTION_DATABASE_ID,
      checkedAtUtc: `2026-07-14T09:${String(offsetMinutes).padStart(2, '0')}:00.000Z`,
      maxAgeSeconds: 3600,
      accountMatched: true,
      remoteDatabaseMatched: true,
      manifestChecksumMatched: true,
    },
    cloneIdentity: {
      expectedDatabaseId: CLONE_DATABASE_ID,
      observedDatabaseId: CLONE_DATABASE_ID,
      exactMatch: true,
    },
    steps: CUTOVER_STEP_ORDER.map((step, index) => ({
      step,
      status: 'passed' as const,
      durationMs: 1000 + index,
    })),
    maintenanceMode: {
      entered: true,
      mode: 'read_only',
      ownerPublicId: 'operator-maintenance',
    },
    bookmark: {
      bookmarkId: `bookmark-${number}`,
      databaseId: CLONE_DATABASE_ID,
      verified: true,
    },
    protectedExport: {
      expectedSha256: EXPORT_SHA256,
      observedSha256: EXPORT_SHA256,
      sourceDatabaseId: PRODUCTION_DATABASE_ID,
      sizeBytes: 44_183_552,
      verified: true,
      encryptedAtRest: true,
      accessControlled: true,
      retentionOwnerPublicId: 'operator-retention',
    },
    deltaBackfill: {
      completed: true,
      expectedCheckpointCount: 12,
      completedCheckpointCount: 12,
      failedRowCount: 0,
      sourceDriftCount: 0,
    },
    migrations: {
      expectedManifestChecksum: MANIFEST_CHECKSUM,
      observedManifestChecksum: MANIFEST_CHECKSUM,
      unknownMigrations: [],
      pendingMigrations: [],
    },
    reconciliation: {
      financialVarianceMinorByCurrency: { BDT: 0 },
      unexplainedVarianceCount: 0,
      unresolvedCriticalExceptionCount: 0,
      foreignKeyViolationCount: 0,
      unsafeIntegerViolationCount: 0,
      tenantIsolationViolationCount: 0,
    },
    processing: {
      failedOutboxItemCount: 0,
      deadLetterOutboxItemCount: 0,
      failedAccountingJobCount: 0,
      retryAccountingJobCount: 0,
      deadLetterAccountingJobCount: 0,
    },
    featureFlags: {
      tenantScoped: true,
      globalSwitchPresent: false,
      productionFlagsEnabled: false,
      domainPlans: [
        {
          tenantId: '100',
          domain: 'reporting',
          flagKey: 'canonical_reporting_v1',
          plannedMode: 'canonical',
        },
      ],
    },
    smokeTests: {
      planId: `smoke-plan-${number}`,
      requiredScenarios: ['patient_read', 'billing_read', 'reporting_read'],
      passedScenarios: ['patient_read', 'billing_read', 'reporting_read'],
      failedScenarios: [],
    },
    rollback: {
      rollbackOwnerPublicId: 'operator-rollback',
      observationOwnerPublicId: 'operator-observation',
      restoreVerified: true,
      reopenVerified: true,
      rollbackDurationMs: 18_000 + number,
      reopenDurationMs: 7_000 + number,
    },
    productionMutationAttempted: false,
  };
}

function evidence(): CutoverReadinessEvidence {
  return {
    schemaVersion: 1,
    mode: 'rehearsal',
    generatedAtUtc: GENERATED_AT,
    proposedProductionMutation: false,
    rehearsals: [rehearsal(1), rehearsal(2)],
  };
}

function issueCodes(input: CutoverReadinessEvidence): string[] {
  return evaluateCutoverReadiness(input).issues.map((issue) => issue.code);
}

describe('canonical cutover runbook checker', () => {
  it('returns go only after two complete ordered clone rehearsals', () => {
    const result = evaluateCutoverReadiness(evidence());

    expect(result.decision).toBe('go');
    expect(result.rehearsalReady).toBe(true);
    expect(result.eligibleForProductionCutover).toBe(false);
    expect(result.validatedRehearsalCount).toBe(2);
    expect(result.issueCount).toBe(0);
    expect(result.totalDurationMs).toBeGreaterThan(0);
    expect(result.maxRollbackDurationMs).toBe(18_002);
    expect(result.maxReopenDurationMs).toBe(7_002);
  });

  it('rejects fewer than two distinct rehearsals', () => {
    const input = evidence();
    input.rehearsals = [rehearsal(1)];

    expect(issueCodes(input)).toContain('CDB100_REHEARSAL_COUNT_INSUFFICIENT');
  });

  it('rejects an out-of-order or incomplete runbook sequence', () => {
    const input = evidence();
    input.rehearsals[0].steps = [...input.rehearsals[0].steps].reverse();

    expect(issueCodes(input)).toContain('CDB100_REHEARSAL_ORDER_INVALID');
  });

  it('rejects production or clone identity mismatch and stale production inspection', () => {
    const input = evidence();
    input.rehearsals[0].productionIdentity.observedDatabaseId = 'wrong-production';
    input.rehearsals[0].productionIdentity.checkedAtUtc = '2026-07-14T06:00:00.000Z';
    input.rehearsals[0].cloneIdentity.observedDatabaseId = 'wrong-clone';
    input.rehearsals[0].cloneIdentity.exactMatch = false;

    expect(issueCodes(input)).toEqual(
      expect.arrayContaining([
        'CDB100_PRODUCTION_IDENTITY_MISMATCH',
        'CDB100_PRODUCTION_IDENTITY_STALE',
        'CDB100_CLONE_IDENTITY_MISMATCH',
      ]),
    );
  });

  it('rejects missing maintenance mode, bookmark, or secure verified export', () => {
    const input = evidence();
    input.rehearsals[0].maintenanceMode.entered = false;
    input.rehearsals[0].bookmark.verified = false;
    input.rehearsals[0].protectedExport.verified = false;
    input.rehearsals[0].protectedExport.observedSha256 = 'c'.repeat(64);
    input.rehearsals[0].protectedExport.encryptedAtRest = false;
    input.rehearsals[0].protectedExport.accessControlled = false;

    expect(issueCodes(input)).toEqual(
      expect.arrayContaining([
        'CDB100_MAINTENANCE_MODE_MISSING',
        'CDB100_BOOKMARK_MISSING',
        'CDB100_EXPORT_UNVERIFIED',
        'CDB100_EXPORT_HASH_MISMATCH',
        'CDB100_EXPORT_SECURITY_MISSING',
      ]),
    );
  });

  it('rejects incomplete delta checkpoints and migration drift', () => {
    const input = evidence();
    input.rehearsals[0].deltaBackfill.completed = false;
    input.rehearsals[0].deltaBackfill.completedCheckpointCount = 11;
    input.rehearsals[0].deltaBackfill.failedRowCount = 1;
    input.rehearsals[0].deltaBackfill.sourceDriftCount = 2;
    input.rehearsals[0].migrations.observedManifestChecksum = `sha256:${'d'.repeat(64)}`;
    input.rehearsals[0].migrations.unknownMigrations = ['9999_unknown.sql'];
    input.rehearsals[0].migrations.pendingMigrations = ['0515_canonical_accounting_outbox.sql'];

    expect(issueCodes(input)).toEqual(
      expect.arrayContaining([
        'CDB100_DELTA_BACKFILL_INCOMPLETE',
        'CDB100_DELTA_BACKFILL_FAILED_ROWS',
        'CDB100_SOURCE_DRIFT',
        'CDB100_MANIFEST_CHECKSUM_MISMATCH',
        'CDB100_UNKNOWN_MIGRATION',
        'CDB100_PENDING_MIGRATION',
      ]),
    );
  });

  it('rejects financial variance, critical exceptions, and integrity failures', () => {
    const input = evidence();
    input.rehearsals[0].reconciliation.financialVarianceMinorByCurrency.BDT = 1;
    input.rehearsals[0].reconciliation.unexplainedVarianceCount = 1;
    input.rehearsals[0].reconciliation.unresolvedCriticalExceptionCount = 1;
    input.rehearsals[0].reconciliation.foreignKeyViolationCount = 1;
    input.rehearsals[0].reconciliation.unsafeIntegerViolationCount = 1;
    input.rehearsals[0].reconciliation.tenantIsolationViolationCount = 1;

    expect(issueCodes(input)).toEqual(
      expect.arrayContaining([
        'CDB100_FINANCIAL_VARIANCE',
        'CDB100_UNEXPLAINED_VARIANCE',
        'CDB100_CRITICAL_EXCEPTION',
        'CDB100_FOREIGN_KEY_VIOLATION',
        'CDB100_UNSAFE_INTEGER',
        'CDB100_TENANT_ISOLATION_VIOLATION',
      ]),
    );
  });

  it('rejects failed or dead-letter outbox and accounting work', () => {
    const input = evidence();
    input.rehearsals[0].processing.failedOutboxItemCount = 1;
    input.rehearsals[0].processing.deadLetterOutboxItemCount = 1;
    input.rehearsals[0].processing.failedAccountingJobCount = 1;
    input.rehearsals[0].processing.retryAccountingJobCount = 1;
    input.rehearsals[0].processing.deadLetterAccountingJobCount = 1;

    expect(issueCodes(input)).toEqual(
      expect.arrayContaining([
        'CDB100_FAILED_OUTBOX_ITEM',
        'CDB100_DEAD_LETTER_OUTBOX_ITEM',
        'CDB100_FAILED_ACCOUNTING_JOB',
        'CDB100_RETRY_ACCOUNTING_JOB',
        'CDB100_DEAD_LETTER_ACCOUNTING_JOB',
      ]),
    );
  });

  it('rejects global, non-tenant-scoped, absent, or prematurely enabled flag plans', () => {
    const input = evidence();
    input.rehearsals[0].featureFlags.tenantScoped = false;
    input.rehearsals[0].featureFlags.globalSwitchPresent = true;
    input.rehearsals[0].featureFlags.productionFlagsEnabled = true;
    input.rehearsals[0].featureFlags.domainPlans = [];

    expect(issueCodes(input)).toEqual(
      expect.arrayContaining([
        'CDB100_TENANT_FLAG_SCOPE_MISSING',
        'CDB100_GLOBAL_FLAG_PROHIBITED',
        'CDB100_DOMAIN_FLAG_PLAN_MISSING',
        'CDB100_PRODUCTION_FLAG_ALREADY_ENABLED',
      ]),
    );
  });

  it('rejects absent or failed smoke coverage', () => {
    const input = evidence();
    input.rehearsals[0].smokeTests.planId = '';
    input.rehearsals[0].smokeTests.passedScenarios = ['patient_read'];
    input.rehearsals[0].smokeTests.failedScenarios = ['billing_read'];

    expect(issueCodes(input)).toEqual(
      expect.arrayContaining([
        'CDB100_SMOKE_PLAN_MISSING',
        'CDB100_SMOKE_COVERAGE_INCOMPLETE',
        'CDB100_SMOKE_TEST_FAILED',
      ]),
    );
  });

  it('rejects missing rollback ownership, verification, and measured timing', () => {
    const input = evidence();
    input.rehearsals[0].rollback.rollbackOwnerPublicId = '';
    input.rehearsals[0].rollback.observationOwnerPublicId = '';
    input.rehearsals[0].rollback.restoreVerified = false;
    input.rehearsals[0].rollback.reopenVerified = false;
    input.rehearsals[0].rollback.rollbackDurationMs = 0;
    input.rehearsals[0].rollback.reopenDurationMs = 0;

    expect(issueCodes(input)).toEqual(
      expect.arrayContaining([
        'CDB100_ROLLBACK_OWNER_MISSING',
        'CDB100_OBSERVATION_OWNER_MISSING',
        'CDB100_ROLLBACK_NOT_VERIFIED',
        'CDB100_REOPEN_NOT_VERIFIED',
        'CDB100_ROLLBACK_DURATION_MISSING',
        'CDB100_REOPEN_DURATION_MISSING',
      ]),
    );
  });

  it('rejects rehearsal evidence that attempted a production mutation', () => {
    const input = evidence();
    input.rehearsals[0].productionMutationAttempted = true;

    expect(issueCodes(input)).toContain('CDB100_PRODUCTION_MUTATION_ATTEMPTED');
  });

  it('requires explicit non-expired domain authorization for production mode', () => {
    const input = evidence();
    input.mode = 'production';
    input.proposedProductionMutation = true;
    input.authorization = {
      authorized: false,
      authorizationPublicId: '',
      domain: 'reporting',
      expiresAtUtc: '2026-07-14T09:00:00.000Z',
    };

    expect(issueCodes(input)).toEqual(
      expect.arrayContaining([
        'CDB100_PRODUCTION_AUTHORIZATION_MISSING',
        'CDB100_PRODUCTION_AUTHORIZATION_EXPIRED',
      ]),
    );
  });

  it('marks production eligibility only with a valid named domain authorization', () => {
    const input = evidence();
    input.mode = 'production';
    input.proposedProductionMutation = true;
    input.authorization = {
      authorized: true,
      authorizationPublicId: 'authorization-reporting-1',
      domain: 'reporting',
      expiresAtUtc: '2026-07-14T11:00:00.000Z',
    };

    const result = evaluateCutoverReadiness(input);
    expect(result.decision).toBe('go');
    expect(result.rehearsalReady).toBe(true);
    expect(result.eligibleForProductionCutover).toBe(true);
  });

  it('fails closed instead of throwing when runtime JSON evidence is malformed', () => {
    const malformed = {} as CutoverReadinessEvidence;

    expect(() => evaluateCutoverReadiness(malformed)).not.toThrow();
    const result = evaluateCutoverReadiness(malformed);
    expect(result.decision).toBe('no_go');
    expect(result.rehearsalReady).toBe(false);
    expect(result.eligibleForProductionCutover).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      'CDB100_EVIDENCE_INVALID',
    );
  });

  it('does not echo operator identifiers, bookmark ids, or export hashes in aggregate output', () => {
    const result = evaluateCutoverReadiness(evidence());
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('operator-maintenance');
    expect(serialized).not.toContain('bookmark-1');
    expect(serialized).not.toContain(EXPORT_SHA256);
  });

  it('returns stable sorted issue codes independent of input rehearsal order', () => {
    const input = evidence();
    input.rehearsals.reverse();
    input.rehearsals[0].processing.failedOutboxItemCount = 1;
    input.rehearsals[1].reconciliation.unresolvedCriticalExceptionCount = 1;

    const codes = issueCodes(input);
    expect(codes).toEqual([...codes].sort());
  });
});
