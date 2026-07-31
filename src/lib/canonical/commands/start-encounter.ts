import {
  prepareCanonicalBatch,
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
  type PreparedCanonicalBatch,
} from '../command-batch';
import { createDeterministicSourceId } from '../source-mapping';
import { toUtcIso } from '../time';

export type StartEncounterType = 'outpatient' | 'inpatient' | 'teleconsultation' | 'emergency' | 'other';
export type StartEncounterParticipantRole = 'treating' | 'consulting' | 'admitting';
export type EncounterSourceKind = 'runtime' | 'backfill' | 'import' | 'sync' | 'manual' | 'migration' | 'other';

export interface StartEncounterInput {
  tenantId: string;
  encounterPublicId?: string;
  legacyPatientId: number;
  patientLinkPublicId: string;
  encounterType: StartEncounterType;
  startedAtUtc: string;
  practitionerPublicId?: string | null;
  participantRole?: StartEncounterParticipantRole | null;
  careLocationPublicId?: string | null;
  sourceKind?: EncounterSourceKind;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  eventPublicId?: string;
  businessDate: string;
}

export interface StartEncounterResult {
  encounterPublicId: string;
  status: 'in_progress';
  version: number;
}

export interface CancelEncounterInput {
  tenantId: string;
  encounterPublicId: string;
  expectedVersion: number;
  cancelledAtUtc: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  eventPublicId?: string;
  businessDate: string;
}

export interface CancelEncounterResult {
  encounterPublicId: string;
  status: 'cancelled';
  version: number;
}

export interface CompleteEncounterInput {
  tenantId: string;
  encounterPublicId: string;
  expectedVersion: number;
  completedAtUtc: string;
  signedSnapshotSha256?: string | null;
  signedAtUtc?: string | null;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  eventPublicId?: string;
  businessDate: string;
}

export interface CompleteEncounterResult {
  encounterPublicId: string;
  status: 'completed';
  version: number;
  signed: boolean;
}

export interface ReplaceEncounterParticipantInput {
  tenantId: string;
  encounterPublicId: string;
  expectedVersion: number;
  practitionerPublicId: string;
  participantRole: StartEncounterParticipantRole;
  changedAtUtc: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  eventPublicId?: string;
  businessDate: string;
}

export interface ReplaceEncounterParticipantResult {
  encounterPublicId: string;
  practitionerPublicId: string;
  participantRole: StartEncounterParticipantRole;
  version: number;
}

export type PreparedEncounterCompletion =
  | { status: 'replayed'; result: CompleteEncounterResult; statements: readonly CanonicalPreparedStatement[] }
  | { status: 'prepared'; result: CompleteEncounterResult; statements: readonly CanonicalPreparedStatement[] };

interface StoredEncounterRow {
  patient_link_public_id: string | null;
  encounter_type: StartEncounterType;
  status: string;
  encounter_version: number;
  started_at_utc: string;
  ended_at_utc: string | null;
  source_evidence_sha256: string;
}

interface PatientLinkRow {
  legacy_patient_id: number;
  link_status: string;
  effective_to_utc: string | null;
}

interface PractitionerRow {
  status: string;
}

interface LocationRow {
  operational_status: string;
}

