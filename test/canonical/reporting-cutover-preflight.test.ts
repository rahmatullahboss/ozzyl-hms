import { describe, expect, it } from 'vitest';
import {
  EXPECTED_CANONICAL_MIGRATIONS,
  REQUIRED_REPORTING_TABLES,
  assertReadOnlyReportingPreflightArgs,
  collectReportingDatabaseEvidence,
  deriveForeignKeyWaiverAuthorization,
  enforceSchemaV2AuthorizationContract,
  evaluateReportingCutoverPreflight,
  type ReportingCutoverPreflightEvidence,
  type ReportingPreflightCommandRunner,
} from '../../scripts/canonical/reporting-cutover-preflight';
import {
  READY_AUTHORIZATION_AT_UTC,
  createReadyReportingAuthorization,
  createReadySingleOperatorReportingAuthorization,
  createReadyTwoPersonReportingAuthorization,
} from './fixtures/reporting-authorization-fixture';

const GENERATED_AT = '2026-07-14T12:00:00.000Z';
const DATABASE_ID = 'c68a5360-a2c1-44cc-9e71-f21057bea102';

function readyEvidence(): ReportingCutoverPreflightEvidence {
  return {
    schemaVersion: 1,
    generatedAtUtc: GENERATED_AT,
    domain: 'reporting',
    productionIdentity: {
      expectedDatabaseId: DATABASE_ID,
      observedDatabaseId: DATABASE_ID,
      accountMatched: true,
      remoteDatabaseMatched: true,
      manifestObjectFound: true,
      manifestChecksumMatched: true,
      inspectedAtUtc: '2026-07-14T11:55:00.000Z',
      maxAgeSeconds: 3600,
    },
    tenants: {
      activeTenantIds: ['1', '100', '101', '102'],
      plannedTenantIds: ['100'],
      canaryTenantId: '100',
    },
    schema: {
      canonicalTableNames: [...REQUIRED_REPORTING_TABLES],
      appliedCanonicalMigrations: [...EXPECTED_CANONICAL_MIGRATIONS],
      unknownCanonicalMigrations: [],
    },
    processing: {
      unresolvedCriticalExceptionCount: 0,
      blockedOutboxCount: 0,
      blockedAccountingCount: 0,
      foreignKeyViolationCount: 0,
    },
    flags: {
      reportingEnabledTenantIds: [],
      globalSwitchEnabled: false,
      activeReportingRoutesSwitched: false,
    },
    authorization: {
      preparationAuthorized: true,
      productionExecutionAuthorized: true,
      authorizedDomain: 'reporting',
      expiresAtUtc: '2026-07-14T13:00:00.000Z',
    },
    maintenance: {
      windowStartUtc: '2026-07-14T12:15:00.000Z',
      windowEndUtc: '2026-07-14T13:00:00.000Z',
    },
    executionPlan: {
      authorizedTenantIds: ['100'],
      approvedMigrations: [...EXPECTED_CANONICAL_MIGRATIONS],
      deploymentAuthorized: true,
      deploymentVersion: 'worker-version-reviewed',
      migrationApplyAuthorized: true,
      productionImportAuthorized: true,
      productionImportCommandApproved: true,
      productionImportCommandId: 'reporting-production-import-v1',
      shadowFlagAuthorized: true,
      shadowFlagTenantId: '100',
      shadowFlagKey: 'canonical_reporting_v1',
      shadowFlagDomain: 'reporting',
      shadowFlagInitialMode: 'shadow',
    },
    foreignKeyDisposition: {
      waiverApproved: false,
      waivedViolationCount: 0,
      waiverEvidencePresent: false,
    },
    rollback: {
      rollbackOwnerAssigned: true,
      rollbackOwnerId: 'rollback-owner-reviewed',
      observationOwnerAssigned: true,
      observationOwnerId: 'observation-owner-reviewed',
      maxRollbackDurationMs: 60_000,
    },
    smoke: {
      planId: 'reporting-canary-smoke-v1',
      requiredScenarios: [
        'doctor_performance_card_detail',
        'diagnostic_volume_card_detail',
        'collections_card_detail',
        'ipd_finance_card_detail',
      ],
    },
    productionMutationAttempted: false,
  };
}

