import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import {
  createDeterministicSourceId,
  normalizeIdentityText,
  normalizeRegistrationNumber,
} from '../source-mapping';
import { toUtcIso } from '../time';

export type PractitionerKind = 'internal' | 'external';
export type PractitionerStatus = 'active' | 'inactive' | 'unknown';
export type PractitionerLinkStatus = 'active' | 'rejected' | 'retired';
export type PractitionerIdentifierSystem = 'bmdc' | 'employee_code' | 'other';
export type PractitionerIdentifierStatus = 'unverified' | 'verified' | 'rejected' | 'retired';
export type PractitionerClassificationType = 'specialty' | 'department';

export interface PractitionerIdentifierInput {
  system: PractitionerIdentifierSystem;
  issuerKey: string;
  value: string;
  displayValue: string;
  verificationStatus: PractitionerIdentifierStatus;
}

export interface PractitionerUserLinkInput {
  legacyUserId: number;
  evidenceType: 'legacy_doctor_user_id' | 'approved_manual';
  linkStatus?: PractitionerLinkStatus;
}

export interface PractitionerEmployeeLinkInput {
  legacyStaffId: number;
  evidenceType: 'shared_explicit_user_id' | 'approved_manual';
}

export interface PractitionerClassificationInput {
  normalizedKey: string;
  displayText: string;
  isPrimary: boolean;
}

interface PractitionerCommandBase {
  tenantId: string;
  idempotencyKey: string;
  eventPublicId?: string;
  occurredAtUtc: string;
  businessDate: string;
}

export interface CreatePractitionerInput extends PractitionerCommandBase {
  practitionerPublicId?: string;
  practitionerKind: PractitionerKind;
  displayName: string;
  status?: PractitionerStatus;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  identifier?: PractitionerIdentifierInput;
  userLink?: PractitionerUserLinkInput;
  employeeLink?: PractitionerEmployeeLinkInput;
  specialty?: PractitionerClassificationInput;
  department?: PractitionerClassificationInput;
}

export interface CreatePractitionerResult {
  practitionerPublicId: string;
  practitionerKind: PractitionerKind;
  status: PractitionerStatus;
  version: number;
}

export interface PractitionerUserLinkTransition extends PractitionerUserLinkInput {
  linkStatus: PractitionerLinkStatus;
}

export interface UpdateOrRetirePractitionerInput extends PractitionerCommandBase {
  practitionerPublicId: string;
  displayName?: string;
  status?: PractitionerStatus;
  expectedVersion: number;
  sourceEvidenceSha256: string;
  identifierUpdates?: PractitionerIdentifierInput[];
  userLink?: PractitionerUserLinkTransition;
  specialty?: PractitionerClassificationInput | null;
  department?: PractitionerClassificationInput | null;
}

export interface UpdateOrRetirePractitionerResult extends CreatePractitionerResult {}

export interface LinkOrUnlinkPractitionerUserInput extends PractitionerCommandBase {
  practitionerPublicId: string;
  legacyUserId: number;
  linkStatus: PractitionerLinkStatus;
  evidenceType: 'legacy_doctor_user_id' | 'approved_manual';
}

export interface LinkOrUnlinkPractitionerEmployeeInput extends PractitionerCommandBase {
  practitionerPublicId: string;
  legacyStaffId: number;
  linkStatus: PractitionerLinkStatus;
  evidenceType: 'shared_explicit_user_id' | 'approved_manual';
}

export interface PractitionerLinkResult {
  practitionerPublicId: string;
  linkType: 'user' | 'employee';
  linkStatus: PractitionerLinkStatus;
}

export interface ManagePractitionerIdentifierInput extends PractitionerCommandBase {
  practitionerPublicId: string;
  system: PractitionerIdentifierSystem;
  issuerKey: string;
  value: string;
  displayValue: string;
  verificationStatus: PractitionerIdentifierStatus;
}

export interface ManagePractitionerIdentifierResult {
  practitionerPublicId: string;
  identifierSystem: PractitionerIdentifierSystem;
  verificationStatus: PractitionerIdentifierStatus;
}

export interface AssignPractitionerClassificationInput extends PractitionerCommandBase {
  practitionerPublicId: string;
  classificationType: PractitionerClassificationType;
  normalizedKey: string;
  displayText: string;
  isPrimary: boolean;
}

export interface AssignPractitionerClassificationResult {
  practitionerPublicId: string;
  classificationType: PractitionerClassificationType;
  normalizedKey: string;
  isPrimary: boolean;
}

interface CurrentPractitionerRow {
  practitioner_kind: PractitionerKind;
  display_name: string;
  status: PractitionerStatus;
  version: number;
}

interface CurrentMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface CurrentUserLinkRow {
  practitioner_public_id: string;
  legacy_user_id: number;
  link_status: PractitionerLinkStatus;
}

interface CurrentEmployeeLinkRow {
  practitioner_public_id: string;
  legacy_staff_id: number;
  link_status: PractitionerLinkStatus;
}

interface CurrentIdentifierRow {
  practitioner_public_id: string;
  verification_status: PractitionerIdentifierStatus;
}

interface CurrentClassificationRow {
  practitioner_public_id: string;
}

