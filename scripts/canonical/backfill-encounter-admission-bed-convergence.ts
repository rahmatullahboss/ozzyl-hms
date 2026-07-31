import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface EncounterAdmissionBedBackfillPreparedStatement {
  bind(...values: unknown[]): EncounterAdmissionBedBackfillPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface EncounterAdmissionBedBackfillDatabase {
  prepare(sql: string): EncounterAdmissionBedBackfillPreparedStatement;
  batch(statements: EncounterAdmissionBedBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface EncounterAdmissionBedBackfillOptions {
  tenantId: string;
  runPublicId: string;
  timezone?: string;
  nowUtc?: string;
  maxSourceRecords?: number;
}

export interface EncounterAdmissionBedBackfillCounts {
  scanned: number;
  encountersCreated: number;
  encountersHardened: number;
  locationsCreated: number;
  bedsCreated: number;
  admissionsCreated: number;
  eventsCreated: number;
  bedStaysCreated: number;
  bedStaysUpdated: number;
  mappingsCreated: number;
  issuesCreated: number;
  skipped: number;
  created: number;
  mapped: number;
  issues: number;
}

export interface EncounterAdmissionBedBackfillResult {
  completed: boolean;
  secondPassZeroNew: boolean;
  counts: EncounterAdmissionBedBackfillCounts;
}

interface RunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface TableInfoRow { name: string }
interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}
interface PatientLinkRow { patient_link_public_id: string }
interface EncounterRow {
  id: number;
  encounter_public_id: string;
  legacy_patient_id: number;
  patient_link_public_id: string | null;
  status: string;
  encounter_version: number;
  source_kind: string;
}
interface BedSourceRow {
  id: number;
  ward_id: number | null;
  ward_code: string | null;
  ward_name: string | null;
  floor_value: string | null;
  room_value: string | null;
  bed_code: string | null;
  bed_class: string | null;
  status: string;
}
interface AdmissionSourceRow {
  id: number;
  admission_no: string;
  patient_id: number;
  encounter_id: number | null;
  doctor_id: number | null;
  bed_id: number | null;
  admission_type: string | null;
  admission_source: string | null;
  admitted_at_utc: string;
  discharged_at_utc: string | null;
  status: string;
}
interface StaySourceRow {
  id: number;
  patient_id: number;
  admission_id: number;
  bed_id: number;
  started_at_utc: string;
  ended_at_utc: string | null;
  status: string | null;
}
interface AdmissionLinkRow { encounter_public_id: string }
interface CanonicalEncounterRow {
  encounter_public_id: string;
  patient_link_public_id: string | null;
  encounter_type: string;
}
interface CanonicalAdmissionRow {
  admission_public_id: string;
  encounter_public_id: string;
  patient_link_public_id: string;
  current_status: string;
}
interface CanonicalBedRow {
  bed_public_id: string;
  operational_status: string;
}
interface CanonicalStayRow {
  bed_stay_public_id: string;
  encounter_public_id: string;
  admission_public_id: string | null;
  bed_public_id: string | null;
  patient_link_public_id: string | null;
  started_at_utc: string;
  ended_at_utc: string | null;
  status: string;
  stay_version: number;
  close_reason: string | null;
  source_evidence_sha256: string;
}

interface StartingCounts {
  encounters: number;
  locations: number;
  beds: number;
  admissions: number;
  events: number;
  stays: number;
  mappings: number;
  issues: number;
}

interface Context {
  db: EncounterAdmissionBedBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  timezone: string;
  nowUtc: string;
  remaining: number;
  scanned: number;
  encountersHardened: number;
  bedStaysUpdated: number;
  skipped: number;
  columns: Map<string, Set<string>>;
}

interface RowOutcome {
  created?: number;
  mapped?: number;
  skipped?: number;
  exceptions?: number;
}

interface Partition {
  key: string;
  sourceTable: string | null;
  process: (context: Context, checkpoint: CheckpointRow) => Promise<boolean>;
}

const ISSUE_TYPE = 'encounter_admission_bed_backfill';
const MIGRATION_NAME = '0548_canonical_encounter_admission_bed_convergence.sql';
const CHECKPOINT_ENTITY = 'encounter_admission_bed';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function positiveLimit(value: number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError('maxSourceRecords must be a positive integer');
  }
  return value;
}

function legacyUtc(value: string | null | undefined, timezone: string, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const offset = timezone === 'Asia/Dhaka' ? '+06:00' : 'Z';
    return toUtcIso(`${raw}T00:00:00${offset}`);
  }
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)) return toUtcIso(iso);
  const offset = timezone === 'Asia/Dhaka' ? '+06:00' : 'Z';
  return toUtcIso(`${iso}${offset}`);
}

function safeCode(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

async function allRows<T>(statement: EncounterAdmissionBedBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function count(
  db: EncounterAdmissionBedBackfillDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function tableColumns(context: Context, table: string): Promise<Set<string>> {
  const cached = context.columns.get(table);
  if (cached) return cached;
  const rows = await allRows<TableInfoRow>(context.db.prepare(`PRAGMA table_info(${table})`));
  const columns = new Set(rows.map((row) => String(row.name)));
  context.columns.set(table, columns);
  return columns;
}

function firstColumn(columns: Set<string>, candidates: readonly string[]): string | null {
  return candidates.find((candidate) => columns.has(candidate)) ?? null;
}

function expression(
  columns: Set<string>,
  candidates: readonly string[],
  alias: string,
  fallback = 'NULL',
): string {
  const column = firstColumn(columns, candidates);
  return `${column ?? fallback} AS ${alias}`;
}

async function captureCounts(
  db: EncounterAdmissionBedBackfillDatabase,
  tenantId: string,
): Promise<StartingCounts> {
  return {
    encounters: await count(db, `SELECT COUNT(*) AS count FROM canonical_encounters WHERE tenant_id=?`, [tenantId]),
    locations: await count(db, `SELECT COUNT(*) AS count FROM canonical_care_locations WHERE tenant_id=?`, [tenantId]),
    beds: await count(db, `SELECT COUNT(*) AS count FROM canonical_beds WHERE tenant_id=?`, [tenantId]),
    admissions: await count(db, `SELECT COUNT(*) AS count FROM canonical_admissions WHERE tenant_id=?`, [tenantId]),
    events: await count(db, `SELECT COUNT(*) AS count FROM canonical_admission_status_events WHERE tenant_id=?`, [tenantId]),
    stays: await count(db, `SELECT COUNT(*) AS count FROM canonical_bed_stays WHERE tenant_id=?`, [tenantId]),
    mappings: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type IN ('encounter','care_location','bed','admission','bed_stay')
    `, [tenantId]),
    issues: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_processing_issues
      WHERE tenant_id=? AND issue_type=?
    `, [tenantId, ISSUE_TYPE]),
  };
}

async function resultFromDelta(
  context: Context,
  starting: StartingCounts,
  completed: boolean,
): Promise<EncounterAdmissionBedBackfillResult> {
  const ending = await captureCounts(context.db, context.tenantId);
  const encountersCreated = ending.encounters - starting.encounters;
  const locationsCreated = ending.locations - starting.locations;
  const bedsCreated = ending.beds - starting.beds;
  const admissionsCreated = ending.admissions - starting.admissions;
  const eventsCreated = ending.events - starting.events;
  const bedStaysCreated = ending.stays - starting.stays;
  const mappingsCreated = ending.mappings - starting.mappings;
  const issuesCreated = ending.issues - starting.issues;
  const created = encountersCreated + locationsCreated + bedsCreated
    + admissionsCreated + eventsCreated + bedStaysCreated;
  const secondPassZeroNew = completed
    && created === 0
    && mappingsCreated === 0
    && issuesCreated === 0
    && context.encountersHardened === 0
    && context.bedStaysUpdated === 0;
  return {
    completed,
    secondPassZeroNew,
    counts: {
      scanned: context.scanned,
      encountersCreated,
      encountersHardened: context.encountersHardened,
      locationsCreated,
      bedsCreated,
      admissionsCreated,
      eventsCreated,
      bedStaysCreated,
      bedStaysUpdated: context.bedStaysUpdated,
      mappingsCreated,
      issuesCreated,
      skipped: context.skipped,
      created,
      mapped: mappingsCreated,
      issues: issuesCreated,
    },
  };
}

async function ensureRun(
  db: EncounterAdmissionBedBackfillDatabase,
  tenantId: string,
  runPublicId: string,
  nowUtc: string,
): Promise<RunRow> {
  let run = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, runPublicId).first<RunRow>();
  if (!run) {
    await db.prepare(`
      INSERT INTO canonical_migration_runs (
        tenant_id,run_public_id,migration_name,migration_kind,status,
        started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'backfill','running',?,?,?)
    `).bind(tenantId, runPublicId, MIGRATION_NAME, nowUtc, nowUtc, nowUtc).run();
    run = await db.prepare(`
      SELECT id,status FROM canonical_migration_runs
      WHERE tenant_id=? AND run_public_id=? LIMIT 1
    `).bind(tenantId, runPublicId).first<RunRow>();
  }
  if (!run) throw new Error('Failed to create CDB-113E migration run');
  if (run.status === 'failed' || run.status === 'cancelled') {
    throw new Error(`CDB-113E backfill run is terminal: ${run.status}`);
  }
  return run;
}

async function ensureCheckpoint(context: Context, key: string): Promise<CheckpointRow> {
  let checkpoint = await context.db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type=?
      AND source_type=? AND partition_key='' LIMIT 1
  `).bind(context.tenantId, context.runId, CHECKPOINT_ENTITY, key).first<CheckpointRow>();
  if (!checkpoint) {
    const publicId = await createDeterministicSourceId(
      'chk', context.tenantId, 'cdb113e_backfill', `${context.runPublicId}:${key}`,
    );
    await context.db.prepare(`
      INSERT INTO canonical_backfill_checkpoints (
        tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
        partition_key,status,started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,'','running',?,?,?)
    `).bind(
      context.tenantId,
      publicId,
      context.runId,
      CHECKPOINT_ENTITY,
      key,
      context.nowUtc,
      context.nowUtc,
      context.nowUtc,
    ).run();
    checkpoint = await context.db.prepare(`
      SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
      WHERE tenant_id=? AND migration_run_id=? AND entity_type=?
        AND source_type=? AND partition_key='' LIMIT 1
    `).bind(context.tenantId, context.runId, CHECKPOINT_ENTITY, key).first<CheckpointRow>();
  } else if (checkpoint.status === 'paused') {
    await context.db.prepare(`
      UPDATE canonical_backfill_checkpoints
      SET status='running',completed_at_utc=NULL,updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(context.nowUtc, context.tenantId, checkpoint.id).run();
    checkpoint.status = 'running';
  }
  if (!checkpoint) throw new Error(`Failed to create CDB-113E checkpoint: ${key}`);
  return checkpoint;
}

