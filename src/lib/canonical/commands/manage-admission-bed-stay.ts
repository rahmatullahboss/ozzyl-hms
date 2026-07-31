import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { createRequestFingerprint } from '../idempotency';
import { createDeterministicSourceId } from '../source-mapping';
import { toUtcIso } from '../time';

export type AdmissionType = 'inpatient' | 'emergency' | 'transfer' | 'direct' | 'conversion' | 'other';
export type AdmissionSource = 'planned' | 'emergency' | 'transfer' | 'direct' | 'encounter_conversion' | 'import' | 'manual' | 'other';
export type AdmissionTerminalStatus = 'discharged' | 'cancelled' | 'entered_in_error';
export type BedStayMovementReason = 'admission' | 'transfer' | 'readmission' | 'correction' | 'migration' | 'other';

interface ActorEvidence {
  actorUserPublicId?: string | null;
  actorSystemKey?: string | null;
}

interface CommandBase extends ActorEvidence {
  tenantId: string;
  idempotencyKey: string;
  eventPublicId?: string;
  occurredAtUtc: string;
  businessDate: string;
}

export interface AdmitPatientAndClaimBedInput extends CommandBase {
  admissionPublicId?: string;
  bedStayPublicId?: string;
  patientLinkPublicId: string;
  encounterPublicId: string;
  admittingPractitionerPublicId?: string | null;
  admissionNumber: string;
  admissionType: AdmissionType;
  admissionSource: AdmissionSource;
  admittedAtUtc: string;
  reasonCode?: string | null;
  bedPublicId?: string | null;
  expectedBedVersion?: number | null;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
}

export interface AdmitPatientAndClaimBedResult {
  admissionPublicId: string;
  currentStatus: 'admitted';
  statusVersion: number;
  bedStayPublicId: string | null;
}