function codes(input: unknown): string[] {
  return evaluateReportingCutoverPreflight(input).issues.map((item) => item.code);
}

describe('CDB-101 reporting production preflight', () => {
  it('marks complete authorized evidence ready for preparation and night execution', () => {
    const result = evaluateReportingCutoverPreflight(readyEvidence());

    expect(result.preparationReady).toBe(true);
    expect(result.nightExecutionReady).toBe(true);
    expect(result.issueCount).toBe(0);
    expect(result.activeTenantCount).toBe(4);
    expect(result.plannedTenantCount).toBe(1);
    expect(result.recommendedCanaryTenantId).toBe('100');
    expect(result.pendingCanonicalMigrationCount).toBe(0);
    expect(result.foreignKeyViolationCount).toBe(0);
    expect(result.productionMutationPerformed).toBe(false);
  });

  it('allows preparation now while known migrations and execution authorization remain pending', () => {
    const input = readyEvidence();
    input.schema.canonicalTableNames = [];
    input.schema.appliedCanonicalMigrations = [];
    input.processing = {
      unresolvedCriticalExceptionCount: null,
      blockedOutboxCount: null,
      blockedAccountingCount: null,
      foreignKeyViolationCount: 0,
    };
    input.authorization.productionExecutionAuthorized = false;
    input.authorization.authorizedDomain = null;
    input.authorization.expiresAtUtc = null;
    input.maintenance.windowStartUtc = null;
    input.maintenance.windowEndUtc = null;

    const result = evaluateReportingCutoverPreflight(input);
    expect(result.preparationReady).toBe(true);
    expect(result.nightExecutionReady).toBe(false);
    expect(result.issues.filter((item) => item.gate === 'preparation')).toHaveLength(0);
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'CDB101_CANONICAL_SCHEMA_NOT_APPLIED',
        'CDB101_PENDING_CANONICAL_MIGRATIONS',
        'CDB101_PROCESSING_EVIDENCE_UNAVAILABLE',
        'CDB101_EXECUTION_AUTHORIZATION_MISSING',
        'CDB101_MAINTENANCE_WINDOW_MISSING',
      ]),
    );
  });

  it('keeps preparation ready but blocks night execution when the production manifest object is absent', () => {
    const input = readyEvidence();
    input.productionIdentity.manifestObjectFound = false;
    input.productionIdentity.manifestChecksumMatched = false;

    const result = evaluateReportingCutoverPreflight(input);
    expect(result.preparationReady).toBe(true);
    expect(result.nightExecutionReady).toBe(false);
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'CDB101_PRODUCTION_MANIFEST_MISSING',
        'CDB101_PRODUCTION_MANIFEST_MISMATCH',
      ]),
    );
  });

  it('blocks preparation for production identity mismatch or stale inspection', () => {
    const input = readyEvidence();
    input.productionIdentity.observedDatabaseId = 'wrong';
    input.productionIdentity.inspectedAtUtc = '2026-07-14T09:00:00.000Z';

    expect(codes(input)).toEqual(
      expect.arrayContaining([
        'CDB101_PRODUCTION_IDENTITY_MISMATCH',
        'CDB101_PRODUCTION_IDENTITY_STALE',
      ]),
    );
  });

  it('blocks preparation when tenant planning is absent, inactive, or has no canary', () => {
    const input = readyEvidence();
    input.tenants.plannedTenantIds = ['999'];
    input.tenants.canaryTenantId = null;

    expect(codes(input)).toEqual(
      expect.arrayContaining([
        'CDB101_PLANNED_TENANT_INACTIVE',
        'CDB101_CANARY_TENANT_MISSING',
      ]),
    );
  });

  it('blocks preparation when a reporting or global flag is already enabled or active routes switched', () => {
    const input = readyEvidence();
    input.flags.reportingEnabledTenantIds = ['100'];
    input.flags.globalSwitchEnabled = true;
    input.flags.activeReportingRoutesSwitched = true;

    expect(codes(input)).toEqual(
      expect.arrayContaining([
        'CDB101_REPORTING_FLAG_ALREADY_ENABLED',
        'CDB101_GLOBAL_SWITCH_PROHIBITED',
        'CDB101_ACTIVE_ROUTE_ALREADY_SWITCHED',
      ]),
    );
  });

  it('keeps preparation ready but blocks night execution when deployed active-route evidence is unavailable', () => {
    const input = readyEvidence();
    input.flags.activeReportingRoutesSwitched = null;

    const result = evaluateReportingCutoverPreflight(input);
    expect(result.preparationReady).toBe(true);
    expect(result.nightExecutionReady).toBe(false);
    expect(result.issues.map((item) => item.code)).toContain(
      'CDB101_ACTIVE_ROUTE_EVIDENCE_UNAVAILABLE',
    );
  });

  it('blocks night execution for unknown migrations, missing required tables, queues, critical issues, or FK violations', () => {
    const input = readyEvidence();
    input.schema.unknownCanonicalMigrations = ['0499_canonical_unknown.sql'];
    input.schema.canonicalTableNames = REQUIRED_REPORTING_TABLES.slice(1);
    input.processing.unresolvedCriticalExceptionCount = 1;
    input.processing.blockedOutboxCount = 1;
    input.processing.blockedAccountingCount = 1;
    input.processing.foreignKeyViolationCount = 1;

    expect(codes(input)).toEqual(
      expect.arrayContaining([
        'CDB101_UNKNOWN_CANONICAL_MIGRATION',
        'CDB101_CANONICAL_SCHEMA_INCOMPLETE',
        'CDB101_CRITICAL_EXCEPTION',
        'CDB101_BLOCKED_OUTBOX',
        'CDB101_BLOCKED_ACCOUNTING',
        'CDB101_FOREIGN_KEY_VIOLATION',
      ]),
    );
  });

  it('requires preparation approval, smoke coverage, rollback ownership, and safe duration', () => {
    const input = readyEvidence();
    input.authorization.preparationAuthorized = false;
    input.smoke.planId = '';
    input.smoke.requiredScenarios = [];
    input.rollback.rollbackOwnerAssigned = false;
    input.rollback.observationOwnerAssigned = false;
    input.rollback.maxRollbackDurationMs = 0;

    expect(codes(input)).toEqual(
      expect.arrayContaining([
        'CDB101_PREPARATION_AUTHORIZATION_MISSING',
        'CDB101_SMOKE_PLAN_MISSING',
        'CDB101_ROLLBACK_OWNER_MISSING',
        'CDB101_OBSERVATION_OWNER_MISSING',
        'CDB101_ROLLBACK_THRESHOLD_INVALID',
      ]),
    );
  });

  it('keeps preparation ready while named rollback and observation owners remain night blockers', () => {
    const input = readyEvidence();
    input.rollback.rollbackOwnerAssigned = false;
    input.rollback.observationOwnerAssigned = false;
    input.rollback.maxRollbackDurationMs = null;

    const result = evaluateReportingCutoverPreflight(input);
    expect(result.preparationReady).toBe(true);
    expect(result.nightExecutionReady).toBe(false);
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'CDB101_ROLLBACK_OWNER_MISSING',
        'CDB101_OBSERVATION_OWNER_MISSING',
        'CDB101_ROLLBACK_THRESHOLD_INVALID',
      ]),
    );
  });

  it('requires a valid reporting authorization and bounded maintenance window for night execution', () => {
    const input = readyEvidence();
    input.authorization.productionExecutionAuthorized = false;
    input.authorization.authorizedDomain = 'payments';
    input.authorization.expiresAtUtc = '2026-07-14T11:00:00.000Z';
    input.maintenance.windowStartUtc = '2026-07-14T13:00:00.000Z';
    input.maintenance.windowEndUtc = '2026-07-14T12:30:00.000Z';

    expect(codes(input)).toEqual(
      expect.arrayContaining([
        'CDB101_EXECUTION_AUTHORIZATION_MISSING',
        'CDB101_EXECUTION_AUTHORIZATION_DOMAIN_MISMATCH',
        'CDB101_EXECUTION_AUTHORIZATION_EXPIRED',
        'CDB101_MAINTENANCE_WINDOW_INVALID',
      ]),
    );
  });

  it('requires exact tenant, migration, deployment, import, and shadow-flag authorization for night execution', () => {
    const input = readyEvidence();
    input.executionPlan.authorizedTenantIds = ['101'];
    input.executionPlan.approvedMigrations = EXPECTED_CANONICAL_MIGRATIONS.slice(0, -1);
    input.executionPlan.deploymentAuthorized = false;
    input.executionPlan.migrationApplyAuthorized = false;
    input.executionPlan.productionImportAuthorized = false;
    input.executionPlan.productionImportCommandApproved = false;
    input.executionPlan.shadowFlagAuthorized = false;

    expect(codes(input)).toEqual(
      expect.arrayContaining([
        'CDB101_AUTHORIZED_TENANT_SCOPE_MISMATCH',
        'CDB101_AUTHORIZED_MIGRATION_SCOPE_MISMATCH',
        'CDB101_DEPLOYMENT_AUTHORIZATION_MISSING',
        'CDB101_MIGRATION_AUTHORIZATION_MISSING',
        'CDB101_PRODUCTION_IMPORT_AUTHORIZATION_MISSING',
        'CDB101_PRODUCTION_IMPORT_COMMAND_MISSING',
        'CDB101_SHADOW_FLAG_AUTHORIZATION_MISSING',
      ]),
    );
  });

  it('derives schema-v2 FK waiver authority only from exact group evidence', () => {
    expect(deriveForeignKeyWaiverAuthorization({
      groups: [
        {
          remainingViolationCount: 26,
          waivedViolationCount: 26,
          disposition: 'formal_waiver',
          ownerId: 'canonical-program-owner',
          evidenceId: 'fk-waiver-old-0391-bills-01',
        },
        {
          remainingViolationCount: 15,
          waivedViolationCount: 15,
          disposition: 'formal_waiver',
          ownerId: 'canonical-program-owner',
          evidenceId: 'fk-waiver-old-0391-visits-01',
        },
      ],
    })).toEqual({
      waiverApproved: true,
      waivedViolationCount: 41,
      waiverEvidencePresent: true,
    });

    expect(deriveForeignKeyWaiverAuthorization({
      groups: [{
        remainingViolationCount: 26,
        waivedViolationCount: 25,
        disposition: 'formal_waiver',
        ownerId: 'canonical-program-owner',
        evidenceId: 'partial-waiver',
      }],
    }).waiverApproved).toBe(false);

    expect(deriveForeignKeyWaiverAuthorization({
      waiverApproved: true,
      waivedViolationCount: 49,
      waiverEvidencePresent: true,
    }, 2)).toEqual({
      waiverApproved: false,
      waivedViolationCount: 0,
      waiverEvidencePresent: false,
    });
  });

  it('accepts an exact reviewed FK waiver and rejects partial waiver evidence', () => {
    const accepted = readyEvidence();
    accepted.processing.foreignKeyViolationCount = 49;
    accepted.foreignKeyDisposition = {
      waiverApproved: true,
      waivedViolationCount: 49,
      waiverEvidencePresent: true,
    };
    expect(evaluateReportingCutoverPreflight(accepted).nightExecutionReady).toBe(true);

    const partial = readyEvidence();
    partial.processing.foreignKeyViolationCount = 49;
    partial.foreignKeyDisposition = {
      waiverApproved: true,
      waivedViolationCount: 48,
      waiverEvidencePresent: true,
    };
    expect(codes(partial)).toContain('CDB101_FOREIGN_KEY_VIOLATION');
  });

  it('forces schema-v2 authorization contract failures into the night gate', () => {
    const base = evaluateReportingCutoverPreflight(readyEvidence());
    expect(base.nightExecutionReady).toBe(true);

    const schemaV2 = enforceSchemaV2AuthorizationContract(
      base,
      { schemaVersion: 2 },
      GENERATED_AT,
    );
    expect(schemaV2.nightExecutionReady).toBe(false);
    expect(schemaV2.issues.map((item) => item.code))
      .toContain('CDB101_AUTHORIZATION_CONTRACT_INVALID');
    expect(JSON.stringify(schemaV2)).not.toContain('authorizationPublicId');

    expect(enforceSchemaV2AuthorizationContract(
      base,
      { schemaVersion: 1 },
      GENERATED_AT,
    )).toEqual(base);

    const widened = {
      ...createReadyReportingAuthorization(),
      deploymentAuthorized: true,
    };
    const widenedResult = enforceSchemaV2AuthorizationContract(base, widened, GENERATED_AT);
    expect(widenedResult.nightExecutionReady).toBe(false);
    expect(widenedResult.issues.map((item) => item.code))
      .toContain('CDB101_AUTHORIZATION_CONTRACT_INVALID');
  });

  it('enforces the schema-v3 two-person contract at the final night gate', () => {
    const base = evaluateReportingCutoverPreflight(readyEvidence());
    const constrained = createReadyTwoPersonReportingAuthorization();

    expect(enforceSchemaV2AuthorizationContract(base, constrained, READY_AUTHORIZATION_AT_UTC).nightExecutionReady)
      .toBe(true);

    if (constrained.schemaVersion !== 3) throw new Error('expected schema v3');
    constrained.rollbackOwner.ownerId = constrained.observationOwner.ownerId;
    const rejected = enforceSchemaV2AuthorizationContract(base, constrained, READY_AUTHORIZATION_AT_UTC);
    expect(rejected.nightExecutionReady).toBe(false);
    expect(rejected.issues.map((item) => item.code))
      .toContain('CDB101_AUTHORIZATION_CONTRACT_INVALID');
  });

  it('enforces the schema-v4 single-operator risk contract at the final night gate', () => {
    const base = evaluateReportingCutoverPreflight(readyEvidence());
    const singleOperator = createReadySingleOperatorReportingAuthorization();

    expect(enforceSchemaV2AuthorizationContract(base, singleOperator, READY_AUTHORIZATION_AT_UTC).nightExecutionReady)
      .toBe(true);

    if (singleOperator.schemaVersion !== 4) throw new Error('expected schema v4');
    singleOperator.singleOperatorRiskAcceptance.postActivationReconciliationRequired = false;
    const rejected = enforceSchemaV2AuthorizationContract(base, singleOperator, READY_AUTHORIZATION_AT_UTC);
    expect(rejected.nightExecutionReady).toBe(false);
    expect(rejected.issues.map((item) => item.code))
      .toContain('CDB101_AUTHORIZATION_CONTRACT_INVALID');
  });

  it('fails closed on malformed runtime evidence', () => {
    const result = evaluateReportingCutoverPreflight({});
    expect(result.preparationReady).toBe(false);
    expect(result.nightExecutionReady).toBe(false);
    expect(result.issues.map((item) => item.code)).toContain('CDB101_EVIDENCE_INVALID');
  });

  it('does not echo authorization identity, tenant names, raw SQL, or protected hashes', () => {
    const input = readyEvidence() as ReportingCutoverPreflightEvidence & Record<string, unknown>;
    input.authorization = {
      ...input.authorization,
      authorizationPublicId: 'secret-authorization-id',
    } as ReportingCutoverPreflightEvidence['authorization'];
    input.tenantNames = ['Sensitive Hospital Name'];
    input.rawSql = 'SELECT patient_name FROM patients';
    input.exportSha256 = 'a'.repeat(64);

    const serialized = JSON.stringify(evaluateReportingCutoverPreflight(input));
    expect(serialized).not.toContain('secret-authorization-id');
    expect(serialized).not.toContain('Sensitive Hospital Name');
    expect(serialized).not.toContain('patient_name');
    expect(serialized).not.toContain('a'.repeat(64));
  });

  it('allows only exact read-only production identity and SELECT commands', () => {
    expect(() => assertReadOnlyReportingPreflightArgs([
      'd1', 'execute', 'hms-super-admin-production-apac', '--remote', '--env', 'production', '--json', '--command',
      'SELECT COUNT(*) AS count FROM tenants;',
    ])).not.toThrow();

    expect(() => assertReadOnlyReportingPreflightArgs([
      'd1', 'execute', 'hms-super-admin-production-apac', '--remote', '--env', 'production', '--json', '--command',
      "UPDATE settings SET value='true';",
    ])).toThrow(/read-only/i);

    expect(() => assertReadOnlyReportingPreflightArgs([
      'd1', 'execute', 'hms-super-admin-production-apac', '--remote', '--env', 'staging', '--json', '--command',
      'SELECT 1;',
    ])).toThrow(/production/i);
  });

  it('collects only aggregate database evidence and proves zero writes', async () => {
    const calls: string[][] = [];
    const runner: ReportingPreflightCommandRunner = async (args) => {
      calls.push(args);
      const sql = args.at(-1) ?? '';
      if (sql.includes('active_tenant_count')) {
        return {
          stdout: Buffer.from(JSON.stringify([{
            results: [{
              active_tenant_count: 4,
              active_tenant_ids_json: '["1","100","101","102"]',
              canonical_table_names_json: JSON.stringify(REQUIRED_REPORTING_TABLES),
              applied_canonical_migrations_json: JSON.stringify(EXPECTED_CANONICAL_MIGRATIONS),
              global_switch_count: 0,
            }],
            success: true,
            meta: { changed_db: false, rows_written: 0 },
          }])),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        };
      }
      if (sql.includes('reporting_enabled_tenant_ids_json')) {
        return {
          stdout: Buffer.from(JSON.stringify([{
            results: [{ reporting_enabled_tenant_ids_json: '[]' }],
            success: true,
            meta: { changed_db: false, rows_written: 0 },
          }])),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        };
      }
      return {
        stdout: Buffer.from(JSON.stringify([{
          results: [{
            unresolved_critical: 0,
            blocked_outbox: 0,
            blocked_accounting: 0,
            fk_violations: 0,
          }],
          success: true,
          meta: { changed_db: false, rows_written: 0 },
        }])),
        stderr: Buffer.alloc(0),
        exitCode: 0,
      };
    };

    const result = await collectReportingDatabaseEvidence({
      databaseName: 'hms-super-admin-production-apac',
      runner,
    });

    expect(result).toMatchObject({
      activeTenantIds: ['1', '100', '101', '102'],
      reportingEnabledTenantIds: [],
      globalSwitchEnabled: false,
      unresolvedCriticalExceptionCount: 0,
      blockedOutboxCount: 0,
      blockedAccountingCount: 0,
      foreignKeyViolationCount: 0,
      changedDb: false,
      rowsWritten: 0,
    });
    expect(calls).toHaveLength(3);
  });

  it('detects an enabled reporting flag even when the canonical schema is only partially applied', async () => {
    const calls: string[][] = [];
    const runner: ReportingPreflightCommandRunner = async (args) => {
      calls.push(args);
      const sql = args.at(-1) ?? '';
      if (sql.includes('active_tenant_count')) {
        return {
          stdout: Buffer.from(JSON.stringify([{
            results: [{
              active_tenant_count: 1,
              active_tenant_ids_json: '["100"]',
              canonical_table_names_json: '["canonical_feature_flags"]',
              applied_canonical_migrations_json: '["0505_canonical_program_foundation.sql"]',
              global_switch_count: 0,
              fk_violations: 0,
            }],
            success: true,
            meta: { changed_db: false, rows_written: 0 },
          }])),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        };
      }
      return {
        stdout: Buffer.from(JSON.stringify([{
          results: [{ reporting_enabled_tenant_ids_json: '["100"]' }],
          success: true,
          meta: { changed_db: false, rows_written: 0 },
        }])),
        stderr: Buffer.alloc(0),
        exitCode: 0,
      };
    };

    const result = await collectReportingDatabaseEvidence({
      databaseName: 'hms-super-admin-production-apac',
      runner,
    });

    expect(result.reportingEnabledTenantIds).toEqual(['100']);
    expect(result.unresolvedCriticalExceptionCount).toBeNull();
    expect(result.blockedOutboxCount).toBeNull();
    expect(result.blockedAccountingCount).toBeNull();
    expect(result.changedDb).toBe(false);
    expect(result.rowsWritten).toBe(0);
    expect(calls).toHaveLength(2);
  });
});