function progressStatement(
  context: Context,
  checkpointId: number,
  cursor: string,
  outcome: RowOutcome,
): EncounterAdmissionBedBackfillPreparedStatement {
  return context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET cursor_value=?,scanned_count=scanned_count+1,
        created_count=created_count+?,mapped_count=mapped_count+?,
        skipped_count=skipped_count+?,exception_count=exception_count+?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(
    cursor,
    outcome.created ?? 0,
    outcome.mapped ?? 0,
    outcome.skipped ?? 0,
    outcome.exceptions ?? 0,
    context.nowUtc,
    context.tenantId,
    checkpointId,
  );
}

async function markCheckpoint(
  context: Context,
  checkpointId: number,
  status: 'paused' | 'completed',
): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET status=?,completed_at_utc=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(
    status,
    status === 'completed' ? context.nowUtc : null,
    context.nowUtc,
    context.tenantId,
    checkpointId,
  ).run();
}

async function readMapping(
  context: Context,
  entityType: string,
  sourceType: string,
  sourcePublicId: string,
): Promise<MappingRow | null> {
  return context.db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(context.tenantId, entityType, sourceType, sourcePublicId).first<MappingRow>();
}

function mappingStatement(
  context: Context,
  input: {
    entityType: string;
    canonicalPublicId: string | null;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    mappingStatus: 'mapped' | 'ambiguous' | 'rejected';
    evidenceSha256: string;
  },
): EncounterAdmissionBedBackfillPreparedStatement {
  return context.db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,1,?,?,?,?)
  `).bind(
    context.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.mappingStatus,
    context.runId,
    input.evidenceSha256,
    context.nowUtc,
    context.nowUtc,
  );
}

async function issueStatement(
  context: Context,
  input: {
    code: string;
    entityType: string;
    sourceType: string;
    sourcePublicId: string | null;
    fingerprintKey: string;
    summary: string;
    details?: Record<string, number | string | boolean | null>;
  },
): Promise<EncounterAdmissionBedBackfillPreparedStatement> {
  const fingerprint = await createDeterministicSourceId(
    'fp', context.tenantId, input.code, input.fingerprintKey,
  );
  const issuePublicId = await createDeterministicSourceId(
    'iss', context.tenantId, input.code, input.fingerprintKey,
  );
  return context.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,issue_type,issue_code,
      entity_type,source_type,source_public_id,fingerprint,severity,status,
      occurrence_count,summary,details_json,first_seen_at_utc,last_seen_at_utc,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,'error','open',1,?,?,?,?,?,?)
    ON CONFLICT (tenant_id,issue_type,fingerprint) DO UPDATE SET
      migration_run_id=excluded.migration_run_id,
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      last_seen_at_utc=excluded.last_seen_at_utc,
      details_json=excluded.details_json,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    context.tenantId,
    issuePublicId,
    context.runId,
    ISSUE_TYPE,
    input.code,
    input.entityType,
    input.sourceType,
    input.sourcePublicId,
    fingerprint,
    input.summary,
    input.details == null ? null : stableCanonicalJson(input.details),
    context.nowUtc,
    context.nowUtc,
    context.nowUtc,
    context.nowUtc,
  );
}

async function patientLinks(
  context: Context,
  legacyPatientId: number,
): Promise<PatientLinkRow[]> {
  return allRows<PatientLinkRow>(context.db.prepare(`
    SELECT patient_link_public_id
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND legacy_patient_id=?
      AND link_status NOT IN ('rejected','retired') AND effective_to_utc IS NULL
    ORDER BY version DESC,patient_link_public_id
  `).bind(context.tenantId, legacyPatientId));
}

async function unresolvedPatientLinkCode(
  context: Context,
  legacyPatientId: number,
  candidateCount: number,
): Promise<'CDB113E_PATIENT_LINK_MISSING' | 'CDB113E_PATIENT_LINK_AMBIGUOUS'> {
  if (candidateCount > 1) return 'CDB113E_PATIENT_LINK_AMBIGUOUS';
  const ambiguous = await context.db.prepare(`
    SELECT 1 AS found FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='patient_link' AND source_type='legacy_patient'
      AND source_public_id=? AND mapping_status='ambiguous' LIMIT 1
  `).bind(context.tenantId, String(legacyPatientId)).first<{ found: number }>();
  return ambiguous ? 'CDB113E_PATIENT_LINK_AMBIGUOUS' : 'CDB113E_PATIENT_LINK_MISSING';
}

function consume(context: Context): void {
  context.scanned += 1;
  context.remaining -= 1;
}

async function processEncounterHardening(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const rows = await allRows<EncounterRow>(context.db.prepare(`
    SELECT id,encounter_public_id,legacy_patient_id,patient_link_public_id,
           status,encounter_version,source_kind
    FROM canonical_encounters
    WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  for (const row of rows) {
    const links = await patientLinks(context, Number(row.legacy_patient_id));
    const statements: EncounterAdmissionBedBackfillPreparedStatement[] = [];
    let exceptions = 0;
    let hardened = false;
    if (links.length !== 1) {
      const code = await unresolvedPatientLinkCode(
        context,
        Number(row.legacy_patient_id),
        links.length,
      );
      statements.push(await issueStatement(context, {
        code,
        entityType: 'encounter',
        sourceType: 'canonical_encounter',
        sourcePublicId: String(row.encounter_public_id),
        fingerprintKey: `encounter:${row.encounter_public_id}:patient:${row.legacy_patient_id}`,
        summary: links.length === 0
          ? 'Encounter has no exact active tenant patient link.'
          : 'Encounter has multiple active tenant patient links; no identity was guessed.',
        details: { candidateCount: links.length },
      }));
      exceptions += 1;
    } else if (
      row.patient_link_public_id !== links[0].patient_link_public_id
      || Number(row.encounter_version) < 1
      || row.source_kind !== 'backfill'
    ) {
      statements.push(context.db.prepare(`
        UPDATE canonical_encounters
        SET patient_link_public_id=?,encounter_version=CASE WHEN encounter_version<1 THEN 1 ELSE encounter_version END,
            source_kind='backfill',updated_at_utc=?
        WHERE tenant_id=? AND id=?
      `).bind(
        links[0].patient_link_public_id,
        context.nowUtc,
        context.tenantId,
        row.id,
      ));
      hardened = true;
    }
    if (row.status === 'planned') {
      statements.push(await issueStatement(context, {
        code: 'CDB113E_PLANNED_ACTUAL_CARE_STATE',
        entityType: 'encounter',
        sourceType: 'canonical_encounter',
        sourcePublicId: String(row.encounter_public_id),
        fingerprintKey: `encounter:${row.encounter_public_id}:planned`,
        summary: 'Planned encounter state requires explicit appointment-intent classification.',
      }));
      exceptions += 1;
    }
    if (!hardened && exceptions === 0) context.skipped += 1;
    statements.push(progressStatement(context, checkpoint.id, String(row.id), {
      created: 0,
      mapped: hardened ? 1 : 0,
      skipped: !hardened && exceptions === 0 ? 1 : 0,
      exceptions,
    }));
    await context.db.batch(statements);
    if (hardened) context.encountersHardened += 1;
    consume(context);
  }
  const last = rows.at(-1)?.id ?? cursor;
  const more = await count(context.db, `
    SELECT COUNT(*) AS count FROM canonical_encounters WHERE tenant_id=? AND id>?
  `, [context.tenantId, last]);
  if (more > 0) {
    await markCheckpoint(context, checkpoint.id, 'paused');
    return false;
  }
  await markCheckpoint(context, checkpoint.id, 'completed');
  return true;
}

