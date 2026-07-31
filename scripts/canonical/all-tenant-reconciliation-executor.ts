import { createHash } from 'node:crypto';
import type { AllTenantReconciliationAuthorization } from './all-tenant-reconciliation-authorization';
import {
  CDB_V1_070C_ARCHIVAL_FK_GROUPS,
  CDB_V1_070C_RECONCILIATION_MIGRATIONS,
} from './all-tenant-reconciliation-package';
import { CDB_V1_070A_MIGRATION_NAMES } from './all-tenant-shadow-execution-package';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export interface AllTenantReconciliationForeignKeyGroup {
  childTable: string;
  parentTable: string;
  violationCount: number;
}

export interface AllTenantReconciliationAggregateState {
  database: { name: string; uuid: string };
  pendingMigrationNames: string[];
  targetLedgerEntriesPresent: string[];
  postSchemaExact: Record<string, boolean>;
  foreignKeyGroups: AllTenantReconciliationForeignKeyGroup[];
  archivalDisposition: {
    archivalRowCount: number;
    archivalLatestUpdatedAtUtc: string;
    activeRowCount: number;
    activeLatestCreatedAtUtc: string;
    triggerCount: number;
    dependentObjectCount: number;
    runtimeSourceReferenceCount: number;
    excludedFromCanonicalImport: boolean;
    excludedFromReporting: boolean;
  };
}

export interface AllTenantReconciliationExecutionGateway {
  readWorkerDeploymentFingerprint(): Promise<string>;
  readAggregateState(): Promise<AllTenantReconciliationAggregateState>;
  writeMigrationLedger(sql: string): Promise<{ changes: number; rowsWritten: number }>;
}

interface HashedEvidence<T> {
  evidenceId: string;
  sha256: string;
  document: T;
}

export interface AllTenantReconciliationEvidenceBundle {
  schemaVersion: 1;
  candidateCommit: string;
  entries: Array<{
    name: string;
    schema: HashedEvidence<{
      schemaVersion: 1;
      evidenceId: string;
      candidateCommit: string;
      databaseUuid: string;
      migrationName: string;
      migrationSha256: string;
      postSchemaExact: boolean;
      aggregateOnly: true;
    }>;
    ledger: HashedEvidence<{
      schemaVersion: 1;
      evidenceId: string;
      candidateCommit: string;
      databaseUuid: string;
      migrationName: string;
      ledgerEntryInitiallyAbsent: boolean;
      pendingMigrationCount: number;
      exactExpectedPendingSet: boolean;
      pendingMigrationNamesSha256: string;
      aggregateOnly: true;
    }>;
  }>;
  foreignKeyDisposition: HashedEvidence<{
    schemaVersion: 1;
    evidenceId: string;
    candidateCommit: string;
    databaseUuid: string;
    rawArchivalViolationCount: number;
    formallyWaivedViolationCount: number;
    effectiveUnwaivedViolationCount: number;
    activeViolationCount: number;
    unknownViolationCount: number;
    groups: AllTenantReconciliationForeignKeyGroup[];
    archivalRowCount: number;
    archivalLatestUpdatedAtUtc: string;
    activeRowCount: number;
    activeLatestCreatedAtUtc: string;
    triggerCount: number;
    dependentObjectCount: number;
    runtimeSourceReferenceCount: number;
    archivalTableConfirmed: boolean;
    activeWriterDisabledConfirmed: boolean;
    excludedFromCanonicalImportConfirmed: boolean;
    excludedFromReportingConfirmed: boolean;
    removalPhase: 'legacy_retirement_p11';
    aggregateOnly: true;
  }>;
}

