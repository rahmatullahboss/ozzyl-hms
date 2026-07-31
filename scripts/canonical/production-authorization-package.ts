import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evaluateProtectedCloneRehearsalResult } from './check-protected-clone-rehearsal-result';

export const CDB_V1_060_CHECKPOINT = 'CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-READY';
export const CDB_V1_060_NEXT_CHECKPOINT = 'CDB-V1-070-STAGED-PRODUCTION-CUTOVER-EXACT-AUTHORIZATION-REQUIRED';
export const CDB_V1_060_BRANCH = 'program/cdb-main-continuous-20260725';

export const CDB_V1_060_MIGRATION_NAMES = [
  '0551_workforce_roster_integrity.sql',
  '0552_attendance_projection_integrity.sql',
  '0553_mfa_registration_schema_repair.sql',
  '0554_canonical_prescription_medication_intent.sql',
  '0555_canonical_clinical_document_diagnosis.sql',
  '0556_canonical_patient_vital_measurement.sql',
  '0557_canonical_medication_administration.sql',
  '0558_canonical_lab_result_specimen.sql',
  '0559_canonical_radiology_acquisition_report.sql',
  '0560_canonical_emergency_case_triage.sql',
  '0561_compensation_rule_route_identity.sql',
  '0563_practitioner_route_identity.sql',
  '0564_patient_import_route_identity.sql',
  '0565_appointment_route_identity.sql',
  '0566_appointment_schedule_route_identity.sql',
  '0567_encounter_visit_route_identity.sql',
  '0568_service_delivery_route_identity.sql',
  '0569_service_catalog_route_identity.sql',
  '0570_doctor_commission_rule_version_snapshot.sql',
] as const;

export const CDB_V1_060_BACKFILL_PATHS = [
  'scripts/canonical/backfill-tenant-patient-links.ts',
  'scripts/canonical/backfill-practitioners.ts',
  'scripts/canonical/backfill-appointments.ts',
  'scripts/canonical/backfill-encounter-admission-bed-convergence.ts',
] as const;

export const CDB_V1_060_PROVIDER_KEYS = [
  'canonical_invoice_provider_v1',
  'canonical_payment_provider_v1',
  'canonical_deposit_provider_v1',
  'canonical_patient_identity_provider_v1',
  'canonical_practitioner_provider_v1',
  'canonical_appointment_provider_v1',
  'canonical_encounter_provider_v1',
  'canonical_admission_bed_provider_v1',
  'canonical_compensation_accrual_provider_v1',
] as const;

export const CDB_V1_060_CONSUMER_IDS = [
  'cdb040b.billing-detail',
  'cdb040b.report',
  'cdb040b.dashboard',
  'cdb040b.export',
  'cdb040b.scheduled-job',
  'cdb040b.admin',
  'cdb040c.reception-patient-context.patient',
  'cdb040c.reception-patient-context.practitioner',
  'cdb040c.reception-patient-context.appointment',
  'cdb040c.reception-patient-context.encounter',
  'cdb040c.reception-patient-context.admission',
  'cdb040c.commission-accrual-admin',
] as const;

export const CDB_V1_060_SOURCE_TABLES = [
  'bills',
  'payments',
  'billing_deposits',
  'patients',
  'doctors',
  'appointments',
  'visits',
  'admissions',
  'doctor_commission_accruals',
] as const;

export const CDB_V1_060_EXTERNAL_BINDING_PATHS = [
  'productionDatabase.name',
  'productionDatabase.id',
  'productionSnapshot.bookmarkId',
  'productionSnapshot.sha256',
  'backupExport.evidenceId',
  'backupExport.sha256',
  'maintenanceWindow.startUtc',
  'maintenanceWindow.endUtc',
  'owners.executionOwnerId',
  'owners.rollbackOwnerId',
  'owners.observationOwnerId',
  'ownerApproval.evidenceId',
  'ownerApproval.evidenceSha256',
  'observation.durationMinutes',
  'observation.maxP95LatencyMs',
  'observation.maxErrorRate',
  'deployedBuild.workerVersionId',
  'deployedBuild.buildManifestSha256',
] as const;