async function bedSourceRows(
  context: Context,
  cursor: number,
  limit: number,
): Promise<BedSourceRow[]> {
  const columns = await tableColumns(context, 'beds');
  if (!columns.has('id') || !columns.has('tenant_id') || !columns.has('status')) return [];
  return allRows<BedSourceRow>(context.db.prepare(`
    SELECT id,
      ${expression(columns, ['ward_id'], 'ward_id')},
      ${expression(columns, ['ward_code'], 'ward_code')},
      ${expression(columns, ['ward_name'], 'ward_name')},
      ${expression(columns, ['floor','floor_no','floor_name'], 'floor_value')},
      ${expression(columns, ['room','room_no','room_number'], 'room_value')},
      ${expression(columns, ['bed_no','bed_number','code'], 'bed_code')},
      ${expression(columns, ['bed_type','type','category'], 'bed_class', "'other'")},
      status
    FROM beds WHERE CAST(tenant_id AS TEXT)=? AND id>? ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, limit));
}

function locationSource(row: BedSourceRow): {
  sourcePublicId: string;
  locationCode: string;
  displayName: string;
  sourceIdentity: Record<string, string | number | null>;
} {
  const wardId = row.ward_id == null ? null : Number(row.ward_id);
  const wardCode = safeCode(row.ward_code ?? row.ward_name, `WARD-${row.id}`);
  const floorCode = row.floor_value == null ? null : safeCode(row.floor_value, `FLOOR-${row.id}`);
  const roomCode = row.room_value == null ? null : safeCode(row.room_value, `ROOM-${row.id}`);
  const sourcePublicId = wardId == null
    ? [floorCode, wardCode, roomCode].filter(Boolean).join(':')
    : [`WARD-ID-${wardId}`, roomCode].filter(Boolean).join(':');
  return {
    sourcePublicId,
    locationCode: safeCode(sourcePublicId, `WARD-${row.id}`),
    displayName: String(row.room_value ?? row.ward_name ?? row.ward_code ?? `Ward ${row.id}`).trim(),
    sourceIdentity: {
      wardId,
      floorCode,
      wardCode,
      roomCode,
    },
  };
}

async function processCareLocations(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const rows = await bedSourceRows(context, cursor, context.remaining);
  for (const row of rows) {
    const location = locationSource(row);
    const evidence = await createSourceEvidenceSha256({
      sourceType: 'legacy_bed_location',
      sourcePublicId: location.sourcePublicId,
      ...location.sourceIdentity,
    });
    const existing = await readMapping(context, 'care_location', 'legacy_bed_location', location.sourcePublicId);
    const statements: EncounterAdmissionBedBackfillPreparedStatement[] = [];
    let created = 0;
    let mapped = 0;
    let skipped = 0;
    let exceptions = 0;
    if (existing) {
      if (existing.evidence_sha256 && existing.evidence_sha256 !== evidence) {
        statements.push(await issueStatement(context, {
          code: 'CDB113E_LOCATION_SOURCE_EVIDENCE_DRIFT',
          entityType: 'care_location',
          sourceType: 'legacy_bed_location',
          sourcePublicId: location.sourcePublicId,
          fingerprintKey: `location:${location.sourcePublicId}:evidence-drift`,
          summary: 'Care-location source evidence changed after mapping.',
        }));
        exceptions = 1;
      } else {
        skipped = 1;
        context.skipped += 1;
      }
    } else {
      const publicId = await createDeterministicSourceId(
        'location', context.tenantId, 'legacy_bed_location', location.sourcePublicId,
      );
      statements.push(
        context.db.prepare(`
          INSERT INTO canonical_care_locations (
            tenant_id,location_public_id,parent_location_public_id,location_kind,
            location_code,display_name,operational_status,timezone,version,
            source_evidence_sha256,created_at_utc,updated_at_utc
          ) VALUES (?,?,NULL,'ward',?,?, 'active',?,1,?,?,?)
        `).bind(
          context.tenantId,
          publicId,
          location.locationCode,
          location.displayName,
          context.timezone,
          evidence,
          context.nowUtc,
          context.nowUtc,
        ),
        mappingStatement(context, {
          entityType: 'care_location',
          canonicalPublicId: publicId,
          sourceType: 'legacy_bed_location',
          sourcePublicId: location.sourcePublicId,
          sourceTable: 'beds',
          mappingStatus: 'mapped',
          evidenceSha256: evidence,
        }),
      );
      created = 1;
      mapped = 1;
    }
    statements.push(progressStatement(context, checkpoint.id, String(row.id), {
      created,mapped,skipped,exceptions,
    }));
    await context.db.batch(statements);
    consume(context);
  }
  const last = rows.at(-1)?.id ?? cursor;
  const more = await count(context.db, `SELECT COUNT(*) AS count FROM beds WHERE CAST(tenant_id AS TEXT)=? AND id>?`, [context.tenantId, last]);
  if (more > 0) {
    await markCheckpoint(context, checkpoint.id, 'paused');
    return false;
  }
  await markCheckpoint(context, checkpoint.id, 'completed');
  return true;
}

function operationalStatus(value: string): 'active' | 'inactive' | 'maintenance' | 'retired' {
  const status = value.trim().toLowerCase();
  if (status === 'maintenance') return 'maintenance';
  if (status === 'retired' || status === 'decommissioned') return 'retired';
  if (status === 'inactive') return 'inactive';
  return 'active';
}

async function processBeds(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const rows = await bedSourceRows(context, cursor, context.remaining);
  for (const row of rows) {
    const sourcePublicId = String(row.id);
    const location = locationSource(row);
    const locationMapping = await readMapping(context, 'care_location', 'legacy_bed_location', location.sourcePublicId);
    const evidence = await createSourceEvidenceSha256({
      sourceType: 'legacy_bed',
      sourcePublicId,
      locationSourcePublicId: location.sourcePublicId,
      bedCode: safeCode(row.bed_code, `BED-${row.id}`),
      bedClass: safeCode(row.bed_class, 'OTHER').toLowerCase(),
      operationalStatus: operationalStatus(row.status),
    });
    const existing = await readMapping(context, 'bed', 'legacy_bed', sourcePublicId);
    const statements: EncounterAdmissionBedBackfillPreparedStatement[] = [];
    let created = 0;
    let mapped = 0;
    let skipped = 0;
    let exceptions = 0;
    if (!locationMapping?.canonical_public_id || locationMapping.mapping_status !== 'mapped') {
      statements.push(await issueStatement(context, {
        code: 'CDB113E_BED_LOCATION_MAPPING_MISSING',
        entityType: 'bed',
        sourceType: 'legacy_bed',
        sourcePublicId,
        fingerprintKey: `bed:${sourcePublicId}:location`,
        summary: 'Bed resource has no exact mapped care location.',
      }));
      exceptions = 1;
    } else if (existing) {
      if (existing.evidence_sha256 && existing.evidence_sha256 !== evidence) {
        statements.push(await issueStatement(context, {
          code: 'CDB113E_BED_SOURCE_EVIDENCE_DRIFT',
          entityType: 'bed',
          sourceType: 'legacy_bed',
          sourcePublicId,
          fingerprintKey: `bed:${sourcePublicId}:evidence-drift`,
          summary: 'Bed source evidence changed after mapping.',
        }));
        exceptions = 1;
      } else {
        skipped = 1;
        context.skipped += 1;
      }
    } else {
      const publicId = await createDeterministicSourceId('bed', context.tenantId, 'legacy_bed', sourcePublicId);
      statements.push(
        context.db.prepare(`
          INSERT INTO canonical_beds (
            tenant_id,bed_public_id,location_public_id,bed_code,bed_class,
            operational_status,version,source_evidence_sha256,created_at_utc,updated_at_utc
          ) VALUES (?,?,?,?,?,?,1,?,?,?)
        `).bind(
          context.tenantId,
          publicId,
          locationMapping.canonical_public_id,
          safeCode(row.bed_code, `BED-${row.id}`),
          safeCode(row.bed_class, 'OTHER').toLowerCase(),
          operationalStatus(row.status),
          evidence,
          context.nowUtc,
          context.nowUtc,
        ),
        mappingStatement(context, {
          entityType: 'bed',
          canonicalPublicId: publicId,
          sourceType: 'legacy_bed',
          sourcePublicId,
          sourceTable: 'beds',
          mappingStatus: 'mapped',
          evidenceSha256: evidence,
        }),
      );
      created = 1;
      mapped = 1;
    }
    statements.push(progressStatement(context, checkpoint.id, sourcePublicId, {
      created,mapped,skipped,exceptions,
    }));
    await context.db.batch(statements);
    consume(context);
  }
  const last = rows.at(-1)?.id ?? cursor;
  const more = await count(context.db, `SELECT COUNT(*) AS count FROM beds WHERE CAST(tenant_id AS TEXT)=? AND id>?`, [context.tenantId, last]);
  if (more > 0) {
    await markCheckpoint(context, checkpoint.id, 'paused');
    return false;
  }
  await markCheckpoint(context, checkpoint.id, 'completed');
  return true;
}

async function admissionRows(
  context: Context,
  cursor: number,
  limit: number,
): Promise<AdmissionSourceRow[]> {
  const columns = await tableColumns(context, 'admissions');
  if (!columns.has('id') || !columns.has('tenant_id') || !columns.has('admission_no') || !columns.has('patient_id')) return [];
  return allRows<AdmissionSourceRow>(context.db.prepare(`
    SELECT id,admission_no,patient_id,
      ${expression(columns, ['encounter_id'], 'encounter_id')},
      ${expression(columns, ['doctor_id','admitting_doctor_id'], 'doctor_id')},
      ${expression(columns, ['bed_id'], 'bed_id')},
      ${expression(columns, ['admission_type'], 'admission_type', "'inpatient'")},
      ${expression(columns, ['admission_source','admit_source'], 'admission_source')},
      ${expression(columns, ['admitted_at_utc','admission_date','admitted_at'], 'admitted_at_utc')},
      ${expression(columns, ['discharged_at_utc','discharge_date','discharged_at'], 'discharged_at_utc')},
      ${expression(columns, ['status'], 'status', "'entered_in_error'")}
    FROM admissions WHERE CAST(tenant_id AS TEXT)=? AND id>? ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, limit));
}

