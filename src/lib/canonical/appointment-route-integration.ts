import type {
  CanonicalBatchDatabase,
  CanonicalCommandResult,
  CanonicalPreparedStatement,
} from './command-batch';
import {
  createAppointmentIntent,
  fulfilAppointment,
  rescheduleAppointment,
  transitionAppointmentStatus,
  type AppointmentKind,
  type AppointmentModality,
  type AppointmentSchedulingChannel,
  type AppointmentStatus,
  type AppointmentStatusResult,
  type FulfilAppointmentResult,
  type RescheduleAppointmentResult,
} from './commands/manage-appointment';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';

const APPOINTMENT_SOURCE_TYPE = 'legacy_appointment';
const APPOINTMENT_SOURCE_TABLE = 'appointments';
const ROUTE_BOOTSTRAP_ACTOR = 'canonical.appointment.route-bootstrap';

type QueueAssignmentType = 'none' | 'reserved' | 'auto' | 'manual';

interface LegacyAppointmentRow {
  id: number;
  patient_id: number;
  doctor_id: number | null;
  status: string;
  appt_date: string;
  appt_time: string | null;
  appointment_type: string | null;
  visit_type: string | null;
  source: string | null;
  token_no: number | null;
  token_assignment_type: string | null;
  notes: string | null;
  canonical_source_key: string | null;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface CanonicalAppointmentRow {
  current_status: string;
  status_version: number;
}

interface PatientLinkResolutionRow {
  link_count: number;
  patient_link_public_id: string | null;
}

interface DoctorSourceRow {
  canonical_source_key: string | null;
}

interface StoredCommandEnvelopeRow {
  payload_json: string;
}

export interface AppointmentRouteContext {
  tenantId: string;
  legacyAppointmentId: number;
  sourcePublicId: string;
  appointmentPublicId: string;
  mapped: boolean;
  currentStatus: AppointmentStatus;
  statusVersion: number;
  patientLinkPublicId: string;
  requestedPractitionerPublicId: string | null;
  appointmentKind: AppointmentKind;
  modality: AppointmentModality;
  schedulingChannel: AppointmentSchedulingChannel;
  requestedStartUtc: string;
  requestedEndUtc: string;
  businessDate: string;
  timezone: string;
  queueNumber: number | null;
  queueAssignmentType: QueueAssignmentType;
  requestNote: string | null;
  sourceEvidenceSha256: string;
}

interface AppointmentRouteExecution {
  authoritativeStatements: readonly CanonicalPreparedStatement[];
  actorSystemKey: string;
  actorUserPublicId?: string | null;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
  reasonCode: string;
}

export interface AppointmentRouteTransitionExecution extends AppointmentRouteExecution {
  toStatus: Exclude<AppointmentStatus, 'fulfilled' | 'rescheduled'>;
}

export interface AppointmentRouteFulfilExecution extends AppointmentRouteExecution {
  encounterPublicId: string;
}

export interface AppointmentRouteRescheduleExecution extends AppointmentRouteExecution {
  newSourcePublicId: string;
  requestedPractitionerPublicId?: string | null;
  requestedStartUtc: string;
  requestedEndUtc: string;
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

function mapKind(value: string | null): AppointmentKind {
  if (value === 'new_patient') return 'new_patient';
  if (value === 'old_patient' || value === 'follow_up') return 'follow_up';
  if (value === 'report_show' || value === 'report_review') return 'report_review';
  if (value === 'free_visit') return 'free_visit';
  if (value === 'emergency') return 'emergency_request';
  if (value === 'telemedicine') return 'telemedicine';
  return 'other';
}

function mapChannel(value: string | null): AppointmentSchedulingChannel {
  if (value === 'marketplace') return 'marketplace';
  if (value === 'patient_portal') return 'patient_portal';
  if (value === 'doctor_follow_up') return 'doctor_follow_up';
  if (value === 'import') return 'import';
  if (value == null || value === 'scheduled' || value === 'reception') return 'reception';
  return 'other';
}

function mapStatus(value: string): AppointmentStatus {
  if (value === 'requested') return 'requested';
  if (value === 'confirmed') return 'confirmed';
  if (value === 'arrived') return 'arrived';
  if (value === 'checked_in' || value === 'serving' || value === 'engaged') return 'checked_in';
  if (value === 'completed' || value === 'concluded' || value === 'fulfilled') return 'fulfilled';
  if (value === 'cancelled') return 'cancelled';
  if (value === 'no_show') return 'no_show';
  if (value === 'rescheduled') return 'rescheduled';
  if (value === 'entered_in_error') return 'entered_in_error';
  return 'scheduled';
}

function queueAssignment(value: string | null, queueNumber: number | null): QueueAssignmentType {
  if (queueNumber == null) return 'none';
  if (value === 'reserved') return 'reserved';
  if (value === 'manual') return 'manual';
  return 'auto';
}

function localDhakaDateTimeToUtc(date: string, time: string | null): string {
  const localDate = exact(date, 'appointment date');
  const localTime = (time?.trim() || '00:00').slice(0, 8);
  const normalizedTime = localTime.length === 5 ? `${localTime}:00` : localTime;
  const parsed = new Date(`${localDate}T${normalizedTime}+06:00`);
  if (Number.isNaN(parsed.getTime())) throw new RangeError('appointment date/time is invalid');
  return parsed.toISOString();
}

function addMinutes(value: string, minutes: number): string {
  return new Date(Date.parse(value) + minutes * 60_000).toISOString();
}

async function exactPatientLink(
  db: CanonicalBatchDatabase,
  tenantId: string,
  legacyPatientId: number,
): Promise<string> {
  const result = await db.prepare(`
    SELECT COUNT(*) AS link_count, MAX(patient_link_public_id) AS patient_link_public_id
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND legacy_patient_id=?
      AND effective_to_utc IS NULL
      AND link_status NOT IN ('rejected','retired')
  `).bind(tenantId, legacyPatientId).first<PatientLinkResolutionRow>();
  if (Number(result?.link_count ?? 0) !== 1 || !result?.patient_link_public_id) {
    throw new Error('appointment requires one exact active tenant patient link');
  }
  return String(result.patient_link_public_id);
}

export async function resolveAppointmentRouteEncounter(
  db: CanonicalBatchDatabase,
  tenantId: string,
  candidates: readonly { sourceType: string; sourcePublicId: string }[],
): Promise<string> {
  const resolved = new Set<string>();
  for (const candidate of candidates) {
    const sourceType = exact(candidate.sourceType, 'encounter sourceType');
    const sourcePublicId = exact(candidate.sourcePublicId, 'encounter sourcePublicId');
    const mapping = await db.prepare(`
      SELECT canonical_public_id,mapping_status
      FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type='encounter'
        AND source_type=? AND source_public_id=?
      LIMIT 1
    `).bind(tenantId, sourceType, sourcePublicId).first<MappingRow>();
    if (mapping?.mapping_status === 'mapped' && mapping.canonical_public_id) {
      resolved.add(String(mapping.canonical_public_id));
    }
  }
  if (resolved.size !== 1) {
    throw new Error('appointment fulfilment requires one exact active encounter mapping');
  }
  return [...resolved][0];
}

export async function resolveAppointmentRoutePractitioner(
  db: CanonicalBatchDatabase,
  tenantId: string,
  legacyDoctorId: number | null,
): Promise<string | null> {
  if (legacyDoctorId == null) return null;
  const doctor = await db.prepare(`
    SELECT canonical_source_key
    FROM doctors
    WHERE tenant_id=? AND id=?
    LIMIT 1
  `).bind(tenantId, legacyDoctorId).first<DoctorSourceRow>();
  if (!doctor) throw new Error('appointment doctor not found');
  const sourceKeys = [doctor.canonical_source_key?.trim() || null, String(legacyDoctorId)]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  for (const sourcePublicId of sourceKeys) {
    const mapping = await db.prepare(`
      SELECT canonical_public_id,mapping_status
      FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type='practitioner'
        AND source_type='legacy_doctor' AND source_public_id=?
      LIMIT 1
    `).bind(tenantId, sourcePublicId).first<MappingRow>();
    if (mapping?.mapping_status === 'mapped' && mapping.canonical_public_id) {
      return String(mapping.canonical_public_id);
    }
  }
  throw new Error('appointment requires one exact active practitioner mapping');
}

async function storedCommandName(
  db: CanonicalBatchDatabase,
  tenantId: string,
  idempotencyKey: string,
): Promise<string | null> {
  const row = await db.prepare(`
    SELECT payload_json
    FROM canonical_outbox_events
    WHERE tenant_id=? AND idempotency_key=?
    LIMIT 1
  `).bind(tenantId, idempotencyKey).first<StoredCommandEnvelopeRow>();
  if (!row?.payload_json) return null;
  try {
    const envelope = JSON.parse(row.payload_json) as { command?: { name?: unknown } };
    return typeof envelope.command?.name === 'string' ? envelope.command.name : null;
  } catch {
    throw new Error('stored appointment command envelope is invalid');
  }
}

export async function buildAppointmentRouteContext(
  db: CanonicalBatchDatabase,
  input: { tenantId: string; legacyAppointmentId: number },
): Promise<AppointmentRouteContext> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const legacyAppointmentId = positive(Number(input.legacyAppointmentId), 'legacyAppointmentId');
  const row = await db.prepare(`
    SELECT id,patient_id,doctor_id,status,appt_date,appt_time,appointment_type,
           visit_type,source,token_no,token_assignment_type,notes,canonical_source_key
    FROM appointments
    WHERE tenant_id=? AND id=?
    LIMIT 1
  `).bind(tenantId, legacyAppointmentId).first<LegacyAppointmentRow>();
  if (!row) throw new Error('legacy appointment not found');

