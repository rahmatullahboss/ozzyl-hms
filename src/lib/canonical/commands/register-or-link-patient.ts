import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { stableCanonicalJson } from '../idempotency';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../source-mapping';
import { toUtcIso } from '../time';

export type PatientLinkStatus =
  | 'unlinked'
  | 'candidate'
  | 'verified'
  | 'rejected'
  | 'merged'
  | 'retired';

export type PatientLinkVerificationLevel =
  | 'unverified'
  | 'candidate'
  | 'reviewed'
  | 'verified';

export type PatientLinkEvidenceType =
  | 'no_link_placeholder'
  | 'ambiguous_candidate'
  | 'unique_uhid'
  | 'authenticated_claim'
  | 'verified_national_identity'
  | 'reviewed_manual'
  | 'migration_evidence';

export type PatientLinkEventType =
  | 'registered'
  | 'candidate_detected'
  | 'verified_linked'
  | 'link_rejected'
  | 'unlinked'
  | 'merged'
  | 'unmerged'
  | 'retired';

export interface RegisterOrLinkPatientInput {
  tenantId: string;
  patientLinkPublicId?: string;
  legacyPatientId: number;
  globalPatientUhid: string | null;
  linkStatus: PatientLinkStatus;
  verificationLevel: PatientLinkVerificationLevel;
  evidenceType: PatientLinkEvidenceType;
  evidenceSha256: string;
  effectiveAtUtc: string;
  eventType: PatientLinkEventType;
  reasonCode: string;
  actorUserId?: number | null;
  actorSystemKey?: string | null;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  idempotencyKey: string;
  eventPublicId?: string;
  businessDate: string;
  expectedVersion?: number | null;
  issuePublicId?: string | null;
  issueFingerprint?: string | null;
  sourceLegacyPatientId?: number | null;
  targetLegacyPatientId?: number | null;
}

export interface RegisterOrLinkPatientResult {
  patientLinkPublicId: string;
  linkStatus: PatientLinkStatus;
  version: number;
}

type CurrentLinkRow = {
  patient_link_public_id: string;
  link_status: PatientLinkStatus;
  version: number;
};

type CurrentMappingRow = {
  canonical_public_id: string | null;
  mapping_status: string;
};

const COMMAND_NAME = 'canonical.patient-link.register-or-link';
const EXACT_VERIFIED_EVIDENCE = new Set<PatientLinkEvidenceType>([
  'unique_uhid',
  'authenticated_claim',
  'verified_national_identity',
  'reviewed_manual',
]);
const LINK_STATUSES = new Set<PatientLinkStatus>([
  'unlinked',
  'candidate',
  'verified',
  'rejected',
  'merged',
  'retired',
]);
const VERIFICATION_LEVELS = new Set<PatientLinkVerificationLevel>([
  'unverified',
  'candidate',
  'reviewed',
  'verified',
]);
const EVIDENCE_TYPES = new Set<PatientLinkEvidenceType>([
  'no_link_placeholder',
  'ambiguous_candidate',
  'unique_uhid',
  'authenticated_claim',
  'verified_national_identity',
  'reviewed_manual',
  'migration_evidence',
]);
const EVENT_TYPES = new Set<PatientLinkEventType>([
  'registered',
  'candidate_detected',
  'verified_linked',
  'link_rejected',
  'unlinked',
  'merged',
  'unmerged',
  'retired',
]);