function normalizeAdmissionType(value: string | null): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['ipd','inpatient','planned'].includes(normalized)) return 'inpatient';
  if (normalized === 'emergency') return 'emergency';
  if (normalized === 'transfer') return 'transfer';
  if (normalized === 'direct') return 'direct';
  if (['conversion','encounter_conversion'].includes(normalized)) return 'conversion';
  return 'other';
}

export function isAdmissionEncounterTypeCompatible(
  admissionType: string,
  encounterType: string,
): boolean {
  return admissionType === 'emergency'
    ? encounterType === 'emergency'
    : encounterType === 'inpatient';
}

function normalizeAdmissionSource(value: string | null, type: string | null): string {
  const normalized = String(value ?? type ?? '').trim().toLowerCase();
  if (['planned','emergency','transfer','direct','import','manual'].includes(normalized)) return normalized;
  if (['conversion','encounter_conversion'].includes(normalized)) return 'encounter_conversion';
  return 'other';
}

function normalizeAdmissionStatus(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (['planned','admitted','transfer_pending','discharge_pending','discharged','cancelled','entered_in_error'].includes(normalized)) {
    return normalized;
  }
  if (['active','occupied','inpatient'].includes(normalized)) return 'admitted';
  if (['closed','completed','complete'].includes(normalized)) return 'discharged';
  if (normalized === 'canceled') return 'cancelled';
  return 'entered_in_error';
}

function initialAdmissionEvent(status: string): string {
  if (status === 'planned') return 'created';
  if (status === 'admitted') return 'admitted';
  if (status === 'transfer_pending') return 'transfer_requested';
  if (status === 'discharge_pending') return 'discharge_requested';
  if (status === 'discharged') return 'discharged';
  if (status === 'cancelled') return 'cancelled';
  return 'entered_in_error';
}

function synthesizedEncounterStatus(admissionStatus: string): string {
  if (admissionStatus === 'discharged') return 'completed';
  if (admissionStatus === 'cancelled') return 'cancelled';
  if (admissionStatus === 'entered_in_error') return 'entered_in_error';
  return 'in_progress';
}

