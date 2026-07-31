import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from './command-batch';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';
import { resolveAppointmentRoutePractitioner } from './appointment-route-integration';

const COMMAND_NAME = 'canonical.appointment.schedule-extension.record';
const SOURCE_TYPE = 'legacy_doctor_schedule';
const SOURCE_TABLE = 'doctor_schedules';
const ENTITY_TYPE = 'appointment_schedule_extension';

export type AppointmentScheduleOperation = 'create' | 'update' | 'retire';

export interface AppointmentScheduleSnapshot {
  doctorId: number;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  sessionType: string;
  chamber: string | null;
  maxPatients: number;
  notes: string | null;
  isActive: boolean;
}

interface SourceMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  mapping_version: number;
}

export interface AppointmentScheduleRouteContext {
  tenantId: string;
  sourcePublicId: string;
  extensionPublicId: string;
  practitionerPublicId: string;
  mapped: boolean;
  mappingStatus: 'mapped' | 'retired' | null;
  mappingVersion: number;
}

export interface RecordAppointmentScheduleExtensionInput {
  context: AppointmentScheduleRouteContext;
  operation: AppointmentScheduleOperation;
  snapshot: AppointmentScheduleSnapshot;
  authoritativeStatements: readonly CanonicalPreparedStatement[];
  actorUserPublicId?: string | null;
  actorSystemKey: string;
  idempotencyKey: string;
  occurredAtUtc: string;
  businessDate: string;
}

export interface AppointmentScheduleExtensionResult {
  extensionPublicId: string;
  operation: AppointmentScheduleOperation;
  mappingVersion: number;
  status: 'active' | 'retired';
}

function exact(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function normalizedSnapshot(snapshot: AppointmentScheduleSnapshot): AppointmentScheduleSnapshot {
  const startTime = exact(snapshot.startTime, 'startTime');
  const endTime = exact(snapshot.endTime, 'endTime');
  if (startTime >= endTime) throw new RangeError('schedule endTime must be after startTime');
  return {
    doctorId: positive(snapshot.doctorId, 'doctorId'),
    dayOfWeek: exact(snapshot.dayOfWeek, 'dayOfWeek'),
    startTime,
    endTime,
    sessionType: exact(snapshot.sessionType, 'sessionType'),
    chamber: snapshot.chamber?.trim() || null,
    maxPatients: positive(snapshot.maxPatients, 'maxPatients'),
    notes: snapshot.notes?.trim() || null,
    isActive: Boolean(snapshot.isActive),
  };
}

export async function createAppointmentScheduleSourceKey(
  tenantId: string,
  suppliedOperationKey?: string | null,
): Promise<string> {
  const tenant = exact(tenantId, 'tenantId');
  const operationKey = suppliedOperationKey?.trim();
  return operationKey
    ? createDeterministicSourceId('dschsrc', tenant, 'doctor_schedule_route', operationKey)
    : `dschsrc_${crypto.randomUUID().replace(/-/g, '')}`;
}

export async function buildAppointmentScheduleRouteContext(
  db: CanonicalBatchDatabase,
  input: { tenantId: string; sourcePublicId: string; doctorId: number },
): Promise<AppointmentScheduleRouteContext> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const practitionerPublicId = await resolveAppointmentRoutePractitioner(
    db,
    tenantId,
    positive(input.doctorId, 'doctorId'),
  );
  if (!practitionerPublicId) throw new Error('doctor schedule requires an exact Canonical practitioner mapping');
  const extensionPublicId = await createDeterministicSourceId(
    'apptsch',
    tenantId,
    SOURCE_TYPE,
    sourcePublicId,
  );
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status,mapping_version
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, ENTITY_TYPE, SOURCE_TYPE, sourcePublicId).first<SourceMappingRow>();
  if (mapping && mapping.canonical_public_id !== extensionPublicId) {
    throw new Error('doctor schedule source mapping belongs to another extension');
  }
  if (mapping && !['mapped', 'retired'].includes(mapping.mapping_status)) {
    throw new Error('doctor schedule source mapping is not exact');
  }
  return {
    tenantId,
    sourcePublicId,
    extensionPublicId,
    practitionerPublicId,
    mapped: Boolean(mapping),
    mappingStatus: mapping ? mapping.mapping_status as 'mapped' | 'retired' : null,
    mappingVersion: mapping ? positive(Number(mapping.mapping_version), 'mappingVersion') : 0,
  };
}