export interface TransferAdmissionBedInput extends CommandBase {
  admissionPublicId: string;
  expectedAdmissionVersion: number;
  currentStayPublicId: string;
  expectedCurrentStayVersion: number;
  destinationBedPublicId: string;
  expectedDestinationBedVersion: number;
  destinationStayPublicId?: string;
  effectiveAtUtc: string;
  movementReason: Extract<BedStayMovementReason, 'transfer' | 'correction' | 'other'>;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface TransferAdmissionBedResult {
  admissionPublicId: string;
  currentStatus: 'admitted';
  statusVersion: number;
  previousStayPublicId: string;
  activeStayPublicId: string;
}

export interface DischargeOrCancelAdmissionInput extends CommandBase {
  admissionPublicId: string;
  expectedAdmissionVersion: number;
  targetStatus: AdmissionTerminalStatus;
  reasonCode: string;
  expectedActiveStayPublicId?: string | null;
  expectedActiveStayVersion?: number | null;
  sourceEvidenceSha256: string;
}

export interface DischargeOrCancelAdmissionResult {
  admissionPublicId: string;
  currentStatus: AdmissionTerminalStatus;
  statusVersion: number;
  closedStayPublicId: string | null;
}

interface EncounterRow {
  patient_link_public_id: string | null;
  encounter_type: string;
  status: string;
}

interface PatientLinkRow {
  link_status: string;
  effective_to_utc: string | null;
}

interface PractitionerRow {
  status: string;
}

interface AdmissionRow {
  encounter_public_id: string;
  patient_link_public_id: string;
  current_status: string;
  status_version: number;
  admitted_at_utc: string;
  discharged_at_utc: string | null;
}

interface BedRow {
  location_public_id: string;
  operational_status: string;
  version: number;
}

interface StayRow {
  encounter_public_id: string;
  admission_public_id: string | null;
  bed_public_id: string | null;
  patient_link_public_id: string | null;
  started_at_utc: string;
  ended_at_utc: string | null;
  status: string;
  stay_version: number;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface CountRow {
  count: number;
}

const ADMIT_COMMAND = 'canonical.admission.admit';
const TRANSFER_COMMAND = 'canonical.admission.transfer-bed';
const TERMINAL_COMMAND = 'canonical.admission.terminal-transition';

const ADMISSION_TYPES = new Set<AdmissionType>(['inpatient', 'emergency', 'transfer', 'direct', 'conversion', 'other']);
const ADMISSION_SOURCES = new Set<AdmissionSource>([
  'planned', 'emergency', 'transfer', 'direct', 'encounter_conversion', 'import', 'manual', 'other',
]);
const TERMINAL_STATUSES = new Set<AdmissionTerminalStatus>(['discharged', 'cancelled', 'entered_in_error']);
const TRANSFER_REASONS = new Set<TransferAdmissionBedInput['movementReason']>(['transfer', 'correction', 'other']);

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

function sha256(value: string, label: string): string {
  exact(value, label);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
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
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) throw new RangeError('businessDate must be a valid calendar date');
  return normalized;
}

function actor(input: ActorEvidence): { actorUserPublicId: string | null; actorSystemKey: string | null } {
  const actorUserPublicId = optionalExact(input.actorUserPublicId, 'actorUserPublicId');
  const actorSystemKey = optionalExact(input.actorSystemKey, 'actorSystemKey');
  if (actorUserPublicId == null && actorSystemKey == null) {
    throw new TypeError('actorUserPublicId or actorSystemKey is required');
  }
  return { actorUserPublicId, actorSystemKey };
}

function commandBase(input: CommandBase) {
  return {
    tenantId: exact(input.tenantId, 'tenantId'),
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    occurredAtUtc: utc(input.occurredAtUtc, 'occurredAtUtc'),
    businessDate: businessDate(input.businessDate),
    ...actor(input),
  };
}

function admissionType(value: string): AdmissionType {
  if (!ADMISSION_TYPES.has(value as AdmissionType)) throw new RangeError('admissionType is invalid');
  return value as AdmissionType;
}

function admissionSource(value: string): AdmissionSource {
  if (!ADMISSION_SOURCES.has(value as AdmissionSource)) throw new RangeError('admissionSource is invalid');
  return value as AdmissionSource;
}

function terminalStatus(value: string): AdmissionTerminalStatus {
  if (!TERMINAL_STATUSES.has(value as AdmissionTerminalStatus)) throw new RangeError('targetStatus is invalid');
  return value as AdmissionTerminalStatus;
}

function transferReason(value: string): TransferAdmissionBedInput['movementReason'] {
  if (!TRANSFER_REASONS.has(value as TransferAdmissionBedInput['movementReason'])) {
    throw new RangeError('movementReason is invalid for a bed transfer');
  }
  return value as TransferAdmissionBedInput['movementReason'];
}

async function deterministicOrProvided(
  prefix: string,
  tenantId: string,
  sourceType: string,
  sourcePublicId: string,
  provided: string | undefined,
  label: string,
): Promise<string> {
  return provided == null
    ? createDeterministicSourceId(prefix, tenantId, sourceType, sourcePublicId)
    : exact(provided, label);
}

async function commandEventId(
  tenantId: string,
  idempotencyKey: string,
  provided: string | undefined,
): Promise<string> {
  return deterministicOrProvided('admevt', tenantId, 'admission_command', idempotencyKey, provided, 'eventPublicId');
}

async function requirePatientLink(
  db: CanonicalBatchDatabase,
  tenantId: string,
  patientLinkPublicId: string,
): Promise<void> {
  const row = await db.prepare(`
    SELECT link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=?
    LIMIT 1
  `).bind(tenantId, patientLinkPublicId).first<PatientLinkRow>();
  if (!row) throw new Error('patient link not found');
  if (row.link_status === 'rejected' || row.link_status === 'retired' || row.effective_to_utc != null) {
    throw new Error('admission requires an active patient link');
  }
}

async function requireInpatientEncounter(
  db: CanonicalBatchDatabase,
  tenantId: string,
  encounterPublicId: string,
  patientLinkPublicId: string,
): Promise<EncounterRow> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,encounter_type,status
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(tenantId, encounterPublicId).first<EncounterRow>();
  if (!row) throw new Error('canonical inpatient encounter not found');
  if (row.patient_link_public_id !== patientLinkPublicId) {
    throw new Error('admission patient does not match encounter patient');
  }
  if (row.encounter_type !== 'inpatient') throw new Error('admission requires an inpatient encounter');
  if (!['in_progress', 'on_hold'].includes(row.status)) {
    throw new Error(`inpatient encounter is not active: ${row.status}`);
  }
  return row;
}

async function requirePractitioner(
  db: CanonicalBatchDatabase,
  tenantId: string,
  practitionerPublicId: string | null,
): Promise<void> {
  if (practitionerPublicId == null) return;
  const row = await db.prepare(`
    SELECT status FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=?
    LIMIT 1
  `).bind(tenantId, practitionerPublicId).first<PractitionerRow>();
  if (!row || row.status !== 'active') throw new Error('admission requires an active admitting practitioner');
}