async function createAdmissionEncounterStatements(
  context: Context,
  row: AdmissionSourceRow,
  patientLinkPublicId: string,
  admittedAtUtc: string,
  dischargedAtUtc: string | null,
  admissionStatus: string,
): Promise<{
  encounter: CanonicalEncounterRow;
  statements: EncounterAdmissionBedBackfillPreparedStatement[];
}> {
  const sourcePublicId = String(row.id);
  const encounterPublicId = await createDeterministicSourceId(
    'encounter', context.tenantId, 'legacy_admission', sourcePublicId,
  );
  const evidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'legacy_admission_encounter',
    sourcePublicId,
    legacyPatientId: Number(row.patient_id),
    patientLinkPublicId,
    encounterType: 'inpatient',
    status: synthesizedEncounterStatus(admissionStatus),
    startedAtUtc: admittedAtUtc,
    endedAtUtc: dischargedAtUtc,
  });
  const status = synthesizedEncounterStatus(admissionStatus);
  return {
    encounter: {
      encounter_public_id: encounterPublicId,
      patient_link_public_id: patientLinkPublicId,
      encounter_type: 'inpatient',
    },
    statements: [
      context.db.prepare(`
        INSERT INTO canonical_encounters (
          tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
          encounter_type,status,encounter_version,care_location_public_id,
          source_kind,source_command_key,started_at_utc,ended_at_utc,
          signed_snapshot_sha256,signed_at_utc,source_evidence_sha256,
          created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,'inpatient',?,1,NULL,'backfill',?,?,?,NULL,NULL,?,?,?)
      `).bind(
        context.tenantId,
        encounterPublicId,
        Number(row.patient_id),
        patientLinkPublicId,
        status,
        `legacy-admission:${sourcePublicId}`,
        admittedAtUtc,
        dischargedAtUtc,
        evidenceSha256,
        context.nowUtc,
        context.nowUtc,
      ),
      mappingStatement(context, {
        entityType: 'encounter',
        canonicalPublicId: encounterPublicId,
        sourceType: 'legacy_admission',
        sourcePublicId,
        sourceTable: 'admissions',
        mappingStatus: 'mapped',
        evidenceSha256,
      }),
      context.db.prepare(`
        INSERT INTO canonical_encounter_admission_links (
          tenant_id,encounter_public_id,legacy_admission_id,admission_no,
          link_status,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,'active',?,?,?)
      `).bind(
        context.tenantId,
        encounterPublicId,
        Number(row.id),
        String(row.admission_no),
        evidenceSha256,
        context.nowUtc,
        context.nowUtc,
      ),
    ],
  };
}

async function encounterForAdmission(
  context: Context,
  row: AdmissionSourceRow,
): Promise<CanonicalEncounterRow | null> {
  let encounterPublicId: string | null = null;
  if (row.encounter_id != null) {
    const mapping = await readMapping(context, 'encounter', 'legacy_encounter', String(row.encounter_id));
    encounterPublicId = mapping?.mapping_status === 'mapped' ? mapping.canonical_public_id : null;
  }
  if (!encounterPublicId) {
    const mapping = await readMapping(context, 'encounter', 'legacy_admission', String(row.id));
    encounterPublicId = mapping?.mapping_status === 'mapped' ? mapping.canonical_public_id : null;
  }
  if (!encounterPublicId) {
    const link = await context.db.prepare(`
      SELECT encounter_public_id FROM canonical_encounter_admission_links
      WHERE tenant_id=? AND legacy_admission_id=? AND link_status='active' LIMIT 1
    `).bind(context.tenantId, row.id).first<AdmissionLinkRow>();
    encounterPublicId = link?.encounter_public_id ?? null;
  }
  if (!encounterPublicId) return null;
  return context.db.prepare(`
    SELECT encounter_public_id,patient_link_public_id,encounter_type
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(context.tenantId, encounterPublicId).first<CanonicalEncounterRow>();
}

async function processAdmissions(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const rows = await admissionRows(context, cursor, context.remaining);
  for (const row of rows) {
    const sourcePublicId = String(row.id);
    const admittedAtUtc = legacyUtc(row.admitted_at_utc, context.timezone, context.nowUtc);
    const dischargedAtUtc = row.discharged_at_utc == null
      ? null
      : legacyUtc(row.discharged_at_utc, context.timezone, context.nowUtc);
    const status = normalizeAdmissionStatus(String(row.status));
    const admissionType = normalizeAdmissionType(row.admission_type);
    const admissionSource = normalizeAdmissionSource(row.admission_source, row.admission_type);
    const evidence = await createSourceEvidenceSha256({
      sourceType: 'legacy_admission',
      sourcePublicId,
      legacyPatientId: Number(row.patient_id),
      encounterId: row.encounter_id,
      admissionNumber: String(row.admission_no),
      admissionType,
      admissionSource,
      admittedAtUtc,
      dischargedAtUtc,
      status,
    });
    const existing = await readMapping(context, 'admission', 'legacy_admission', sourcePublicId);
    const statements: EncounterAdmissionBedBackfillPreparedStatement[] = [];
    let created = 0;
    let mapped = 0;
    let skipped = 0;
    let exceptions = 0;
    if (existing) {
      if (existing.evidence_sha256 && existing.evidence_sha256 !== evidence) {
        statements.push(await issueStatement(context, {
          code: 'CDB113E_ADMISSION_SOURCE_EVIDENCE_DRIFT',
          entityType: 'admission',
          sourceType: 'legacy_admission',
          sourcePublicId,
          fingerprintKey: `admission:${sourcePublicId}:evidence-drift`,
          summary: 'Admission source evidence changed after mapping.',
        }));
        exceptions = 1;
      } else {
        skipped = 1;
        context.skipped += 1;
      }
    } else {
      const links = await patientLinks(context, Number(row.patient_id));
      let encounter = await encounterForAdmission(context, row);
      if (
        links.length === 1
        && !encounter
        && admissionType !== 'emergency'
        && (dischargedAtUtc == null || dischargedAtUtc >= admittedAtUtc)
      ) {
        const synthesized = await createAdmissionEncounterStatements(
          context,
          row,
          links[0].patient_link_public_id,
          admittedAtUtc,
          dischargedAtUtc,
          status,
        );
        statements.push(...synthesized.statements);
        encounter = synthesized.encounter;
        created += 1;
        mapped += 1;
      }
      let issueCode: string | null = null;
      let issueSummary = '';
      if (links.length !== 1) {
        issueCode = await unresolvedPatientLinkCode(context, Number(row.patient_id), links.length);
        issueSummary = links.length === 0
          ? 'Admission has no exact active patient link.'
          : 'Admission has multiple active patient links; no identity was guessed.';
      } else if (!encounter) {
        issueCode = 'CDB113E_ADMISSION_ENCOUNTER_MAPPING_MISSING';
        issueSummary = 'Admission has no exact mapped canonical encounter.';
      } else if (!isAdmissionEncounterTypeCompatible(admissionType, encounter.encounter_type)) {
        issueCode = 'CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT';
        issueSummary = 'Admission type does not match the canonical encounter type.';
      } else if (encounter.patient_link_public_id !== links[0].patient_link_public_id) {
        issueCode = 'CDB113E_ADMISSION_ENCOUNTER_PATIENT_MISMATCH';
        issueSummary = 'Admission patient link does not match encounter patient link.';
      } else if (dischargedAtUtc != null && dischargedAtUtc < admittedAtUtc) {
        issueCode = 'CDB113E_ADMISSION_INTERVAL_INVALID';
        issueSummary = 'Admission discharge time precedes admission time.';
      }
      if (issueCode) {
        statements.push(
          mappingStatement(context, {
            entityType: 'admission',
            canonicalPublicId: null,
            sourceType: 'legacy_admission',
            sourcePublicId,
            sourceTable: 'admissions',
            mappingStatus: 'ambiguous',
            evidenceSha256: evidence,
          }),
          await issueStatement(context, {
            code: issueCode,
            entityType: 'admission',
            sourceType: 'legacy_admission',
            sourcePublicId,
            fingerprintKey: `admission:${sourcePublicId}:${issueCode}`,
            summary: issueSummary,
            details: { patientCandidateCount: links.length },
          }),
        );
        mapped = 1;
        exceptions = 1;
      } else if (encounter && links.length === 1) {
        const publicId = await createDeterministicSourceId(
          'admission', context.tenantId, 'legacy_admission', sourcePublicId,
        );
        const eventPublicId = await createDeterministicSourceId(
          'admevt', context.tenantId, 'legacy_admission', `${sourcePublicId}:initial`,
        );
        const eventType = initialAdmissionEvent(status);
        statements.push(
          context.db.prepare(`
            INSERT INTO canonical_admissions (
              tenant_id,admission_public_id,encounter_public_id,patient_link_public_id,
              admission_number,admission_type,admission_source,current_status,status_version,
              admitted_at_utc,discharged_at_utc,reason_code,safe_note,idempotency_key,
              request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
            ) VALUES (?,?,?,?,?,?,?,?,1,?,?,NULL,NULL,?,?,?,?,?)
          `).bind(
            context.tenantId,
            publicId,
            encounter.encounter_public_id,
            links[0].patient_link_public_id,
            String(row.admission_no),
            admissionType,
            admissionSource,
            status,
            admittedAtUtc,
            dischargedAtUtc,
            `backfill:${context.runPublicId}:${sourcePublicId}`,
            evidence,
            evidence,
            context.nowUtc,
            context.nowUtc,
          ),
          context.db.prepare(`
            INSERT INTO canonical_admission_status_events (
              tenant_id,event_public_id,admission_public_id,event_type,from_status,to_status,
              sequence,reason_code,safe_note,actor_user_public_id,actor_system_key,
              idempotency_key,source_evidence_sha256,occurred_at_utc,created_at_utc
            ) VALUES (?,?,?,?,NULL,?,1,NULL,NULL,NULL,'canonical.backfill',?,?,?,?)
          `).bind(
            context.tenantId,
            eventPublicId,
            publicId,
            eventType,
            status,
            `backfill-event:${context.runPublicId}:${sourcePublicId}`,
            evidence,
            dischargedAtUtc ?? admittedAtUtc,
            context.nowUtc,
          ),
          mappingStatement(context, {
            entityType: 'admission',
            canonicalPublicId: publicId,
            sourceType: 'legacy_admission',
            sourcePublicId,
            sourceTable: 'admissions',
            mappingStatus: 'mapped',
            evidenceSha256: evidence,
          }),
        );
        created += 2;
        mapped += 1;
      }
    }
    statements.push(progressStatement(context, checkpoint.id, sourcePublicId, {
      created,mapped,skipped,exceptions,
    }));
    await context.db.batch(statements);
    consume(context);
  }
  const last = rows.at(-1)?.id ?? cursor;
  const more = await count(context.db, `SELECT COUNT(*) AS count FROM admissions WHERE CAST(tenant_id AS TEXT)=? AND id>?`, [context.tenantId, last]);
  if (more > 0) {
    await markCheckpoint(context, checkpoint.id, 'paused');
    return false;
  }
  await markCheckpoint(context, checkpoint.id, 'completed');
  return true;
}

async function stayRows(
  context: Context,
  cursor: number,
  limit: number,
): Promise<StaySourceRow[]> {
  const columns = await tableColumns(context, 'patient_bed_infos');
  if (!columns.has('id') || !columns.has('tenant_id') || !columns.has('patient_id') || !columns.has('admission_id') || !columns.has('bed_id')) return [];
  return allRows<StaySourceRow>(context.db.prepare(`
    SELECT id,patient_id,admission_id,bed_id,
      ${expression(columns, ['started_at_utc','started_on'], 'started_at_utc')},
      ${expression(columns, ['ended_at_utc','ended_on'], 'ended_at_utc')},
      ${expression(columns, ['status'], 'status')}
    FROM patient_bed_infos
    WHERE CAST(tenant_id AS TEXT)=? AND id>? ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, limit));
}

