import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  buildProtectedCloneRepositoryBinding,
  type ProtectedCloneRehearsalAuthorization,
  type ProtectedCloneScopeRecord,
} from './protected-clone-rehearsal-authorization';
import { CDB101_PRODUCTION_DATABASE_ID } from './production-cutover-contract';

export interface ProtectedCloneSourceSelection {
  invoice: string;
  payment: string;
  deposit: string;
  patient: string;
  practitioner: string;
  appointment: string;
  encounter: string;
  admission: string;
  compensation: string;
}

interface PreparationArguments {
  baseClone: string;
  tenantId: string;
  atUtc: string;
  outputDir?: string;
}

const FINANCIAL_CONSUMERS = [
  'cdb040b.billing-detail',
  'cdb040b.report',
  'cdb040b.dashboard',
  'cdb040b.export',
  'cdb040b.scheduled-job',
  'cdb040b.admin',
] as const;

const MIGRATION_NAMES = [
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

const BACKFILL_PATHS = [
  'scripts/canonical/backfill-tenant-patient-links.ts',
  'scripts/canonical/backfill-practitioners.ts',
  'scripts/canonical/backfill-appointments.ts',
  'scripts/canonical/backfill-encounter-admission-bed-convergence.ts',
] as const;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fileSha256(path: string): string {
  return sha256(readFileSync(path));
}

function exactUtc(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be an exact ISO UTC timestamp`);
  }
  return value;
}

function protectedRegularFile(path: string, label: string): void {
  const link = lstatSync(path);
  if (!link.isFile() || link.isSymbolicLink() || link.nlink !== 1) {
    throw new Error(`${label} must be one regular file`);
  }
  if ((statSync(path).mode & 0o777) !== 0o600) {
    throw new Error(`${label} must use mode 0600`);
  }
}

function exactSourceRow(
  database: DatabaseSync,
  query: string,
  tenantId: string,
  label: string,
): string {
  const rows = database.prepare(query).all(tenantId) as Array<{ source_public_id: string | number }>;
  if (rows.length !== 1) throw new Error(`${label} requires one exact mapped source row`);
  const value = String(rows[0].source_public_id);
  if (value.trim() === '') throw new Error(`${label} source row is empty`);
  return value;
}

function selectProtectedCloneSourceRows(
  database: DatabaseSync,
  tenantId: string,
): ProtectedCloneSourceSelection {
  return {
    invoice: exactSourceRow(database, `
      SELECT m.source_public_id
      FROM canonical_source_mappings m
      JOIN bills source
        ON CAST(source.tenant_id AS TEXT)=m.tenant_id
       AND source.invoice_no=m.source_public_id
      JOIN canonical_invoices canonical
        ON canonical.tenant_id=m.tenant_id
       AND canonical.invoice_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='invoice'
        AND m.source_type='legacy_live_bill' AND m.mapping_status='mapped'
      ORDER BY source.id LIMIT 1
    `, tenantId, 'invoice'),
    payment: exactSourceRow(database, `
      SELECT m.source_public_id
      FROM canonical_source_mappings m
      JOIN payments source
        ON CAST(source.tenant_id AS TEXT)=m.tenant_id
       AND source.receipt_no=m.source_public_id
      JOIN canonical_payment_receipts canonical
        ON canonical.tenant_id=m.tenant_id
       AND canonical.receipt_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='payment_receipt'
        AND m.source_type='legacy_live_payment' AND m.mapping_status='mapped'
      ORDER BY source.id LIMIT 1
    `, tenantId, 'payment'),
    deposit: exactSourceRow(database, `
      SELECT m.source_public_id
      FROM canonical_source_mappings m
      JOIN billing_deposits source
        ON CAST(source.tenant_id AS TEXT)=m.tenant_id
       AND source.deposit_receipt_no=m.source_public_id
       AND lower(source.transaction_type)='deposit'
      JOIN canonical_deposits canonical
        ON canonical.tenant_id=m.tenant_id
       AND canonical.deposit_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='deposit'
        AND m.source_type='legacy_live_deposit' AND m.mapping_status='mapped'
      ORDER BY source.id LIMIT 1
    `, tenantId, 'deposit'),
    patient: exactSourceRow(database, `
      SELECT m.source_public_id
      FROM canonical_source_mappings m
      JOIN patients source
        ON CAST(source.tenant_id AS TEXT)=m.tenant_id
       AND CAST(source.id AS TEXT)=m.source_public_id
      JOIN canonical_tenant_patient_links canonical
        ON canonical.tenant_id=m.tenant_id
       AND canonical.patient_link_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='patient_link'
        AND m.source_type='legacy_patient' AND m.mapping_status='mapped'
      ORDER BY source.id LIMIT 1
    `, tenantId, 'patient'),
    practitioner: exactSourceRow(database, `
      SELECT m.source_public_id
      FROM canonical_source_mappings m
      JOIN doctors source
        ON CAST(source.tenant_id AS TEXT)=m.tenant_id
       AND CAST(source.id AS TEXT)=m.source_public_id
      JOIN canonical_practitioners canonical
        ON canonical.tenant_id=m.tenant_id
       AND canonical.practitioner_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='practitioner'
        AND m.source_type='legacy_doctor' AND m.mapping_status='mapped'
      ORDER BY source.id LIMIT 1
    `, tenantId, 'practitioner'),
    appointment: exactSourceRow(database, `
      SELECT m.source_public_id
      FROM canonical_source_mappings m
      JOIN appointments source
        ON CAST(source.tenant_id AS TEXT)=m.tenant_id
       AND CAST(source.id AS TEXT)=m.source_public_id
      JOIN canonical_appointments canonical
        ON canonical.tenant_id=m.tenant_id
       AND canonical.appointment_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='appointment'
        AND m.source_type='legacy_appointment' AND m.mapping_status='mapped'
      ORDER BY source.id LIMIT 1
    `, tenantId, 'appointment'),
    encounter: exactSourceRow(database, `
      SELECT m.source_public_id
      FROM canonical_source_mappings m
      JOIN visits source
        ON CAST(source.tenant_id AS TEXT)=m.tenant_id
       AND CAST(source.id AS TEXT)=m.source_public_id
      JOIN canonical_encounters canonical
        ON canonical.tenant_id=m.tenant_id
       AND canonical.encounter_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='encounter'
        AND m.source_type='legacy_visit' AND m.mapping_status='mapped'
      ORDER BY source.id LIMIT 1
    `, tenantId, 'encounter'),
    admission: exactSourceRow(database, `
      SELECT m.source_public_id
      FROM canonical_source_mappings m
      JOIN admissions source
        ON CAST(source.tenant_id AS TEXT)=m.tenant_id
       AND CAST(source.id AS TEXT)=m.source_public_id
      JOIN canonical_admissions canonical
        ON canonical.tenant_id=m.tenant_id
       AND canonical.admission_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='admission'
        AND m.source_type='legacy_admission' AND m.mapping_status='mapped'
      ORDER BY source.id LIMIT 1
    `, tenantId, 'admission'),
    compensation: exactSourceRow(database, `
      SELECT m.source_public_id
      FROM canonical_source_mappings m
      JOIN doctor_commission_accruals source
        ON CAST(source.tenant_id AS TEXT)=m.tenant_id
       AND CAST(source.id AS TEXT)=m.source_public_id
      JOIN canonical_compensation_accruals canonical
        ON canonical.tenant_id=m.tenant_id
       AND canonical.accrual_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='compensation_accrual'
        AND m.source_type='legacy_doctor_commission_accrual'
        AND m.mapping_status='mapped'
      ORDER BY source.id LIMIT 1
    `, tenantId, 'compensation accrual'),
  };
}

export function buildProtectedCloneScopeRecords(
  tenantId: string,
  source: ProtectedCloneSourceSelection,
): ProtectedCloneScopeRecord[] {
  const records: ProtectedCloneScopeRecord[] = [];
  for (const consumerId of FINANCIAL_CONSUMERS) {
    records.push(
      {
        tenantId,
        providerKey: 'canonical_invoice_provider_v1',
        consumerId,
        sourceTable: 'bills',
        sourceRowKey: `bills:${source.invoice}`,
      },
      {
        tenantId,
        providerKey: 'canonical_payment_provider_v1',
        consumerId,
        sourceTable: 'payments',
        sourceRowKey: `payments:${source.payment}`,
      },
      {
        tenantId,
        providerKey: 'canonical_deposit_provider_v1',
        consumerId,
        sourceTable: 'billing_deposits',
        sourceRowKey: `billing_deposits:${source.deposit}`,
      },
    );
  }
  records.push(
    {
      tenantId,
      providerKey: 'canonical_patient_identity_provider_v1',
      consumerId: 'cdb040c.reception-patient-context.patient',
      sourceTable: 'patients',
      sourceRowKey: `patients:${source.patient}`,
    },
    {
      tenantId,
      providerKey: 'canonical_practitioner_provider_v1',
      consumerId: 'cdb040c.reception-patient-context.practitioner',
      sourceTable: 'doctors',
      sourceRowKey: `doctors:${source.practitioner}`,
    },
    {
      tenantId,
      providerKey: 'canonical_appointment_provider_v1',
      consumerId: 'cdb040c.reception-patient-context.appointment',
      sourceTable: 'appointments',
      sourceRowKey: `appointments:${source.appointment}`,
    },
    {
      tenantId,
      providerKey: 'canonical_encounter_provider_v1',
      consumerId: 'cdb040c.reception-patient-context.encounter',
      sourceTable: 'visits',
      sourceRowKey: `visits:${source.encounter}`,
    },
    {
      tenantId,
      providerKey: 'canonical_admission_bed_provider_v1',
      consumerId: 'cdb040c.reception-patient-context.admission',
      sourceTable: 'admissions',
      sourceRowKey: `admissions:${source.admission}`,
    },
    {
      tenantId,
      providerKey: 'canonical_compensation_accrual_provider_v1',
      consumerId: 'cdb040c.commission-accrual-admin',
      sourceTable: 'doctor_commission_accruals',
      sourceRowKey: `doctor_commission_accruals:${source.compensation}`,
    },
  );
  return records;
}

function parseArguments(argv: string[]): PreparationArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--') continue;
    if (!key.startsWith('--')) throw new Error(`unexpected argument ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`);
    values.set(key, value);
    index += 1;
  }
  const baseClone = values.get('--base-clone');
  const atUtc = values.get('--at-utc');
  if (!baseClone) throw new Error('missing required argument --base-clone');
  if (!atUtc) throw new Error('missing required argument --at-utc');
  return {
    baseClone,
    atUtc: exactUtc(atUtc, 'atUtc'),
    tenantId: values.get('--tenant') ?? '100',
    outputDir: values.get('--output-dir'),
  };
}

function stampFromUtc(atUtc: string): string {
  return atUtc.replace(/[-:.]/g, '');
}

function prepareAuthorization(args: PreparationArguments): Record<string, unknown> {
  const repositoryRoot = process.cwd();
  const baseClone = resolve(args.baseClone);
  protectedRegularFile(baseClone, 'base protected clone');
  const outputDir = resolve(args.outputDir ?? join(
    homedir(),
    '.hms-canonical-rehearsals',
    `cdbv1050-${stampFromUtc(args.atUtc)}`,
  ));
  if (existsSync(outputDir)) throw new Error('protected rehearsal output directory already exists');
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  chmodSync(outputDir, 0o700);

  try {
    const sourcePath = join(outputDir, 'source-snapshot.sqlite3');
    const backupPath = join(outputDir, 'rollback-backup.sqlite3');
    const targetPath = join(outputDir, 'target-clone.sqlite3');
    const evidencePath = join(outputDir, 'execution-evidence.json');
    const authorizationPath = join(outputDir, 'authorization.json');
    copyFileSync(baseClone, sourcePath);
    copyFileSync(baseClone, backupPath);
    chmodSync(sourcePath, 0o600);
    chmodSync(backupPath, 0o600);

    const database = new DatabaseSync(sourcePath, { readOnly: true });
    let selection: ProtectedCloneSourceSelection;
    try {
      selection = selectProtectedCloneSourceRows(database, args.tenantId);
    } finally {
      database.close();
    }
    const records = buildProtectedCloneScopeRecords(args.tenantId, selection);
    const binding = buildProtectedCloneRepositoryBinding(repositoryRoot);
    const issued = new Date(Date.parse(args.atUtc) - 5_000);
    const windowStart = new Date(Date.parse(args.atUtc) - 1_000);
    const windowEnd = new Date(Date.parse(args.atUtc) + 3 * 60 * 60 * 1000);
    const expires = new Date(windowEnd.getTime() + 30 * 60 * 1000);
    const stamp = stampFromUtc(args.atUtc);
    const migrations = MIGRATION_NAMES.map((name) => ({
      name,
      sha256: fileSha256(join(repositoryRoot, 'migrations', name)),
    }));
    const backfills = BACKFILL_PATHS.map((path) => ({
      path,
      sha256: fileSha256(join(repositoryRoot, path)),
      partitionLimit: 100,
    }));

    const authorization: ProtectedCloneRehearsalAuthorization = {
      schemaVersion: 1,
      authorizationId: `auth_cdbv1050_${stamp}`,
      operation: 'protected_clone_migration_backfill_and_rollback_rehearsal',
      target: {
        platform: 'local_sqlite_d1_equivalent',
        accountIdSha256: sha256('local-protected-rehearsal-account'),
        databaseName: `cdb-v1-050-protected-local-${stamp}`,
        databaseUuid: `local-cdbv1050-${sha256(outputDir).slice(0, 24)}`,
        environment: 'protected_clone',
        remote: false,
        productionDatabaseUuid: CDB101_PRODUCTION_DATABASE_ID,
      },
      timing: {
        issuedAtUtc: issued.toISOString(),
        windowStartUtc: windowStart.toISOString(),
        windowEndUtc: windowEnd.toISOString(),
        expiresAtUtc: expires.toISOString(),
      },
      owner: {
        ownerId: 'rahmatullah-zisan',
        displayName: 'Rahmatullah Zisan',
        approved: true,
        approvalSource: 'user_explicit_protected_clone_rehearsal_authorization',
        executionOwnerId: 'canonical-core-v1-agent',
        rollbackOwnerId: 'canonical-core-v1-agent',
        observationOwnerId: 'canonical-core-v1-agent',
      },
      sourceSnapshot: {
        identity: `cdb113h2r8-protected-local-source-${stamp}`,
        sha256: fileSha256(sourcePath),
        exportedAtUtc: new Date(issued.getTime() - 60_000).toISOString(),
        readOnly: true,
        productionSourceMutationAllowed: false,
      },
      rollback: {
        backupIdentity: `cdbv1050-rollback-${stamp}`,
        backupSha256: fileSha256(backupPath),
        restoreAuthorityConfirmed: true,
        restoreOnAnyFailure: true,
        stopOnFirstFailure: true,
        rollbackProvider: 'legacy',
      },
      repository: binding,
      scope: {
        tenantIds: [args.tenantId],
        maxRecords: records.length,
        records,
      },
      migrations,
      backfills,
      acceptance: {
        integrityCheck: 'ok',
        foreignKeyViolations: 0,
        criticalUnexplainedVarianceCount: 0,
        providerErrorCount: 0,
        mappingAmbiguityCount: 0,
        crossTenantReferenceCount: 0,
        latencyBudgetBreachCount: 0,
        secondPassNewBusinessRows: 0,
        sourceSnapshotMutationCount: 0,
      },
      procedure: {
        serialMigrations: true,
        boundedBackfills: true,
        secondPassRequired: true,
        sourceReadOnlyVerification: true,
        receptionSmoke: true,
        billingSmoke: true,
        paymentSmoke: true,
        commissionSmoke: true,
        providerPromotionRehearsal: true,
        immediateLegacyRollback: true,
        noConcurrentDeployment: true,
      },
      permissions: {
        protectedCloneRead: true,
        protectedCloneSchemaMigration: true,
        protectedCloneBackfill: true,
        providerPromotionRehearsal: true,
        rollbackRehearsal: true,
        productionRead: false,
        productionMutation: false,
        productionProviderActivation: false,
        deployment: false,
        trafficChange: false,
        localSyncActivation: false,
        legacyRetirement: false,
        remoteDatabaseDeletion: false,
        push: false,
        cdbToMainIntegration: false,
      },
    };
    writeFileSync(authorizationPath, `${JSON.stringify(authorization, null, 2)}\n`, { mode: 0o600 });
    chmodSync(authorizationPath, 0o600);
    const executionPaths = {
      work: outputDir,
      authorization: authorizationPath,
      source: sourcePath,
      backup: backupPath,
      target: targetPath,
      evidence: evidencePath,
      atUtc: windowStart.toISOString(),
    };
    const executionPathsPath = join(outputDir, 'execution-paths.json');
    writeFileSync(executionPathsPath, `${JSON.stringify(executionPaths, null, 2)}\n`, { mode: 0o600 });
    chmodSync(executionPathsPath, 0o600);
    const parent = join(homedir(), '.hms-canonical-rehearsals');
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    chmodSync(parent, 0o700);
    const pointer = join(parent, '.cdbv1050-current');
    writeFileSync(pointer, `${outputDir}\n`, { mode: 0o600 });
    chmodSync(pointer, 0o600);

    return {
      work: outputDir,
      authorizationPath,
      sourcePath,
      backupPath,
      targetPath,
      evidencePath,
      atUtc: windowStart.toISOString(),
      repositoryHead: binding.repositoryCommit,
      recordCount: records.length,
      migrationCount: migrations.length,
      backfillCount: backfills.length,
      sourceHashMatchesBackup: fileSha256(sourcePath) === fileSha256(backupPath),
    };
  } catch (error) {
    rmSync(outputDir, { recursive: true, force: true });
    throw error;
  }
}

async function main(): Promise<void> {
  const prepared = prepareAuthorization(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({
      checkpoint: 'CDB-V1-050-AUTHORIZATION-PREPARATION',
      status: 'failed',
      error: message,
      productionMutationPerformed: false,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