interface SourceMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface ActiveRequestCountRow {
  active_count: number;
}

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function optionalExact(value: string | null | undefined, label: string): string | null {
  return value == null ? null : exact(value, label);
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function hash(value: string, label: string): string {
  exact(value, label);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

function businessDate(value: string): string {
  const normalized = exact(value, 'businessDate');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new RangeError('businessDate must use YYYY-MM-DD');
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    instant.getUTCFullYear() !== Number(match[1])
    || instant.getUTCMonth() !== Number(match[2]) - 1
    || instant.getUTCDate() !== Number(match[3])
  ) throw new RangeError('businessDate must be a valid calendar date');
  return normalized;
}

function encounterType(value: string): StartEncounterType {
  if (!['outpatient', 'inpatient', 'teleconsultation', 'emergency', 'other'].includes(value)) {
    throw new RangeError('encounterType is invalid');
  }
  return value as StartEncounterType;
}

function participantRole(value: string): StartEncounterParticipantRole {
  if (!['treating', 'consulting', 'admitting'].includes(value)) throw new RangeError('participantRole is invalid');
  return value as StartEncounterParticipantRole;
}

function sourceKind(value: string): EncounterSourceKind {
  if (!['runtime', 'backfill', 'import', 'sync', 'manual', 'migration', 'other'].includes(value)) {
    throw new RangeError('sourceKind is invalid');
  }
  return value as EncounterSourceKind;
}

async function eventId(
  tenantId: string,
  idempotencyKey: string,
  provided: string | undefined,
): Promise<string> {
  return provided == null
    ? createDeterministicSourceId('encevt', tenantId, 'encounter_command', idempotencyKey)
    : exact(provided, 'eventPublicId');
}

async function encounterId(
  tenantId: string,
  sourceType: string,
  sourcePublicId: string,
  provided: string | undefined,
): Promise<string> {
  return provided == null
    ? createDeterministicSourceId('enc', tenantId, sourceType, sourcePublicId)
    : exact(provided, 'encounterPublicId');
}

async function requireActivePatientLink(
  db: CanonicalBatchDatabase,
  tenantId: string,
  patientLinkPublicId: string,
  legacyPatientId: number,
): Promise<void> {
  const row = await db.prepare(`
    SELECT legacy_patient_id,link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=?
    LIMIT 1
  `).bind(tenantId, patientLinkPublicId).first<PatientLinkRow>();
  if (!row) throw new Error('patient link not found');
  if (row.link_status === 'rejected' || row.link_status === 'retired' || row.effective_to_utc != null) {
    throw new Error('encounter requires an active patient link');
  }
  if (Number(row.legacy_patient_id) !== legacyPatientId) {
    throw new Error('patient link does not match legacy patient evidence');
  }
}

async function requireActivePractitioner(
  db: CanonicalBatchDatabase,
  tenantId: string,
  practitionerPublicId: string,
): Promise<void> {
  const row = await db.prepare(`
    SELECT status FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=?
    LIMIT 1
  `).bind(tenantId, practitionerPublicId).first<PractitionerRow>();
  if (!row || row.status !== 'active') throw new Error('encounter requires an active practitioner');
}

async function requireActiveLocation(
  db: CanonicalBatchDatabase,
  tenantId: string,
  careLocationPublicId: string | null,
): Promise<void> {
  if (careLocationPublicId == null) return;
  const row = await db.prepare(`
    SELECT operational_status FROM canonical_care_locations
    WHERE tenant_id=? AND location_public_id=?
    LIMIT 1
  `).bind(tenantId, careLocationPublicId).first<LocationRow>();
  if (!row || row.operational_status !== 'active') throw new Error('encounter requires an active care location');
}

async function requireSourceAvailable(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    sourceType: string;
    sourcePublicId: string;
    encounterPublicId: string;
  },
): Promise<void> {
  const row = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='encounter' AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.sourceType, input.sourcePublicId).first<SourceMappingRow>();
  if (!row) return;
  if (row.mapping_status !== 'mapped' || row.canonical_public_id !== input.encounterPublicId) {
    throw new Error('encounter source mapping already belongs to another encounter');
  }
  throw new Error('encounter source mapping already exists without replay evidence');
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    encounterPublicId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    sourceEvidenceSha256: string;
    occurredAtUtc: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?, 'encounter', ?, ?, ?, ?, 'mapped', 1, NULL, ?, ?, ?)
  `).bind(
    input.tenantId,
    input.encounterPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

export async function startEncounter(
  db: CanonicalBatchDatabase,
  raw: StartEncounterInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<StartEncounterResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const evidence = hash(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const legacyPatientId = positive(raw.legacyPatientId, 'legacyPatientId');
  const patientLinkPublicId = exact(raw.patientLinkPublicId, 'patientLinkPublicId');
  const resolvedEncounterType = encounterType(raw.encounterType);
  const startedAtUtc = utc(raw.startedAtUtc, 'startedAtUtc');
  const practitionerPublicId = optionalExact(raw.practitionerPublicId, 'practitionerPublicId');
  const resolvedParticipantRole = raw.participantRole == null ? null : participantRole(raw.participantRole);
  if ((practitionerPublicId == null) !== (resolvedParticipantRole == null)) {
    throw new Error('encounter practitioner and participant role must be supplied together');
  }
  const careLocationPublicId = optionalExact(raw.careLocationPublicId, 'careLocationPublicId');
  const resolvedSourceKind = sourceKind(raw.sourceKind ?? 'runtime');
  if (resolvedSourceKind === 'migration' && sourceType.startsWith('runtime')) {
    throw new RangeError('runtime encounter cannot use migration sourceKind');
  }
  const resolvedBusinessDate = businessDate(raw.businessDate);
  const encounterPublicId = await encounterId(tenantId, sourceType, sourcePublicId, raw.encounterPublicId);
  const resolvedEventId = await eventId(tenantId, idempotencyKey, raw.eventPublicId);
  const request = {
    encounterPublicId,
    legacyPatientId,
    patientLinkPublicId,
    encounterType: resolvedEncounterType,
    startedAtUtc,
    practitionerPublicId,
    participantRole: resolvedParticipantRole,
    careLocationPublicId,
    sourceKind: resolvedSourceKind,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256: evidence,
  };
  const replay = await readCanonicalCommandReplay<StartEncounterResult>(db, {
    tenantId,
    commandName: 'canonical.encounter.start',
    idempotencyKey,
    request,
  });
  if (replay) return replay;

  await requireActivePatientLink(db, tenantId, patientLinkPublicId, legacyPatientId);
  if (practitionerPublicId) await requireActivePractitioner(db, tenantId, practitionerPublicId);
  await requireActiveLocation(db, tenantId, careLocationPublicId);
  const existing = await db.prepare(`
    SELECT encounter_version FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(tenantId, encounterPublicId).first<{ encounter_version: number }>();
  if (existing) throw new Error('encounterPublicId already exists');
  await requireSourceAvailable(db, { tenantId, sourceType, sourcePublicId, encounterPublicId });

  const result: StartEncounterResult = { encounterPublicId, status: 'in_progress', version: 1 };
  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_encounters (
        tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
        encounter_type,status,encounter_version,care_location_public_id,source_kind,
        source_command_key,started_at_utc,source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,'in_progress',1,?,?,?,?,?,?,?)
    `).bind(
      tenantId,
      encounterPublicId,
      legacyPatientId,
      patientLinkPublicId,
      resolvedEncounterType,
      careLocationPublicId,
      resolvedSourceKind,
      idempotencyKey,
      startedAtUtc,
      evidence,
      startedAtUtc,
      startedAtUtc,
    ),
  ];
  if (practitionerPublicId && resolvedParticipantRole) {
    statements.push(db.prepare(`
      INSERT INTO canonical_encounter_participants (
        tenant_id,encounter_public_id,practitioner_public_id,
        participant_role,evidence_type,active_from_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,'approved_manual',?,?,?)
    `).bind(
      tenantId,
      encounterPublicId,
      practitionerPublicId,
      resolvedParticipantRole,
      startedAtUtc,
      startedAtUtc,
      startedAtUtc,
    ));
  }
  statements.push(sourceMappingStatement(db, {
    tenantId,
    encounterPublicId,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256: evidence,
    occurredAtUtc: startedAtUtc,
  }));
  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.encounter.start',
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_encounter',
      aggregatePublicId: encounterPublicId,
      eventType: 'canonical.encounter.started',
      eventVersion: 1,
      occurredAtUtc: startedAtUtc,
      businessDate: resolvedBusinessDate,
      payload: {
        encounterPublicId,
        encounterType: resolvedEncounterType,
        status: 'in_progress',
        version: 1,
        careLocationPublicId,
      },
    },
  });
}

export async function prepareStartEncounterBatch(
  db: CanonicalBatchDatabase,
  input: StartEncounterInput,
  authoritativeStatements: readonly CanonicalPreparedStatement[] = [],
): Promise<PreparedCanonicalBatch<StartEncounterResult>> {
  let capturedStatements: readonly CanonicalPreparedStatement[] | null = null;
  const captureDb: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return db.prepare(sql);
    },
    async batch(statements) {
      capturedStatements = [...statements];
      return statements.map(() => ({ success: true }));
    },
  };
  const result = await startEncounter(captureDb, input, { authoritativeStatements });
  if (result.status === 'replayed') {
    return { status: 'replayed', result: result.result, statements: [] };
  }
  const preparedStatements = capturedStatements as readonly CanonicalPreparedStatement[] | null;
  if (!preparedStatements || preparedStatements.length === 0) {
    throw new Error('Encounter start preparation did not produce a canonical batch');
  }
  return { status: 'prepared', result: result.result, statements: preparedStatements };
}

export async function cancelEncounter(
  db: CanonicalBatchDatabase,
  raw: CancelEncounterInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CancelEncounterResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const encounterPublicId = exact(raw.encounterPublicId, 'encounterPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const cancelledAtUtc = utc(raw.cancelledAtUtc, 'cancelledAtUtc');
  const evidence = hash(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const resolvedEventId = await eventId(tenantId, idempotencyKey, raw.eventPublicId);
  const resolvedBusinessDate = businessDate(raw.businessDate);
  const request = { encounterPublicId, expectedVersion, cancelledAtUtc, sourceEvidenceSha256: evidence };
  const replay = await readCanonicalCommandReplay<CancelEncounterResult>(db, {
    tenantId,
    commandName: 'canonical.encounter.cancel',
    idempotencyKey,
    request,
  });
  if (replay) return replay;

  const encounter = await db.prepare(`
    SELECT patient_link_public_id,encounter_type,status,encounter_version,
           started_at_utc,ended_at_utc,source_evidence_sha256
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(tenantId, encounterPublicId).first<StoredEncounterRow>();
  if (!encounter) throw new Error('canonical encounter not found');
  if (Number(encounter.encounter_version) !== expectedVersion) {
    throw new Error(`expectedVersion ${expectedVersion} does not match current version ${encounter.encounter_version}`);
  }
  if (encounter.status !== 'in_progress' || encounter.ended_at_utc !== null) {
    throw new Error(`canonical encounter cannot be cancelled in status: ${encounter.status}`);
  }
  if (Date.parse(cancelledAtUtc) < Date.parse(encounter.started_at_utc)) {
    throw new RangeError('encounter cancellation cannot occur before encounter start');
  }
  const activeRequests = await db.prepare(`
    SELECT COUNT(*) AS active_count
    FROM canonical_service_requests
    WHERE tenant_id=? AND encounter_public_id=?
      AND status IN ('active','partially_fulfilled')
  `).bind(tenantId, encounterPublicId).first<ActiveRequestCountRow>();
  if (Number(activeRequests?.active_count ?? 0) > 0) {
    throw new Error('canonical encounter cannot be cancelled while an active service request remains');
  }

  const nextVersion = expectedVersion + 1;
  const result: CancelEncounterResult = { encounterPublicId, status: 'cancelled', version: nextVersion };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.encounter.cancel',
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_encounters
        SET status='cancelled',ended_at_utc=?,encounter_version=?,
            source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND encounter_public_id=?
          AND encounter_version=? AND status='in_progress' AND ended_at_utc IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM canonical_service_requests r
            WHERE r.tenant_id=canonical_encounters.tenant_id
              AND r.encounter_public_id=canonical_encounters.encounter_public_id
              AND r.status IN ('active','partially_fulfilled')
          )
      `).bind(
        cancelledAtUtc,
        nextVersion,
        evidence,
        cancelledAtUtc,
        tenantId,
        encounterPublicId,
        expectedVersion,
      ),
      db.prepare(`
        UPDATE canonical_encounter_participants
        SET active_to_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND encounter_public_id=? AND active_to_utc IS NULL
      `).bind(cancelledAtUtc, cancelledAtUtc, tenantId, encounterPublicId),
    ],
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_encounter',
      aggregatePublicId: encounterPublicId,
      eventType: 'canonical.encounter.cancelled',
      eventVersion: 1,
      occurredAtUtc: cancelledAtUtc,
      businessDate: resolvedBusinessDate,
      payload: result,
    },
  });
}

function optionalHash(value: string | null | undefined, label: string): string | null {
  return value == null ? null : hash(value, label);
}

async function prepareCompleteEncounterCommand(
  db: CanonicalBatchDatabase,
  raw: CompleteEncounterInput,
  authoritativeStatements: readonly CanonicalPreparedStatement[] = [],
): Promise<PreparedEncounterCompletion> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const encounterPublicId = exact(raw.encounterPublicId, 'encounterPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const completedAtUtc = utc(raw.completedAtUtc, 'completedAtUtc');
  const signedSnapshotSha256 = optionalHash(raw.signedSnapshotSha256, 'signedSnapshotSha256');
  const signedAtUtc = raw.signedAtUtc == null ? null : utc(raw.signedAtUtc, 'signedAtUtc');
  if ((signedSnapshotSha256 == null) !== (signedAtUtc == null)) {
    throw new Error('signed encounter completion requires both snapshot hash and signed time');
  }
  if (signedAtUtc && Date.parse(signedAtUtc) > Date.parse(completedAtUtc)) {
    throw new RangeError('encounter cannot complete before its signature time');
  }
  const evidence = hash(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const resolvedBusinessDate = businessDate(raw.businessDate);
  const resolvedEventId = await eventId(tenantId, idempotencyKey, raw.eventPublicId);
  const request = {
    encounterPublicId,
    signedSnapshotSha256,
    sourceEvidenceSha256: evidence,
  };
  const replay = await readCanonicalCommandReplay<CompleteEncounterResult>(db, {
    tenantId,
    commandName: 'canonical.encounter.complete',
    idempotencyKey,
    request,
  });
  if (replay) return { status: 'replayed', result: replay.result, statements: [] };

  const encounter = await db.prepare(`
    SELECT patient_link_public_id,encounter_type,status,encounter_version,
           started_at_utc,ended_at_utc,source_evidence_sha256
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(tenantId, encounterPublicId).first<StoredEncounterRow>();
  if (!encounter) throw new Error('canonical encounter not found');
  if (Number(encounter.encounter_version) !== expectedVersion) {
    throw new Error(`expectedVersion ${expectedVersion} does not match current version ${encounter.encounter_version}`);
  }
  if (encounter.status !== 'in_progress' || encounter.ended_at_utc !== null) {
    throw new Error(`canonical encounter cannot be completed in status: ${encounter.status}`);
  }
  if (Date.parse(completedAtUtc) < Date.parse(encounter.started_at_utc)) {
    throw new RangeError('encounter completion cannot occur before encounter start');
  }
  const nextVersion = expectedVersion + 1;
  const result: CompleteEncounterResult = {
    encounterPublicId,
    status: 'completed',
    version: nextVersion,
    signed: signedSnapshotSha256 != null,
  };
  const prepared = await prepareCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.encounter.complete',
    idempotencyKey,
    request,
    authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_encounters
        SET status='completed',ended_at_utc=?,encounter_version=?,
            signed_snapshot_sha256=COALESCE(?,signed_snapshot_sha256),
            signed_at_utc=COALESCE(?,signed_at_utc),
            source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND encounter_public_id=?
          AND encounter_version=? AND status='in_progress' AND ended_at_utc IS NULL
      `).bind(
        completedAtUtc,
        nextVersion,
        signedSnapshotSha256,
        signedAtUtc,
        evidence,
        completedAtUtc,
        tenantId,
        encounterPublicId,
        expectedVersion,
      ),
      db.prepare(`
        UPDATE canonical_encounter_participants
        SET active_to_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND encounter_public_id=? AND active_to_utc IS NULL
      `).bind(completedAtUtc, completedAtUtc, tenantId, encounterPublicId),
    ],
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_encounter',
      aggregatePublicId: encounterPublicId,
      eventType: 'canonical.encounter.completed',
      eventVersion: nextVersion,
      occurredAtUtc: completedAtUtc,
      businessDate: resolvedBusinessDate,
      payload: result,
    },
  });
  return prepared;
}

export async function prepareCompleteEncounterBatch(
  db: CanonicalBatchDatabase,
  input: CompleteEncounterInput,
  authoritativeStatements: readonly CanonicalPreparedStatement[] = [],
): Promise<PreparedEncounterCompletion> {
  return prepareCompleteEncounterCommand(db, input, authoritativeStatements);
}

export async function completeEncounter(
  db: CanonicalBatchDatabase,
  input: CompleteEncounterInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CompleteEncounterResult>> {
  const prepared = await prepareCompleteEncounterCommand(
    db,
    input,
    execution.authoritativeStatements ?? [],
  );
  if (prepared.status === 'replayed') return { status: 'replayed', result: prepared.result };
  try {
    await db.batch([...prepared.statements]);
    return { status: 'applied', result: prepared.result };
  } catch (error) {
    const replay = await prepareCompleteEncounterCommand(db, input, []);
    if (replay.status === 'replayed') return { status: 'replayed', result: replay.result };
    throw error;
  }
}

export async function replaceEncounterParticipant(
  db: CanonicalBatchDatabase,
  raw: ReplaceEncounterParticipantInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<ReplaceEncounterParticipantResult>> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const encounterPublicId = exact(raw.encounterPublicId, 'encounterPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const practitionerPublicId = exact(raw.practitionerPublicId, 'practitionerPublicId');
  const resolvedParticipantRole = participantRole(raw.participantRole);
  const changedAtUtc = utc(raw.changedAtUtc, 'changedAtUtc');
  const evidence = hash(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const resolvedBusinessDate = businessDate(raw.businessDate);
  const resolvedEventId = await eventId(tenantId, idempotencyKey, raw.eventPublicId);
  const request = {
    encounterPublicId,
    practitionerPublicId,
    participantRole: resolvedParticipantRole,
    sourceEvidenceSha256: evidence,
  };
  const replay = await readCanonicalCommandReplay<ReplaceEncounterParticipantResult>(db, {
    tenantId,
    commandName: 'canonical.encounter.participant.replace',
    idempotencyKey,
    request,
  });
  if (replay) return replay;
  await requireActivePractitioner(db, tenantId, practitionerPublicId);
  const encounter = await db.prepare(`
    SELECT patient_link_public_id,encounter_type,status,encounter_version,
           started_at_utc,ended_at_utc,source_evidence_sha256
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(tenantId, encounterPublicId).first<StoredEncounterRow>();
  if (!encounter) throw new Error('canonical encounter not found');
  if (Number(encounter.encounter_version) !== expectedVersion) {
    throw new Error(`expectedVersion ${expectedVersion} does not match current version ${encounter.encounter_version}`);
  }
  if (encounter.status !== 'in_progress' || encounter.ended_at_utc !== null) {
    throw new Error(`canonical encounter participant cannot change in status: ${encounter.status}`);
  }
  if (Date.parse(changedAtUtc) < Date.parse(encounter.started_at_utc)) {
    throw new RangeError('participant change cannot occur before encounter start');
  }
  const nextVersion = expectedVersion + 1;
  const result: ReplaceEncounterParticipantResult = {
    encounterPublicId,
    practitionerPublicId,
    participantRole: resolvedParticipantRole,
    version: nextVersion,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.encounter.participant.replace',
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_encounter_participants
        SET active_to_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND encounter_public_id=?
          AND participant_role=? AND active_to_utc IS NULL
      `).bind(changedAtUtc, changedAtUtc, tenantId, encounterPublicId, resolvedParticipantRole),
      db.prepare(`
        INSERT INTO canonical_encounter_participants (
          tenant_id,encounter_public_id,practitioner_public_id,participant_role,
          evidence_type,active_from_utc,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,'approved_manual',?,?,?)
      `).bind(
        tenantId,
        encounterPublicId,
        practitionerPublicId,
        resolvedParticipantRole,
        changedAtUtc,
        changedAtUtc,
        changedAtUtc,
      ),
      db.prepare(`
        UPDATE canonical_encounters
        SET encounter_version=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND encounter_public_id=?
          AND encounter_version=? AND status='in_progress' AND ended_at_utc IS NULL
      `).bind(
        nextVersion,
        evidence,
        changedAtUtc,
        tenantId,
        encounterPublicId,
        expectedVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_encounter',
      aggregatePublicId: encounterPublicId,
      eventType: 'canonical.encounter.participant.replaced',
      eventVersion: nextVersion,
      occurredAtUtc: changedAtUtc,
      businessDate: resolvedBusinessDate,
      payload: result,
    },
  });
}