function requireExactString(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function optionalExactString(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return requireExactString(value, label);
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function requireSha256(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new TypeError(`${label} must be a 64-character SHA-256 hex string`);
  return value.toLowerCase();
}

function requireNormalizedUtc(value: string, label: string): string {
  let normalized: string;
  try {
    normalized = toUtcIso(value);
  } catch (error) {
    throw new RangeError(`${label} must be a normalized UTC ISO timestamp`, { cause: error });
  }
  if (normalized !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

function requireBusinessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('businessDate must use YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
  return value;
}

function expectedStatusForEvent(eventType: PatientLinkEventType): PatientLinkStatus | null {
  switch (eventType) {
    case 'registered': return 'unlinked';
    case 'candidate_detected': return 'candidate';
    case 'verified_linked': return 'verified';
    case 'link_rejected': return 'rejected';
    case 'unlinked': return 'unlinked';
    case 'merged': return 'merged';
    case 'unmerged': return null;
    case 'retired': return 'retired';
  }
}

type ResolvedRegisterOrLinkPatientInput = Omit<
  RegisterOrLinkPatientInput,
  'patientLinkPublicId' | 'eventPublicId'
> & {
  patientLinkPublicId: string;
  eventPublicId: string;
};

async function resolveDeterministicIdentifiers(
  input: RegisterOrLinkPatientInput,
): Promise<ResolvedRegisterOrLinkPatientInput> {
  const tenantId = requireExactString(input.tenantId, 'tenantId');
  const sourceType = requireExactString(input.sourceType, 'sourceType');
  const sourcePublicId = requireExactString(input.sourcePublicId, 'sourcePublicId');
  const idempotencyKey = requireExactString(input.idempotencyKey, 'idempotencyKey');
  const patientLinkPublicId = input.patientLinkPublicId
    ?? await createDeterministicSourceId('ptlink', tenantId, sourceType, sourcePublicId);
  const eventPublicId = input.eventPublicId
    ?? await createDeterministicSourceId('ptlevt', tenantId, 'patient_link_event', idempotencyKey);
  let issuePublicId = input.issuePublicId ?? null;
  let issueFingerprint = input.issueFingerprint ?? null;
  if (input.linkStatus === 'candidate') {
    issuePublicId ??= await createDeterministicSourceId(
      'ptlissue',
      tenantId,
      'patient_link_issue',
      `${sourceType}:${sourcePublicId}`,
    );
    issueFingerprint ??= await createSourceEvidenceSha256({
      tenantId,
      sourceType,
      sourcePublicId,
      reasonCode: input.reasonCode,
      evidenceSha256: input.evidenceSha256,
    });
  }
  return {
    ...input,
    tenantId,
    sourceType,
    sourcePublicId,
    idempotencyKey,
    patientLinkPublicId,
    eventPublicId,
    issuePublicId,
    issueFingerprint,
  };
}

function validateInput(input: ResolvedRegisterOrLinkPatientInput): Required<Omit<RegisterOrLinkPatientInput,
  'expectedVersion' | 'actorUserId' | 'actorSystemKey' | 'issuePublicId' | 'issueFingerprint'
  | 'sourceLegacyPatientId' | 'targetLegacyPatientId'>> & {
    expectedVersion: number | null;
    actorUserId: number | null;
    actorSystemKey: string | null;
    issuePublicId: string | null;
    issueFingerprint: string | null;
    sourceLegacyPatientId: number | null;
    targetLegacyPatientId: number | null;
  } {
  const tenantId = requireExactString(input.tenantId, 'tenantId');
  const patientLinkPublicId = requireExactString(input.patientLinkPublicId, 'patientLinkPublicId');
  const legacyPatientId = requirePositiveInteger(input.legacyPatientId, 'legacyPatientId');
  const globalPatientUhid = optionalExactString(input.globalPatientUhid, 'globalPatientUhid');
  if (!LINK_STATUSES.has(input.linkStatus)) throw new TypeError('linkStatus is not supported');
  if (!VERIFICATION_LEVELS.has(input.verificationLevel)) throw new TypeError('verificationLevel is not supported');
  if (!EVIDENCE_TYPES.has(input.evidenceType)) throw new TypeError('evidenceType is not supported');
  if (!EVENT_TYPES.has(input.eventType)) throw new TypeError('eventType is not supported');
  const evidenceSha256 = requireSha256(input.evidenceSha256, 'evidenceSha256');
  const effectiveAtUtc = requireNormalizedUtc(input.effectiveAtUtc, 'effectiveAtUtc');
  const reasonCode = requireExactString(input.reasonCode, 'reasonCode');
  const sourceType = requireExactString(input.sourceType, 'sourceType');
  const sourcePublicId = requireExactString(input.sourcePublicId, 'sourcePublicId');
  const sourceTable = requireExactString(input.sourceTable, 'sourceTable');
  const idempotencyKey = requireExactString(input.idempotencyKey, 'idempotencyKey');
  const eventPublicId = requireExactString(input.eventPublicId, 'eventPublicId');
  const businessDate = requireBusinessDate(input.businessDate);
  const actorUserId = input.actorUserId == null ? null : requirePositiveInteger(input.actorUserId, 'actorUserId');
  const actorSystemKey = optionalExactString(input.actorSystemKey, 'actorSystemKey');
  if (actorUserId == null && actorSystemKey == null) throw new TypeError('actor requires actorUserId or actorSystemKey');
  const expectedVersion = input.expectedVersion == null
    ? null
    : requirePositiveInteger(input.expectedVersion, 'expectedVersion');
  const issuePublicId = optionalExactString(input.issuePublicId, 'issuePublicId');
  const issueFingerprint = input.issueFingerprint == null
    ? null
    : requireSha256(input.issueFingerprint, 'issueFingerprint');
  const sourceLegacyPatientId = input.sourceLegacyPatientId == null
    ? null
    : requirePositiveInteger(input.sourceLegacyPatientId, 'sourceLegacyPatientId');
  const targetLegacyPatientId = input.targetLegacyPatientId == null
    ? null
    : requirePositiveInteger(input.targetLegacyPatientId, 'targetLegacyPatientId');

  if (input.linkStatus === 'verified') {
    if (!globalPatientUhid) throw new TypeError('verified linkStatus requires globalPatientUhid');
    if (input.verificationLevel !== 'verified') throw new TypeError('verified linkStatus requires verified verificationLevel');
    if (!EXACT_VERIFIED_EVIDENCE.has(input.evidenceType)) {
      throw new TypeError('evidenceType is not allowed for a verified patient link');
    }
  } else if (input.linkStatus === 'candidate') {
    if (globalPatientUhid != null) throw new TypeError('candidate linkStatus cannot claim globalPatientUhid');
    if (input.verificationLevel !== 'candidate' || input.evidenceType !== 'ambiguous_candidate') {
      throw new TypeError('candidate linkStatus requires candidate verification and ambiguous evidenceType');
    }
    if (!issuePublicId || !issueFingerprint) {
      throw new TypeError('candidate linkStatus requires issuePublicId and issueFingerprint');
    }
  } else if (input.linkStatus === 'unlinked') {
    if (globalPatientUhid != null) throw new TypeError('unlinked linkStatus cannot claim globalPatientUhid');
    if (input.verificationLevel !== 'unverified' || input.evidenceType !== 'no_link_placeholder') {
      throw new TypeError('unlinked linkStatus requires unverified verification and no-link evidenceType');
    }
  } else if (globalPatientUhid != null && input.linkStatus !== 'merged') {
    throw new TypeError(`${input.linkStatus} linkStatus cannot claim globalPatientUhid`);
  }

  const expectedStatus = expectedStatusForEvent(input.eventType);
  if (expectedStatus && expectedStatus !== input.linkStatus) {
    throw new TypeError(`eventType ${input.eventType} does not lead to linkStatus ${input.linkStatus}`);
  }
  if (input.eventType === 'merged' || input.eventType === 'unmerged') {
    if (!sourceLegacyPatientId || !targetLegacyPatientId || sourceLegacyPatientId === targetLegacyPatientId) {
      throw new TypeError(`${input.eventType} requires distinct sourceLegacyPatientId and targetLegacyPatientId`);
    }
  }

  return {
    tenantId,
    patientLinkPublicId,
    legacyPatientId,
    globalPatientUhid,
    linkStatus: input.linkStatus,
    verificationLevel: input.verificationLevel,
    evidenceType: input.evidenceType,
    evidenceSha256,
    effectiveAtUtc,
    eventType: input.eventType,
    reasonCode,
    actorUserId,
    actorSystemKey,
    sourceType,
    sourcePublicId,
    sourceTable,
    idempotencyKey,
    eventPublicId,
    businessDate,
    expectedVersion,
    issuePublicId,
    issueFingerprint,
    sourceLegacyPatientId,
    targetLegacyPatientId,
  };
}

function buildRequest(input: ReturnType<typeof validateInput>): Record<string, unknown> {
  return {
    tenantId: input.tenantId,
    patientLinkPublicId: input.patientLinkPublicId,
    legacyPatientId: input.legacyPatientId,
    globalPatientUhid: input.globalPatientUhid,
    linkStatus: input.linkStatus,
    verificationLevel: input.verificationLevel,
    evidenceType: input.evidenceType,
    evidenceSha256: input.evidenceSha256,
    eventType: input.eventType,
    reasonCode: input.reasonCode,
    actorUserId: input.actorUserId,
    actorSystemKey: input.actorSystemKey,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    idempotencyKey: input.idempotencyKey,
    eventPublicId: input.eventPublicId,
    expectedVersion: input.expectedVersion,
    issuePublicId: input.issuePublicId,
    issueFingerprint: input.issueFingerprint,
    sourceLegacyPatientId: input.sourceLegacyPatientId,
    targetLegacyPatientId: input.targetLegacyPatientId,
  };
}

function linkInsertStatement(
  db: CanonicalBatchDatabase,
  input: ReturnType<typeof validateInput>,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,global_patient_uhid,
      link_status,verification_level,evidence_type,evidence_sha256,
      effective_from_utc,effective_to_utc,version,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,NULL,1,?,?)
  `).bind(
    input.tenantId,
    input.patientLinkPublicId,
    input.legacyPatientId,
    input.globalPatientUhid,
    input.linkStatus,
    input.verificationLevel,
    input.evidenceType,
    input.evidenceSha256,
    input.effectiveAtUtc,
    input.effectiveAtUtc,
    input.effectiveAtUtc,
  );
}

function linkUpdateStatement(
  db: CanonicalBatchDatabase,
  input: ReturnType<typeof validateInput>,
  currentVersion: number,
): CanonicalPreparedStatement {
  return db.prepare(`
    UPDATE canonical_tenant_patient_links
    SET global_patient_uhid=?,
        link_status=?,
        verification_level=?,
        evidence_type=?,
        evidence_sha256=?,
        effective_from_utc=?,
        effective_to_utc=NULL,
        version=version+1,
        updated_at_utc=?
    WHERE tenant_id=?
      AND patient_link_public_id=?
      AND legacy_patient_id=?
      AND version=?
  `).bind(
    input.globalPatientUhid,
    input.linkStatus,
    input.verificationLevel,
    input.evidenceType,
    input.evidenceSha256,
    input.effectiveAtUtc,
    input.effectiveAtUtc,
    input.tenantId,
    input.patientLinkPublicId,
    input.legacyPatientId,
    currentVersion,
  );
}

function eventStatement(
  db: CanonicalBatchDatabase,
  input: ReturnType<typeof validateInput>,
  fromStatus: PatientLinkStatus | null,
  nextVersion: number,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_tenant_patient_link_events (
      tenant_id,event_public_id,patient_link_public_id,legacy_patient_id,global_patient_uhid,
      event_type,from_status,to_status,source_legacy_patient_id,target_legacy_patient_id,
      actor_user_id,actor_system_key,reason_code,evidence_type,evidence_sha256,
      idempotency_key,sequence,occurred_at_utc,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
      CASE WHEN EXISTS (
        SELECT 1 FROM canonical_tenant_patient_links
        WHERE tenant_id=? AND patient_link_public_id=? AND legacy_patient_id=? AND version=?
      ) THEN ? ELSE 0 END,
      ?,?
    )
  `).bind(
    input.tenantId,
    input.eventPublicId,
    input.patientLinkPublicId,
    input.legacyPatientId,
    input.globalPatientUhid,
    input.eventType,
    fromStatus,
    input.linkStatus,
    input.sourceLegacyPatientId,
    input.targetLegacyPatientId,
    input.actorUserId,
    input.actorSystemKey,
    input.reasonCode,
    input.evidenceType,
    input.evidenceSha256,
    input.idempotencyKey,
    input.tenantId,
    input.patientLinkPublicId,
    input.legacyPatientId,
    nextVersion,
    nextVersion,
    input.effectiveAtUtc,
    input.effectiveAtUtc,
  );
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: ReturnType<typeof validateInput>,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?, 'patient_link', ?, ?, ?, ?, 'mapped', 1, NULL, ?, ?, ?)
  `).bind(
    input.tenantId,
    input.patientLinkPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.evidenceSha256,
    input.effectiveAtUtc,
    input.effectiveAtUtc,
  );
}

function ambiguityIssueStatement(
  db: CanonicalBatchDatabase,
  input: ReturnType<typeof validateInput>,
): CanonicalPreparedStatement | null {
  if (input.linkStatus !== 'candidate' || !input.issuePublicId || !input.issueFingerprint) return null;
  const detailsJson = stableCanonicalJson({
    reasonCode: input.reasonCode,
    evidenceType: input.evidenceType,
    candidateOnly: true,
  });
  return db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,reconciliation_run_id,
      issue_type,issue_code,entity_type,entity_public_id,source_type,source_public_id,
      fingerprint,severity,status,occurrence_count,summary,details_json,
      first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?, ?, NULL, NULL,
      'identity_resolution', 'PATIENT_IDENTITY_AMBIGUOUS', 'patient_link', ?, ?, ?,
      ?, 'warning', 'open', 1, 'Patient identity evidence requires review', ?, ?, ?, ?, ?
    )
  `).bind(
    input.tenantId,
    input.issuePublicId,
    input.patientLinkPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.issueFingerprint,
    detailsJson,
    input.effectiveAtUtc,
    input.effectiveAtUtc,
    input.effectiveAtUtc,
    input.effectiveAtUtc,
  );
}