export async function recordAppointmentScheduleExtension(
  db: CanonicalBatchDatabase,
  raw: RecordAppointmentScheduleExtensionInput,
): Promise<CanonicalCommandResult<AppointmentScheduleExtensionResult>> {
  const context = raw.context;
  const operation = raw.operation;
  if (!['create', 'update', 'retire'].includes(operation)) throw new RangeError('schedule operation is invalid');
  const snapshot = normalizedSnapshot(raw.snapshot);
  if (operation === 'retire' && snapshot.isActive) throw new Error('retired schedule snapshot must be inactive');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const actorSystemKey = exact(raw.actorSystemKey, 'actorSystemKey');
  const request = {
    extensionPublicId: context.extensionPublicId,
    sourcePublicId: context.sourcePublicId,
    practitionerPublicId: context.practitionerPublicId,
    operation,
    snapshot,
    actorUserPublicId: raw.actorUserPublicId ?? null,
    actorSystemKey,
    businessDate: exact(raw.businessDate, 'businessDate'),
  };
  const replay = await readCanonicalCommandReplay<AppointmentScheduleExtensionResult>(db, {
    tenantId: context.tenantId,
    commandName: COMMAND_NAME,
    idempotencyKey,
    request,
  });
  if (replay) return replay;

  if (operation === 'create' && context.mapped) {
    throw new Error('doctor schedule source is already mapped');
  }
  if (operation === 'update' && context.mappingStatus === 'retired') {
    throw new Error('retired doctor schedule extension cannot be updated');
  }
  if (operation === 'retire' && context.mappingStatus === 'retired') {
    throw new Error('doctor schedule extension is already retired');
  }
  const sourceEvidenceSha256 = await createSourceEvidenceSha256(request);
  const nextVersion = context.mappingVersion + 1;
  const status = operation === 'retire' ? 'retired' : 'active';
  const result: AppointmentScheduleExtensionResult = {
    extensionPublicId: context.extensionPublicId,
    operation,
    mappingVersion: nextVersion,
    status,
  };
  const mappingStatement = context.mapped
    ? db.prepare(`
        UPDATE canonical_source_mappings
        SET mapping_status=?,mapping_version=?,evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
          AND canonical_public_id=? AND mapping_version=?
      `).bind(
        operation === 'retire' ? 'retired' : 'mapped',
        nextVersion,
        sourceEvidenceSha256,
        raw.occurredAtUtc,
        context.tenantId,
        ENTITY_TYPE,
        SOURCE_TYPE,
        context.sourcePublicId,
        context.extensionPublicId,
        context.mappingVersion,
      )
    : db.prepare(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        context.tenantId,
        ENTITY_TYPE,
        context.extensionPublicId,
        SOURCE_TYPE,
        context.sourcePublicId,
        SOURCE_TABLE,
        operation === 'retire' ? 'retired' : 'mapped',
        nextVersion,
        sourceEvidenceSha256,
        raw.occurredAtUtc,
        raw.occurredAtUtc,
      );
  const eventPublicId = await createDeterministicSourceId(
    'apptschevt',
    context.tenantId,
    COMMAND_NAME,
    idempotencyKey,
  );
  return runCanonicalBatch(db, {
    tenantId: context.tenantId,
    commandName: COMMAND_NAME,
    idempotencyKey,
    request,
    authoritativeStatements: raw.authoritativeStatements,
    statements: [mappingStatement],
    result,
    event: {
      eventPublicId,
      aggregateType: 'canonical_appointment_schedule_extension',
      aggregatePublicId: context.extensionPublicId,
      eventType: `canonical.appointment.schedule-extension.${operation}`,
      eventVersion: nextVersion,
      occurredAtUtc: raw.occurredAtUtc,
      businessDate: raw.businessDate,
      payload: result,
    },
  });
}