export interface AllTenantReconciliationExecutionReceipt {
  schemaVersion: 1;
  checkpoint: 'CDB-V1-070C-SCHEMA-LEDGER-ARCHIVAL-FK-RECONCILIATION-COMPLETE';
  reconciled: true;
  candidateCommit: string;
  pendingMigrationCountBefore: 29;
  pendingMigrationCountAfter: 25;
  migrationLedgerRowsWritten: 4;
  migrationSqlStatementsExecuted: 0;
  ddlStatementsExecuted: 0;
  businessRowsWritten: 0;
  rawArchivalForeignKeyViolationsBefore: 41;
  rawArchivalForeignKeyViolationsAfter: 41;
  effectiveUnwaivedForeignKeyViolationsAfter: 0;
  workerDeploymentFingerprint: string;
  finalResponseAuthority: 'legacy';
  trafficChanged: false;
  providerFlagsChanged: 0;
  canonicalPromotionPerformed: false;
  localSyncActivationPerformed: false;
  legacyRetirementPerformed: false;
  archivalTableMutationPerformed: false;
  destructiveActionPerformed: false;
  remoteDatabaseDeletionPerformed: false;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      output[key] = stableValue((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return value;
}

export function reconciliationEvidenceSha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  const left = sorted(actual);
  const right = sorted(expected);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizedForeignKeyGroups(
  groups: readonly AllTenantReconciliationForeignKeyGroup[],
): AllTenantReconciliationForeignKeyGroup[] {
  return [...groups]
    .map((group) => ({
      childTable: group.childTable,
      parentTable: group.parentTable,
      violationCount: Number(group.violationCount),
    }))
    .sort((left, right) => `${left.childTable}->${left.parentTable}`.localeCompare(
      `${right.childTable}->${right.parentTable}`,
    ));
}

function exactForeignKeyGroups(groups: readonly AllTenantReconciliationForeignKeyGroup[]): boolean {
  const expected = normalizedForeignKeyGroups(CDB_V1_070C_ARCHIVAL_FK_GROUPS.map((group) => ({
    childTable: group.childTable,
    parentTable: group.parentTable,
    violationCount: group.rawViolationCount,
  })));
  const actual = normalizedForeignKeyGroups(groups);
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function exactArchivalDisposition(state: AllTenantReconciliationAggregateState): boolean {
  const disposition = state.archivalDisposition;
  const archivalUpdated = Date.parse(disposition.archivalLatestUpdatedAtUtc);
  const activeCreated = Date.parse(disposition.activeLatestCreatedAtUtc);
  return Number.isSafeInteger(disposition.archivalRowCount)
    && disposition.archivalRowCount > 0
    && Number.isSafeInteger(disposition.activeRowCount)
    && disposition.activeRowCount > 0
    && Number.isFinite(archivalUpdated)
    && Number.isFinite(activeCreated)
    && archivalUpdated < activeCreated
    && disposition.triggerCount === 0
    && disposition.dependentObjectCount === 0
    && disposition.runtimeSourceReferenceCount === 0
    && disposition.excludedFromCanonicalImport === true
    && disposition.excludedFromReporting === true;
}

function evidencePrefix(migrationName: string): string {
  const match = /^(\d{4})_/.exec(migrationName);
  if (!match) throw new Error(`Invalid reconciliation migration name: ${migrationName}`);
  return match[1];
}

function hashed<T extends { evidenceId: string }>(document: T): HashedEvidence<T> {
  return { evidenceId: document.evidenceId, sha256: reconciliationEvidenceSha256(document), document };
}

export function buildAllTenantReconciliationEvidenceBundle(
  state: AllTenantReconciliationAggregateState,
  candidateCommit: string,
): AllTenantReconciliationEvidenceBundle {
  if (!/^[0-9a-f]{40}$/.test(candidateCommit)) throw new Error('Candidate commit must be a 40-character Git SHA');
  const pendingNames = sorted(state.pendingMigrationNames);
  const expectedPending = sorted(CDB_V1_070A_MIGRATION_NAMES);
  const exactExpectedPendingSet = sameStrings(pendingNames, expectedPending);
  const presentTargets = new Set(state.targetLedgerEntriesPresent);
  const candidateShort = candidateCommit.slice(0, 12);
  const entries = CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((migration) => {
    const prefix = evidencePrefix(migration.name);
    const schemaDocument = {
      schemaVersion: 1 as const,
      evidenceId: `cdb-v1-070c-schema-${prefix}-${candidateShort}`,
      candidateCommit,
      databaseUuid: state.database.uuid,
      migrationName: migration.name,
      migrationSha256: migration.sha256,
      postSchemaExact: state.postSchemaExact[migration.name] === true,
      aggregateOnly: true as const,
    };
    const ledgerDocument = {
      schemaVersion: 1 as const,
      evidenceId: `cdb-v1-070c-ledger-${prefix}-${candidateShort}`,
      candidateCommit,
      databaseUuid: state.database.uuid,
      migrationName: migration.name,
      ledgerEntryInitiallyAbsent: !presentTargets.has(migration.name),
      pendingMigrationCount: pendingNames.length,
      exactExpectedPendingSet,
      pendingMigrationNamesSha256: reconciliationEvidenceSha256(pendingNames),
      aggregateOnly: true as const,
    };
    return {
      name: migration.name,
      schema: hashed(schemaDocument),
      ledger: hashed(ledgerDocument),
    };
  });
  const groups = normalizedForeignKeyGroups(state.foreignKeyGroups);
  const rawArchivalViolationCount = groups
    .filter((group) => group.childTable === 'doctor_commission_accruals_old_0391')
    .reduce((sum, group) => sum + group.violationCount, 0);
  const unknownViolationCount = groups
    .filter((group) => group.childTable !== 'doctor_commission_accruals_old_0391'
      || !['bills', 'visits'].includes(group.parentTable))
    .reduce((sum, group) => sum + group.violationCount, 0);
  const activeViolationCount = groups
    .filter((group) => group.childTable !== 'doctor_commission_accruals_old_0391')
    .reduce((sum, group) => sum + group.violationCount, 0);
  const dispositionReady = exactForeignKeyGroups(groups) && exactArchivalDisposition(state);
  const foreignKeyDocument = {
    schemaVersion: 1 as const,
    evidenceId: `cdb-v1-070c-archival-fk-${candidateShort}`,
    candidateCommit,
    databaseUuid: state.database.uuid,
    rawArchivalViolationCount,
    formallyWaivedViolationCount: dispositionReady ? rawArchivalViolationCount : 0,
    effectiveUnwaivedViolationCount: dispositionReady ? 0 : rawArchivalViolationCount,
    activeViolationCount,
    unknownViolationCount,
    groups,
    archivalRowCount: state.archivalDisposition.archivalRowCount,
    archivalLatestUpdatedAtUtc: state.archivalDisposition.archivalLatestUpdatedAtUtc,
    activeRowCount: state.archivalDisposition.activeRowCount,
    activeLatestCreatedAtUtc: state.archivalDisposition.activeLatestCreatedAtUtc,
    triggerCount: state.archivalDisposition.triggerCount,
    dependentObjectCount: state.archivalDisposition.dependentObjectCount,
    runtimeSourceReferenceCount: state.archivalDisposition.runtimeSourceReferenceCount,
    archivalTableConfirmed: state.archivalDisposition.archivalRowCount > 0,
    activeWriterDisabledConfirmed: dispositionReady,
    excludedFromCanonicalImportConfirmed: state.archivalDisposition.excludedFromCanonicalImport,
    excludedFromReportingConfirmed: state.archivalDisposition.excludedFromReporting,
    removalPhase: 'legacy_retirement_p11' as const,
    aggregateOnly: true as const,
  };
  return {
    schemaVersion: 1,
    candidateCommit,
    entries,
    foreignKeyDisposition: hashed(foreignKeyDocument),
  };
}

function sqlString(value: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`Unsafe SQL literal: ${value}`);
  return `'${value.replaceAll("'", "''")}'`;
}

function valuesCte(name: string, values: readonly string[]): string {
  return `${name}(name) AS (VALUES ${values.map((value) => `(${sqlString(value)})`).join(',')})`;
}

const schemaGuardSql = `
  EXISTS (SELECT 1 FROM pragma_table_info('approval_requests') WHERE name='approval_revision')
  AND EXISTS (SELECT 1 FROM pragma_table_info('approval_decisions') WHERE name='approval_revision')
  AND EXISTS (SELECT 1 FROM pragma_table_info('approval_decisions') WHERE name='superseded_at')
  AND EXISTS (SELECT 1 FROM pragma_table_info('approval_decisions') WHERE name='superseded_by_revision')
  AND EXISTS (SELECT 1 FROM pragma_table_info('approval_decisions') WHERE name='superseded_reason')
  AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_approval_decisions_current')
  AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='approval_events' AND sql LIKE '%request_info%' AND sql LIKE '%info_submitted%')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_duty_roster') WHERE name='version')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_duty_roster') WHERE name='updated_by')
  AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='hr_roster_events')
  AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='workforce_mutation_idempotency')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_attendance_punches') WHERE name='source_event_key')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_attendance_punches') WHERE name='request_hash')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_attendance') WHERE name='business_date')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_attendance') WHERE name='projection_version')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_attendance') WHERE name='roster_id')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_attendance_punches') WHERE name='business_date')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_attendance') WHERE name='projection_status')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_attendance') WHERE name='worked_minutes')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_attendance') WHERE name='first_in_at_utc')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_attendance') WHERE name='last_out_at_utc')
  AND EXISTS (SELECT 1 FROM pragma_table_info('hr_attendance') WHERE name='projection_updated_at_utc')
  AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='hr_attendance_projection_events')
  AND EXISTS (SELECT 1 FROM pragma_table_info('doctor_commission_rules') WHERE name='rule_version')
  AND EXISTS (SELECT 1 FROM pragma_table_info('doctor_commission_accruals') WHERE name='commission_rule_version_snapshot')
  AND EXISTS (SELECT 1 FROM pragma_table_info('doctor_commission_accruals') WHERE name='commission_reason_code')`;

const foreignKeyGuardSql = `
  (SELECT COUNT(*) FROM pragma_foreign_key_check WHERE "table"='doctor_commission_accruals_old_0391' AND parent='bills')=26
  AND (SELECT COUNT(*) FROM pragma_foreign_key_check WHERE "table"='doctor_commission_accruals_old_0391' AND parent='visits')=15
  AND NOT EXISTS (
    SELECT 1 FROM pragma_foreign_key_check
    WHERE "table"<>'doctor_commission_accruals_old_0391' OR parent NOT IN ('bills','visits')
  )`;

const archivalDispositionGuardSql = `
  (SELECT COUNT(*) FROM doctor_commission_accruals_old_0391)>0
  AND (SELECT COUNT(*) FROM doctor_commission_accruals)>0
  AND datetime((SELECT MAX(updated_at) FROM doctor_commission_accruals_old_0391))
      < datetime((SELECT MAX(created_at) FROM doctor_commission_accruals))
  AND (SELECT COUNT(*) FROM sqlite_master
       WHERE type='trigger' AND tbl_name='doctor_commission_accruals_old_0391')=0
  AND (SELECT COUNT(*) FROM sqlite_master
       WHERE type IN ('view','trigger')
         AND sql IS NOT NULL
         AND instr(lower(sql), lower('doctor_commission_accruals_old_0391'))>0
         AND NOT (type='trigger' AND tbl_name='doctor_commission_accruals_old_0391'))=0`;

export function buildAtomicMigrationLedgerReconciliationSql(): string {
  const targets = CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((entry) => entry.name);
  return `WITH
${valuesCte('approved', targets)},
${valuesCte('expected_pending', CDB_V1_070A_MIGRATION_NAMES)}
INSERT INTO d1_migrations(name)
SELECT approved.name
FROM approved
WHERE
  (SELECT COUNT(*) FROM expected_pending e LEFT JOIN d1_migrations d ON d.name=e.name WHERE d.name IS NULL)=29
  AND (SELECT COUNT(*) FROM approved a JOIN d1_migrations d ON d.name=a.name)=0
  AND ${schemaGuardSql}
  AND ${foreignKeyGuardSql}
  AND ${archivalDispositionGuardSql};`;
}

function assertDatabaseIdentity(state: AllTenantReconciliationAggregateState): void {
  if (state.database.name !== CDB101_PRODUCTION_DATABASE_NAME
    || state.database.uuid !== CDB101_PRODUCTION_DATABASE_ID) {
    throw new Error('Production database identity mismatch');
  }
}

function assertBeforeState(state: AllTenantReconciliationAggregateState): void {
  assertDatabaseIdentity(state);
  if (!sameStrings(state.pendingMigrationNames, CDB_V1_070A_MIGRATION_NAMES)) {
    throw new Error('Migration ledger pending set mismatch');
  }
  if (state.targetLedgerEntriesPresent.length !== 0) {
    throw new Error('Migration ledger target entry already exists');
  }
  if (CDB_V1_070C_RECONCILIATION_MIGRATIONS.some((entry) => state.postSchemaExact[entry.name] !== true)) {
    throw new Error('Post-migration schema is not exact');
  }
  if (!exactForeignKeyGroups(state.foreignKeyGroups)) {
    throw new Error('Archival foreign key disposition mismatch');
  }
  if (!exactArchivalDisposition(state)) {
    throw new Error('Archival disposition prerequisites mismatch');
  }
}

function assertEvidenceBindings(
  authorization: AllTenantReconciliationAuthorization,
  state: AllTenantReconciliationAggregateState,
): void {
  const bundle = buildAllTenantReconciliationEvidenceBundle(state, authorization.repository.candidateCommit);
  for (const entry of authorization.reconciliation.entries) {
    const evidence = bundle.entries.find((item) => item.name === entry.name);
    if (!evidence
      || entry.schemaEvidenceId !== evidence.schema.evidenceId
      || entry.schemaEvidenceSha256 !== evidence.schema.sha256
      || entry.ledgerEvidenceId !== evidence.ledger.evidenceId
      || entry.ledgerEvidenceSha256 !== evidence.ledger.sha256) {
      throw new Error(`Protected reconciliation evidence mismatch: ${entry.name}`);
    }
  }
  if (authorization.foreignKeyDisposition.evidenceId !== bundle.foreignKeyDisposition.evidenceId
    || authorization.foreignKeyDisposition.evidenceSha256 !== bundle.foreignKeyDisposition.sha256) {
    throw new Error('Protected foreign key evidence mismatch');
  }
}

function assertPostState(state: AllTenantReconciliationAggregateState): void {
  assertDatabaseIdentity(state);
  const targets = new Set(CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((entry) => entry.name));
  const expectedPending = CDB_V1_070A_MIGRATION_NAMES.filter((name) => !targets.has(name));
  if (!sameStrings(state.pendingMigrationNames, expectedPending)
    || !sameStrings(state.targetLedgerEntriesPresent, [...targets])) {
    throw new Error('Reconciliation post-state migration ledger mismatch');
  }
  if (CDB_V1_070C_RECONCILIATION_MIGRATIONS.some((entry) => state.postSchemaExact[entry.name] !== true)) {
    throw new Error('Reconciliation post-state schema mismatch');
  }
  if (!exactForeignKeyGroups(state.foreignKeyGroups)) {
    throw new Error('Reconciliation post-state foreign key mismatch');
  }
  if (!exactArchivalDisposition(state)) {
    throw new Error('Reconciliation post-state archival disposition mismatch');
  }
}

export async function executeAuthorizedAllTenantReconciliation(
  authorization: AllTenantReconciliationAuthorization,
  gateway: AllTenantReconciliationExecutionGateway,
): Promise<AllTenantReconciliationExecutionReceipt> {
  if (authorization.operation !== 'all_tenant_schema_ledger_archival_fk_reconciliation') {
    throw new Error('Reconciliation authorization operation mismatch');
  }
  const deploymentInitial = await gateway.readWorkerDeploymentFingerprint();
  if (!deploymentInitial) throw new Error('Worker deployment fingerprint is missing');
  const before = await gateway.readAggregateState();
  assertBeforeState(before);
  assertEvidenceBindings(authorization, before);
  const deploymentBeforeWrite = await gateway.readWorkerDeploymentFingerprint();
  if (deploymentBeforeWrite !== deploymentInitial) {
    throw new Error('Worker deployment assignment changed before reconciliation write');
  }
  const write = await gateway.writeMigrationLedger(buildAtomicMigrationLedgerReconciliationSql());
  const writeCounters = [write.changes, write.rowsWritten];
  if (writeCounters.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 4)
    || !writeCounters.includes(4)) {
    throw new Error('Atomic reconciliation did not report exactly four migration ledger rows');
  }
  const after = await gateway.readAggregateState();
  assertPostState(after);
  const deploymentAfter = await gateway.readWorkerDeploymentFingerprint();
  if (deploymentAfter !== deploymentInitial) {
    throw new Error('Worker deployment assignment changed during reconciliation');
  }
  return {
    schemaVersion: 1,
    checkpoint: 'CDB-V1-070C-SCHEMA-LEDGER-ARCHIVAL-FK-RECONCILIATION-COMPLETE',
    reconciled: true,
    candidateCommit: authorization.repository.candidateCommit,
    pendingMigrationCountBefore: 29,
    pendingMigrationCountAfter: 25,
    migrationLedgerRowsWritten: 4,
    migrationSqlStatementsExecuted: 0,
    ddlStatementsExecuted: 0,
    businessRowsWritten: 0,
    rawArchivalForeignKeyViolationsBefore: 41,
    rawArchivalForeignKeyViolationsAfter: 41,
    effectiveUnwaivedForeignKeyViolationsAfter: 0,
    workerDeploymentFingerprint: deploymentInitial,
    finalResponseAuthority: 'legacy',
    trafficChanged: false,
    providerFlagsChanged: 0,
    canonicalPromotionPerformed: false,
    localSyncActivationPerformed: false,
    legacyRetirementPerformed: false,
    archivalTableMutationPerformed: false,
    destructiveActionPerformed: false,
    remoteDatabaseDeletionPerformed: false,
  };
}

export const ALL_TENANT_RECONCILIATION_SCHEMA_ASSERTION_SQL = `SELECT
  CASE WHEN ${schemaGuardSql} THEN 1 ELSE 0 END AS all_schema_exact;`;

export const ALL_TENANT_RECONCILIATION_FOREIGN_KEY_AGGREGATE_SQL = `SELECT
  "table" AS child_table,
  parent AS parent_table,
  COUNT(*) AS violation_count
FROM pragma_foreign_key_check
GROUP BY "table", parent
ORDER BY "table", parent;`;

export const ALL_TENANT_RECONCILIATION_ARCHIVAL_DISPOSITION_SQL = `SELECT
  (SELECT COUNT(*) FROM doctor_commission_accruals_old_0391) AS archival_row_count,
  (SELECT MAX(updated_at) FROM doctor_commission_accruals_old_0391) AS archival_latest_updated_at,
  (SELECT COUNT(*) FROM doctor_commission_accruals) AS active_row_count,
  (SELECT MAX(created_at) FROM doctor_commission_accruals) AS active_latest_created_at,
  (SELECT COUNT(*) FROM sqlite_master
   WHERE type='trigger' AND tbl_name='doctor_commission_accruals_old_0391') AS trigger_count,
  (SELECT COUNT(*) FROM sqlite_master
   WHERE type IN ('view','trigger')
     AND sql IS NOT NULL
     AND instr(lower(sql), lower('doctor_commission_accruals_old_0391'))>0
     AND NOT (type='trigger' AND tbl_name='doctor_commission_accruals_old_0391')) AS dependent_object_count;`;

export const ALL_TENANT_RECONCILIATION_PENDING_SQL = `WITH
${valuesCte('expected_pending', CDB_V1_070A_MIGRATION_NAMES)}
SELECT e.name
FROM expected_pending e
LEFT JOIN d1_migrations d ON d.name=e.name
WHERE d.name IS NULL
ORDER BY e.name;`;

export const ALL_TENANT_RECONCILIATION_TARGET_LEDGER_SQL = `SELECT name
FROM d1_migrations
WHERE name IN (${CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((entry) => sqlString(entry.name)).join(',')})
ORDER BY name;`;