  const sourcePublicId = row.canonical_source_key?.trim() || String(legacyAppointmentId);
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='appointment'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, APPOINTMENT_SOURCE_TYPE, sourcePublicId).first<MappingRow>();
  if (mapping && (mapping.mapping_status !== 'mapped' || !mapping.canonical_public_id)) {
    throw new Error('appointment source mapping is not exact and active');
  }

  const patientLinkPublicId = await exactPatientLink(db, tenantId, Number(row.patient_id));
  const requestedPractitionerPublicId = await resolveAppointmentRoutePractitioner(
    db,
    tenantId,
    row.doctor_id == null ? null : Number(row.doctor_id),
  );
  const requestedStartUtc = localDhakaDateTimeToUtc(String(row.appt_date), row.appt_time);
  const requestedEndUtc = addMinutes(requestedStartUtc, 30);
  const appointmentKind = mapKind(row.appointment_type ?? row.visit_type);
  const queueNumber = row.token_no == null ? null : Number(row.token_no);
  const queueAssignmentType = queueAssignment(row.token_assignment_type, queueNumber);
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: APPOINTMENT_SOURCE_TYPE,
    sourcePublicId,
    legacyAppointmentId,
    patientId: Number(row.patient_id),
    appointmentKind,
    requestedStartUtc,
    requestedEndUtc,
    businessDate: String(row.appt_date),
    queueNumber,
    queueAssignmentType,
    channel: mapChannel(row.source),
  });

  const appointmentPublicId = mapping?.canonical_public_id
    ? String(mapping.canonical_public_id)
    : await createDeterministicSourceId('appt', tenantId, APPOINTMENT_SOURCE_TYPE, sourcePublicId);
  let currentStatus = mapStatus(String(row.status));
  let statusVersion = 0;
  if (mapping?.canonical_public_id) {
    const canonical = await db.prepare(`
      SELECT current_status,status_version
      FROM canonical_appointments
      WHERE tenant_id=? AND appointment_public_id=?
      LIMIT 1
    `).bind(tenantId, appointmentPublicId).first<CanonicalAppointmentRow>();
    if (!canonical) throw new Error('mapped canonical appointment not found');
    currentStatus = mapStatus(String(canonical.current_status));
    statusVersion = positive(Number(canonical.status_version), 'statusVersion');
  }

  return {
    tenantId,
    legacyAppointmentId,
    sourcePublicId,
    appointmentPublicId,
    mapped: Boolean(mapping?.canonical_public_id),
    currentStatus,
    statusVersion,
    patientLinkPublicId,
    requestedPractitionerPublicId,
    appointmentKind,
    modality: appointmentKind === 'telemedicine' ? 'telemedicine' : 'in_person',
    schedulingChannel: mapChannel(row.source),
    requestedStartUtc,
    requestedEndUtc,
    businessDate: String(row.appt_date),
    timezone: 'Asia/Dhaka',
    queueNumber,
    queueAssignmentType,
    requestNote: row.notes?.trim() || null,
    sourceEvidenceSha256,
  };
}