export async function registerOrLinkPatient(
  db: CanonicalBatchDatabase,
  rawInput: RegisterOrLinkPatientInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<RegisterOrLinkPatientResult>> {
  const input = validateInput(await resolveDeterministicIdentifiers(rawInput));
  const request = buildRequest(input);
  const replay = await readCanonicalCommandReplay<RegisterOrLinkPatientResult>(db, {
    tenantId: input.tenantId,
    commandName: COMMAND_NAME,
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const current = await db.prepare(`
    SELECT patient_link_public_id,link_status,version
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND legacy_patient_id=?
    LIMIT 1
  `).bind(input.tenantId, input.legacyPatientId).first<CurrentLinkRow>();

  if (current) {
    if (current.patient_link_public_id !== input.patientLinkPublicId) {
      throw new Error('legacyPatientId already belongs to another patientLinkPublicId');
    }
    if (input.expectedVersion == null) throw new TypeError('expectedVersion is required when updating an existing patient link');
    if (Number(current.version) !== input.expectedVersion) {
      throw new Error(`expectedVersion ${input.expectedVersion} does not match current version ${current.version}`);
    }
  } else if (input.expectedVersion != null) {
    throw new Error('expectedVersion cannot be supplied when creating a patient link');
  }

  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='patient_link' AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.sourceType, input.sourcePublicId).first<CurrentMappingRow>();
  if (mapping && (mapping.mapping_status !== 'mapped' || mapping.canonical_public_id !== input.patientLinkPublicId)) {
    throw new Error('patient source mapping already belongs to another canonical identity');
  }

  const nextVersion = current ? Number(current.version) + 1 : 1;
  const authoritativeStatements = [
    current
      ? linkUpdateStatement(db, input, Number(current.version))
      : linkInsertStatement(db, input),
  ];
  const statements: CanonicalPreparedStatement[] = [
    eventStatement(db, input, current?.link_status ?? null, nextVersion),
  ];
  if (!mapping) statements.push(sourceMappingStatement(db, input));
  const issueStatement = ambiguityIssueStatement(db, input);
  if (issueStatement) statements.push(issueStatement);

  const result: RegisterOrLinkPatientResult = {
    patientLinkPublicId: input.patientLinkPublicId,
    linkStatus: input.linkStatus,
    version: nextVersion,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: COMMAND_NAME,
    idempotencyKey: input.idempotencyKey,
    request,
    authoritativeStatements: [
      ...(execution.authoritativeStatements ?? []),
      ...authoritativeStatements,
    ],
    statements,
    result,
    event: {
      eventPublicId: input.eventPublicId,
      aggregateType: 'canonical_patient_link',
      aggregatePublicId: input.patientLinkPublicId,
      eventType: `canonical.patient-link.${input.eventType}`,
      eventVersion: nextVersion,
      occurredAtUtc: input.effectiveAtUtc,
      businessDate: input.businessDate,
      payload: {
        patientLinkPublicId: input.patientLinkPublicId,
        linkStatus: input.linkStatus,
        verificationLevel: input.verificationLevel,
        evidenceType: input.evidenceType,
        version: nextVersion,
      },
    },
  });
}