function intervalsOverlap(
  leftStart: string,
  leftEnd: string | null,
  rightStart: string,
  rightEnd: string | null,
): boolean {
  const leftEndValue = leftEnd ?? '9999-12-31T23:59:59.999Z';
  const rightEndValue = rightEnd ?? '9999-12-31T23:59:59.999Z';
  return leftStart < rightEndValue && rightStart < leftEndValue;
}

async function processBedStays(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const rows = await stayRows(context, cursor, context.remaining);
  for (const row of rows) {
    const sourcePublicId = String(row.id);
    const startedAtUtc = legacyUtc(row.started_at_utc, context.timezone, context.nowUtc);
    const endedAtUtc = row.ended_at_utc == null
      ? null
      : legacyUtc(row.ended_at_utc, context.timezone, context.nowUtc);
    const status = endedAtUtc == null ? 'active' : 'completed';
    const evidence = await createSourceEvidenceSha256({
      sourceType: 'legacy_patient_bed_info',
      sourcePublicId,
      legacyPatientId: Number(row.patient_id),
      legacyAdmissionId: Number(row.admission_id),
      legacyBedId: Number(row.bed_id),
      startedAtUtc,
      endedAtUtc,
      status,
    });
    const existingMapping = await readMapping(
      context,
      'bed_stay',
      'legacy_patient_bed_info',
      sourcePublicId,
    );
    const existingStay = await context.db.prepare(`
      SELECT bed_stay_public_id,encounter_public_id,admission_public_id,bed_public_id,
             patient_link_public_id,started_at_utc,ended_at_utc,status,stay_version,
             close_reason,source_evidence_sha256
      FROM canonical_bed_stays
      WHERE tenant_id=? AND legacy_patient_bed_info_id=? LIMIT 1
    `).bind(context.tenantId, row.id).first<CanonicalStayRow>();
    const admissionMapping = await readMapping(
      context,
      'admission',
      'legacy_admission',
      String(row.admission_id),
    );
    const bedMapping = await readMapping(context, 'bed', 'legacy_bed', String(row.bed_id));
    const admission = admissionMapping?.canonical_public_id == null
      ? null
      : await context.db.prepare(`
          SELECT admission_public_id,encounter_public_id,patient_link_public_id,current_status
          FROM canonical_admissions
          WHERE tenant_id=? AND admission_public_id=? LIMIT 1
        `).bind(context.tenantId, admissionMapping.canonical_public_id).first<CanonicalAdmissionRow>();
    const bed = bedMapping?.canonical_public_id == null
      ? null
      : await context.db.prepare(`
          SELECT bed_public_id,operational_status FROM canonical_beds
          WHERE tenant_id=? AND bed_public_id=? LIMIT 1
        `).bind(context.tenantId, bedMapping.canonical_public_id).first<CanonicalBedRow>();
    const links = await patientLinks(context, Number(row.patient_id));
    const statements: EncounterAdmissionBedBackfillPreparedStatement[] = [];
    let created = 0;
    let mapped = 0;
    let skipped = 0;
    let exceptions = 0;
    let issueCode: string | null = null;
    let issueSummary = '';

    if (
      existingMapping?.mapping_status === 'mapped'
      && existingMapping.canonical_public_id != null
      && existingMapping.canonical_public_id !== existingStay?.bed_stay_public_id
    ) {
      issueCode = 'CDB113E_BED_STAY_MAPPING_TARGET_CONFLICT';
      issueSummary = 'Existing bed-stay mapping target does not match the exact legacy stay row.';
    } else if (links.length !== 1) {
      issueCode = await unresolvedPatientLinkCode(context, Number(row.patient_id), links.length);
      issueSummary = 'Bed stay has no single exact patient link.';
    } else if (!admission) {
      issueCode = 'CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING';
      issueSummary = 'Bed stay has no exact mapped canonical admission.';
    } else if (!bed) {
      issueCode = 'CDB113E_BED_STAY_BED_MAPPING_MISSING';
      issueSummary = 'Bed stay has no exact mapped canonical bed resource.';
    } else if (admission.patient_link_public_id !== links[0].patient_link_public_id) {
      issueCode = 'CDB113E_BED_STAY_PATIENT_MISMATCH';
      issueSummary = 'Bed-stay patient does not match admission patient.';
    } else if (endedAtUtc != null && endedAtUtc < startedAtUtc) {
      issueCode = 'CDB113E_BED_STAY_INTERVAL_INVALID';
      issueSummary = 'Bed-stay end time precedes start time.';
    } else if (status === 'active' && bed.operational_status === 'maintenance') {
      issueCode = 'CDB113E_MAINTENANCE_BED_OCCUPANCY';
      issueSummary = 'An active legacy occupancy references a maintenance bed.';
    } else if (status === 'active' && ['inactive','retired'].includes(bed.operational_status)) {
      issueCode = 'CDB113E_INACTIVE_BED_OCCUPANCY';
      issueSummary = 'An active legacy occupancy references an inactive or retired bed.';
    } else if (admission && bed) {
      const overlaps = await allRows<CanonicalStayRow>(context.db.prepare(`
        SELECT bed_stay_public_id,encounter_public_id,admission_public_id,bed_public_id,
               patient_link_public_id,started_at_utc,ended_at_utc,status,stay_version,
               close_reason,source_evidence_sha256
        FROM canonical_bed_stays
        WHERE tenant_id=? AND (bed_public_id=? OR admission_public_id=?)
          AND bed_stay_public_id<>?
      `).bind(
        context.tenantId,
        bed.bed_public_id,
        admission.admission_public_id,
        existingStay?.bed_stay_public_id ?? '',
      ));
      if (overlaps.some((entry) => intervalsOverlap(
        startedAtUtc,
        endedAtUtc,
        String(entry.started_at_utc),
        entry.ended_at_utc == null ? null : String(entry.ended_at_utc),
      ))) {
        issueCode = 'CDB113E_BED_STAY_INTERVAL_OVERLAP';
        issueSummary = 'Bed stay overlaps an existing canonical bed or admission interval.';
      }
    }

    if (issueCode) {
      const alreadyClassified = existingMapping?.mapping_status === 'ambiguous'
        && existingMapping.canonical_public_id == null
        && existingMapping.evidence_sha256 === evidence
        && (existingStay == null || (
          existingStay.status === 'invalid'
          && existingStay.close_reason === issueCode
          && existingStay.source_evidence_sha256 === evidence
        ));
      if (alreadyClassified) {
        skipped = 1;
        context.skipped += 1;
      } else {
        if (existingStay) {
          statements.push(context.db.prepare(`
            UPDATE canonical_bed_stays
            SET admission_public_id=NULL,bed_public_id=NULL,patient_link_public_id=NULL,
                ended_at_utc=COALESCE(ended_at_utc,started_at_utc),
                status='invalid',close_reason=?,stay_version=CASE WHEN stay_version<1 THEN 1 ELSE stay_version END,
                source_evidence_sha256=?,updated_at_utc=?
            WHERE tenant_id=? AND legacy_patient_bed_info_id=?
          `).bind(
            issueCode,
            evidence,
            context.nowUtc,
            context.tenantId,
            row.id,
          ));
          context.bedStaysUpdated += 1;
        }
        if (existingMapping) {
          statements.push(context.db.prepare(`
            UPDATE canonical_source_mappings
            SET canonical_public_id=NULL,mapping_status='ambiguous',
                mapping_version=mapping_version+1,migration_run_id=?,evidence_sha256=?,updated_at_utc=?
            WHERE tenant_id=? AND entity_type='bed_stay'
              AND source_type='legacy_patient_bed_info' AND source_public_id=?
          `).bind(
            context.runId,
            evidence,
            context.nowUtc,
            context.tenantId,
            sourcePublicId,
          ));
        } else {
          statements.push(mappingStatement(context, {
            entityType: 'bed_stay',
            canonicalPublicId: null,
            sourceType: 'legacy_patient_bed_info',
            sourcePublicId,
            sourceTable: 'patient_bed_infos',
            mappingStatus: 'ambiguous',
            evidenceSha256: evidence,
          }));
          mapped = 1;
        }
        statements.push(await issueStatement(context, {
          code: issueCode,
          entityType: 'bed_stay',
          sourceType: 'legacy_patient_bed_info',
          sourcePublicId,
          fingerprintKey: `stay:${sourcePublicId}:${issueCode}`,
          summary: issueSummary,
          details: { patientCandidateCount: links.length },
        }));
        exceptions = 1;
      }
    } else if (admission && bed && links.length === 1) {
      const publicId = existingStay?.bed_stay_public_id ?? await createDeterministicSourceId(
        'bedstay',
        context.tenantId,
        'legacy_patient_bed_info',
        sourcePublicId,
      );
      const alreadyAdopted = existingStay != null
        && existingMapping?.mapping_status === 'mapped'
        && existingMapping.canonical_public_id === publicId
        && existingMapping.evidence_sha256 === evidence
        && existingStay.encounter_public_id === admission.encounter_public_id
        && existingStay.admission_public_id === admission.admission_public_id
        && existingStay.bed_public_id === bed.bed_public_id
        && existingStay.patient_link_public_id === links[0].patient_link_public_id
        && existingStay.started_at_utc === startedAtUtc
        && existingStay.ended_at_utc === endedAtUtc
        && existingStay.status === status
        && existingStay.close_reason == null
        && existingStay.source_evidence_sha256 === evidence;
      if (alreadyAdopted) {
        skipped = 1;
        context.skipped += 1;
      } else {
        if (existingStay) {
          statements.push(context.db.prepare(`
            UPDATE canonical_bed_stays
            SET encounter_public_id=?,admission_public_id=?,bed_public_id=?,patient_link_public_id=?,
                started_at_utc=?,ended_at_utc=?,status=?,
                stay_version=CASE WHEN stay_version<1 THEN 1 ELSE stay_version END,
                movement_reason='migration',source_command_key=COALESCE(source_command_key,?),
                close_reason=NULL,source_evidence_sha256=?,updated_at_utc=?
            WHERE tenant_id=? AND legacy_patient_bed_info_id=?
          `).bind(
            admission.encounter_public_id,
            admission.admission_public_id,
            bed.bed_public_id,
            links[0].patient_link_public_id,
            startedAtUtc,
            endedAtUtc,
            status,
            `backfill:${context.runPublicId}:${sourcePublicId}`,
            evidence,
            context.nowUtc,
            context.tenantId,
            row.id,
          ));
          context.bedStaysUpdated += 1;
        } else {
          statements.push(context.db.prepare(`
            INSERT INTO canonical_bed_stays (
              tenant_id,bed_stay_public_id,encounter_public_id,legacy_patient_bed_info_id,
              legacy_admission_id,legacy_bed_id,admission_public_id,bed_public_id,
              patient_link_public_id,started_at_utc,ended_at_utc,status,stay_version,
              movement_reason,source_command_key,close_reason,source_evidence_sha256,
              created_at_utc,updated_at_utc
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'migration',?,NULL,?,?,?)
          `).bind(
            context.tenantId,
            publicId,
            admission.encounter_public_id,
            row.id,
            row.admission_id,
            row.bed_id,
            admission.admission_public_id,
            bed.bed_public_id,
            links[0].patient_link_public_id,
            startedAtUtc,
            endedAtUtc,
            status,
            `backfill:${context.runPublicId}:${sourcePublicId}`,
            evidence,
            context.nowUtc,
            context.nowUtc,
          ));
          created = 1;
        }
        if (existingMapping) {
          statements.push(context.db.prepare(`
            UPDATE canonical_source_mappings
            SET canonical_public_id=?,mapping_status='mapped',
                mapping_version=mapping_version+1,migration_run_id=?,evidence_sha256=?,updated_at_utc=?
            WHERE tenant_id=? AND entity_type='bed_stay'
              AND source_type='legacy_patient_bed_info' AND source_public_id=?
          `).bind(
            publicId,
            context.runId,
            evidence,
            context.nowUtc,
            context.tenantId,
            sourcePublicId,
          ));
        } else {
          statements.push(mappingStatement(context, {
            entityType: 'bed_stay',
            canonicalPublicId: publicId,
            sourceType: 'legacy_patient_bed_info',
            sourcePublicId,
            sourceTable: 'patient_bed_infos',
            mappingStatus: 'mapped',
            evidenceSha256: evidence,
          }));
          mapped = 1;
        }
      }
    }
    statements.push(progressStatement(context, checkpoint.id, sourcePublicId, {
      created,mapped,skipped,exceptions,
    }));
    await context.db.batch(statements);
    consume(context);
  }
  const last = rows.at(-1)?.id ?? cursor;
  const more = await count(context.db, `
    SELECT COUNT(*) AS count FROM patient_bed_infos
    WHERE CAST(tenant_id AS TEXT)=? AND id>?
  `, [context.tenantId, last]);
  if (more > 0) {
    await markCheckpoint(context, checkpoint.id, 'paused');
    return false;
  }
  await markCheckpoint(context, checkpoint.id, 'completed');
  return true;
}

