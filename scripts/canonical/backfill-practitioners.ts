import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
  normalizeIdentityText,
  normalizeRegistrationNumber,
} from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface PractitionerBackfillPreparedStatement {
  bind(...values: unknown[]): PractitionerBackfillPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PractitionerBackfillDatabase {
  prepare(sql: string): PractitionerBackfillPreparedStatement;
  batch(statements: PractitionerBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface PractitionerBackfillOptions {
  tenantId: string;
  runPublicId: string;
  nowUtc?: string;
  maxSourceRecords?: number;
}

export interface PractitionerBackfillCounts {
  scanned: number;
  created: number;
  mapped: number;
  ambiguous: number;
  userLinks: number;
  employeeLinks: number;
  issues: number;
}

export interface PractitionerBackfillResult {
  completed: boolean;
  counts: PractitionerBackfillCounts;
}

interface MigrationRunRow {
  id: number;
  status: string;
}

interface CheckpointRow {
  id: number;
  cursor_value: string | null;
  status: string;
}

interface SourceMappingRow {
  mapping_status: 'mapped' | 'ambiguous' | 'rejected' | 'retired';
  canonical_public_id: string | null;
  evidence_sha256: string | null;
}

interface IdentifierClaimRow {
  practitioner_public_id: string;
}

type PractitionerClaimRow = IdentifierClaimRow;

interface DoctorRow {
  id: number;
  name: string;
  specialty: string | null;
  department: string | null;
  bmdc_reg_no: string | null;
  user_id: number | null;
  is_active: number;
}

interface ExternalReferrerRow {
  id: number;
  name: string;
  specialty: string | null;
}

interface UserRow {
  id: number;
  tenant_id: string | number | null;
}

interface StaffRow {
  id: number;
}

interface CountRow {
  count: number;
}

interface StartingCounts {
  practitioners: number;
  userLinks: number;
  employeeLinks: number;
  issues: number;
  mapped: number;
  ambiguous: number;
}

interface RowOutcome {
  created: number;
  mapped: number;
  skipped: number;
  exceptions: number;
}

interface BackfillContext {
  db: PractitionerBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  nowUtc: string;
  remaining: number;
  scanned: number;
  duplicateRegistrations: Set<string>;
  duplicateUserIds: Map<number, number>;
  internalNames: Set<string>;
  externalNameCounts: Map<string, number>;
}

const SOURCE_DOCTOR = 'legacy_doctor';
const SOURCE_EXTERNAL = 'legacy_external_referrer';

function requireExactNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function positiveLimit(value: number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError('maxSourceRecords must be a positive integer');
  return value;
}

async function allRows<T>(statement: PractitionerBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function countTable(
  db: PractitionerBackfillDatabase,
  table: string,
  tenantId: string,
  predicate = '',
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ?${predicate}`)
    .bind(tenantId)
    .first<CountRow>();
  return Number(row?.count ?? 0);
}

async function captureCounts(db: PractitionerBackfillDatabase, tenantId: string): Promise<StartingCounts> {
  return {
    practitioners: await countTable(db, 'canonical_practitioners', tenantId),
    userLinks: await countTable(db, 'canonical_practitioner_user_links', tenantId),
    employeeLinks: await countTable(db, 'canonical_practitioner_employee_links', tenantId),
    issues: await countTable(db, 'canonical_processing_issues', tenantId),
    mapped: await countTable(db, 'canonical_source_mappings', tenantId, " AND mapping_status = 'mapped'"),
    ambiguous: await countTable(db, 'canonical_source_mappings', tenantId, " AND mapping_status = 'ambiguous'"),
  };
}

async function resultFromDelta(
  db: PractitionerBackfillDatabase,
  tenantId: string,
  starting: StartingCounts,
  scanned: number,
  completed: boolean,
): Promise<PractitionerBackfillResult> {
  const ending = await captureCounts(db, tenantId);
  return {
    completed,
    counts: {
      scanned,
      created: ending.practitioners - starting.practitioners,
      mapped: ending.mapped - starting.mapped,
      ambiguous: ending.ambiguous - starting.ambiguous,
      userLinks: ending.userLinks - starting.userLinks,
      employeeLinks: ending.employeeLinks - starting.employeeLinks,
      issues: ending.issues - starting.issues,
    },
  };
}

async function ensureMigrationRun(
  db: PractitionerBackfillDatabase,
  tenantId: string,
  runPublicId: string,
  nowUtc: string,
): Promise<MigrationRunRow> {
  let run = await db
    .prepare(
      `SELECT id, status
       FROM canonical_migration_runs
       WHERE tenant_id = ? AND run_public_id = ?
       LIMIT 1`,
    )
    .bind(tenantId, runPublicId)
    .first<MigrationRunRow>();

  if (!run) {
    await db
      .prepare(
        `INSERT INTO canonical_migration_runs (
           tenant_id, run_public_id, migration_name, migration_kind,
           status, started_at_utc, created_at_utc, updated_at_utc
         ) VALUES (?, ?, '0506_canonical_practitioners.sql', 'backfill',
                   'running', ?, ?, ?)`,
      )
      .bind(tenantId, runPublicId, nowUtc, nowUtc, nowUtc)
      .run();
    run = await db
      .prepare(
        `SELECT id, status
         FROM canonical_migration_runs
         WHERE tenant_id = ? AND run_public_id = ?
         LIMIT 1`,
      )
      .bind(tenantId, runPublicId)
      .first<MigrationRunRow>();
  }

  if (!run) throw new Error('Failed to create canonical practitioner migration run');
  if (run.status === 'failed' || run.status === 'cancelled') {
    throw new Error(`Practitioner backfill run is terminal: ${run.status}`);
  }
  return run;
}

async function ensureCheckpoint(
  db: PractitionerBackfillDatabase,
  tenantId: string,
  runId: number,
  runPublicId: string,
  sourceType: string,
  nowUtc: string,
): Promise<CheckpointRow> {
  let checkpoint = await db
    .prepare(
      `SELECT id, cursor_value, status
       FROM canonical_backfill_checkpoints
       WHERE tenant_id = ? AND migration_run_id = ?
         AND entity_type = 'practitioner' AND source_type = ? AND partition_key = ''
       LIMIT 1`,
    )
    .bind(tenantId, runId, sourceType)
    .first<CheckpointRow>();

  if (!checkpoint) {
    const checkpointPublicId = await createDeterministicSourceId('chk', tenantId, 'practitioner_backfill', `${runPublicId}:${sourceType}`);
    await db
      .prepare(
        `INSERT INTO canonical_backfill_checkpoints (
           tenant_id, checkpoint_public_id, migration_run_id, entity_type,
           source_type, partition_key, status, started_at_utc,
           created_at_utc, updated_at_utc
         ) VALUES (?, ?, ?, 'practitioner', ?, '', 'running', ?, ?, ?)`,
      )
      .bind(tenantId, checkpointPublicId, runId, sourceType, nowUtc, nowUtc, nowUtc)
      .run();
    checkpoint = await db
      .prepare(
        `SELECT id, cursor_value, status
         FROM canonical_backfill_checkpoints
         WHERE tenant_id = ? AND migration_run_id = ?
           AND entity_type = 'practitioner' AND source_type = ? AND partition_key = ''
         LIMIT 1`,
      )
      .bind(tenantId, runId, sourceType)
      .first<CheckpointRow>();
  } else if (checkpoint.status === 'paused') {
    await db
      .prepare(
        `UPDATE canonical_backfill_checkpoints
         SET status = 'running', completed_at_utc = NULL, updated_at_utc = ?
         WHERE tenant_id = ? AND id = ?`,
      )
      .bind(nowUtc, tenantId, checkpoint.id)
      .run();
    checkpoint.status = 'running';
  }

  if (!checkpoint) throw new Error(`Failed to create checkpoint for ${sourceType}`);
  return checkpoint;
}

function checkpointProgressStatement(
  db: PractitionerBackfillDatabase,
  input: {
    tenantId: string;
    checkpointId: number;
    cursor: string;
    nowUtc: string;
    outcome: RowOutcome;
  },
): PractitionerBackfillPreparedStatement {
  return db
    .prepare(
      `UPDATE canonical_backfill_checkpoints
       SET cursor_value = ?,
           scanned_count = scanned_count + 1,
           created_count = created_count + ?,
           mapped_count = mapped_count + ?,
           skipped_count = skipped_count + ?,
           exception_count = exception_count + ?,
           updated_at_utc = ?
       WHERE tenant_id = ? AND id = ?`,
    )
    .bind(
      input.cursor,
      input.outcome.created,
      input.outcome.mapped,
      input.outcome.skipped,
      input.outcome.exceptions,
      input.nowUtc,
      input.tenantId,
      input.checkpointId,
    );
}

async function existingMapping(
  db: PractitionerBackfillDatabase,
  tenantId: string,
  sourceType: string,
  sourcePublicId: string,
): Promise<SourceMappingRow | null> {
  return db
    .prepare(
      `SELECT mapping_status, canonical_public_id, evidence_sha256
       FROM canonical_source_mappings
       WHERE tenant_id = ? AND entity_type = 'practitioner'
         AND source_type = ? AND source_public_id = ?
       LIMIT 1`,
    )
    .bind(tenantId, sourceType, sourcePublicId)
    .first<SourceMappingRow>();
}

function mappingStatement(
  db: PractitionerBackfillDatabase,
  input: {
    tenantId: string;
    practitionerPublicId: string | null;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    mappingStatus: 'mapped' | 'ambiguous';
    evidenceSha256: string;
    runId: number;
    nowUtc: string;
  },
): PractitionerBackfillPreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO canonical_source_mappings (
         tenant_id, entity_type, canonical_public_id, source_type,
         source_public_id, source_table, mapping_status, mapping_version,
         migration_run_id, evidence_sha256, created_at_utc, updated_at_utc
       ) VALUES (?, 'practitioner', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .bind(
      input.tenantId,
      input.practitionerPublicId,
      input.sourceType,
      input.sourcePublicId,
      input.sourceTable,
      input.mappingStatus,
      input.runId,
      input.evidenceSha256,
      input.nowUtc,
      input.nowUtc,
    );
}

async function issueStatement(
  db: PractitionerBackfillDatabase,
  input: {
    tenantId: string;
    runId: number;
    issueCode: string;
    sourceType: string;
    sourcePublicId: string | null;
    fingerprintKey: string;
    summary: string;
    details?: Record<string, number | string>;
    nowUtc: string;
  },
): Promise<PractitionerBackfillPreparedStatement> {
  const fingerprint = await createDeterministicSourceId('fp', input.tenantId, input.issueCode, input.fingerprintKey);
  const issuePublicId = await createDeterministicSourceId('iss', input.tenantId, input.issueCode, input.fingerprintKey);
  return db
    .prepare(
      `INSERT INTO canonical_processing_issues (
         tenant_id, issue_public_id, migration_run_id, issue_type, issue_code,
         entity_type, source_type, source_public_id, fingerprint, severity,
         status, occurrence_count, summary, details_json,
         first_seen_at_utc, last_seen_at_utc, created_at_utc, updated_at_utc
       ) VALUES (?, ?, ?, 'identity_backfill', ?, 'practitioner', ?, ?, ?,
                 'error', 'open', 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, issue_type, fingerprint) DO UPDATE SET
         migration_run_id = excluded.migration_run_id,
         occurrence_count = canonical_processing_issues.occurrence_count + 1,
         last_seen_at_utc = excluded.last_seen_at_utc,
         details_json = excluded.details_json,
         updated_at_utc = excluded.updated_at_utc`,
    )
    .bind(
      input.tenantId,
      issuePublicId,
      input.runId,
      input.issueCode,
      input.sourceType,
      input.sourcePublicId,
      fingerprint,
      input.summary,
      input.details ? JSON.stringify(input.details) : null,
      input.nowUtc,
      input.nowUtc,
      input.nowUtc,
      input.nowUtc,
    );
}

async function prepareDoctorContext(
  db: PractitionerBackfillDatabase,
  tenantId: string,
): Promise<{
  rows: DoctorRow[];
  duplicateRegistrations: Set<string>;
  duplicateUserIds: Map<number, number>;
  internalNames: Set<string>;
}> {
  const rows = await allRows<DoctorRow>(
    db
      .prepare(
        `SELECT id, name, specialty, department, bmdc_reg_no, user_id, is_active
         FROM doctors
         WHERE CAST(tenant_id AS TEXT) = ?
         ORDER BY id`,
      )
      .bind(tenantId),
  );
  const registrationCounts = new Map<string, number>();
  const userIdCounts = new Map<number, number>();
  const internalNames = new Set<string>();
  for (const row of rows) {
    const registration = normalizeRegistrationNumber(row.bmdc_reg_no);
    if (registration) registrationCounts.set(registration, (registrationCounts.get(registration) ?? 0) + 1);
    if (row.user_id != null) userIdCounts.set(row.user_id, (userIdCounts.get(row.user_id) ?? 0) + 1);
    const name = normalizeIdentityText(row.name);
    if (name) internalNames.add(name);
  }
  return {
    rows,
    duplicateRegistrations: new Set(
      [...registrationCounts.entries()].filter(([, count]) => count > 1).map(([registration]) => registration),
    ),
    duplicateUserIds: new Map([...userIdCounts.entries()].filter(([, count]) => count > 1)),
    internalNames,
  };
}

async function prepareExternalContext(
  db: PractitionerBackfillDatabase,
  tenantId: string,
): Promise<{ rows: ExternalReferrerRow[]; externalNameCounts: Map<string, number> }> {
  const rows = await allRows<ExternalReferrerRow>(
    db
      .prepare(
        `SELECT id, name, specialty
         FROM external_referring_doctors
         WHERE CAST(tenant_id AS TEXT) = ?
         ORDER BY id`,
      )
      .bind(tenantId),
  );
  const externalNameCounts = new Map<string, number>();
  for (const row of rows) {
    const name = normalizeIdentityText(row.name);
    if (name) externalNameCounts.set(name, (externalNameCounts.get(name) ?? 0) + 1);
  }
  return { rows, externalNameCounts };
}

async function doctorEvidenceSha256(row: DoctorRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_DOCTOR,
    sourcePublicId: String(row.id),
    displayName: normalizeIdentityText(row.name),
    specialty: normalizeIdentityText(row.specialty),
    department: normalizeIdentityText(row.department),
    registrationNumber: normalizeRegistrationNumber(row.bmdc_reg_no),
    userId: row.user_id,
    isActive: Number(row.is_active) === 1,
  });
}

async function externalEvidenceSha256(row: ExternalReferrerRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_EXTERNAL,
    sourcePublicId: String(row.id),
    displayName: normalizeIdentityText(row.name),
    specialty: normalizeIdentityText(row.specialty),
  });
}

async function skipExistingMapping(
  context: BackfillContext,
  checkpoint: CheckpointRow,
  input: {
    sourceType: string;
    sourcePublicId: string;
    evidenceSha256: string;
    mapping: SourceMappingRow;
  },
): Promise<void> {
  const statements: PractitionerBackfillPreparedStatement[] = [];
  let exceptionCount = 0;
  if (input.mapping.evidence_sha256 !== input.evidenceSha256) {
    statements.push(
      await issueStatement(context.db, {
        tenantId: context.tenantId,
        runId: context.runId,
        issueCode: 'PRACTITIONER_SOURCE_EVIDENCE_CHANGED',
        sourceType: input.sourceType,
        sourcePublicId: input.sourcePublicId,
        fingerprintKey: `${input.sourceType}:${input.sourcePublicId}:source-evidence`,
        summary: 'Mapped practitioner source evidence changed and requires explicit review.',
        nowUtc: context.nowUtc,
      }),
    );
    exceptionCount = 1;
  }
  statements.push(
    checkpointProgressStatement(context.db, {
      tenantId: context.tenantId,
      checkpointId: checkpoint.id,
      cursor: input.sourcePublicId,
      nowUtc: context.nowUtc,
      outcome: { created: 0, mapped: 0, skipped: 1, exceptions: exceptionCount },
    }),
  );
  await context.db.batch(statements);
  context.scanned += 1;
  context.remaining -= 1;
}

async function processDoctor(
  context: BackfillContext,
  checkpoint: CheckpointRow,
  row: DoctorRow,
): Promise<void> {
  const sourcePublicId = String(row.id);
  const evidenceSha256 = await doctorEvidenceSha256(row);
  const mapped = await existingMapping(context.db, context.tenantId, SOURCE_DOCTOR, sourcePublicId);
  const mappedPractitionerPublicId = mapped?.mapping_status === 'mapped'
    && mapped.canonical_public_id
    && mapped.evidence_sha256 === evidenceSha256
    ? mapped.canonical_public_id
    : null;
  if (mapped && !mappedPractitionerPublicId) {
    await skipExistingMapping(context, checkpoint, {
      sourceType: SOURCE_DOCTOR,
      sourcePublicId,
      evidenceSha256,
      mapping: mapped,
    });
    return;
  }

  const registration = normalizeRegistrationNumber(row.bmdc_reg_no);
  const duplicateUserCount = row.user_id == null ? 0 : (context.duplicateUserIds.get(row.user_id) ?? 0);
  let identifierClaim: PractitionerClaimRow | null = null;
  let user: UserRow | null = null;
  let userClaim: PractitionerClaimRow | null = null;
  let staff: StaffRow[] = [];
  let employeeClaim: PractitionerClaimRow | null = null;

  if (registration && !context.duplicateRegistrations.has(registration)) {
    identifierClaim = await context.db
      .prepare(
        `SELECT practitioner_public_id
         FROM canonical_practitioner_identifiers
         WHERE tenant_id = ? AND identifier_system = 'bmdc'
           AND issuer_key = '' AND normalized_value = ?
         LIMIT 1`,
      )
      .bind(context.tenantId, registration)
      .first<PractitionerClaimRow>();
  }

  if (row.user_id != null && duplicateUserCount <= 1) {
    user = await context.db
      .prepare(`SELECT id, tenant_id FROM users WHERE id = ? LIMIT 1`)
      .bind(row.user_id)
      .first<UserRow>();
    if (user && String(user.tenant_id ?? '') === context.tenantId) {
      userClaim = await context.db
        .prepare(
          `SELECT practitioner_public_id
           FROM canonical_practitioner_user_links
           WHERE tenant_id = ? AND legacy_user_id = ? AND link_status = 'active'
           LIMIT 1`,
        )
        .bind(context.tenantId, row.user_id)
        .first<PractitionerClaimRow>();
      staff = await allRows<StaffRow>(
        context.db
          .prepare(
            `SELECT id FROM staff
             WHERE CAST(tenant_id AS TEXT) = ? AND user_id = ?
             ORDER BY id`,
          )
          .bind(context.tenantId, row.user_id),
      );
      if (staff.length === 1) {
        employeeClaim = await context.db
          .prepare(
            `SELECT practitioner_public_id
             FROM canonical_practitioner_employee_links
             WHERE tenant_id = ? AND legacy_staff_id = ? AND link_status = 'active'
             LIMIT 1`,
          )
          .bind(context.tenantId, staff[0].id)
          .first<PractitionerClaimRow>();
      }
    }
  }

  const candidateIds = new Set(
    [
      mappedPractitionerPublicId,
      identifierClaim?.practitioner_public_id,
      userClaim?.practitioner_public_id,
      employeeClaim?.practitioner_public_id,
    ].filter((value): value is string => Boolean(value)),
  );
  if (candidateIds.size > 1) {
    const statements: PractitionerBackfillPreparedStatement[] = [];
    if (!mapped) {
      statements.push(mappingStatement(context.db, {
        tenantId: context.tenantId,
        practitionerPublicId: null,
        sourceType: SOURCE_DOCTOR,
        sourcePublicId,
        sourceTable: 'doctors',
        mappingStatus: 'ambiguous',
        evidenceSha256,
        runId: context.runId,
        nowUtc: context.nowUtc,
      }));
    }
    statements.push(
      await issueStatement(context.db, {
        tenantId: context.tenantId,
        runId: context.runId,
        issueCode: 'PRACTITIONER_DETERMINISTIC_IDENTITY_CONFLICT',
        sourceType: SOURCE_DOCTOR,
        sourcePublicId,
        fingerprintKey: `doctor:${sourcePublicId}:deterministic-identity-conflict`,
        summary: 'Deterministic practitioner identifiers resolve to different canonical practitioners.',
        details: { candidateCount: candidateIds.size },
        nowUtc: context.nowUtc,
      }),
      checkpointProgressStatement(context.db, {
        tenantId: context.tenantId,
        checkpointId: checkpoint.id,
        cursor: sourcePublicId,
        nowUtc: context.nowUtc,
        outcome: { created: 0, mapped: 0, skipped: 0, exceptions: 1 },
      }),
    );
    await context.db.batch(statements);
    context.scanned += 1;
    context.remaining -= 1;
    return;
  }

  const existingPractitionerPublicId = candidateIds.values().next().value as string | undefined;
  const practitionerPublicId = existingPractitionerPublicId
    ?? await createDeterministicSourceId('prc', context.tenantId, SOURCE_DOCTOR, sourcePublicId);
  const practitionerIsNew = existingPractitionerPublicId === undefined;
  const statements: PractitionerBackfillPreparedStatement[] = [];
  if (practitionerIsNew) {
    statements.push(
      context.db
        .prepare(
          `INSERT OR IGNORE INTO canonical_practitioners (
             tenant_id, practitioner_public_id, practitioner_kind,
             display_name, status, version, source_evidence_sha256,
             created_at_utc, updated_at_utc
           ) VALUES (?, ?, 'internal', ?, ?, 1, ?, ?, ?)`,
        )
        .bind(
          context.tenantId,
          practitionerPublicId,
          row.name,
          Number(row.is_active) === 1 ? 'active' : 'inactive',
          evidenceSha256,
          context.nowUtc,
          context.nowUtc,
        ),
    );
  }
  if (!mapped) {
    statements.push(
      mappingStatement(context.db, {
        tenantId: context.tenantId,
        practitionerPublicId,
        sourceType: SOURCE_DOCTOR,
        sourcePublicId,
        sourceTable: 'doctors',
        mappingStatus: 'mapped',
        evidenceSha256,
        runId: context.runId,
        nowUtc: context.nowUtc,
      }),
    );
  }

  let exceptionCount = 0;
  if (registration && context.duplicateRegistrations.has(registration)) {
    statements.push(
      await issueStatement(context.db, {
        tenantId: context.tenantId,
        runId: context.runId,
        issueCode: 'PRACTITIONER_IDENTIFIER_DUPLICATE',
        sourceType: SOURCE_DOCTOR,
        sourcePublicId,
        fingerprintKey: `doctor:${sourcePublicId}:bmdc:${registration}`,
        summary: 'Duplicate practitioner registration number requires explicit review.',
        details: { duplicateGroupSize: 2 },
        nowUtc: context.nowUtc,
      }),
    );
    exceptionCount += 1;
  } else if (registration && row.bmdc_reg_no && !identifierClaim) {
    statements.push(
      context.db
        .prepare(
          `INSERT OR IGNORE INTO canonical_practitioner_identifiers (
             tenant_id, practitioner_public_id, identifier_system, issuer_key,
             normalized_value, display_value, verification_status,
             created_at_utc, updated_at_utc
           ) VALUES (?, ?, 'bmdc', '', ?, ?, 'unverified', ?, ?)`,
        )
        .bind(context.tenantId, practitionerPublicId, registration, row.bmdc_reg_no.trim(), context.nowUtc, context.nowUtc),
    );
  }

  const specialty = normalizeIdentityText(row.specialty);
  if (specialty && row.specialty) {
    statements.push(
      context.db
        .prepare(
          `INSERT OR IGNORE INTO canonical_practitioner_specialties (
             tenant_id, practitioner_public_id, normalized_key,
             display_text, is_primary, created_at_utc, updated_at_utc
           ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(context.tenantId, practitionerPublicId, specialty, row.specialty.trim(), context.nowUtc, context.nowUtc),
    );
  }

  const department = normalizeIdentityText(row.department);
  if (department && row.department) {
    statements.push(
      context.db
        .prepare(
          `INSERT OR IGNORE INTO canonical_practitioner_departments (
             tenant_id, practitioner_public_id, normalized_key,
             display_text, is_primary, created_at_utc, updated_at_utc
           ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(context.tenantId, practitionerPublicId, department, row.department.trim(), context.nowUtc, context.nowUtc),
    );
  }

  if (row.user_id != null) {
    if (duplicateUserCount > 1) {
      statements.push(
        await issueStatement(context.db, {
          tenantId: context.tenantId,
          runId: context.runId,
          issueCode: 'PRACTITIONER_USER_LINK_AMBIGUOUS',
          sourceType: SOURCE_DOCTOR,
          sourcePublicId: null,
          fingerprintKey: `user:${row.user_id}:doctor-claims`,
          summary: 'Multiple legacy doctors claim the same explicit user identity.',
          details: { candidateCount: duplicateUserCount },
          nowUtc: context.nowUtc,
        }),
      );
      exceptionCount += 1;
    } else if (!user) {
      statements.push(
        await issueStatement(context.db, {
          tenantId: context.tenantId,
          runId: context.runId,
          issueCode: 'PRACTITIONER_USER_ORPHAN',
          sourceType: SOURCE_DOCTOR,
          sourcePublicId,
          fingerprintKey: `doctor:${sourcePublicId}:user:${row.user_id}`,
          summary: 'Explicit legacy practitioner user link points to a missing user.',
          nowUtc: context.nowUtc,
        }),
      );
      exceptionCount += 1;
    } else if (String(user.tenant_id ?? '') !== context.tenantId) {
      statements.push(
        await issueStatement(context.db, {
          tenantId: context.tenantId,
          runId: context.runId,
          issueCode: 'PRACTITIONER_USER_TENANT_MISMATCH',
          sourceType: SOURCE_DOCTOR,
          sourcePublicId,
          fingerprintKey: `doctor:${sourcePublicId}:user:${row.user_id}`,
          summary: 'Explicit legacy practitioner user link crosses tenant ownership.',
          nowUtc: context.nowUtc,
        }),
      );
      exceptionCount += 1;
    } else {
      if (!userClaim) {
        statements.push(
          context.db
            .prepare(
              `INSERT OR IGNORE INTO canonical_practitioner_user_links (
                 tenant_id, practitioner_public_id, legacy_user_id,
                 link_status, evidence_type, created_at_utc, updated_at_utc
               ) VALUES (?, ?, ?, 'active', 'legacy_doctor_user_id', ?, ?)`,
            )
            .bind(context.tenantId, practitionerPublicId, row.user_id, context.nowUtc, context.nowUtc),
        );
      }
      if (staff.length === 1 && !employeeClaim) {
        statements.push(
          context.db
            .prepare(
              `INSERT OR IGNORE INTO canonical_practitioner_employee_links (
                 tenant_id, practitioner_public_id, legacy_staff_id,
                 link_status, evidence_type, created_at_utc, updated_at_utc
               ) VALUES (?, ?, ?, 'active', 'shared_explicit_user_id', ?, ?)`,
            )
            .bind(context.tenantId, practitionerPublicId, staff[0].id, context.nowUtc, context.nowUtc),
        );
      } else if (staff.length > 1) {
        statements.push(
          await issueStatement(context.db, {
            tenantId: context.tenantId,
            runId: context.runId,
            issueCode: 'PRACTITIONER_EMPLOYEE_LINK_AMBIGUOUS',
            sourceType: SOURCE_DOCTOR,
            sourcePublicId,
            fingerprintKey: `doctor:${sourcePublicId}:user:${row.user_id}:staff`,
            summary: 'Multiple staff rows share the explicit practitioner user link.',
            details: { candidateCount: staff.length },
            nowUtc: context.nowUtc,
          }),
        );
        exceptionCount += 1;
      }
    }
  }

  statements.push(
    checkpointProgressStatement(context.db, {
      tenantId: context.tenantId,
      checkpointId: checkpoint.id,
      cursor: sourcePublicId,
      nowUtc: context.nowUtc,
      outcome: {
        created: practitionerIsNew ? 1 : 0,
        mapped: mapped ? 0 : 1,
        skipped: 0,
        exceptions: exceptionCount,
      },
    }),
  );
  await context.db.batch(statements);
  context.scanned += 1;
  context.remaining -= 1;
}

async function processExternalReferrer(
  context: BackfillContext,
  checkpoint: CheckpointRow,
  row: ExternalReferrerRow,
): Promise<void> {
  const sourcePublicId = String(row.id);
  const evidenceSha256 = await externalEvidenceSha256(row);
  const mapped = await existingMapping(context.db, context.tenantId, SOURCE_EXTERNAL, sourcePublicId);
  if (mapped) {
    await skipExistingMapping(context, checkpoint, {
      sourceType: SOURCE_EXTERNAL,
      sourcePublicId,
      evidenceSha256,
      mapping: mapped,
    });
    return;
  }

  const normalizedName = normalizeIdentityText(row.name);
  const matchesInternal = normalizedName ? context.internalNames.has(normalizedName) : true;
  const duplicateExternal = normalizedName ? (context.externalNameCounts.get(normalizedName) ?? 0) > 1 : true;
  const statements: PractitionerBackfillPreparedStatement[] = [];

  if (matchesInternal || duplicateExternal) {
    statements.push(
      mappingStatement(context.db, {
        tenantId: context.tenantId,
        practitionerPublicId: null,
        sourceType: SOURCE_EXTERNAL,
        sourcePublicId,
        sourceTable: 'external_referring_doctors',
        mappingStatus: 'ambiguous',
        evidenceSha256,
        runId: context.runId,
        nowUtc: context.nowUtc,
      }),
    );
    const issueCode = matchesInternal ? 'PRACTITIONER_EXTERNAL_INTERNAL_NAME_AMBIGUITY' : 'PRACTITIONER_EXTERNAL_NAME_DUPLICATE';
    const fingerprintKey = matchesInternal
      ? `external:${sourcePublicId}:internal-name`
      : `external-name-group:${normalizedName ?? 'empty'}`;
    statements.push(
      await issueStatement(context.db, {
        tenantId: context.tenantId,
        runId: context.runId,
        issueCode,
        sourceType: SOURCE_EXTERNAL,
        sourcePublicId: duplicateExternal && !matchesInternal ? null : sourcePublicId,
        fingerprintKey,
        summary: matchesInternal
          ? 'External referrer name overlaps an internal practitioner and cannot be merged without an identifier.'
          : 'Multiple external referrers share a normalized name and require explicit review.',
        details: duplicateExternal ? { candidateCount: context.externalNameCounts.get(normalizedName ?? '') ?? 0 } : undefined,
        nowUtc: context.nowUtc,
      }),
    );
    statements.push(
      checkpointProgressStatement(context.db, {
        tenantId: context.tenantId,
        checkpointId: checkpoint.id,
        cursor: sourcePublicId,
        nowUtc: context.nowUtc,
        outcome: { created: 0, mapped: 0, skipped: 0, exceptions: 1 },
      }),
    );
  } else {
    const practitionerPublicId = await createDeterministicSourceId('prc', context.tenantId, SOURCE_EXTERNAL, sourcePublicId);
    statements.push(
      context.db
        .prepare(
          `INSERT OR IGNORE INTO canonical_practitioners (
             tenant_id, practitioner_public_id, practitioner_kind,
             display_name, status, version, source_evidence_sha256,
             created_at_utc, updated_at_utc
           ) VALUES (?, ?, 'external', ?, 'active', 1, ?, ?, ?)`,
        )
        .bind(
          context.tenantId,
          practitionerPublicId,
          row.name,
          evidenceSha256,
          context.nowUtc,
          context.nowUtc,
        ),
      mappingStatement(context.db, {
        tenantId: context.tenantId,
        practitionerPublicId,
        sourceType: SOURCE_EXTERNAL,
        sourcePublicId,
        sourceTable: 'external_referring_doctors',
        mappingStatus: 'mapped',
        evidenceSha256,
        runId: context.runId,
        nowUtc: context.nowUtc,
      }),
    );
    const specialty = normalizeIdentityText(row.specialty);
    if (specialty && row.specialty) {
      statements.push(
        context.db
          .prepare(
            `INSERT OR IGNORE INTO canonical_practitioner_specialties (
               tenant_id, practitioner_public_id, normalized_key,
               display_text, is_primary, created_at_utc, updated_at_utc
             ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(context.tenantId, practitionerPublicId, specialty, row.specialty.trim(), context.nowUtc, context.nowUtc),
      );
    }
    statements.push(
      checkpointProgressStatement(context.db, {
        tenantId: context.tenantId,
        checkpointId: checkpoint.id,
        cursor: sourcePublicId,
        nowUtc: context.nowUtc,
        outcome: { created: 1, mapped: 1, skipped: 0, exceptions: 0 },
      }),
    );
  }

  await context.db.batch(statements);
  context.scanned += 1;
  context.remaining -= 1;
}

async function pauseCheckpoint(
  db: PractitionerBackfillDatabase,
  tenantId: string,
  checkpointId: number,
  nowUtc: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE canonical_backfill_checkpoints
       SET status = 'paused', completed_at_utc = NULL, updated_at_utc = ?
       WHERE tenant_id = ? AND id = ?`,
    )
    .bind(nowUtc, tenantId, checkpointId)
    .run();
}

async function completeCheckpoint(
  db: PractitionerBackfillDatabase,
  tenantId: string,
  checkpointId: number,
  nowUtc: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE canonical_backfill_checkpoints
       SET status = 'completed', completed_at_utc = ?, updated_at_utc = ?
       WHERE tenant_id = ? AND id = ?`,
    )
    .bind(nowUtc, nowUtc, tenantId, checkpointId)
    .run();
}

async function completeRun(
  db: PractitionerBackfillDatabase,
  tenantId: string,
  runId: number,
  nowUtc: string,
  result: PractitionerBackfillResult,
): Promise<void> {
  await db
    .prepare(
      `UPDATE canonical_migration_runs
       SET status = 'succeeded', completed_at_utc = ?,
           result_summary_json = ?, updated_at_utc = ?
       WHERE tenant_id = ? AND id = ?`,
    )
    .bind(nowUtc, JSON.stringify(result.counts), nowUtc, tenantId, runId)
    .run();
}

export async function backfillPractitioners(
  db: PractitionerBackfillDatabase,
  options: PractitionerBackfillOptions,
): Promise<PractitionerBackfillResult> {
  const tenantId = requireExactNonEmpty(options.tenantId, 'tenantId');
  const runPublicId = requireExactNonEmpty(options.runPublicId, 'runPublicId');
  const nowUtc = toUtcIso(options.nowUtc ?? new Date());
  const starting = await captureCounts(db, tenantId);
  const run = await ensureMigrationRun(db, tenantId, runPublicId, nowUtc);
  if (run.status === 'succeeded') return resultFromDelta(db, tenantId, starting, 0, true);

  const doctorContext = await prepareDoctorContext(db, tenantId);
  const externalContext = await prepareExternalContext(db, tenantId);
  const context: BackfillContext = {
    db,
    tenantId,
    runId: run.id,
    runPublicId,
    nowUtc,
    remaining: positiveLimit(options.maxSourceRecords),
    scanned: 0,
    duplicateRegistrations: doctorContext.duplicateRegistrations,
    duplicateUserIds: doctorContext.duplicateUserIds,
    internalNames: doctorContext.internalNames,
    externalNameCounts: externalContext.externalNameCounts,
  };

  const doctorCheckpoint = await ensureCheckpoint(db, tenantId, run.id, runPublicId, SOURCE_DOCTOR, nowUtc);
  if (doctorCheckpoint.status !== 'completed') {
    const cursor = Number(doctorCheckpoint.cursor_value ?? 0);
    const remainingDoctors = doctorContext.rows.filter((row) => row.id > cursor);
    for (const row of remainingDoctors) {
      if (context.remaining <= 0) {
        await pauseCheckpoint(db, tenantId, doctorCheckpoint.id, nowUtc);
        return resultFromDelta(db, tenantId, starting, context.scanned, false);
      }
      await processDoctor(context, doctorCheckpoint, row);
    }
    await completeCheckpoint(db, tenantId, doctorCheckpoint.id, nowUtc);
  }

  if (context.remaining <= 0 && externalContext.rows.length > 0) {
    return resultFromDelta(db, tenantId, starting, context.scanned, false);
  }

  const externalCheckpoint = await ensureCheckpoint(db, tenantId, run.id, runPublicId, SOURCE_EXTERNAL, nowUtc);
  if (externalCheckpoint.status !== 'completed') {
    const cursor = Number(externalCheckpoint.cursor_value ?? 0);
    const remainingExternal = externalContext.rows.filter((row) => row.id > cursor);
    for (const row of remainingExternal) {
      if (context.remaining <= 0) {
        await pauseCheckpoint(db, tenantId, externalCheckpoint.id, nowUtc);
        return resultFromDelta(db, tenantId, starting, context.scanned, false);
      }
      await processExternalReferrer(context, externalCheckpoint, row);
    }
    await completeCheckpoint(db, tenantId, externalCheckpoint.id, nowUtc);
  }

  const result = await resultFromDelta(db, tenantId, starting, context.scanned, true);
  await completeRun(db, tenantId, run.id, nowUtc, result);
  return result;
}