const CDB_V1_050_RESULT_PATH = 'docs/database/cdb-v1-050-protected-clone-rehearsal-result.json';
const CDB_V1_050_CHECKER_PATH = 'scripts/canonical/check-protected-clone-rehearsal-result.ts';
const RUNBOOK_PATH = 'docs/database/canonical-core-v1-production-cutover-runbook.md';
const MIGRATION_MANIFEST_PATH = 'src/data/schema-migrations.generated.ts';

export interface ProductionAuthorizationPackageBinding {
  branch: string;
  candidateCommit: string;
  buildSha: string;
}

export interface ProductionAuthorizationPackageCommand {
  id: string;
  phase: 'preflight' | 'backup_verification' | 'migration' | 'backfill' | 'reconciliation' | 'shadow_canary' | 'observation' | 'rollback';
  executable: false;
  argvTemplate: string[];
}

export interface ProductionAuthorizationPackage {
  schemaVersion: 1;
  checkpoint: typeof CDB_V1_060_CHECKPOINT;
  status: 'prepared_not_authorized';
  candidate: ProductionAuthorizationPackageBinding;
  bindings: {
    cdbV1050ResultPath: typeof CDB_V1_050_RESULT_PATH;
    cdbV1050ResultSha256: string;
    cdbV1050CheckerPath: typeof CDB_V1_050_CHECKER_PATH;
    cdbV1050CheckerSha256: string;
    runbookPath: typeof RUNBOOK_PATH;
    runbookSha256: string;
    migrationManifestPath: typeof MIGRATION_MANIFEST_PATH;
    migrationManifestSha256: string;
    migrationManifestCount: 504;
  };
  scope: {
    tenantIds: ['100'];
    domains: ['finance', 'identity_episode', 'practitioner_compensation'];
    providerKeys: string[];
    consumerIds: string[];
    sourceTables: string[];
    canaryMode: 'shadow_read_only';
    maxTenantCount: 1;
  };
  migrations: Array<{
    name: string;
    path: string;
    sha256: string;
    additiveOnly: true;
  }>;
  backfills: Array<{
    id: string;
    path: string;
    sha256: string;
    maxSourceRecordsPerPass: 100;
    secondPassRequired: true;
    secondPassNewBusinessRowsExpected: 0;
  }>;
  commands: ProductionAuthorizationPackageCommand[];
  acceptance: {
    maximumUnexplainedVarianceCount: 0;
    maximumProviderErrorCount: 0;
    maximumMappingAmbiguityCount: 0;
    maximumCrossTenantReferenceCount: 0;
    maximumForeignKeyViolationCount: 0;
    maximumSecondPassNewBusinessRows: 0;
    requiredSmokeWorkflowCount: 4;
    requiredFinalProvider: 'legacy';
  };
  abortConditions: string[];
  rollback: {
    immediate: true;
    finalProvider: 'legacy';
    keepLegacyRoutesActive: true;
    maximumRollbackDurationMs: null;
  };
  firstCutoverExclusions: {
    canonicalWrites: true;
    compatibilityWriteRetirement: true;
    legacyReaderRetirement: true;
    legacyWriterRetirement: true;
    destructiveMigrations: true;
    localSyncActivation: true;
  };
  permissions: {
    productionReadAuthorized: false;
    productionMigrationAuthorized: false;
    productionBackfillAuthorized: false;
    providerPromotionAuthorized: false;
    canonicalWriteAuthorized: false;
    deploymentAuthorized: false;
    trafficChangeAuthorized: false;
    localSyncActivationAuthorized: false;
    legacyRetirementAuthorized: false;
    destructiveActionAuthorized: false;
  };
  externalBindings: {
    productionDatabase: { name: null; id: null };
    productionSnapshot: { bookmarkId: null; sha256: null };
    backupExport: { evidenceId: null; sha256: null };
    maintenanceWindow: { startUtc: null; endUtc: null; writeFreezeProcedureId: null };
    owners: { executionOwnerId: null; rollbackOwnerId: null; observationOwnerId: null };
    ownerApproval: { evidenceId: null; evidenceSha256: null; approvedAtUtc: null };
    observation: { durationMinutes: null; maxP95LatencyMs: null; maxErrorRate: null };
    deployedBuild: { workerVersionId: null; buildManifestSha256: null };
  };
  safety: {
    aggregateOnly: true;
    networkRequestPerformed: false;
    productionReadPerformed: false;
    productionMutationPerformed: false;
    deploymentPerformed: false;
    trafficChanged: false;
    pushPerformed: false;
    cdbToMainIntegrationPerformed: false;
  };
  nextCheckpoint: typeof CDB_V1_060_NEXT_CHECKPOINT;
}

