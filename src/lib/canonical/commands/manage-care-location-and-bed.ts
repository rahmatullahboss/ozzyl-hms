import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { createDeterministicSourceId } from '../source-mapping';
import { toUtcIso } from '../time';

export type CareLocationKind = 'facility' | 'branch' | 'floor' | 'ward' | 'room' | 'care_area' | 'other';
export type CareLocationOperationalStatus = 'active' | 'inactive' | 'retired';
export type BedOperationalStatus = 'active' | 'inactive' | 'maintenance' | 'retired';

interface ResourceActorInput {
  actorUserPublicId?: string | null;
  actorSystemKey?: string | null;
}

interface ResourceCommandBase extends ResourceActorInput {
  tenantId: string;
  idempotencyKey: string;
  eventPublicId?: string;
  occurredAtUtc: string;
  businessDate: string;
}

interface SourceEvidenceInput {
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
}

export interface CreateCareLocationInput extends ResourceCommandBase, SourceEvidenceInput {
  locationPublicId?: string;
  parentLocationPublicId?: string | null;
  locationKind: CareLocationKind;
  locationCode: string;
  displayName: string;
  operationalStatus?: Exclude<CareLocationOperationalStatus, 'retired'>;
  timezone: string;
}

export interface UpdateCareLocationInput extends ResourceCommandBase {
  locationPublicId: string;
  expectedVersion: number;
  parentLocationPublicId?: string | null;
  locationKind: CareLocationKind;
  locationCode: string;
  displayName: string;
  operationalStatus: Exclude<CareLocationOperationalStatus, 'retired'>;
  timezone: string;
  sourceEvidenceSha256: string;
}