async function processIssueClassification(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const bedColumns = await tableColumns(context, 'beds');
  const stayColumns = await tableColumns(context, 'patient_bed_infos');
  const stayEndColumn = firstColumn(stayColumns, ['ended_at_utc','ended_on']);
  if (
    !bedColumns.has('id')
    || !bedColumns.has('tenant_id')
    || !bedColumns.has('status')
    || !stayColumns.has('bed_id')
    || !stayColumns.has('tenant_id')
    || stayEndColumn == null
  ) {
    await markCheckpoint(context, checkpoint.id, 'completed');
    return true;
  }
  const rows = await allRows<{
    id: number;
    legacy_status: string;
    has_active_source_interval: number;
  }>(context.db.prepare(`
    SELECT b.id,CAST(b.status AS TEXT) AS legacy_status,
      CASE WHEN EXISTS (
        SELECT 1 FROM patient_bed_infos p
        WHERE CAST(p.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
          AND p.bed_id=b.id AND p.${stayEndColumn} IS NULL
      ) THEN 1 ELSE 0 END AS has_active_source_interval
    FROM beds b
    WHERE CAST(b.tenant_id AS TEXT)=?
      AND (
        (
          lower(trim(CAST(b.status AS TEXT))) IN ('occupied','in_use','in-use')
          AND NOT EXISTS (
            SELECT 1 FROM patient_bed_infos p
            WHERE CAST(p.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
              AND p.bed_id=b.id AND p.${stayEndColumn} IS NULL
          )
        )
        OR
        (
          lower(trim(CAST(b.status AS TEXT))) IN ('available','free','vacant')
          AND EXISTS (
            SELECT 1 FROM patient_bed_infos p
            WHERE CAST(p.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
              AND p.bed_id=b.id AND p.${stayEndColumn} IS NULL
          )
        )
      )
    ORDER BY b.id
  `).bind(context.tenantId));
  for (const row of rows) {
    const sourcePublicId = String(row.id);
    const existing = await context.db.prepare(`
      SELECT 1 AS found
      FROM canonical_processing_issues
      WHERE tenant_id=? AND issue_type=?
        AND issue_code='CDB113E_LEGACY_BED_STATUS_CACHE_VARIANCE'
        AND entity_type='bed' AND source_type='legacy_bed'
        AND source_public_id=? AND status IN ('open','acknowledged','waived')
      LIMIT 1
    `).bind(context.tenantId, ISSUE_TYPE, sourcePublicId).first<{ found: number }>();
    if (existing) {
      context.skipped += 1;
      continue;
    }
    await context.db.batch([
      await issueStatement(context, {
        code: 'CDB113E_LEGACY_BED_STATUS_CACHE_VARIANCE',
        entityType: 'bed',
        sourceType: 'legacy_bed',
        sourcePublicId,
        fingerprintKey: `bed:${sourcePublicId}:legacy-status-cache-variance`,
        summary: 'Legacy bed status differs from interval-based occupancy evidence.',
        details: {
          legacyStatusOccupied: ['occupied','in_use','in-use'].includes(
            String(row.legacy_status).trim().toLowerCase(),
          ),
          hasActiveSourceInterval: Number(row.has_active_source_interval) === 1,
        },
      }),
    ]);
  }
  await markCheckpoint(context, checkpoint.id, 'completed');
  return true;
}