const CREATE_COMMAND = 'canonical.practitioner.create';
const UPDATE_COMMAND = 'canonical.practitioner.update';
const USER_LINK_COMMAND = 'canonical.practitioner.user-link';
const EMPLOYEE_LINK_COMMAND = 'canonical.practitioner.employee-link';
const IDENTIFIER_COMMAND = 'canonical.practitioner.identifier';
const CLASSIFICATION_COMMAND = 'canonical.practitioner.classification';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function positive(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function hash(value: string, label: string): string {
  exact(value, label);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return value;
}

function utc(value: string): string {
  if (toUtcIso(value) !== value) throw new RangeError('occurredAtUtc must be a normalized UTC ISO timestamp');
  return value;
}

function kind(value: string): PractitionerKind {
  if (value !== 'internal' && value !== 'external') throw new RangeError('practitionerKind is invalid');
  return value;
}

function status(value: string): PractitionerStatus {
  if (value !== 'active' && value !== 'inactive' && value !== 'unknown') {
    throw new RangeError('practitioner status is invalid');
  }
  return value;
}

function linkStatus(value: string): PractitionerLinkStatus {
  if (value !== 'active' && value !== 'rejected' && value !== 'retired') {
    throw new RangeError('practitioner link status is invalid');
  }
  return value;
}

function identifierSystem(value: string): PractitionerIdentifierSystem {
  if (value !== 'bmdc' && value !== 'employee_code' && value !== 'other') {
    throw new RangeError('identifier system is invalid');
  }
  return value;
}

function identifierStatus(value: string): PractitionerIdentifierStatus {
  if (value !== 'unverified' && value !== 'verified' && value !== 'rejected' && value !== 'retired') {
    throw new RangeError('identifier verification status is invalid');
  }
  return value;
}

function classificationType(value: string): PractitionerClassificationType {
  if (value !== 'specialty' && value !== 'department') throw new RangeError('classification type is invalid');
  return value;
}

function normalizedClassificationKey(value: string): string {
  const exactValue = exact(value, 'normalizedKey');
  const normalized = normalizeIdentityText(exactValue);
  if (!normalized || normalized !== exactValue) {
    throw new TypeError('normalizedKey must already be normalized lowercase identity text');
  }
  return exactValue;
}

function normalizedIdentifierValue(value: string): string {
  const normalized = normalizeRegistrationNumber(exact(value, 'identifier value'));
  if (!normalized) throw new TypeError('identifier value cannot be empty');
  return normalized;
}

function base(input: PractitionerCommandBase) {
  return {
    tenantId: exact(input.tenantId, 'tenantId'),
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    occurredAtUtc: utc(input.occurredAtUtc),
    businessDate: exact(input.businessDate, 'businessDate'),
  };
}

async function eventId(
  tenantId: string,
  idempotencyKey: string,
  provided: string | undefined,
): Promise<string> {
  return provided == null
    ? createDeterministicSourceId('pracevt', tenantId, 'practitioner_command', idempotencyKey)
    : exact(provided, 'eventPublicId');
}

async function requirePractitioner(
  db: CanonicalBatchDatabase,
  tenantId: string,
  practitionerPublicId: string,
): Promise<CurrentPractitionerRow> {
  const current = await db.prepare(`
    SELECT practitioner_kind,display_name,status,version
    FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=?
    LIMIT 1
  `).bind(tenantId, practitionerPublicId).first<CurrentPractitionerRow>();
  if (!current) throw new Error('practitioner not found');
  return current;
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    practitionerPublicId: string;
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
    ) VALUES (?, 'practitioner', ?, ?, ?, ?, 'mapped', 1, NULL, ?, ?, ?)
  `).bind(
    input.tenantId,
    input.practitionerPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

function classificationStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    practitionerPublicId: string;
    classificationType: PractitionerClassificationType;
    normalizedKey: string;
    displayText: string;
    isPrimary: boolean;
    occurredAtUtc: string;
  },
): CanonicalPreparedStatement {
  const table = input.classificationType === 'specialty'
    ? 'canonical_practitioner_specialties'
    : 'canonical_practitioner_departments';
  return db.prepare(`
    INSERT INTO ${table} (
      tenant_id,practitioner_public_id,normalized_key,display_text,is_primary,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.practitionerPublicId,
    input.normalizedKey,
    input.displayText,
    input.isPrimary ? 1 : 0,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

export async function createPractitioner(
  db: CanonicalBatchDatabase,
  raw: CreatePractitionerInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CreatePractitionerResult>> {
  const common = base(raw);
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const practitionerPublicId = raw.practitionerPublicId == null
    ? await createDeterministicSourceId('pract', common.tenantId, sourceType, sourcePublicId)
    : exact(raw.practitionerPublicId, 'practitionerPublicId');
  const resolvedEventId = await eventId(common.tenantId, common.idempotencyKey, raw.eventPublicId);
  const practitionerKind = kind(raw.practitionerKind);
  const displayName = exact(raw.displayName, 'displayName');
  const practitionerStatus = status(raw.status ?? 'active');
  const sourceEvidenceSha256 = hash(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');

  const identifier = raw.identifier == null ? null : {
    system: identifierSystem(raw.identifier.system),
    issuerKey: exact(raw.identifier.issuerKey, 'issuerKey'),
    normalizedValue: normalizedIdentifierValue(raw.identifier.value),
    displayValue: exact(raw.identifier.displayValue, 'displayValue'),
    verificationStatus: identifierStatus(raw.identifier.verificationStatus),
  };
  const userLink = raw.userLink == null ? null : {
    legacyUserId: positive(raw.userLink.legacyUserId, 'legacyUserId'),
    evidenceType: raw.userLink.evidenceType,
    linkStatus: linkStatus(raw.userLink.linkStatus ?? 'active'),
  };
  if (userLink && userLink.evidenceType !== 'legacy_doctor_user_id' && userLink.evidenceType !== 'approved_manual') {
    throw new RangeError('user link evidence type is invalid');
  }
  if (userLink?.linkStatus === 'active' && practitionerStatus !== 'active') {
    throw new Error('active user link requires an active practitioner');
  }
  const employeeLink = raw.employeeLink == null ? null : {
    legacyStaffId: positive(raw.employeeLink.legacyStaffId, 'legacyStaffId'),
    evidenceType: raw.employeeLink.evidenceType,
  };
  if (employeeLink && employeeLink.evidenceType !== 'shared_explicit_user_id' && employeeLink.evidenceType !== 'approved_manual') {
    throw new RangeError('employee link evidence type is invalid');
  }
  const specialty = raw.specialty == null ? null : {
    normalizedKey: normalizedClassificationKey(raw.specialty.normalizedKey),
    displayText: exact(raw.specialty.displayText, 'specialty displayText'),
    isPrimary: Boolean(raw.specialty.isPrimary),
  };
  const department = raw.department == null ? null : {
    normalizedKey: normalizedClassificationKey(raw.department.normalizedKey),
    displayText: exact(raw.department.displayText, 'department displayText'),
    isPrimary: Boolean(raw.department.isPrimary),
  };

  const request = {
    practitionerPublicId,
    practitionerKind,
    displayName,
    status: practitionerStatus,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    identifier,
    userLink,
    employeeLink,
    specialty,
    department,
  };
  const replay = await readCanonicalCommandReplay<CreatePractitionerResult>(db, {
    tenantId: common.tenantId,
    commandName: CREATE_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const existing = await db.prepare(`
    SELECT practitioner_kind,display_name,status,version
    FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=?
    LIMIT 1
  `).bind(common.tenantId, practitionerPublicId).first<CurrentPractitionerRow>();
  if (existing) throw new Error('practitionerPublicId already exists');

  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='practitioner' AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(common.tenantId, sourceType, sourcePublicId).first<CurrentMappingRow>();
  if (mapping) {
    if (mapping.mapping_status !== 'mapped' || mapping.canonical_public_id !== practitionerPublicId) {
      throw new Error('practitioner source mapping already belongs to another practitioner');
    }
    throw new Error('practitioner source mapping already exists without replay evidence');
  }

  if (identifier) {
    const currentIdentifier = await db.prepare(`
      SELECT practitioner_public_id,verification_status
      FROM canonical_practitioner_identifiers
      WHERE tenant_id=? AND identifier_system=? AND issuer_key=? AND normalized_value=?
      LIMIT 1
    `).bind(
      common.tenantId,
      identifier.system,
      identifier.issuerKey,
      identifier.normalizedValue,
    ).first<CurrentIdentifierRow>();
    if (currentIdentifier && currentIdentifier.practitioner_public_id !== practitionerPublicId) {
      throw new Error('identifier already belongs to another practitioner');
    }
  }

  if (userLink) {
    const currentUserLink = await db.prepare(`
      SELECT practitioner_public_id,legacy_user_id,link_status
      FROM canonical_practitioner_user_links
      WHERE tenant_id=? AND (practitioner_public_id=? OR legacy_user_id=?)
      LIMIT 1
    `).bind(common.tenantId, practitionerPublicId, userLink.legacyUserId).first<CurrentUserLinkRow>();
    if (currentUserLink) throw new Error('user link already belongs to a practitioner');
  }
  if (employeeLink) {
    const currentEmployeeLink = await db.prepare(`
      SELECT practitioner_public_id,legacy_staff_id,link_status
      FROM canonical_practitioner_employee_links
      WHERE tenant_id=? AND (practitioner_public_id=? OR legacy_staff_id=?)
      LIMIT 1
    `).bind(common.tenantId, practitionerPublicId, employeeLink.legacyStaffId).first<CurrentEmployeeLinkRow>();
    if (currentEmployeeLink) throw new Error('employee link already belongs to a practitioner');
  }

  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
        version,source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,1,?,?,?)
    `).bind(
      common.tenantId,
      practitionerPublicId,
      practitionerKind,
      displayName,
      practitionerStatus,
      sourceEvidenceSha256,
      common.occurredAtUtc,
      common.occurredAtUtc,
    ),
  ];

  if (userLink) {
    statements.push(db.prepare(`
      INSERT INTO canonical_practitioner_user_links (
        tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?)
    `).bind(
      common.tenantId,
      practitionerPublicId,
      userLink.legacyUserId,
      userLink.linkStatus,
      userLink.evidenceType,
      common.occurredAtUtc,
      common.occurredAtUtc,
    ));
  }
  if (employeeLink) {
    statements.push(db.prepare(`
      INSERT INTO canonical_practitioner_employee_links (
        tenant_id,practitioner_public_id,legacy_staff_id,link_status,evidence_type,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?)
    `).bind(
      common.tenantId,
      practitionerPublicId,
      employeeLink.legacyStaffId,
      'active',
      employeeLink.evidenceType,
      common.occurredAtUtc,
      common.occurredAtUtc,
    ));
  }
  if (identifier) {
    statements.push(db.prepare(`
      INSERT INTO canonical_practitioner_identifiers (
        tenant_id,practitioner_public_id,identifier_system,issuer_key,normalized_value,
        display_value,verification_status,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      common.tenantId,
      practitionerPublicId,
      identifier.system,
      identifier.issuerKey,
      identifier.normalizedValue,
      identifier.displayValue,
      identifier.verificationStatus,
      common.occurredAtUtc,
      common.occurredAtUtc,
    ));
  }
  if (specialty) {
    statements.push(classificationStatement(db, {
      tenantId: common.tenantId,
      practitionerPublicId,
      classificationType: 'specialty',
      ...specialty,
      occurredAtUtc: common.occurredAtUtc,
    }));
  }
  if (department) {
    statements.push(classificationStatement(db, {
      tenantId: common.tenantId,
      practitionerPublicId,
      classificationType: 'department',
      ...department,
      occurredAtUtc: common.occurredAtUtc,
    }));
  }
  statements.push(sourceMappingStatement(db, {
    tenantId: common.tenantId,
    practitionerPublicId,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    occurredAtUtc: common.occurredAtUtc,
  }));

  const result: CreatePractitionerResult = {
    practitionerPublicId,
    practitionerKind,
    status: practitionerStatus,
    version: 1,
  };
  return runCanonicalBatch(db, {
    tenantId: common.tenantId,
    commandName: CREATE_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_practitioner',
      aggregatePublicId: practitionerPublicId,
      eventType: 'canonical.practitioner.created',
      eventVersion: 1,
      occurredAtUtc: common.occurredAtUtc,
      businessDate: common.businessDate,
      payload: result,
    },
  });
}

export async function updateOrRetirePractitioner(
  db: CanonicalBatchDatabase,
  raw: UpdateOrRetirePractitionerInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<UpdateOrRetirePractitionerResult>> {
  const common = base(raw);
  const practitionerPublicId = exact(raw.practitionerPublicId, 'practitionerPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const sourceEvidenceSha256 = hash(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const requestedDisplayName = raw.displayName == null ? null : exact(raw.displayName, 'displayName');
  const requestedStatus = raw.status == null ? null : status(raw.status);
  const identifierUpdates = (raw.identifierUpdates ?? []).map((identifier) => ({
    system: identifierSystem(identifier.system),
    issuerKey: exact(identifier.issuerKey, 'identifier issuerKey'),
    normalizedValue: normalizedIdentifierValue(identifier.value),
    displayValue: exact(identifier.displayValue, 'identifier displayValue'),
    verificationStatus: identifierStatus(identifier.verificationStatus),
  }));
  const identifierKeys = identifierUpdates.map((identifier) =>
    `${identifier.system}\u0000${identifier.issuerKey}\u0000${identifier.normalizedValue}`,
  );
  if (new Set(identifierKeys).size !== identifierKeys.length) {
    throw new Error('duplicate practitioner identifier update');
  }
  const requestedUserLink = raw.userLink == null ? null : {
    legacyUserId: positive(raw.userLink.legacyUserId, 'legacyUserId'),
    linkStatus: linkStatus(raw.userLink.linkStatus),
    evidenceType: raw.userLink.evidenceType,
  };
  if (requestedUserLink
    && requestedUserLink.evidenceType !== 'legacy_doctor_user_id'
    && requestedUserLink.evidenceType !== 'approved_manual') {
    throw new RangeError('user link evidence type is invalid');
  }
  const specialtyProvided = raw.specialty !== undefined;
  const departmentProvided = raw.department !== undefined;
  const specialty = raw.specialty == null ? null : {
    normalizedKey: normalizedClassificationKey(raw.specialty.normalizedKey),
    displayText: exact(raw.specialty.displayText, 'specialty displayText'),
    isPrimary: Boolean(raw.specialty.isPrimary),
  };
  const department = raw.department == null ? null : {
    normalizedKey: normalizedClassificationKey(raw.department.normalizedKey),
    displayText: exact(raw.department.displayText, 'department displayText'),
    isPrimary: Boolean(raw.department.isPrimary),
  };
  if (
    requestedDisplayName == null
    && requestedStatus == null
    && identifierUpdates.length === 0
    && requestedUserLink == null
    && !specialtyProvided
    && !departmentProvided
  ) {
    throw new TypeError('at least one practitioner identity change is required');
  }
  const resolvedEventId = await eventId(common.tenantId, common.idempotencyKey, raw.eventPublicId);
  const request = {
    practitionerPublicId,
    displayName: requestedDisplayName,
    status: requestedStatus,
    expectedVersion,
    sourceEvidenceSha256,
    identifierUpdates,
    userLink: requestedUserLink,
    specialtyProvided,
    specialty,
    departmentProvided,
    department,
  };
  const replay = await readCanonicalCommandReplay<UpdateOrRetirePractitionerResult>(db, {
    tenantId: common.tenantId,
    commandName: UPDATE_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const current = await requirePractitioner(db, common.tenantId, practitionerPublicId);
  if (Number(current.version) !== expectedVersion) {
    throw new Error(`expectedVersion ${expectedVersion} does not match current version ${current.version}`);
  }
  const nextDisplayName = requestedDisplayName ?? current.display_name;
  const nextStatus = requestedStatus ?? current.status;
  if ((specialtyProvided || departmentProvided) && nextStatus !== 'active') {
    throw new Error('classification changes require an active practitioner');
  }

  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      UPDATE canonical_practitioners
      SET display_name=?,status=?,version=version+1,source_evidence_sha256=?,updated_at_utc=?
      WHERE tenant_id=? AND practitioner_public_id=? AND version=?
    `).bind(
      nextDisplayName,
      nextStatus,
      sourceEvidenceSha256,
      common.occurredAtUtc,
      common.tenantId,
      practitionerPublicId,
      expectedVersion,
    ),
  ];

  for (const identifier of identifierUpdates) {
    const existingIdentifier = await db.prepare(`
      SELECT practitioner_public_id,verification_status
      FROM canonical_practitioner_identifiers
      WHERE tenant_id=? AND identifier_system=? AND issuer_key=? AND normalized_value=?
      LIMIT 1
    `).bind(
      common.tenantId,
      identifier.system,
      identifier.issuerKey,
      identifier.normalizedValue,
    ).first<CurrentIdentifierRow>();
    if (existingIdentifier && existingIdentifier.practitioner_public_id !== practitionerPublicId) {
      throw new Error('identifier already belongs to another practitioner');
    }
    statements.push(existingIdentifier
      ? db.prepare(`
          UPDATE canonical_practitioner_identifiers
          SET display_value=?,verification_status=?,updated_at_utc=?
          WHERE tenant_id=? AND practitioner_public_id=?
            AND identifier_system=? AND issuer_key=? AND normalized_value=?
        `).bind(
          identifier.displayValue,
          identifier.verificationStatus,
          common.occurredAtUtc,
          common.tenantId,
          practitionerPublicId,
          identifier.system,
          identifier.issuerKey,
          identifier.normalizedValue,
        )
      : db.prepare(`
          INSERT INTO canonical_practitioner_identifiers (
            tenant_id,practitioner_public_id,identifier_system,issuer_key,normalized_value,
            display_value,verification_status,created_at_utc,updated_at_utc
          ) VALUES (?,?,?,?,?,?,?,?,?)
        `).bind(
          common.tenantId,
          practitionerPublicId,
          identifier.system,
          identifier.issuerKey,
          identifier.normalizedValue,
          identifier.displayValue,
          identifier.verificationStatus,
          common.occurredAtUtc,
          common.occurredAtUtc,
        ));
  }

  if (requestedUserLink) {
    if (requestedUserLink.linkStatus === 'active' && nextStatus !== 'active') {
      throw new Error('active link requires an active practitioner');
    }
    const currentUserLink = await db.prepare(`
      SELECT practitioner_public_id,legacy_user_id,link_status
      FROM canonical_practitioner_user_links
      WHERE tenant_id=? AND (practitioner_public_id=? OR legacy_user_id=?)
      LIMIT 1
    `).bind(
      common.tenantId,
      practitionerPublicId,
      requestedUserLink.legacyUserId,
    ).first<CurrentUserLinkRow>();
    if (currentUserLink && (
      currentUserLink.practitioner_public_id !== practitionerPublicId
      || Number(currentUserLink.legacy_user_id) !== requestedUserLink.legacyUserId
    )) {
      throw new Error('user link already belongs to another practitioner');
    }
    if (!currentUserLink && requestedUserLink.linkStatus !== 'active') {
      throw new Error('cannot retire or reject a missing user link');
    }
    statements.push(currentUserLink
      ? db.prepare(`
          UPDATE canonical_practitioner_user_links
          SET link_status=?,evidence_type=?,updated_at_utc=?
          WHERE tenant_id=? AND practitioner_public_id=? AND legacy_user_id=?
        `).bind(
          requestedUserLink.linkStatus,
          requestedUserLink.evidenceType,
          common.occurredAtUtc,
          common.tenantId,
          practitionerPublicId,
          requestedUserLink.legacyUserId,
        )
      : db.prepare(`
          INSERT INTO canonical_practitioner_user_links (
            tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type,
            created_at_utc,updated_at_utc
          ) VALUES (?,?,?,?,?,?,?)
        `).bind(
          common.tenantId,
          practitionerPublicId,
          requestedUserLink.legacyUserId,
          requestedUserLink.linkStatus,
          requestedUserLink.evidenceType,
          common.occurredAtUtc,
          common.occurredAtUtc,
        ));
  }

  const addClassificationStatements = async (
    classificationType: PractitionerClassificationType,
    provided: boolean,
    classification: PractitionerClassificationInput | null,
  ) => {
    if (!provided) return;
    const table = classificationType === 'specialty'
      ? 'canonical_practitioner_specialties'
      : 'canonical_practitioner_departments';
    statements.push(db.prepare(`
      UPDATE ${table}
      SET is_primary=0,updated_at_utc=?
      WHERE tenant_id=? AND practitioner_public_id=? AND is_primary=1
    `).bind(common.occurredAtUtc, common.tenantId, practitionerPublicId));
    if (!classification) return;
    const existingClassification = await db.prepare(`
      SELECT practitioner_public_id
      FROM ${table}
      WHERE tenant_id=? AND practitioner_public_id=? AND normalized_key=?
      LIMIT 1
    `).bind(
      common.tenantId,
      practitionerPublicId,
      classification.normalizedKey,
    ).first<CurrentClassificationRow>();
    statements.push(existingClassification
      ? db.prepare(`
          UPDATE ${table}
          SET display_text=?,is_primary=?,updated_at_utc=?
          WHERE tenant_id=? AND practitioner_public_id=? AND normalized_key=?
        `).bind(
          classification.displayText,
          classification.isPrimary ? 1 : 0,
          common.occurredAtUtc,
          common.tenantId,
          practitionerPublicId,
          classification.normalizedKey,
        )
      : classificationStatement(db, {
          tenantId: common.tenantId,
          practitionerPublicId,
          classificationType,
          normalizedKey: classification.normalizedKey,
          displayText: classification.displayText,
          isPrimary: classification.isPrimary,
          occurredAtUtc: common.occurredAtUtc,
        }));
  };
  await addClassificationStatements('specialty', specialtyProvided, specialty);
  await addClassificationStatements('department', departmentProvided, department);

  const nextVersion = expectedVersion + 1;
  const result: UpdateOrRetirePractitionerResult = {
    practitionerPublicId,
    practitionerKind: current.practitioner_kind,
    status: nextStatus,
    version: nextVersion,
  };
  return runCanonicalBatch(db, {
    tenantId: common.tenantId,
    commandName: UPDATE_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_practitioner',
      aggregatePublicId: practitionerPublicId,
      eventType: nextStatus === 'inactive'
        ? 'canonical.practitioner.retired'
        : 'canonical.practitioner.updated',
      eventVersion: nextVersion,
      occurredAtUtc: common.occurredAtUtc,
      businessDate: common.businessDate,
      payload: {
        ...result,
        identifierUpdateCount: identifierUpdates.length,
        userLinkStatus: requestedUserLink?.linkStatus ?? null,
        specialtyChanged: specialtyProvided,
        departmentChanged: departmentProvided,
      },
    },
  });
}

async function linkOrUnlink(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    practitionerPublicId: string;
    legacyId: number;
    linkStatus: PractitionerLinkStatus;
    evidenceType: string;
    idempotencyKey: string;
    eventPublicId?: string;
    occurredAtUtc: string;
    businessDate: string;
    linkType: 'user' | 'employee';
  },
  execution: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<PractitionerLinkResult>> {
  const common = base(input);
  const practitionerPublicId = exact(input.practitionerPublicId, 'practitionerPublicId');
  const legacyId = positive(input.legacyId, input.linkType === 'user' ? 'legacyUserId' : 'legacyStaffId');
  const nextLinkStatus = linkStatus(input.linkStatus);
  const evidenceType = exact(input.evidenceType, 'evidenceType');
  if (input.linkType === 'user') {
    if (evidenceType !== 'legacy_doctor_user_id' && evidenceType !== 'approved_manual') {
      throw new RangeError('user link evidence type is invalid');
    }
  } else if (evidenceType !== 'shared_explicit_user_id' && evidenceType !== 'approved_manual') {
    throw new RangeError('employee link evidence type is invalid');
  }
  const commandName = input.linkType === 'user' ? USER_LINK_COMMAND : EMPLOYEE_LINK_COMMAND;
  const resolvedEventId = await eventId(common.tenantId, common.idempotencyKey, input.eventPublicId);
  const request = {
    practitionerPublicId,
    legacyId,
    linkStatus: nextLinkStatus,
    evidenceType,
    linkType: input.linkType,
    occurredAtUtc: common.occurredAtUtc,
    businessDate: common.businessDate,
  };
  const replay = await readCanonicalCommandReplay<PractitionerLinkResult>(db, {
    tenantId: common.tenantId,
    commandName,
    idempotencyKey: common.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const practitioner = await requirePractitioner(db, common.tenantId, practitionerPublicId);
  if (nextLinkStatus === 'active' && practitioner.status !== 'active') {
    throw new Error('active link requires an active practitioner');
  }

  let current: CurrentUserLinkRow | CurrentEmployeeLinkRow | null;
  let statement: CanonicalPreparedStatement;
  if (input.linkType === 'user') {
    current = await db.prepare(`
      SELECT practitioner_public_id,legacy_user_id,link_status
      FROM canonical_practitioner_user_links
      WHERE tenant_id=? AND (practitioner_public_id=? OR legacy_user_id=?)
      LIMIT 1
    `).bind(common.tenantId, practitionerPublicId, legacyId).first<CurrentUserLinkRow>();
    if (current && (
      current.practitioner_public_id !== practitionerPublicId
      || Number((current as CurrentUserLinkRow).legacy_user_id) !== legacyId
    )) throw new Error('user link already belongs to another practitioner');
    if (!current && nextLinkStatus !== 'active') throw new Error('cannot retire or reject a missing user link');
    statement = current
      ? db.prepare(`
          UPDATE canonical_practitioner_user_links
          SET link_status=?,evidence_type=?,updated_at_utc=?
          WHERE tenant_id=? AND practitioner_public_id=? AND legacy_user_id=?
        `).bind(nextLinkStatus, evidenceType, common.occurredAtUtc, common.tenantId, practitionerPublicId, legacyId)
      : db.prepare(`
          INSERT INTO canonical_practitioner_user_links (
            tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type,
            created_at_utc,updated_at_utc
          ) VALUES (?,?,?,?,?,?,?)
        `).bind(
          common.tenantId,
          practitionerPublicId,
          legacyId,
          nextLinkStatus,
          evidenceType,
          common.occurredAtUtc,
          common.occurredAtUtc,
        );
  } else {
    current = await db.prepare(`
      SELECT practitioner_public_id,legacy_staff_id,link_status
      FROM canonical_practitioner_employee_links
      WHERE tenant_id=? AND (practitioner_public_id=? OR legacy_staff_id=?)
      LIMIT 1
    `).bind(common.tenantId, practitionerPublicId, legacyId).first<CurrentEmployeeLinkRow>();
    if (current && (
      current.practitioner_public_id !== practitionerPublicId
      || Number((current as CurrentEmployeeLinkRow).legacy_staff_id) !== legacyId
    )) throw new Error('employee link already belongs to another practitioner');
    if (!current && nextLinkStatus !== 'active') throw new Error('cannot retire or reject a missing employee link');
    statement = current
      ? db.prepare(`
          UPDATE canonical_practitioner_employee_links
          SET link_status=?,evidence_type=?,updated_at_utc=?
          WHERE tenant_id=? AND practitioner_public_id=? AND legacy_staff_id=?
        `).bind(nextLinkStatus, evidenceType, common.occurredAtUtc, common.tenantId, practitionerPublicId, legacyId)
      : db.prepare(`
          INSERT INTO canonical_practitioner_employee_links (
            tenant_id,practitioner_public_id,legacy_staff_id,link_status,evidence_type,
            created_at_utc,updated_at_utc
          ) VALUES (?,?,?,?,?,?,?)
        `).bind(
          common.tenantId,
          practitionerPublicId,
          legacyId,
          nextLinkStatus,
          evidenceType,
          common.occurredAtUtc,
          common.occurredAtUtc,
        );
  }

  const result: PractitionerLinkResult = {
    practitionerPublicId,
    linkType: input.linkType,
    linkStatus: nextLinkStatus,
  };
  return runCanonicalBatch(db, {
    tenantId: common.tenantId,
    commandName,
    idempotencyKey: common.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [statement],
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_practitioner',
      aggregatePublicId: practitionerPublicId,
      eventType: `canonical.practitioner.${input.linkType}-link.${nextLinkStatus}`,
      occurredAtUtc: common.occurredAtUtc,
      businessDate: common.businessDate,
      payload: result,
    },
  });
}

export function linkOrUnlinkPractitionerUser(
  db: CanonicalBatchDatabase,
  raw: LinkOrUnlinkPractitionerUserInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<PractitionerLinkResult>> {
  return linkOrUnlink(db, {
    ...raw,
    legacyId: raw.legacyUserId,
    linkType: 'user',
  }, execution);
}

export function linkOrUnlinkPractitionerEmployee(
  db: CanonicalBatchDatabase,
  raw: LinkOrUnlinkPractitionerEmployeeInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<PractitionerLinkResult>> {
  return linkOrUnlink(db, {
    ...raw,
    legacyId: raw.legacyStaffId,
    linkType: 'employee',
  }, execution);
}

export async function managePractitionerIdentifier(
  db: CanonicalBatchDatabase,
  raw: ManagePractitionerIdentifierInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<ManagePractitionerIdentifierResult>> {
  const common = base(raw);
  const practitionerPublicId = exact(raw.practitionerPublicId, 'practitionerPublicId');
  const system = identifierSystem(raw.system);
  const issuerKey = exact(raw.issuerKey, 'issuerKey');
  const normalizedValue = normalizedIdentifierValue(raw.value);
  const displayValue = exact(raw.displayValue, 'displayValue');
  const verificationStatus = identifierStatus(raw.verificationStatus);
  const resolvedEventId = await eventId(common.tenantId, common.idempotencyKey, raw.eventPublicId);
  const request = {
    practitionerPublicId,
    system,
    issuerKey,
    normalizedValue,
    displayValue,
    verificationStatus,
    occurredAtUtc: common.occurredAtUtc,
    businessDate: common.businessDate,
  };
  const replay = await readCanonicalCommandReplay<ManagePractitionerIdentifierResult>(db, {
    tenantId: common.tenantId,
    commandName: IDENTIFIER_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
  });
  if (replay) return replay;

  await requirePractitioner(db, common.tenantId, practitionerPublicId);
  const current = await db.prepare(`
    SELECT practitioner_public_id,verification_status
    FROM canonical_practitioner_identifiers
    WHERE tenant_id=? AND identifier_system=? AND issuer_key=? AND normalized_value=?
    LIMIT 1
  `).bind(common.tenantId, system, issuerKey, normalizedValue).first<CurrentIdentifierRow>();
  if (current && current.practitioner_public_id !== practitionerPublicId) {
    throw new Error('identifier already belongs to another practitioner');
  }
  const statement = current
    ? db.prepare(`
        UPDATE canonical_practitioner_identifiers
        SET display_value=?,verification_status=?,updated_at_utc=?
        WHERE tenant_id=? AND practitioner_public_id=?
          AND identifier_system=? AND issuer_key=? AND normalized_value=?
      `).bind(
        displayValue,
        verificationStatus,
        common.occurredAtUtc,
        common.tenantId,
        practitionerPublicId,
        system,
        issuerKey,
        normalizedValue,
      )
    : db.prepare(`
        INSERT INTO canonical_practitioner_identifiers (
          tenant_id,practitioner_public_id,identifier_system,issuer_key,normalized_value,
          display_value,verification_status,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?)
      `).bind(
        common.tenantId,
        practitionerPublicId,
        system,
        issuerKey,
        normalizedValue,
        displayValue,
        verificationStatus,
        common.occurredAtUtc,
        common.occurredAtUtc,
      );

  const result: ManagePractitionerIdentifierResult = {
    practitionerPublicId,
    identifierSystem: system,
    verificationStatus,
  };
  return runCanonicalBatch(db, {
    tenantId: common.tenantId,
    commandName: IDENTIFIER_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [statement],
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_practitioner',
      aggregatePublicId: practitionerPublicId,
      eventType: `canonical.practitioner.identifier.${verificationStatus}`,
      occurredAtUtc: common.occurredAtUtc,
      businessDate: common.businessDate,
      payload: result,
    },
  });
}

export async function assignPractitionerClassification(
  db: CanonicalBatchDatabase,
  raw: AssignPractitionerClassificationInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<AssignPractitionerClassificationResult>> {
  const common = base(raw);
  const practitionerPublicId = exact(raw.practitionerPublicId, 'practitionerPublicId');
  const resolvedClassificationType = classificationType(raw.classificationType);
  const normalizedKey = normalizedClassificationKey(raw.normalizedKey);
  const displayText = exact(raw.displayText, 'displayText');
  const isPrimary = Boolean(raw.isPrimary);
  const resolvedEventId = await eventId(common.tenantId, common.idempotencyKey, raw.eventPublicId);
  const request = {
    practitionerPublicId,
    classificationType: resolvedClassificationType,
    normalizedKey,
    displayText,
    isPrimary,
    occurredAtUtc: common.occurredAtUtc,
    businessDate: common.businessDate,
  };
  const replay = await readCanonicalCommandReplay<AssignPractitionerClassificationResult>(db, {
    tenantId: common.tenantId,
    commandName: CLASSIFICATION_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const practitioner = await requirePractitioner(db, common.tenantId, practitionerPublicId);
  if (practitioner.status !== 'active') throw new Error('classification assignment requires an active practitioner');
  const table = resolvedClassificationType === 'specialty'
    ? 'canonical_practitioner_specialties'
    : 'canonical_practitioner_departments';
  const current = await db.prepare(`
    SELECT practitioner_public_id
    FROM ${table}
    WHERE tenant_id=? AND practitioner_public_id=? AND normalized_key=?
    LIMIT 1
  `).bind(common.tenantId, practitionerPublicId, normalizedKey).first<CurrentClassificationRow>();
  const statement = current
    ? db.prepare(`
        UPDATE ${table}
        SET display_text=?,is_primary=?,updated_at_utc=?
        WHERE tenant_id=? AND practitioner_public_id=? AND normalized_key=?
      `).bind(
        displayText,
        isPrimary ? 1 : 0,
        common.occurredAtUtc,
        common.tenantId,
        practitionerPublicId,
        normalizedKey,
      )
    : classificationStatement(db, {
        tenantId: common.tenantId,
        practitionerPublicId,
        classificationType: resolvedClassificationType,
        normalizedKey,
        displayText,
        isPrimary,
        occurredAtUtc: common.occurredAtUtc,
      });

  const result: AssignPractitionerClassificationResult = {
    practitionerPublicId,
    classificationType: resolvedClassificationType,
    normalizedKey,
    isPrimary,
  };
  return runCanonicalBatch(db, {
    tenantId: common.tenantId,
    commandName: CLASSIFICATION_COMMAND,
    idempotencyKey: common.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [statement],
    result,
    event: {
      eventPublicId: resolvedEventId,
      aggregateType: 'canonical_practitioner',
      aggregatePublicId: practitionerPublicId,
      eventType: `canonical.practitioner.${resolvedClassificationType}.assigned`,
      occurredAtUtc: common.occurredAtUtc,
      businessDate: common.businessDate,
      payload: result,
    },
  });
}