function createRouteAppointmentInput(
  context: AppointmentRouteContext,
  input: {
    sourcePublicId: string;
    currentStatus: AppointmentStatus;
    requestedPractitionerPublicId?: string | null;
    sourceEvidenceSha256: string;
    execution: AppointmentRouteExecution;
    encounterPublicId?: string | null;
  },
) {
  return {
    tenantId: context.tenantId,
    patientLinkPublicId: context.patientLinkPublicId,
    requestedPractitionerPublicId: input.requestedPractitionerPublicId === undefined
      ? context.requestedPractitionerPublicId
      : input.requestedPractitionerPublicId,
    appointmentKind: context.appointmentKind,
    modality: context.modality,
    schedulingChannel: context.schedulingChannel,
    requestedStartUtc: context.requestedStartUtc,
    requestedEndUtc: context.requestedEndUtc,
    businessDate: input.execution.businessDate,
    timezone: context.timezone,
    \u0074okenNumber: context.queueNumber,
    \u0074okenAssignmentType: context.queueAssignmentType,
    requestNote: context.requestNote,
    sourceType: APPOINTMENT_SOURCE_TYPE,
    sourcePublicId: input.sourcePublicId,
    sourceTable: APPOINTMENT_SOURCE_TABLE,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
    actorUserPublicId: input.execution.actorUserPublicId,
    actorSystemKey: ROUTE_BOOTSTRAP_ACTOR,
    idempotencyKey: input.execution.idempotencyKey,
    occurredAtUtc: input.execution.occurredAtUtc,
    legacyBootstrap: {
      currentStatus: input.currentStatus,
      encounterPublicId: input.encounterPublicId ?? null,
      linkType: input.encounterPublicId ? 'fulfilled_by' as const : undefined,
    },
  };
}