export interface RetireCareLocationInput extends ResourceCommandBase {
  locationPublicId: string;
  expectedVersion: number;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface CareLocationResult {
  locationPublicId: string;
  operationalStatus: CareLocationOperationalStatus;
  version: number;
}

export interface CreateBedResourceInput extends ResourceCommandBase, SourceEvidenceInput {
  bedPublicId?: string;
  locationPublicId: string;
  bedCode: string;
  bedClass: string;
  operationalStatus?: Exclude<BedOperationalStatus, 'retired'>;
}

export interface UpdateBedResourceInput extends ResourceCommandBase {
  bedPublicId: string;
  expectedVersion: number;
  locationPublicId: string;
  bedCode: string;
  bedClass: string;
  operationalStatus: Exclude<BedOperationalStatus, 'retired'>;
  sourceEvidenceSha256: string;
}

export interface RetireBedResourceInput extends ResourceCommandBase {
  bedPublicId: string;
  expectedVersion: number;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface BedResourceResult {
  bedPublicId: string;
  operationalStatus: BedOperationalStatus;
  version: number;
}

interface LocationRow {
  parent_location_public_id: string | null;
  location_kind: CareLocationKind;
  location_code: string;
  display_name: string;
  operational_status: CareLocationOperationalStatus;
  timezone: string;
  version: number;
}

interface BedRow {
  location_public_id: string;
  bed_code: string;
  bed_class: string;
  operational_status: BedOperationalStatus;
  version: number;
}

interface SourceMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface CountRow {
  count: number;
}

const LOCATION_CREATE_COMMAND = 'canonical.care-location.create';
const LOCATION_UPDATE_COMMAND = 'canonical.care-location.update';
const LOCATION_RETIRE_COMMAND = 'canonical.care-location.retire';
const BED_CREATE_COMMAND = 'canonical.bed-resource.create';
const BED_UPDATE_COMMAND = 'canonical.bed-resource.update';
const BED_RETIRE_COMMAND = 'canonical.bed-resource.retire';

const LOCATION_KINDS = new Set<CareLocationKind>([
  'facility', 'branch', 'floor', 'ward', 'room', 'care_area', 'other',
]);
const LOCATION_STATUSES = new Set<CareLocationOperationalStatus>(['active', 'inactive', 'retired']);
const BED_STATUSES = new Set<BedOperationalStatus>(['active', 'inactive', 'maintenance', 'retired']);

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
  if (!/^[0-9a-f]{64}$/.test(value)) throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

function actor(input: ResourceActorInput): { actorUserPublicId: string | null; actorSystemKey: string | null } {
  const actorUserPublicId = optionalExact(input.actorUserPublicId, 'actorUserPublicId');
  const actorSystemKey = optionalExact(input.actorSystemKey, 'actorSystemKey');
  if (actorUserPublicId == null && actorSystemKey == null) {
    throw new TypeError('actorUserPublicId or actorSystemKey is required');
  }
  return { actorUserPublicId, actorSystemKey };
}

function base(input: ResourceCommandBase) {
  return {
    tenantId: exact(input.tenantId, 'tenantId'),
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    occurredAtUtc: utc(input.occurredAtUtc, 'occurredAtUtc'),
    businessDate: exact(input.businessDate, 'businessDate'),
    ...actor(input),
  };
}

function locationKind(value: string): CareLocationKind {
  if (!LOCATION_KINDS.has(value as CareLocationKind)) throw new RangeError('locationKind is invalid');
  return value as CareLocationKind;
}

function locationStatus(value: string, allowRetired: boolean): CareLocationOperationalStatus {
  if (!LOCATION_STATUSES.has(value as CareLocationOperationalStatus) || (!allowRetired && value === 'retired')) {
    throw new RangeError('operationalStatus is invalid for a care location command');
  }
  return value as CareLocationOperationalStatus;
}

function bedStatus(value: string, allowRetired: boolean): BedOperationalStatus {
  if (!BED_STATUSES.has(value as BedOperationalStatus) || (!allowRetired && value === 'retired')) {
    throw new RangeError('operationalStatus is invalid for a bed resource command');
  }
  return value as BedOperationalStatus;
}

async function eventId(
  prefix: string,
  tenantId: string,
  idempotencyKey: string,
  provided: string | undefined,
): Promise<string> {
  return provided == null
    ? createDeterministicSourceId(prefix, tenantId, 'canonical_command', idempotencyKey)
    : exact(provided, 'eventPublicId');
}

async function publicId(
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

async function requireLocation(
  db: CanonicalBatchDatabase,
  tenantId: string,
  locationPublicId: string,
): Promise<LocationRow> {
  const row = await db.prepare(`
    SELECT parent_location_public_id,location_kind,location_code,display_name,
           operational_status,timezone,version
    FROM canonical_care_locations
    WHERE tenant_id=? AND location_public_id=?
    LIMIT 1
  `).bind(tenantId, locationPublicId).first<LocationRow>();
  if (!row) throw new Error('care location not found');
  return row;
}

async function requireUsableParent(
  db: CanonicalBatchDatabase,
  tenantId: string,
  parentLocationPublicId: string | null,
): Promise<void> {
  if (parentLocationPublicId == null) return;
  const parent = await requireLocation(db, tenantId, parentLocationPublicId);
  if (parent.operational_status === 'retired') throw new Error('parent care location is retired');
}

async function rejectLocationCycle(
  db: CanonicalBatchDatabase,
  tenantId: string,
  locationPublicId: string,
  proposedParentPublicId: string | null,
): Promise<void> {
  if (proposedParentPublicId == null) return;
  if (proposedParentPublicId === locationPublicId) throw new Error('care location hierarchy cycle detected');
  const row = await db.prepare(`
    WITH RECURSIVE ancestors(location_public_id,parent_location_public_id) AS (
      SELECT location_public_id,parent_location_public_id
      FROM canonical_care_locations
      WHERE tenant_id=? AND location_public_id=?
      UNION ALL
      SELECT parent.location_public_id,parent.parent_location_public_id
      FROM canonical_care_locations parent
      JOIN ancestors child ON child.parent_location_public_id=parent.location_public_id
      WHERE parent.tenant_id=?
    )
    SELECT COUNT(*) AS count FROM ancestors WHERE location_public_id=?
  `).bind(tenantId, proposedParentPublicId, tenantId, locationPublicId).first<CountRow>();
  if (Number(row?.count ?? 0) > 0) throw new Error('care location hierarchy cycle detected');
}

async function requireUsableBedLocation(
  db: CanonicalBatchDatabase,
  tenantId: string,
  locationPublicId: string,
): Promise<void> {
  const location = await requireLocation(db, tenantId, locationPublicId);
  if (location.operational_status !== 'active') {
    throw new Error('bed resource requires an active care location');
  }
}

async function requireBed(
  db: CanonicalBatchDatabase,
  tenantId: string,
  bedPublicId: string,
): Promise<BedRow> {
  const row = await db.prepare(`
    SELECT location_public_id,bed_code,bed_class,operational_status,version
    FROM canonical_beds
    WHERE tenant_id=? AND bed_public_id=?
    LIMIT 1
  `).bind(tenantId, bedPublicId).first<BedRow>();
  if (!row) throw new Error('bed resource not found');
  return row;
}

async function hasOpenStay(
  db: CanonicalBatchDatabase,
  tenantId: string,
  bedPublicId: string,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count FROM canonical_bed_stays
    WHERE tenant_id=? AND bed_public_id=? AND status='active' AND ended_at_utc IS NULL
  `).bind(tenantId, bedPublicId).first<CountRow>();
  return Number(row?.count ?? 0) > 0;
}

async function requireSourceMappingAvailable(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'care_location' | 'bed_resource';
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
  ).first<SourceMappingRow>();
  if (!row) return;
  if (row.mapping_status !== 'mapped' || row.canonical_public_id !== input.canonicalPublicId) {
    throw new Error(`${input.entityType.replace('_', ' ')} source mapping already belongs to another resource`);
  }
  throw new Error(`${input.entityType.replace('_', ' ')} source mapping already exists without replay evidence`);
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'care_location' | 'bed_resource';
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

export async function createCareLocation(
  db: CanonicalBatchDatabase,
  input: CreateCareLocationInput,
  options: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CareLocationResult>> {
  const command = base(input);
  const sourceType = exact(input.sourceType, 'sourceType');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(input.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = hash(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const locationPublicId = await publicId(
    'location', command.tenantId, sourceType, sourcePublicId, input.locationPublicId, 'locationPublicId',
  );
  const parentLocationPublicId = optionalExact(input.parentLocationPublicId, 'parentLocationPublicId');
  const kind = locationKind(input.locationKind);
  const code = exact(input.locationCode, 'locationCode');
  const displayName = exact(input.displayName, 'displayName');
  const operationalStatus = locationStatus(input.operationalStatus ?? 'active', false) as Exclude<CareLocationOperationalStatus, 'retired'>;
  const timezone = exact(input.timezone, 'timezone');
  const request = {
    locationPublicId,
    parentLocationPublicId,
    locationKind: kind,
    locationCode: code,
    displayName,
    operationalStatus,
    timezone,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actorUserPublicId: command.actorUserPublicId,
    actorSystemKey: command.actorSystemKey,
    occurredAtUtc: command.occurredAtUtc,
  };
  const replay = await readCanonicalCommandReplay<CareLocationResult>(db, {
    tenantId: command.tenantId,
    commandName: LOCATION_CREATE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
  });
  if (replay) return replay;
  await requireUsableParent(db, command.tenantId, parentLocationPublicId);
  if (parentLocationPublicId === locationPublicId) throw new Error('care location hierarchy cycle detected');
  await requireSourceMappingAvailable(db, {
    tenantId: command.tenantId,
    entityType: 'care_location',
    sourceType,
    sourcePublicId,
    canonicalPublicId: locationPublicId,
  });
  const result: CareLocationResult = { locationPublicId, operationalStatus, version: 1 };
  return runCanonicalBatch(db, {
    tenantId: command.tenantId,
    commandName: LOCATION_CREATE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
    authoritativeStatements: options.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_care_locations (
          tenant_id,location_public_id,parent_location_public_id,location_kind,
          location_code,display_name,operational_status,timezone,version,
          source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,1,?,?,?)
      `).bind(
        command.tenantId,
        locationPublicId,
        parentLocationPublicId,
        kind,
        code,
        displayName,
        operationalStatus,
        timezone,
        sourceEvidenceSha256,
        command.occurredAtUtc,
        command.occurredAtUtc,
      ),
    ],
    reconciliationStatements: [
      sourceMappingStatement(db, {
        tenantId: command.tenantId,
        entityType: 'care_location',
        canonicalPublicId: locationPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        sourceEvidenceSha256,
        occurredAtUtc: command.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await eventId('carelocevt', command.tenantId, command.idempotencyKey, input.eventPublicId),
      aggregateType: 'canonical_care_location',
      aggregatePublicId: locationPublicId,
      eventType: 'canonical.care-location.created',
      occurredAtUtc: command.occurredAtUtc,
      businessDate: command.businessDate,
      payload: { locationPublicId, locationKind: kind, operationalStatus, version: 1 },
    },
  });
}

export async function updateCareLocation(
  db: CanonicalBatchDatabase,
  input: UpdateCareLocationInput,
  options: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CareLocationResult>> {
  const command = base(input);
  const locationPublicId = exact(input.locationPublicId, 'locationPublicId');
  const expectedVersion = positive(input.expectedVersion, 'expectedVersion');
  const parentLocationPublicId = optionalExact(input.parentLocationPublicId, 'parentLocationPublicId');
  const kind = locationKind(input.locationKind);
  const code = exact(input.locationCode, 'locationCode');
  const displayName = exact(input.displayName, 'displayName');
  const operationalStatus = locationStatus(input.operationalStatus, false) as Exclude<CareLocationOperationalStatus, 'retired'>;
  const timezone = exact(input.timezone, 'timezone');
  const sourceEvidenceSha256 = hash(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const request = {
    locationPublicId,
    expectedVersion,
    parentLocationPublicId,
    locationKind: kind,
    locationCode: code,
    displayName,
    operationalStatus,
    timezone,
    sourceEvidenceSha256,
    actorUserPublicId: command.actorUserPublicId,
    actorSystemKey: command.actorSystemKey,
    occurredAtUtc: command.occurredAtUtc,
  };
  const replay = await readCanonicalCommandReplay<CareLocationResult>(db, {
    tenantId: command.tenantId,
    commandName: LOCATION_UPDATE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
  });
  if (replay) return replay;
  const current = await requireLocation(db, command.tenantId, locationPublicId);
  if (current.operational_status === 'retired') throw new Error('retired care location cannot be updated');
  if (current.version !== expectedVersion) throw new Error('care location expectedVersion is stale');
  await requireUsableParent(db, command.tenantId, parentLocationPublicId);
  await rejectLocationCycle(db, command.tenantId, locationPublicId, parentLocationPublicId);
  const version = expectedVersion + 1;
  const result: CareLocationResult = { locationPublicId, operationalStatus, version };
  return runCanonicalBatch(db, {
    tenantId: command.tenantId,
    commandName: LOCATION_UPDATE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
    authoritativeStatements: options.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_care_locations
        SET parent_location_public_id=?,location_kind=?,location_code=?,display_name=?,
            operational_status=?,timezone=?,version=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND location_public_id=? AND version=? AND operational_status<>'retired'
      `).bind(
        parentLocationPublicId,
        kind,
        code,
        displayName,
        operationalStatus,
        timezone,
        version,
        sourceEvidenceSha256,
        command.occurredAtUtc,
        command.tenantId,
        locationPublicId,
        expectedVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: await eventId('carelocevt', command.tenantId, command.idempotencyKey, input.eventPublicId),
      aggregateType: 'canonical_care_location',
      aggregatePublicId: locationPublicId,
      eventType: 'canonical.care-location.updated',
      eventVersion: version,
      occurredAtUtc: command.occurredAtUtc,
      businessDate: command.businessDate,
      payload: { locationPublicId, locationKind: kind, operationalStatus, version },
    },
  });
}

export async function retireCareLocation(
  db: CanonicalBatchDatabase,
  input: RetireCareLocationInput,
  options: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CareLocationResult>> {
  const command = base(input);
  const locationPublicId = exact(input.locationPublicId, 'locationPublicId');
  const expectedVersion = positive(input.expectedVersion, 'expectedVersion');
  const reasonCode = exact(input.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = hash(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const request = {
    locationPublicId,
    expectedVersion,
    reasonCode,
    sourceEvidenceSha256,
    actorUserPublicId: command.actorUserPublicId,
    actorSystemKey: command.actorSystemKey,
    occurredAtUtc: command.occurredAtUtc,
  };
  const replay = await readCanonicalCommandReplay<CareLocationResult>(db, {
    tenantId: command.tenantId,
    commandName: LOCATION_RETIRE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
  });
  if (replay) return replay;
  const current = await requireLocation(db, command.tenantId, locationPublicId);
  if (current.version !== expectedVersion) throw new Error('care location expectedVersion is stale');
  if (current.operational_status === 'retired') throw new Error('care location is already retired');
  const childCount = await db.prepare(`
    SELECT COUNT(*) AS count FROM canonical_care_locations
    WHERE tenant_id=? AND parent_location_public_id=? AND operational_status<>'retired'
  `).bind(command.tenantId, locationPublicId).first<CountRow>();
  if (Number(childCount?.count ?? 0) > 0) throw new Error('care location cannot retire while active child locations remain');
  const bedCount = await db.prepare(`
    SELECT COUNT(*) AS count FROM canonical_beds
    WHERE tenant_id=? AND location_public_id=? AND operational_status<>'retired'
  `).bind(command.tenantId, locationPublicId).first<CountRow>();
  if (Number(bedCount?.count ?? 0) > 0) throw new Error('care location cannot retire while an active bed resource remains');
  const version = expectedVersion + 1;
  const result: CareLocationResult = { locationPublicId, operationalStatus: 'retired', version };
  return runCanonicalBatch(db, {
    tenantId: command.tenantId,
    commandName: LOCATION_RETIRE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
    authoritativeStatements: options.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_care_locations
        SET operational_status='retired',version=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND location_public_id=? AND version=? AND operational_status<>'retired'
          AND NOT EXISTS (
            SELECT 1 FROM canonical_care_locations child
            WHERE child.tenant_id=canonical_care_locations.tenant_id
              AND child.parent_location_public_id=canonical_care_locations.location_public_id
              AND child.operational_status<>'retired'
          )
          AND NOT EXISTS (
            SELECT 1 FROM canonical_beds bed
            WHERE bed.tenant_id=canonical_care_locations.tenant_id
              AND bed.location_public_id=canonical_care_locations.location_public_id
              AND bed.operational_status<>'retired'
          )
      `).bind(
        version,
        sourceEvidenceSha256,
        command.occurredAtUtc,
        command.tenantId,
        locationPublicId,
        expectedVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: await eventId('carelocevt', command.tenantId, command.idempotencyKey, input.eventPublicId),
      aggregateType: 'canonical_care_location',
      aggregatePublicId: locationPublicId,
      eventType: 'canonical.care-location.retired',
      eventVersion: version,
      occurredAtUtc: command.occurredAtUtc,
      businessDate: command.businessDate,
      payload: { locationPublicId, operationalStatus: 'retired', version, reasonCode },
    },
  });
}

export async function createBedResource(
  db: CanonicalBatchDatabase,
  input: CreateBedResourceInput,
  options: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<BedResourceResult>> {
  const command = base(input);
  const sourceType = exact(input.sourceType, 'sourceType');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(input.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = hash(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const bedPublicId = await publicId('bed', command.tenantId, sourceType, sourcePublicId, input.bedPublicId, 'bedPublicId');
  const locationPublicId = exact(input.locationPublicId, 'locationPublicId');
  const bedCode = exact(input.bedCode, 'bedCode');
  const bedClass = exact(input.bedClass, 'bedClass');
  const operationalStatus = bedStatus(input.operationalStatus ?? 'active', false) as Exclude<BedOperationalStatus, 'retired'>;
  const request = {
    bedPublicId,
    locationPublicId,
    bedCode,
    bedClass,
    operationalStatus,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actorUserPublicId: command.actorUserPublicId,
    actorSystemKey: command.actorSystemKey,
    occurredAtUtc: command.occurredAtUtc,
  };
  const replay = await readCanonicalCommandReplay<BedResourceResult>(db, {
    tenantId: command.tenantId,
    commandName: BED_CREATE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
  });
  if (replay) return replay;
  await requireUsableBedLocation(db, command.tenantId, locationPublicId);
  await requireSourceMappingAvailable(db, {
    tenantId: command.tenantId,
    entityType: 'bed_resource',
    sourceType,
    sourcePublicId,
    canonicalPublicId: bedPublicId,
  });
  const result: BedResourceResult = { bedPublicId, operationalStatus, version: 1 };
  return runCanonicalBatch(db, {
    tenantId: command.tenantId,
    commandName: BED_CREATE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
    authoritativeStatements: options.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_beds (
          tenant_id,bed_public_id,location_public_id,bed_code,bed_class,
          operational_status,version,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,1,?,?,?)
      `).bind(
        command.tenantId,
        bedPublicId,
        locationPublicId,
        bedCode,
        bedClass,
        operationalStatus,
        sourceEvidenceSha256,
        command.occurredAtUtc,
        command.occurredAtUtc,
      ),
    ],
    reconciliationStatements: [
      sourceMappingStatement(db, {
        tenantId: command.tenantId,
        entityType: 'bed_resource',
        canonicalPublicId: bedPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        sourceEvidenceSha256,
        occurredAtUtc: command.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: await eventId('bedevt', command.tenantId, command.idempotencyKey, input.eventPublicId),
      aggregateType: 'canonical_bed_resource',
      aggregatePublicId: bedPublicId,
      eventType: 'canonical.bed-resource.created',
      occurredAtUtc: command.occurredAtUtc,
      businessDate: command.businessDate,
      payload: { bedPublicId, locationPublicId, operationalStatus, version: 1 },
    },
  });
}

export async function updateBedResource(
  db: CanonicalBatchDatabase,
  input: UpdateBedResourceInput,
  options: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<BedResourceResult>> {
  const command = base(input);
  const bedPublicId = exact(input.bedPublicId, 'bedPublicId');
  const expectedVersion = positive(input.expectedVersion, 'expectedVersion');
  const locationPublicId = exact(input.locationPublicId, 'locationPublicId');
  const bedCode = exact(input.bedCode, 'bedCode');
  const bedClass = exact(input.bedClass, 'bedClass');
  const operationalStatus = bedStatus(input.operationalStatus, false) as Exclude<BedOperationalStatus, 'retired'>;
  const sourceEvidenceSha256 = hash(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const request = {
    bedPublicId,
    expectedVersion,
    locationPublicId,
    bedCode,
    bedClass,
    operationalStatus,
    sourceEvidenceSha256,
    actorUserPublicId: command.actorUserPublicId,
    actorSystemKey: command.actorSystemKey,
    occurredAtUtc: command.occurredAtUtc,
  };
  const replay = await readCanonicalCommandReplay<BedResourceResult>(db, {
    tenantId: command.tenantId,
    commandName: BED_UPDATE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
  });
  if (replay) return replay;
  const current = await requireBed(db, command.tenantId, bedPublicId);
  if (current.operational_status === 'retired') throw new Error('retired bed resource cannot be updated');
  if (current.version !== expectedVersion) throw new Error('bed resource expectedVersion is stale');
  await requireUsableBedLocation(db, command.tenantId, locationPublicId);
  const openStay = await hasOpenStay(db, command.tenantId, bedPublicId);
  if (openStay && (operationalStatus !== 'active' || locationPublicId !== current.location_public_id)) {
    throw new Error('occupied bed resource with an open stay cannot change location or operational status');
  }
  const version = expectedVersion + 1;
  const result: BedResourceResult = { bedPublicId, operationalStatus, version };
  return runCanonicalBatch(db, {
    tenantId: command.tenantId,
    commandName: BED_UPDATE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
    authoritativeStatements: options.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_beds
        SET location_public_id=?,bed_code=?,bed_class=?,operational_status=?,version=?,
            source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND bed_public_id=? AND version=? AND operational_status<>'retired'
          AND (
            NOT EXISTS (
              SELECT 1 FROM canonical_bed_stays stay
              WHERE stay.tenant_id=canonical_beds.tenant_id
                AND stay.bed_public_id=canonical_beds.bed_public_id
                AND stay.status='active' AND stay.ended_at_utc IS NULL
            )
            OR (canonical_beds.location_public_id=? AND ?='active')
          )
      `).bind(
        locationPublicId,
        bedCode,
        bedClass,
        operationalStatus,
        version,
        sourceEvidenceSha256,
        command.occurredAtUtc,
        command.tenantId,
        bedPublicId,
        expectedVersion,
        locationPublicId,
        operationalStatus,
      ),
    ],
    result,
    event: {
      eventPublicId: await eventId('bedevt', command.tenantId, command.idempotencyKey, input.eventPublicId),
      aggregateType: 'canonical_bed_resource',
      aggregatePublicId: bedPublicId,
      eventType: 'canonical.bed-resource.updated',
      eventVersion: version,
      occurredAtUtc: command.occurredAtUtc,
      businessDate: command.businessDate,
      payload: { bedPublicId, locationPublicId, operationalStatus, version },
    },
  });
}

export async function retireBedResource(
  db: CanonicalBatchDatabase,
  input: RetireBedResourceInput,
  options: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<BedResourceResult>> {
  const command = base(input);
  const bedPublicId = exact(input.bedPublicId, 'bedPublicId');
  const expectedVersion = positive(input.expectedVersion, 'expectedVersion');
  const reasonCode = exact(input.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = hash(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const request = {
    bedPublicId,
    expectedVersion,
    reasonCode,
    sourceEvidenceSha256,
    actorUserPublicId: command.actorUserPublicId,
    actorSystemKey: command.actorSystemKey,
    occurredAtUtc: command.occurredAtUtc,
  };
  const replay = await readCanonicalCommandReplay<BedResourceResult>(db, {
    tenantId: command.tenantId,
    commandName: BED_RETIRE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
  });
  if (replay) return replay;
  const current = await requireBed(db, command.tenantId, bedPublicId);
  if (current.version !== expectedVersion) throw new Error('bed resource expectedVersion is stale');
  if (current.operational_status === 'retired') throw new Error('bed resource is already retired');
  if (await hasOpenStay(db, command.tenantId, bedPublicId)) {
    throw new Error('bed resource cannot retire while an open stay exists');
  }
  const version = expectedVersion + 1;
  const result: BedResourceResult = { bedPublicId, operationalStatus: 'retired', version };
  return runCanonicalBatch(db, {
    tenantId: command.tenantId,
    commandName: BED_RETIRE_COMMAND,
    idempotencyKey: command.idempotencyKey,
    request,
    authoritativeStatements: options.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_beds
        SET operational_status='retired',version=?,source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND bed_public_id=? AND version=? AND operational_status<>'retired'
          AND NOT EXISTS (
            SELECT 1 FROM canonical_bed_stays stay
            WHERE stay.tenant_id=canonical_beds.tenant_id
              AND stay.bed_public_id=canonical_beds.bed_public_id
              AND stay.status='active' AND stay.ended_at_utc IS NULL
          )
      `).bind(
        version,
        sourceEvidenceSha256,
        command.occurredAtUtc,
        command.tenantId,
        bedPublicId,
        expectedVersion,
      ),
    ],
    result,
    event: {
      eventPublicId: await eventId('bedevt', command.tenantId, command.idempotencyKey, input.eventPublicId),
      aggregateType: 'canonical_bed_resource',
      aggregatePublicId: bedPublicId,
      eventType: 'canonical.bed-resource.retired',
      eventVersion: version,
      occurredAtUtc: command.occurredAtUtc,
      businessDate: command.businessDate,
      payload: { bedPublicId, operationalStatus: 'retired', version, reasonCode },
    },
  });
}