async function requireAdmission(
  db: CanonicalBatchDatabase,
  tenantId: string,
  admissionPublicId: string,
): Promise<AdmissionRow> {
  const row = await db.prepare(`
    SELECT encounter_public_id,patient_link_public_id,current_status,status_version,
           admitted_at_utc,discharged_at_utc
    FROM canonical_admissions
    WHERE tenant_id=? AND admission_public_id=?
    LIMIT 1
  `).bind(tenantId, admissionPublicId).first<AdmissionRow>();
  if (!row) throw new Error('canonical admission not found');
  return row;
}

async function requireBed(
  db: CanonicalBatchDatabase,
  tenantId: string,
  bedPublicId: string,
): Promise<BedRow> {
  const row = await db.prepare(`
    SELECT location_public_id,operational_status,version
    FROM canonical_beds
    WHERE tenant_id=? AND bed_public_id=?
    LIMIT 1
  `).bind(tenantId, bedPublicId).first<BedRow>();
  if (!row) throw new Error('canonical bed not found');
  return row;
}

async function requireStay(
  db: CanonicalBatchDatabase,
  tenantId: string,
  stayPublicId: string,
): Promise<StayRow> {
  const row = await db.prepare(`
    SELECT encounter_public_id,admission_public_id,bed_public_id,patient_link_public_id,
           started_at_utc,ended_at_utc,status,stay_version
    FROM canonical_bed_stays
    WHERE tenant_id=? AND bed_stay_public_id=?
    LIMIT 1
  `).bind(tenantId, stayPublicId).first<StayRow>();
  if (!row) throw new Error('canonical bed stay not found');
  return row;
}

async function openStayForBed(
  db: CanonicalBatchDatabase,
  tenantId: string,
  bedPublicId: string,
): Promise<StayRow | null> {
  return db.prepare(`
    SELECT encounter_public_id,admission_public_id,bed_public_id,patient_link_public_id,
           started_at_utc,ended_at_utc,status,stay_version
    FROM canonical_bed_stays
    WHERE tenant_id=? AND bed_public_id=? AND status='active' AND ended_at_utc IS NULL
    LIMIT 1
  `).bind(tenantId, bedPublicId).first<StayRow>();
}

async function openStayForAdmission(
  db: CanonicalBatchDatabase,
  tenantId: string,
  admissionPublicId: string,
): Promise<(StayRow & { bed_stay_public_id: string }) | null> {
  return db.prepare(`
    SELECT bed_stay_public_id,encounter_public_id,admission_public_id,bed_public_id,
           patient_link_public_id,started_at_utc,ended_at_utc,status,stay_version
    FROM canonical_bed_stays
    WHERE tenant_id=? AND admission_public_id=? AND status='active' AND ended_at_utc IS NULL
    LIMIT 1
  `).bind(tenantId, admissionPublicId).first<StayRow & { bed_stay_public_id: string }>();
}

async function requireSourceMappingAvailable(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'admission' | 'bed_stay';
    sourceType: string;
    sourcePublicId: string;
    canonicalPublicId: string;
  },
): Promise<void> {
  const row = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(
    input.tenantId,
    input.entityType,
    input.sourceType,
    input.sourcePublicId,
  ).first<MappingRow>();
  if (!row) return;
  if (row.mapping_status !== 'mapped' || row.canonical_public_id !== input.canonicalPublicId) {
    throw new Error(`${input.entityType} source mapping belongs to another canonical resource`);
  }
  throw new Error(`${input.entityType} source mapping already exists without replay evidence`);
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'admission' | 'bed_stay';
    canonicalPublicId: string;
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
    ) VALUES (?,?,?,?,?,?,'mapped',1,NULL,?,?,?)
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

function admissionStatusEventStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    admissionPublicId: string;
    eventType: string;
    fromStatus: string | null;
    toStatus: string;
    sequence: number;
    reasonCode: string | null;
    actorUserPublicId: string | null;
    actorSystemKey: string | null;
    idempotencyKey: string;
    sourceEvidenceSha256: string;
    occurredAtUtc: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_admission_status_events (
      tenant_id,event_public_id,admission_public_id,event_type,from_status,to_status,
      sequence,reason_code,safe_note,actor_user_public_id,actor_system_key,
      idempotency_key,source_evidence_sha256,occurred_at_utc,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.eventPublicId,
    input.admissionPublicId,
    input.eventType,
    input.fromStatus,
    input.toStatus,
    input.sequence,
    input.reasonCode,
    input.actorUserPublicId,
    input.actorSystemKey,
    input.idempotencyKey,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

export async function admitPatientAndClaimBed(
  db: CanonicalBatchDatabase,
  input: AdmitPatientAndClaimBedInput,
  options: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<AdmitPatientAndClaimBedResult>> {
  const common = commandBase(input);
  const patientLinkPublicId = exact(input.patientLinkPublicId, 'patientLinkPublicId');
  const encounterPublicId = exact(input.encounterPublicId, 'encounterPublicId');
  const practitionerPublicId = optionalExact(input.admittingPractitionerPublicId, 'admittingPractitionerPublicId');
  const admissionNumber = exact(input.admissionNumber, 'admissionNumber');
  const resolvedAdmissionType = admissionType(input.admissionType);
  const resolvedAdmissionSource = admissionSource(input.admissionSource);
  const admittedAtUtc = utc(input.admittedAtUtc, 'admittedAtUtc');
  const reasonCode = optionalExact(input.reasonCode, 'reasonCode');
  const bedPublicId = optionalExact(input.bedPublicId, 'bedPublicId');
  const expectedBedVersion = input.expectedBedVersion == null
    ? null
    : positive(input.expectedBedVersion, 'expectedBedVersion');
  if ((bedPublicId == null) !== (expectedBedVersion == null)) {
    throw new TypeError('bedPublicId and expectedBedVersion must be supplied together');
  }
  if (bedPublicId == null && input.bedStayPublicId != null) {
    throw new TypeError('bedStayPublicId requires bedPublicId');
  }
  const sourceType = exact(input.sourceType, 'sourceType');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(input.sourceTable, 'sourceTable');
  const evidence = sha256(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const admissionPublicId = await deterministicOrProvided(
    'admission', common.tenantId, sourceType, sourcePublicId, input.admissionPublicId, 'admissionPublicId',
  );
  const bedStayPublicId = bedPublicId == null
    ? null
    : await deterministicOrProvided(
      'bedstay',
      common.tenantId,
      sourceType,
      `${sourcePublicId}:bed-stay:${bedPublicId}`,
      input.bedStayPublicId,
      'bedStayPublicId',
    );
  const resolvedEventId = await commandEventId(common.tenantId, common.idempotencyKey, input.eventPublicId);
  const request = {
    admissionPublicId,
    bedStayPublicId,
    patientLinkPublicId,
    encounterPublicId,
    admittingPractitionerPublicId: practitionerPublicId,
    admissionNumber,
    admissionType: resolvedAdmissionType,
    admissionSource: resolvedAdmissionSource,
    admittedAtUtc,
    reasonCode,
    bedPublicId,
    expectedBedVersion,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256: evidence,
    actorUserPublicId: common.actorUserPublicId,
    actorSystemKey: common.actorSystemKey,
    occurredAtUtc: common.occurredAtUtc,
  };
  const replay = await readCanonicalCommandReplay<AdmitPatientAndClaimBedResult>(db, {
    tenantId: common.tenantId,
    commandName: ADMIT_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
  });
  if (replay) return replay;

  await requirePatientLink(db, common.tenantId, patientLinkPublicId);
  await requireInpatientEncounter(db, common.tenantId, encounterPublicId, patientLinkPublicId);
  await requirePractitioner(db, common.tenantId, practitionerPublicId);
  const activeAdmission = await db.prepare(`
    SELECT COUNT(*) AS count FROM canonical_admissions
    WHERE tenant_id=? AND encounter_public_id=?
      AND current_status IN ('planned','admitted','transfer_pending','discharge_pending')
  `).bind(common.tenantId, encounterPublicId).first<CountRow>();
  if (Number(activeAdmission?.count ?? 0) > 0) throw new Error('encounter already has an active admission');

  if (bedPublicId != null && expectedBedVersion != null) {
    const bed = await requireBed(db, common.tenantId, bedPublicId);
    if (Number(bed.version) !== expectedBedVersion) {
      throw new Error(`expectedBedVersion ${expectedBedVersion} does not match current bed version ${bed.version}`);
    }
    if (bed.operational_status !== 'active') throw new Error('admission requires an active bed');
    if (await openStayForBed(db, common.tenantId, bedPublicId)) throw new Error('bed already has an open stay and is occupied');
  }

  await requireSourceMappingAvailable(db, {
    tenantId: common.tenantId,
    entityType: 'admission',
    sourceType,
    sourcePublicId,
    canonicalPublicId: admissionPublicId,
  });
  if (bedStayPublicId != null && bedPublicId != null) {
    await requireSourceMappingAvailable(db, {
      tenantId: common.tenantId,
      entityType: 'bed_stay',
      sourceType,
      sourcePublicId: `${sourcePublicId}:bed-stay:${bedPublicId}`,
      canonicalPublicId: bedStayPublicId,
    });
  }

  const fingerprint = await createRequestFingerprint(request);
  const result: AdmitPatientAndClaimBedResult = {
    admissionPublicId,
    currentStatus: 'admitted',
    statusVersion: 1,
    bedStayPublicId,
  };
  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_admissions (
        tenant_id,admission_public_id,encounter_public_id,patient_link_public_id,
        admission_number,admission_type,admission_source,current_status,status_version,
        admitted_at_utc,discharged_at_utc,reason_code,safe_note,idempotency_key,
        request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,'admitted',1,?,NULL,?,NULL,?,?,?,?,?)
    `).bind(
      common.tenantId,
      admissionPublicId,
      encounterPublicId,
      patientLinkPublicId,
      admissionNumber,
      resolvedAdmissionType,
      resolvedAdmissionSource,
      admittedAtUtc,
      reasonCode,
      common.idempotencyKey,
      fingerprint,
      evidence,
      common.occurredAtUtc,
      common.occurredAtUtc,
    ),
    admissionStatusEventStatement(db, {
      tenantId: common.tenantId,
      eventPublicId: resolvedEventId,
      admissionPublicId,
      eventType: 'admitted',
      fromStatus: null,
      toStatus: 'admitted',
      sequence: 1,
      reasonCode,
      actorUserPublicId: common.actorUserPublicId,
      actorSystemKey: common.actorSystemKey,
      idempotencyKey: common.idempotencyKey,
      sourceEvidenceSha256: evidence,
      occurredAtUtc: common.occurredAtUtc,
    }),
  ];
  if (practitionerPublicId != null) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO canonical_encounter_participants (
        tenant_id,encounter_public_id,practitioner_public_id,participant_role,
        evidence_type,active_from_utc,active_to_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'admitting','approved_manual',?,NULL,?,?)
    `).bind(
      common.tenantId,
      encounterPublicId,
      practitionerPublicId,
      admittedAtUtc,
      common.occurredAtUtc,
      common.occurredAtUtc,
    ));
  }
  if (bedStayPublicId != null && bedPublicId != null) {
    statements.push(db.prepare(`
      INSERT INTO canonical_bed_stays (
        tenant_id,bed_stay_public_id,encounter_public_id,legacy_patient_bed_info_id,
        legacy_admission_id,legacy_bed_id,admission_public_id,bed_public_id,
        patient_link_public_id,started_at_utc,ended_at_utc,status,stay_version,
        movement_reason,source_command_key,close_reason,source_evidence_sha256,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,NULL,NULL,NULL,?,?,?, ?,NULL,'active',1,'admission',?,NULL,?,?,?)
    `).bind(
      common.tenantId,
      bedStayPublicId,
      encounterPublicId,
      admissionPublicId,
      bedPublicId,
      patientLinkPublicId,
      admittedAtUtc,
      common.idempotencyKey,
      evidence,
      common.occurredAtUtc,
      common.occurredAtUtc,
    ));
  }

  const reconciliationStatements: CanonicalPreparedStatement[] = [
    sourceMappingStatement(db, {
      tenantId: common.tenantId,
      entityType: 'admission',
      canonicalPublicId: admissionPublicId,
      sourceType,
      sourcePublicId,
      sourceTable,
      sourceEvidenceSha256: evidence,
      occurredAtUtc: common.occurredAtUtc,
    }),
  ];
  if (bedStayPublicId != null && bedPublicId != null) {
    reconciliationStatements.push(sourceMappingStatement(db, {
      tenantId: common.tenantId,
      entityType: 'bed_stay',
      canonicalPublicId: bedStayPublicId,
      sourceType,
      sourcePublicId: `${sourcePublicId}:bed-stay:${bedPublicId}`,
      sourceTable,
      sourceEvidenceSha256: evidence,
      occurredAtUtc: common.occurredAtUtc,
    }));
  }

  return runCanonicalBatch(db, {
    tenantId: common.tenantId,
    commandName: ADMIT_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
    authoritativeStatements: options.authoritativeStatements,
    statements,
    reconciliationStatements,
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_admission',
      aggregatePublicId: admissionPublicId,
      eventType: 'canonical.admission.admitted',
      occurredAtUtc: common.occurredAtUtc,
      businessDate: common.businessDate,
      payload: {
        admissionPublicId,
        encounterPublicId,
        currentStatus: 'admitted',
        statusVersion: 1,
        bedStayPublicId,
        bedPublicId,
      },
    },
  });
}