function partitions(): Partition[] {
  return [
    { key: 'encounter_hardening', sourceTable: 'canonical_encounters', process: processEncounterHardening },
    { key: 'care_location', sourceTable: 'beds', process: processCareLocations },
    { key: 'bed_resource', sourceTable: 'beds', process: processBeds },
    { key: 'admission', sourceTable: 'admissions', process: processAdmissions },
    { key: 'bed_stay', sourceTable: 'patient_bed_infos', process: processBedStays },
    { key: 'issue_classification', sourceTable: null, process: processIssueClassification },
  ];
}

async function pauseNextPartition(context: Context, nextKey: string): Promise<void> {
  const checkpoint = await ensureCheckpoint(context, nextKey);
  if (checkpoint.status !== 'completed') await markCheckpoint(context, checkpoint.id, 'paused');
}

export async function backfillEncounterAdmissionBedConvergence(
  db: EncounterAdmissionBedBackfillDatabase,
  raw: EncounterAdmissionBedBackfillOptions,
): Promise<EncounterAdmissionBedBackfillResult> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const runPublicId = exact(raw.runPublicId, 'runPublicId');
  const timezone = exact(raw.timezone ?? 'Asia/Dhaka', 'timezone');
  const nowUtc = toUtcIso(raw.nowUtc ?? new Date().toISOString());
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  const context: Context = {
    db,
    tenantId,
    runId: run.id,
    runPublicId,
    timezone,
    nowUtc,
    remaining: positiveLimit(raw.maxSourceRecords),
    scanned: 0,
    encountersHardened: 0,
    bedStaysUpdated: 0,
    skipped: 0,
    columns: new Map(),
  };
  const starting = await captureCounts(db, tenantId);
  const ordered = partitions();
  for (let index = 0; index < ordered.length; index += 1) {
    const partition = ordered[index];
    const checkpoint = await ensureCheckpoint(context, partition.key);
    if (checkpoint.status === 'completed') continue;
    if (context.remaining <= 0) {
      await markCheckpoint(context, checkpoint.id, 'paused');
      const partial = await resultFromDelta(context, starting, false);
      await db.prepare(`
        UPDATE canonical_migration_runs SET result_summary_json=?,updated_at_utc=?
        WHERE tenant_id=? AND id=?
      `).bind(stableCanonicalJson({ completed: false, counts: partial.counts }), nowUtc, tenantId, run.id).run();
      return partial;
    }
    const completed = await partition.process(context, checkpoint);
    if (!completed) {
      const partial = await resultFromDelta(context, starting, false);
      await db.prepare(`
        UPDATE canonical_migration_runs SET result_summary_json=?,updated_at_utc=?
        WHERE tenant_id=? AND id=?
      `).bind(stableCanonicalJson({ completed: false, counts: partial.counts }), nowUtc, tenantId, run.id).run();
      return partial;
    }
    if (context.remaining <= 0 && index + 1 < ordered.length) {
      await pauseNextPartition(context, ordered[index + 1].key);
      const partial = await resultFromDelta(context, starting, false);
      await db.prepare(`
        UPDATE canonical_migration_runs SET result_summary_json=?,updated_at_utc=?
        WHERE tenant_id=? AND id=?
      `).bind(stableCanonicalJson({ completed: false, counts: partial.counts }), nowUtc, tenantId, run.id).run();
      return partial;
    }
  }
  const result = await resultFromDelta(context, starting, true);
  await db.prepare(`
    UPDATE canonical_migration_runs
    SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(
    nowUtc,
    stableCanonicalJson({
      completed: true,
      secondPassZeroNew: result.secondPassZeroNew,
      counts: result.counts,
    }),
    nowUtc,
    tenantId,
    run.id,
  ).run();
  return result;
}