export interface ProductionAuthorizationPackageEvaluation {
  packageReady: boolean;
  executionReady: false;
  issues: string[];
  unresolvedExternalBindings: string[];
  migrationCount: number;
  backfillCount: number;
  providerCount: number;
  consumerCount: number;
  sourceTableCount: number;
  networkRequestPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fileSha256(root: string, path: string): string {
  const absolute = join(root, path);
  if (!existsSync(absolute)) throw new Error(`required repository file is missing: ${path}`);
  return sha256(readFileSync(absolute));
}

function exactSha(value: string, label: string): string {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`${label} must be one lowercase 40-character Git SHA`);
  return value;
}

function exactArray(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function readJson(root: string, path: string): unknown {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown;
}

function migrationManifestCount(root: string): number {
  const text = readFileSync(join(root, MIGRATION_MANIFEST_PATH), 'utf8');
  return (text.match(/\bfilename:\s*"[^"]+"/g) ?? []).length;
}

function commands(): ProductionAuthorizationPackageCommand[] {
  const authorization = '{{PROTECTED_AUTHORIZATION_PATH}}';
  const externalEvidence = '{{EXTERNAL_EVIDENCE_DIRECTORY}}';
  return [
    {
      id: 'cdbv1070.preflight',
      phase: 'preflight',
      executable: false,
      argvTemplate: ['pnpm', 'canonical:production-authorization-package-readiness'],
    },
    {
      id: 'cdbv1070.backup-verification',
      phase: 'backup_verification',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'backup-verification', '--authorization', authorization, '--evidence-dir', externalEvidence],
    },
    {
      id: 'cdbv1070.migration',
      phase: 'migration',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'migration', '--authorization', authorization, '--migration-count', '19'],
    },
    {
      id: 'cdbv1070.backfill',
      phase: 'backfill',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'backfill', '--authorization', authorization, '--backfill-count', '4', '--second-pass'],
    },
    {
      id: 'cdbv1070.reconciliation',
      phase: 'reconciliation',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'reconciliation', '--authorization', authorization, '--require-zero-variance'],
    },
    {
      id: 'cdbv1070.shadow-canary',
      phase: 'shadow_canary',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'shadow-canary', '--authorization', authorization, '--tenant', '100', '--mode', 'shadow'],
    },
    {
      id: 'cdbv1070.observation',
      phase: 'observation',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'observation', '--authorization', authorization, '--evidence-dir', externalEvidence],
    },
    {
      id: 'cdbv1070.rollback',
      phase: 'rollback',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'rollback', '--authorization', authorization, '--final-provider', 'legacy'],
    },
  ];
}

function backfillId(path: string): string {
  return path.replace('scripts/canonical/', '').replace(/\.ts$/, '').replaceAll('-', '_');
}