export async function transferAdmissionBed(
  db: CanonicalBatchDatabase,
  input: TransferAdmissionBedInput,
  options: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<TransferAdmissionBedResult>> {
  const common = commandBase(input);
  const admissionPublicId = exact(input.admissionPublicId, 'admissionPublicId');
  const expectedAdmissionVersion = positive(input.expectedAdmissionVersion, 'expectedAdmissionVersion');
  const currentStayPublicId = exact(input.currentStayPublicId, 'currentStayPublicId');
  const expectedCurrentStayVersion = positive(input.expectedCurrentStayVersion, 'expectedCurrentStayVersion');
  const destinationBedPublicId = exact(input.destinationBedPublicId, 'destinationBedPublicId');
  const expectedDestinationBedVersion = positive(input.expectedDestinationBedVersion, 'expectedDestinationBedVersion');
  const effectiveAtUtc = utc(input.effectiveAtUtc, 'effectiveAtUtc');
  const movementReason = transferReason(input.movementReason);
  const reasonCode = exact(input.reasonCode, 'reasonCode');
  const evidence = sha256(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const destinationStayPublicId = await deterministicOrProvided(
    'bedstay',
    common.tenantId,
    'admission_transfer',
    `${admissionPublicId}:${destinationBedPublicId}:${common.idempotencyKey}`,
    input.destinationStayPublicId,
    'destinationStayPublicId',
  );
  const resolvedEventId = await commandEventId(common.tenantId, common.idempotencyKey, input.eventPublicId);
  const request = {
    admissionPublicId,
    expectedAdmissionVersion,
    currentStayPublicId,
    expectedCurrentStayVersion,
    destinationBedPublicId,
    expectedDestinationBedVersion,
    destinationStayPublicId,
    effectiveAtUtc,
    movementReason,
    reasonCode,
    sourceEvidenceSha256: evidence,
    actorUserPublicId: common.actorUserPublicId,
    actorSystemKey: common.actorSystemKey,
  };
  const replay = await readCanonicalCommandReplay<TransferAdmissionBedResult>(db, {
    tenantId: common.tenantId,
    commandName: TRANSFER_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const admission = await requireAdmission(db, common.tenantId, admissionPublicId);
  if (Number(admission.status_version) !== expectedAdmissionVersion) {
    throw new Error(`expectedAdmissionVersion ${expectedAdmissionVersion} does not match current admission version ${admission.status_version}`);
  }
  if (admission.current_status !== 'admitted') {
    throw new Error(`admission cannot transfer in status: ${admission.current_status}`);
  }
  const currentStay = await requireStay(db, common.tenantId, currentStayPublicId);
  if (currentStay.admission_public_id !== admissionPublicId || currentStay.encounter_public_id !== admission.encounter_public_id) {
    throw new Error('current stay does not belong to admission');
  }
  if (currentStay.status !== 'active' || currentStay.ended_at_utc != null) throw new Error('current stay is not active');
  if (Number(currentStay.stay_version) !== expectedCurrentStayVersion) {
    throw new Error(`expectedCurrentStayVersion ${expectedCurrentStayVersion} does not match current stay version ${currentStay.stay_version}`);
  }
  if (Date.parse(effectiveAtUtc) < Date.parse(currentStay.started_at_utc)) {
    throw new RangeError('transfer cannot occur before the current stay started');
  }
  if (currentStay.bed_public_id === destinationBedPublicId) throw new Error('destination bed is already the active bed');
  const destinationBed = await requireBed(db, common.tenantId, destinationBedPublicId);
  if (Number(destinationBed.version) !== expectedDestinationBedVersion) {
    throw new Error(`expectedDestinationBedVersion ${expectedDestinationBedVersion} does not match destination bed version ${destinationBed.version}`);
  }
  if (destinationBed.operational_status !== 'active') throw new Error('destination requires an active bed');
  if (await openStayForBed(db, common.tenantId, destinationBedPublicId)) {
    throw new Error('destination bed already has an open stay and is occupied');
  }

  const nextAdmissionVersion = expectedAdmissionVersion + 1;
  const result: TransferAdmissionBedResult = {
    admissionPublicId,
    currentStatus: 'admitted',
    statusVersion: nextAdmissionVersion,
    previousStayPublicId: currentStayPublicId,
    activeStayPublicId: destinationStayPublicId,
  };
  return runCanonicalBatch(db, {
    tenantId: common.tenantId,
    commandName: TRANSFER_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
    authoritativeStatements: options.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_bed_stays
        SET ended_at_utc=?,status='completed',stay_version=?,close_reason='transfer',
            source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND bed_stay_public_id=? AND admission_public_id=?
          AND stay_version=? AND status='active' AND ended_at_utc IS NULL
      `).bind(
        effectiveAtUtc,
        expectedCurrentStayVersion + 1,
        evidence,
        common.occurredAtUtc,
        common.tenantId,
        currentStayPublicId,
        admissionPublicId,
        expectedCurrentStayVersion,
      ),
      db.prepare(`
        INSERT INTO canonical_bed_stays (
          tenant_id,bed_stay_public_id,encounter_public_id,legacy_patient_bed_info_id,
          legacy_admission_id,legacy_bed_id,admission_public_id,bed_public_id,
          patient_link_public_id,started_at_utc,ended_at_utc,status,stay_version,
          movement_reason,source_command_key,close_reason,source_evidence_sha256,
          created_at_utc,updated_at_utc
        ) VALUES (?,?,?,NULL,NULL,NULL,?,?,?, ?,NULL,'active',1,?,?,NULL,?,?,?)
      `).bind(
        common.tenantId,
        destinationStayPublicId,
        admission.encounter_public_id,
        admissionPublicId,
        destinationBedPublicId,
        admission.patient_link_public_id,
        effectiveAtUtc,
        movementReason,
        common.idempotencyKey,
        evidence,
        common.occurredAtUtc,
        common.occurredAtUtc,
      ),
      db.prepare(`
        UPDATE canonical_admissions
        SET status_version=?,reason_code=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND admission_public_id=? AND status_version=?
          AND current_status='admitted'
      `).bind(
        nextAdmissionVersion,
        reasonCode,
        evidence,
        common.occurredAtUtc,
        common.tenantId,
        admissionPublicId,
        expectedAdmissionVersion,
      ),
      admissionStatusEventStatement(db, {
        tenantId: common.tenantId,
        eventPublicId: resolvedEventId,
        admissionPublicId,
        eventType: 'transfer_received',
        fromStatus: 'admitted',
        toStatus: 'admitted',
        sequence: nextAdmissionVersion,
        reasonCode,
        actorUserPublicId: common.actorUserPublicId,
        actorSystemKey: common.actorSystemKey,
        idempotencyKey: common.idempotencyKey,
        sourceEvidenceSha256: evidence,
        occurredAtUtc: common.occurredAtUtc,
      }),
    ],
    reconciliationStatements: [
      sourceMappingStatement(db, {
        tenantId: common.tenantId,
        entityType: 'bed_stay',
        canonicalPublicId: destinationStayPublicId,
        sourceType: 'admission_transfer',
        sourcePublicId: common.idempotencyKey,
        sourceTable: 'canonical_admissions',
        sourceEvidenceSha256: evidence,
        occurredAtUtc: common.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_admission',
      aggregatePublicId: admissionPublicId,
      eventType: 'canonical.admission.bed-transferred',
      eventVersion: nextAdmissionVersion,
      occurredAtUtc: common.occurredAtUtc,
      businessDate: common.businessDate,
      payload: {
        admissionPublicId,
        currentStatus: 'admitted',
        statusVersion: nextAdmissionVersion,
        previousStayPublicId: currentStayPublicId,
        activeStayPublicId: destinationStayPublicId,
        destinationBedPublicId,
      },
    },
  });
}

export async function dischargeOrCancelAdmission(
  db: CanonicalBatchDatabase,
  input: DischargeOrCancelAdmissionInput,
  options: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<DischargeOrCancelAdmissionResult>> {
  const common = commandBase(input);
  const admissionPublicId = exact(input.admissionPublicId, 'admissionPublicId');
  const expectedAdmissionVersion = positive(input.expectedAdmissionVersion, 'expectedAdmissionVersion');
  const targetStatus = terminalStatus(input.targetStatus);
  const reasonCode = exact(input.reasonCode, 'reasonCode');
  const expectedStayPublicId = optionalExact(input.expectedActiveStayPublicId, 'expectedActiveStayPublicId');
  const expectedStayVersion = input.expectedActiveStayVersion == null
    ? null
    : positive(input.expectedActiveStayVersion, 'expectedActiveStayVersion');
  if ((expectedStayPublicId == null) !== (expectedStayVersion == null)) {
    throw new TypeError('expectedActiveStayPublicId and expectedActiveStayVersion must be supplied together');
  }
  const evidence = sha256(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const resolvedEventId = await commandEventId(common.tenantId, common.idempotencyKey, input.eventPublicId);
  const request = {
    admissionPublicId,
    expectedAdmissionVersion,
    targetStatus,
    reasonCode,
    expectedActiveStayPublicId: expectedStayPublicId,
    expectedActiveStayVersion: expectedStayVersion,
    sourceEvidenceSha256: evidence,
    actorUserPublicId: common.actorUserPublicId,
    actorSystemKey: common.actorSystemKey,
    occurredAtUtc: common.occurredAtUtc,
  };
  const replay = await readCanonicalCommandReplay<DischargeOrCancelAdmissionResult>(db, {
    tenantId: common.tenantId,
    commandName: TERMINAL_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const admission = await requireAdmission(db, common.tenantId, admissionPublicId);
  if (Number(admission.status_version) !== expectedAdmissionVersion) {
    throw new Error(`expectedAdmissionVersion ${expectedAdmissionVersion} does not match current admission version ${admission.status_version}`);
  }
  if (!['planned', 'admitted', 'transfer_pending', 'discharge_pending'].includes(admission.current_status)) {
    throw new Error(`admission is already terminal or cannot transition from status: ${admission.current_status}`);
  }
  if (Date.parse(common.occurredAtUtc) < Date.parse(admission.admitted_at_utc)) {
    throw new RangeError('admission terminal transition cannot occur before admission');
  }
  const activeStay = await openStayForAdmission(db, common.tenantId, admissionPublicId);
  if (expectedStayPublicId != null && expectedStayVersion != null) {
    if (!activeStay) throw new Error('expected active stay is missing');
    if (activeStay.bed_stay_public_id !== expectedStayPublicId) {
      throw new Error('expected active stay does not match admission occupancy');
    }
    if (Number(activeStay.stay_version) !== expectedStayVersion) {
      throw new Error(`expectedActiveStayVersion ${expectedStayVersion} does not match current stay version ${activeStay.stay_version}`);
    }
  } else if (activeStay) {
    throw new Error('active stay exists; exact expected stay evidence is required');
  }

  const nextAdmissionVersion = expectedAdmissionVersion + 1;
  const closedStayPublicId = activeStay?.bed_stay_public_id ?? null;
  const result: DischargeOrCancelAdmissionResult = {
    admissionPublicId,
    currentStatus: targetStatus,
    statusVersion: nextAdmissionVersion,
    closedStayPublicId,
  };
  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      UPDATE canonical_admissions
      SET current_status=?,status_version=?,discharged_at_utc=?,reason_code=?,
          source_evidence_sha256=?,updated_at_utc=?
      WHERE tenant_id=? AND admission_public_id=? AND status_version=?
        AND current_status IN ('planned','admitted','transfer_pending','discharge_pending')
    `).bind(
      targetStatus,
      nextAdmissionVersion,
      targetStatus === 'discharged' ? common.occurredAtUtc : null,
      reasonCode,
      evidence,
      common.occurredAtUtc,
      common.tenantId,
      admissionPublicId,
      expectedAdmissionVersion,
    ),
  ];
  if (activeStay) {
    const invalid = targetStatus === 'entered_in_error';
    statements.push(db.prepare(`
      UPDATE canonical_bed_stays
      SET ended_at_utc=?,status=?,stay_version=?,close_reason=?,
          source_evidence_sha256=?,updated_at_utc=?
      WHERE tenant_id=? AND bed_stay_public_id=? AND admission_public_id=?
        AND stay_version=? AND status='active' AND ended_at_utc IS NULL
    `).bind(
      common.occurredAtUtc,
      invalid ? 'invalid' : 'completed',
      Number(activeStay.stay_version) + 1,
      invalid ? reasonCode : targetStatus === 'discharged' ? 'discharge' : 'cancellation',
      evidence,
      common.occurredAtUtc,
      common.tenantId,
      activeStay.bed_stay_public_id,
      admissionPublicId,
      activeStay.stay_version,
    ));
  }
  statements.push(admissionStatusEventStatement(db, {
    tenantId: common.tenantId,
    eventPublicId: resolvedEventId,
    admissionPublicId,
    eventType: targetStatus,
    fromStatus: admission.current_status,
    toStatus: targetStatus,
    sequence: nextAdmissionVersion,
    reasonCode,
    actorUserPublicId: common.actorUserPublicId,
    actorSystemKey: common.actorSystemKey,
    idempotencyKey: common.idempotencyKey,
    sourceEvidenceSha256: evidence,
    occurredAtUtc: common.occurredAtUtc,
  }));

  return runCanonicalBatch(db, {
    tenantId: common.tenantId,
    commandName: TERMINAL_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
    authoritativeStatements: options.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_admission',
      aggregatePublicId: admissionPublicId,
      eventType: `canonical.admission.${targetStatus}`,
      eventVersion: nextAdmissionVersion,
      occurredAtUtc: common.occurredAtUtc,
      businessDate: common.businessDate,
      payload: result,
    },
  });
}