export async function transitionRouteAppointment(
  db: CanonicalBatchDatabase,
  context: AppointmentRouteContext,
  execution: AppointmentRouteTransitionExecution,
): Promise<CanonicalCommandResult<AppointmentStatusResult>> {
  const idempotencyKey = exact(execution.idempotencyKey, 'idempotencyKey');
  const priorCommand = await storedCommandName(db, context.tenantId, idempotencyKey);
  const evidence = await createSourceEvidenceSha256({
    tenantId: context.tenantId,
    legacyAppointmentId: context.legacyAppointmentId,
    toStatus: execution.toStatus,
    reasonCode: execution.reasonCode,
  });
  if (!context.mapped || priorCommand === 'canonical.appointment.create') {
    return createAppointmentIntent(db, createRouteAppointmentInput(context, {
      sourcePublicId: context.sourcePublicId,
      currentStatus: execution.toStatus,
      sourceEvidenceSha256: evidence,
      execution: { ...execution, idempotencyKey },
    }), { authoritativeStatements: execution.authoritativeStatements });
  }
  return transitionAppointmentStatus(db, {
    tenantId: context.tenantId,
    appointmentPublicId: context.appointmentPublicId,
    toStatus: execution.toStatus,
    expectedVersion: context.statusVersion,
    reasonCode: exact(execution.reasonCode, 'reasonCode'),
    sourceEvidenceSha256: evidence,
    actorUserPublicId: execution.actorUserPublicId,
    actorSystemKey: exact(execution.actorSystemKey, 'actorSystemKey'),
    idempotencyKey: exact(execution.idempotencyKey, 'idempotencyKey'),
    occurredAtUtc: execution.occurredAtUtc,
    businessDate: execution.businessDate,
  }, { authoritativeStatements: execution.authoritativeStatements });
}