export function buildProductionAuthorizationPackage(
  rootInput: string,
  binding: ProductionAuthorizationPackageBinding,
): ProductionAuthorizationPackage {
  const root = resolve(rootInput);
  if (binding.branch !== CDB_V1_060_BRANCH) throw new Error(`branch must equal ${CDB_V1_060_BRANCH}`);
  exactSha(binding.candidateCommit, 'candidateCommit');
  exactSha(binding.buildSha, 'buildSha');
  const rehearsalResult = readJson(root, CDB_V1_050_RESULT_PATH);
  const rehearsalIssues = evaluateProtectedCloneRehearsalResult(rehearsalResult);
  if (rehearsalIssues.length > 0) {
    throw new Error(`CDB-V1-050 result is invalid: ${rehearsalIssues.join(', ')}`);
  }
  const manifestCount = migrationManifestCount(root);
  if (manifestCount !== 504) throw new Error(`migration manifest must contain 504 entries, received ${manifestCount}`);

  return {
    schemaVersion: 1,
    checkpoint: CDB_V1_060_CHECKPOINT,
    status: 'prepared_not_authorized',
    candidate: { ...binding },
    bindings: {
      cdbV1050ResultPath: CDB_V1_050_RESULT_PATH,
      cdbV1050ResultSha256: fileSha256(root, CDB_V1_050_RESULT_PATH),
      cdbV1050CheckerPath: CDB_V1_050_CHECKER_PATH,
      cdbV1050CheckerSha256: fileSha256(root, CDB_V1_050_CHECKER_PATH),
      runbookPath: RUNBOOK_PATH,
      runbookSha256: fileSha256(root, RUNBOOK_PATH),
      migrationManifestPath: MIGRATION_MANIFEST_PATH,
      migrationManifestSha256: fileSha256(root, MIGRATION_MANIFEST_PATH),
      migrationManifestCount: 504,
    },
    scope: {
      tenantIds: ['100'],
      domains: ['finance', 'identity_episode', 'practitioner_compensation'],
      providerKeys: [...CDB_V1_060_PROVIDER_KEYS],
      consumerIds: [...CDB_V1_060_CONSUMER_IDS],
      sourceTables: [...CDB_V1_060_SOURCE_TABLES],
      canaryMode: 'shadow_read_only',
      maxTenantCount: 1,
    },
    migrations: CDB_V1_060_MIGRATION_NAMES.map((name) => ({
      name,
      path: `migrations/${name}`,
      sha256: fileSha256(root, `migrations/${name}`),
      additiveOnly: true,
    })),
    backfills: CDB_V1_060_BACKFILL_PATHS.map((path) => ({
      id: backfillId(path),
      path,
      sha256: fileSha256(root, path),
      maxSourceRecordsPerPass: 100,
      secondPassRequired: true,
      secondPassNewBusinessRowsExpected: 0,
    })),
    commands: commands(),
    acceptance: {
      maximumUnexplainedVarianceCount: 0,
      maximumProviderErrorCount: 0,
      maximumMappingAmbiguityCount: 0,
      maximumCrossTenantReferenceCount: 0,
      maximumForeignKeyViolationCount: 0,
      maximumSecondPassNewBusinessRows: 0,
      requiredSmokeWorkflowCount: 4,
      requiredFinalProvider: 'legacy',
    },
    abortConditions: [
      'candidate commit or build differs from the authorized package',
      'production database identity, snapshot, backup or owner evidence differs from authorization',
      'maintenance window or write-freeze binding is invalid',
      'pending migration set differs from the exact nineteen approved migrations',
      'backfill partition exceeds the exact authorized tenant and row bounds',
      'second pass creates any new business row',
      'mapping ambiguity, cross-tenant reference or foreign-key violation is observed',
      'unexplained variance, provider error or approved latency/error threshold breach is observed',
      'legacy rollback cannot be completed immediately',
    ],
    rollback: {
      immediate: true,
      finalProvider: 'legacy',
      keepLegacyRoutesActive: true,
      maximumRollbackDurationMs: null,
    },
    firstCutoverExclusions: {
      canonicalWrites: true,
      compatibilityWriteRetirement: true,
      legacyReaderRetirement: true,
      legacyWriterRetirement: true,
      destructiveMigrations: true,
      localSyncActivation: true,
    },
    permissions: {
      productionReadAuthorized: false,
      productionMigrationAuthorized: false,
      productionBackfillAuthorized: false,
      providerPromotionAuthorized: false,
      canonicalWriteAuthorized: false,
      deploymentAuthorized: false,
      trafficChangeAuthorized: false,
      localSyncActivationAuthorized: false,
      legacyRetirementAuthorized: false,
      destructiveActionAuthorized: false,
    },
    externalBindings: {
      productionDatabase: { name: null, id: null },
      productionSnapshot: { bookmarkId: null, sha256: null },
      backupExport: { evidenceId: null, sha256: null },
      maintenanceWindow: { startUtc: null, endUtc: null, writeFreezeProcedureId: null },
      owners: { executionOwnerId: null, rollbackOwnerId: null, observationOwnerId: null },
      ownerApproval: { evidenceId: null, evidenceSha256: null, approvedAtUtc: null },
      observation: { durationMinutes: null, maxP95LatencyMs: null, maxErrorRate: null },
      deployedBuild: { workerVersionId: null, buildManifestSha256: null },
    },
    safety: {
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      deploymentPerformed: false,
      trafficChanged: false,
      pushPerformed: false,
      cdbToMainIntegrationPerformed: false,
    },
    nextCheckpoint: CDB_V1_060_NEXT_CHECKPOINT,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return array(value).filter((entry): entry is string => typeof entry === 'string');
}

function nested(root: Record<string, unknown> | null, ...keys: string[]): unknown {
  let current: unknown = root;
  for (const key of keys) {
    const currentObject = object(current);
    if (!currentObject) return undefined;
    current = currentObject[key];
  }
  return current;
}

function unsafeCommandToken(value: string): boolean {
  return /(?:&&|\|\||[;|<>`]|\$\()/.test(value);
}

function checkHashBinding(
  issues: string[],
  root: string,
  actualPath: unknown,
  expectedPath: string,
  actualHash: unknown,
  label: string,
): void {
  if (actualPath !== expectedPath) {
    issues.push(`${label} path mismatch`);
    return;
  }
  const expectedHash = fileSha256(root, expectedPath);
  if (actualHash !== expectedHash) issues.push(`${label} hash mismatch`);
}

function addExternalBindingIssues(
  issues: string[],
  packageObject: Record<string, unknown>,
): string[] {
  const bindings = object(packageObject.externalBindings);
  const unresolved: string[] = [];
  for (const path of CDB_V1_060_EXTERNAL_BINDING_PATHS) {
    const value = nested(bindings, ...path.split('.'));
    if (value == null) unresolved.push(path);
    else issues.push(`committed package must not embed external binding ${path}`);
  }
  return unresolved;
}

export function evaluateProductionAuthorizationPackage(
  rootInput: string,
  value: unknown,
): ProductionAuthorizationPackageEvaluation {
  const root = resolve(rootInput);
  const issues: string[] = [];
  const packageObject = object(value);
  if (!packageObject) {
    return {
      packageReady: false,
      executionReady: false,
      issues: ['package must be one JSON object'],
      unresolvedExternalBindings: [...CDB_V1_060_EXTERNAL_BINDING_PATHS],
      migrationCount: 0,
      backfillCount: 0,
      providerCount: 0,
      consumerCount: 0,
      sourceTableCount: 0,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
    };
  }

  if (packageObject.schemaVersion !== 1) issues.push('schemaVersion must equal 1');
  if (packageObject.checkpoint !== CDB_V1_060_CHECKPOINT) issues.push('checkpoint mismatch');
  if (packageObject.status !== 'prepared_not_authorized') issues.push('status mismatch');
  if (packageObject.nextCheckpoint !== CDB_V1_060_NEXT_CHECKPOINT) issues.push('next checkpoint mismatch');

  const candidate = object(packageObject.candidate);
  if (candidate?.branch !== CDB_V1_060_BRANCH) issues.push('candidate branch mismatch');
  if (typeof candidate?.candidateCommit !== 'string' || !/^[0-9a-f]{40}$/.test(candidate.candidateCommit)) {
    issues.push('candidate commit is invalid');
  }
  if (typeof candidate?.buildSha !== 'string' || !/^[0-9a-f]{40}$/.test(candidate.buildSha)) {
    issues.push('build SHA is invalid');
  }

  const bindings = object(packageObject.bindings);
  checkHashBinding(issues, root, bindings?.cdbV1050ResultPath, CDB_V1_050_RESULT_PATH, bindings?.cdbV1050ResultSha256, 'CDB-V1-050 result');
  checkHashBinding(issues, root, bindings?.cdbV1050CheckerPath, CDB_V1_050_CHECKER_PATH, bindings?.cdbV1050CheckerSha256, 'CDB-V1-050 checker');
  checkHashBinding(issues, root, bindings?.runbookPath, RUNBOOK_PATH, bindings?.runbookSha256, 'runbook');
  checkHashBinding(issues, root, bindings?.migrationManifestPath, MIGRATION_MANIFEST_PATH, bindings?.migrationManifestSha256, 'migration manifest');
  if (bindings?.migrationManifestCount !== 504 || migrationManifestCount(root) !== 504) {
    issues.push('migration manifest count must equal 504');
  }
  try {
    const rehearsalIssues = evaluateProtectedCloneRehearsalResult(readJson(root, CDB_V1_050_RESULT_PATH));
    if (rehearsalIssues.length > 0) issues.push('CDB-V1-050 result is not valid');
  } catch {
    issues.push('CDB-V1-050 result cannot be read');
  }

  const scope = object(packageObject.scope);
  const tenantIds = stringArray(scope?.tenantIds);
  const providers = stringArray(scope?.providerKeys);
  const consumers = stringArray(scope?.consumerIds);
  const sourceTables = stringArray(scope?.sourceTables);
  if (!exactArray(tenantIds, ['100'])) issues.push('tenant scope must equal the single reviewed canary tenant template');
  if (!exactArray(stringArray(scope?.domains), ['finance', 'identity_episode', 'practitioner_compensation'])) issues.push('domain scope mismatch');
  if (!exactArray(providers, CDB_V1_060_PROVIDER_KEYS)) issues.push('provider scope mismatch');
  if (!exactArray(consumers, CDB_V1_060_CONSUMER_IDS)) issues.push('consumer scope mismatch');
  if (!exactArray(sourceTables, CDB_V1_060_SOURCE_TABLES)) issues.push('source-table scope mismatch');
  if (scope?.canaryMode !== 'shadow_read_only' || scope?.maxTenantCount !== 1) issues.push('canary scope must remain one-tenant read-only shadow');

  const migrationEntries = array(packageObject.migrations).map(object);
  if (migrationEntries.length !== CDB_V1_060_MIGRATION_NAMES.length) issues.push('migration count mismatch');
  for (let index = 0; index < CDB_V1_060_MIGRATION_NAMES.length; index += 1) {
    const name = CDB_V1_060_MIGRATION_NAMES[index];
    const entry = migrationEntries[index];
    const path = `migrations/${name}`;
    if (entry?.name !== name || entry?.path !== path || entry?.additiveOnly !== true) {
      issues.push(`migration contract mismatch: ${name}`);
      continue;
    }
    if (entry.sha256 !== fileSha256(root, path)) issues.push(`migration hash mismatch: ${name}`);
  }

  const backfillEntries = array(packageObject.backfills).map(object);
  if (backfillEntries.length !== CDB_V1_060_BACKFILL_PATHS.length) issues.push('backfill count mismatch');
  for (let index = 0; index < CDB_V1_060_BACKFILL_PATHS.length; index += 1) {
    const path = CDB_V1_060_BACKFILL_PATHS[index];
    const entry = backfillEntries[index];
    if (
      entry?.path !== path
      || entry?.id !== backfillId(path)
      || entry?.maxSourceRecordsPerPass !== 100
      || entry?.secondPassRequired !== true
      || entry?.secondPassNewBusinessRowsExpected !== 0
    ) {
      issues.push(`backfill contract mismatch: ${path}`);
      continue;
    }
    if (entry.sha256 !== fileSha256(root, path)) issues.push(`backfill hash mismatch: ${path}`);
  }

  const expectedCommands = commands();
  const commandEntries = array(packageObject.commands).map(object);
  if (commandEntries.length !== expectedCommands.length) issues.push('command count mismatch');
  for (let index = 0; index < expectedCommands.length; index += 1) {
    const expected = expectedCommands[index];
    const entry = commandEntries[index];
    const tokens = stringArray(entry?.argvTemplate);
    if (
      entry?.id !== expected.id
      || entry?.phase !== expected.phase
      || entry?.executable !== false
      || !exactArray(tokens, expected.argvTemplate)
    ) issues.push(`command contract mismatch: ${expected.phase}`);
    if (tokens.some(unsafeCommandToken)) issues.push(`unsafe command token in ${expected.phase}`);
  }

  const permissionObject = object(packageObject.permissions);
  for (const key of [
    'productionReadAuthorized',
    'productionMigrationAuthorized',
    'productionBackfillAuthorized',
    'providerPromotionAuthorized',
    'canonicalWriteAuthorized',
    'deploymentAuthorized',
    'trafficChangeAuthorized',
    'localSyncActivationAuthorized',
    'legacyRetirementAuthorized',
    'destructiveActionAuthorized',
  ]) {
    if (permissionObject?.[key] !== false) issues.push(`prepared package cannot authorize ${key}`);
  }

  const exclusions = object(packageObject.firstCutoverExclusions);
  for (const key of [
    'canonicalWrites',
    'compatibilityWriteRetirement',
    'legacyReaderRetirement',
    'legacyWriterRetirement',
    'destructiveMigrations',
    'localSyncActivation',
  ]) {
    if (exclusions?.[key] !== true) issues.push(`first-cutover exclusion must remain true: ${key}`);
  }

  const rollback = object(packageObject.rollback);
  if (rollback?.immediate !== true || rollback?.finalProvider !== 'legacy' || rollback?.keepLegacyRoutesActive !== true) {
    issues.push('rollback contract mismatch');
  }
  const abortConditions = stringArray(packageObject.abortConditions);
  if (abortConditions.length !== 9 || abortConditions.some((entry) => entry.trim() === '')) issues.push('abort conditions are incomplete');

  const safety = object(packageObject.safety);
  if (safety?.aggregateOnly !== true) issues.push('aggregate-only safety evidence is required');
  for (const key of [
    'networkRequestPerformed',
    'productionReadPerformed',
    'productionMutationPerformed',
    'deploymentPerformed',
    'trafficChanged',
    'pushPerformed',
    'cdbToMainIntegrationPerformed',
  ]) {
    if (safety?.[key] !== false) issues.push(`safety flag must be false: ${key}`);
  }

  const unresolvedExternalBindings = addExternalBindingIssues(issues, packageObject);
  if (!exactArray(unresolvedExternalBindings, CDB_V1_060_EXTERNAL_BINDING_PATHS)) {
    issues.push('external binding gap list mismatch');
  }

  return {
    packageReady: issues.length === 0,
    executionReady: false,
    issues: [...new Set(issues)],
    unresolvedExternalBindings,
    migrationCount: migrationEntries.length,
    backfillCount: backfillEntries.length,
    providerCount: providers.length,
    consumerCount: consumers.length,
    sourceTableCount: sourceTables.length,
    networkRequestPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
  };
}