export async function fulfilRouteAppointment(
  db: CanonicalBatchDatabase,
  context: AppointmentRouteContext,
  execution: AppointmentRouteFulfilExecution,
): Promise<CanonicalCommandResult<FulfilAppointmentResult | AppointmentStatusResult>> {
  const encounterPublicId = exact(execution.encounterPublicId, 'encounterPublicId');
  const idempotencyKey = exact(execution.idempotencyKey, 'idempotencyKey');
  const priorCommand = await storedCommandName(db, context.tenantId, idempotencyKey);
  const evidence = await createSourceEvidenceSha256({
    tenantId: context.tenantId,
    legacyAppointmentId: context.legacyAppointmentId,
    encounterPublicId,
    reasonCode: execution.reasonCode,
  });
  if (!context.mapped || priorCommand === 'canonical.appointment.create') {
    return createAppointmentIntent(db, createRouteAppointmentInput(context, {
      sourcePublicId: context.sourcePublicId,
      currentStatus: 'fulfilled',
      sourceEvidenceSha256: evidence,
      execution: { ...execution, idempotencyKey },
      encounterPublicId,
    }), { authoritativeStatements: execution.authoritativeStatements });
  }
  return fulfilAppointment(db, {
    tenantId: context.tenantId,
    appointmentPublicId: context.appointmentPublicId,
    encounterPublicId,
    linkType: 'fulfilled_by',
    expectedVersion: context.statusVersion,
    reasonCode: exact(execution.reasonCode, 'reasonCode'),
    sourceEvidenceSha256: evidence,
    actorUserPublicId: execution.actorUserPublicId,
    actorSystemKey: exact(execution.actorSystemKey, 'actorSystemKey'),
    idempotencyKey: exact(execution.idempotencyKey, 'idempotencyKey'),
    occurredAtUtc: execution.occurredAtUtc,
    businessDate: execution.businessDate,
  }, { authoritativeStatements: execution.authoritativeStatements });
}

export async function rescheduleRouteAppointment(
  db: CanonicalBatchDatabase,
  context: AppointmentRouteContext,
  execution: AppointmentRouteRescheduleExecution,
): Promise<CanonicalCommandResult<RescheduleAppointmentResult | AppointmentStatusResult>> {
  const newSourcePublicId = exact(execution.newSourcePublicId, 'newSourcePublicId');
  const idempotencyKey = exact(execution.idempotencyKey, 'idempotencyKey');
  const priorCommand = await storedCommandName(db, context.tenantId, idempotencyKey);
  const requestedPractitionerPublicId = execution.requestedPractitionerPublicId === undefined
    ? context.requestedPractitionerPublicId
    : execution.requestedPractitionerPublicId;
  const requestedStartUtc = exact(execution.requestedStartUtc, 'requestedStartUtc');
  const requestedEndUtc = exact(execution.requestedEndUtc, 'requestedEndUtc');
  const evidence = await createSourceEvidenceSha256({
    tenantId: context.tenantId,
    legacyAppointmentId: context.legacyAppointmentId,
    newSourcePublicId,
    requestedPractitionerPublicId,
    requestedStartUtc,
    requestedEndUtc,
    reasonCode: execution.reasonCode,
  });
  if (!context.mapped || priorCommand === 'canonical.appointment.create') {
    const createContext = { ...context, requestedStartUtc, requestedEndUtc };
    return createAppointmentIntent(db, createRouteAppointmentInput(createContext, {
      sourcePublicId: newSourcePublicId,
      currentStatus: 'scheduled',
      requestedPractitionerPublicId,
      sourceEvidenceSha256: evidence,
      execution: { ...execution, idempotencyKey },
    }), { authoritativeStatements: execution.authoritativeStatements });
  }
  return rescheduleAppointment(db, {
    tenantId: context.tenantId,
    appointmentPublicId: context.appointmentPublicId,
    expectedVersion: context.statusVersion,
    requestedPractitionerPublicId,
    requestedStartUtc,
    requestedEndUtc,
    businessDate: execution.businessDate,
    timezone: context.timezone,
    \u0074okenNumber: context.queueNumber,
    \u0074okenAssignmentType: context.queueAssignmentType,
    sourceType: APPOINTMENT_SOURCE_TYPE,
    sourcePublicId: newSourcePublicId,
    sourceTable: APPOINTMENT_SOURCE_TABLE,
    sourceEvidenceSha256: evidence,
    reasonCode: exact(execution.reasonCode, 'reasonCode'),
    actorUserPublicId: execution.actorUserPublicId,
    actorSystemKey: exact(execution.actorSystemKey, 'actorSystemKey'),
    idempotencyKey: exact(execution.idempotencyKey, 'idempotencyKey'),
    occurredAtUtc: execution.occurredAtUtc,
  }, { authoritativeStatements: execution.authoritativeStatements });
}

export async function runAppointmentProjectionCompatibility(
  db: CanonicalBatchDatabase,
  statements: readonly CanonicalPreparedStatement[],
): Promise<void> {
  await db.batch([...statements]);
}
