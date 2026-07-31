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

export type AppointmentStatus =
  | 'requested'
  | 'scheduled'
  | 'confirmed'
  | 'arrived'
  | 'checked_in'
  | 'fulfilled'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled'
  | 'entered_in_error';

export type AppointmentKind =
  | 'new_patient'
  | 'follow_up'
  | 'report_review'
  | 'free_visit'
  | 'emergency_request'
  | 'telemedicine'
  | 'other';

export type AppointmentModality = 'in_person' | 'telemedicine' | 'home_visit' | 'other';
export type AppointmentSchedulingChannel =
  | 'reception'
  | 'patient_portal'
  | 'marketplace'
  | 'doctor_follow_up'
  | 'import'
  | 'other';
export type AppointmentTokenAssignmentType = 'none' | 'auto' | 'reserved' | 'manual';
export type AppointmentEncounterLinkType =
  | 'fulfilled_by'
  | 'converted_to_emergency'
  | 'converted_to_inpatient'
  | 'approved_manual';
export type AppointmentEncounterLinkStatus = 'retired' | 'rejected';

interface AppointmentActorInput {
  actorUserPublicId?: string | null;
  actorSystemKey?: string | null;
}

interface AppointmentCommandBase extends AppointmentActorInput {
  tenantId: string;
  idempotencyKey: string;
  eventPublicId?: string;
  occurredAtUtc: string;
  businessDate: string;
}

export interface AppointmentQuoteInput {
  amountMinor: number;
  currencyCode: string;
  source: string;
  effectiveAtUtc: string;
}

export interface AppointmentLegacyBootstrapInput {
  currentStatus: AppointmentStatus;
  encounterPublicId?: string | null;
  linkType?: AppointmentEncounterLinkType;
}

export interface CreateAppointmentIntentInput extends AppointmentCommandBase {
  appointmentPublicId?: string;
  patientLinkPublicId: string;
  requestedPractitionerPublicId?: string | null;
  requestedServiceItemPublicId?: string | null;
  requestedLocationPublicId?: string | null;
  appointmentKind: AppointmentKind;
  modality: AppointmentModality;
  schedulingChannel: AppointmentSchedulingChannel;
  requestedStartUtc: string;
  requestedEndUtc: string;
  timezone: string;
  \u0074okenNumber?: number | null;
  \u0074okenAssignmentType: AppointmentTokenAssignmentType;
  initialStatus?: 'requested' | 'scheduled' | 'confirmed';
  legacyBootstrap?: AppointmentLegacyBootstrapInput;
  requestNote?: string | null;
  referralPractitionerPublicId?: string | null;
  quote?: AppointmentQuoteInput | null;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
}

export interface AppointmentStatusResult {
  appointmentPublicId: string;
  currentStatus: AppointmentStatus;
  statusVersion: number;
}

export interface TransitionAppointmentStatusInput extends AppointmentCommandBase {
  appointmentPublicId: string;
  toStatus: Exclude<AppointmentStatus, 'fulfilled' | 'rescheduled'>;
  expectedVersion: number;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface RescheduleAppointmentInput extends AppointmentCommandBase {
  appointmentPublicId: string;
  expectedVersion: number;
  newAppointmentPublicId?: string;
  requestedPractitionerPublicId?: string | null;
  requestedStartUtc: string;
  requestedEndUtc: string;
  timezone: string;
  \u0074okenNumber?: number | null;
  \u0074okenAssignmentType: AppointmentTokenAssignmentType;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  reasonCode: string;
}

export interface RescheduleAppointmentResult {
  previousAppointmentPublicId: string;
  previousStatusVersion: number;
  newAppointmentPublicId: string;
  newStatusVersion: number;
}

export interface FulfilAppointmentInput extends AppointmentCommandBase {
  appointmentPublicId: string;
  encounterPublicId: string;
  linkPublicId?: string;
  linkType: AppointmentEncounterLinkType;
  expectedVersion: number;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface FulfilAppointmentResult extends AppointmentStatusResult {
  encounterPublicId: string;
  linkPublicId: string;
  linkStatus: 'active';
}

export interface RetireAppointmentEncounterLinkInput extends AppointmentCommandBase {
  appointmentPublicId: string;
  linkPublicId: string;
  expectedVersion: number;
  linkStatus: AppointmentEncounterLinkStatus;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface RetireAppointmentEncounterLinkResult extends AppointmentStatusResult {
  linkPublicId: string;
  linkStatus: AppointmentEncounterLinkStatus;
}

interface CurrentAppointmentRow {
  patient_link_public_id: string;
  requested_practitioner_public_id: string | null;
  requested_service_item_public_id: string | null;
  requested_location_public_id: string | null;
  appointment_kind: AppointmentKind;
  modality: AppointmentModality;
  scheduling_channel: AppointmentSchedulingChannel;
  requested_start_utc: string;
  requested_end_utc: string;
  business_date: string;
  timezone: string;
  \u0074oken_number: number | null;
  \u0074oken_assignment_type: AppointmentTokenAssignmentType;
  current_status: AppointmentStatus;
  status_version: number;
  request_note: string | null;
  referral_practitioner_public_id: string | null;
  quoted_amount_minor: number | null;
  currency_code: string | null;
  quote_source: string | null;
  quote_effective_at_utc: string | null;
}

interface PatientLinkRow {
  legacy_patient_id: number;
  link_status: string;
  effective_to_utc: string | null;
}
interface PractitionerRow { status: string }
interface ServiceRow { status: string }
interface SourceMappingRow { canonical_public_id: string | null; mapping_status: string }
interface EncounterRow { legacy_patient_id: number; status: string }
interface ActiveLinkRow {
  link_public_id: string;
  appointment_public_id: string;
  encounter_public_id: string;
  link_status: string;
}

const CREATE_COMMAND = 'canonical.appointment.create';
const TRANSITION_COMMAND = 'canonical.appointment.transition';
const RESCHEDULE_COMMAND = 'canonical.appointment.reschedule';
const FULFIL_COMMAND = 'canonical.appointment.fulfil';
const RETIRE_LINK_COMMAND = 'canonical.appointment.encounter-link.retire';

const STATUSES = new Set<AppointmentStatus>([
  'requested', 'scheduled', 'confirmed', 'arrived', 'checked_in',
  'fulfilled', 'cancelled', 'no_show', 'rescheduled', 'entered_in_error',
]);

const TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  requested: ['scheduled', 'confirmed', 'cancelled', 'entered_in_error'],
  scheduled: ['confirmed', 'arrived', 'checked_in', 'cancelled', 'no_show', 'entered_in_error'],
  confirmed: ['arrived', 'checked_in', 'cancelled', 'no_show', 'entered_in_error'],
  arrived: ['checked_in', 'cancelled', 'no_show', 'entered_in_error'],
  checked_in: ['entered_in_error'],
  fulfilled: ['entered_in_error'],
  cancelled: [],
  no_show: [],
  rescheduled: [],
  entered_in_error: [],
};

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

function nonnegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
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

function validateBusinessDate(value: string): string {
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

function appointmentStatus(value: string, label = 'appointment status'): AppointmentStatus {
  if (!STATUSES.has(value as AppointmentStatus)) throw new RangeError(`${label} is invalid`);
  return value as AppointmentStatus;
}

function appointmentKind(value: string): AppointmentKind {
  if (!['new_patient', 'follow_up', 'report_review', 'free_visit', 'emergency_request', 'telemedicine', 'other'].includes(value)) {
    throw new RangeError('appointmentKind is invalid');
  }
  return value as AppointmentKind;
}

function appointmentModality(value: string): AppointmentModality {
  if (!['in_person', 'telemedicine', 'home_visit', 'other'].includes(value)) {
    throw new RangeError('modality is invalid');
  }
  return value as AppointmentModality;
}

function schedulingChannel(value: string): AppointmentSchedulingChannel {
  if (!['reception', 'patient_portal', 'marketplace', 'doctor_follow_up', 'import', 'other'].includes(value)) {
    throw new RangeError('schedulingChannel is invalid');
  }
  return value as AppointmentSchedulingChannel;
}

function queueNumber(
  type: AppointmentTokenAssignmentType,
  value: number | null | undefined,
): { \u0074okenAssignmentType: AppointmentTokenAssignmentType; \u0074okenNumber: number | null } {
  if (!['none', 'auto', 'reserved', 'manual'].includes(type)) throw new RangeError('tokenAssignmentType is invalid');
  if (type === 'none') {
    if (value != null) throw new RangeError('tokenNumber must be null when tokenAssignmentType is none');
    return { \u0074okenAssignmentType: type, \u0074okenNumber: null };
  }
  return { \u0074okenAssignmentType: type, \u0074okenNumber: positive(Number(value), 'tokenNumber') };
}

function actor(input: AppointmentActorInput): { actorUserPublicId: string | null; actorSystemKey: string | null } {
  const actorUserPublicId = optionalExact(input.actorUserPublicId, 'actorUserPublicId');
  const actorSystemKey = optionalExact(input.actorSystemKey, 'actorSystemKey');
  if (actorUserPublicId == null && actorSystemKey == null) {
    throw new TypeError('actorUserPublicId or actorSystemKey is required');
  }
  return { actorUserPublicId, actorSystemKey };
}

function commandBase(input: AppointmentCommandBase) {
  return {
    tenantId: exact(input.tenantId, 'tenantId'),
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    occurredAtUtc: utc(input.occurredAtUtc, 'occurredAtUtc'),
    businessDate: validateBusinessDate(input.businessDate),
    ...actor(input),
  };
}

function validateInterval(start: string, end: string): { start: string; end: string } {
  const normalizedStart = utc(start, 'requestedStartUtc');
  const normalizedEnd = utc(end, 'requestedEndUtc');
  if (Date.parse(normalizedEnd) < Date.parse(normalizedStart)) {
    throw new RangeError('requestedEndUtc cannot be before requestedStartUtc');
  }
  return { start: normalizedStart, end: normalizedEnd };
}

function validateQuote(input: AppointmentQuoteInput | null | undefined): AppointmentQuoteInput | null {
  if (input == null) return null;
  const currencyCode = exact(input.currencyCode, 'quote.currencyCode');
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new RangeError('quote.currencyCode must be three uppercase letters');
  return {
    amountMinor: nonnegative(input.amountMinor, 'quote.amountMinor'),
    currencyCode,
    source: exact(input.source, 'quote.source'),
    effectiveAtUtc: utc(input.effectiveAtUtc, 'quote.effectiveAtUtc'),
  };
}

async function deterministicId(
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

async function outboxEventId(
  tenantId: string,
  idempotencyKey: string,
  provided: string | undefined,
): Promise<string> {
  return deterministicId('apptevt', tenantId, 'appointment_command', idempotencyKey, provided, 'eventPublicId');
}

async function statusEventId(tenantId: string, idempotencyKey: string, suffix = 'status'): Promise<string> {
  return createDeterministicSourceId('apptstevt', tenantId, suffix, idempotencyKey);
}

async function appointmentLinkId(
  tenantId: string,
  appointmentPublicId: string,
  encounterPublicId: string,
  provided: string | undefined,
): Promise<string> {
  return deterministicId('apptlink', tenantId, appointmentPublicId, encounterPublicId, provided, 'linkPublicId');
}

async function requireAppointment(
  db: CanonicalBatchDatabase,
  tenantId: string,
  appointmentPublicId: string,
): Promise<CurrentAppointmentRow> {
  const row = await db.prepare(`
    SELECT patient_link_public_id,requested_practitioner_public_id,
           requested_service_item_public_id,requested_location_public_id,
           appointment_kind,modality,scheduling_channel,requested_start_utc,
           requested_end_utc,business_date,timezone,token_number,token_assignment_type,
           current_status,status_version,request_note,referral_practitioner_public_id,
           quoted_amount_minor,currency_code,quote_source,quote_effective_at_utc
    FROM canonical_appointments
    WHERE tenant_id=? AND appointment_public_id=?
    LIMIT 1
  `).bind(tenantId, appointmentPublicId).first<CurrentAppointmentRow>();
  if (!row) throw new Error('appointment not found');
  return row;
}

async function requirePatientLink(
  db: CanonicalBatchDatabase,
  tenantId: string,
  patientLinkPublicId: string,
): Promise<PatientLinkRow> {
  const row = await db.prepare(`
    SELECT legacy_patient_id,link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=?
    LIMIT 1
  `).bind(tenantId, patientLinkPublicId).first<PatientLinkRow>();
  if (!row) throw new Error('patient link not found');
  if (row.link_status === 'rejected' || row.link_status === 'retired' || row.effective_to_utc != null) {
    throw new Error('appointment requires an active patient link');
  }
  return row;
}

async function requireActivePractitioner(
  db: CanonicalBatchDatabase,
  tenantId: string,
  practitionerPublicId: string | null,
  label: string,
): Promise<void> {
  if (practitionerPublicId == null) return;
  const row = await db.prepare(`
    SELECT status FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=?
    LIMIT 1
  `).bind(tenantId, practitionerPublicId).first<PractitionerRow>();
  if (!row || row.status !== 'active') throw new Error(`${label} requires an active practitioner`);
}

async function requireActiveService(
  db: CanonicalBatchDatabase,
  tenantId: string,
  servicePublicId: string | null,
): Promise<void> {
  if (servicePublicId == null) return;
  const row = await db.prepare(`
    SELECT status FROM canonical_service_catalog_items
    WHERE tenant_id=? AND service_public_id=?
    LIMIT 1
  `).bind(tenantId, servicePublicId).first<ServiceRow>();
  if (!row || row.status !== 'active') throw new Error('appointment requires an active service item');
}

async function requireSourceMappingAvailable(
  db: CanonicalBatchDatabase,
  input: { tenantId: string; sourceType: string; sourcePublicId: string; appointmentPublicId: string },
): Promise<void> {
  const row = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='appointment' AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.sourceType, input.sourcePublicId).first<SourceMappingRow>();
  if (!row) return;
  if (row.mapping_status !== 'mapped' || row.canonical_public_id !== input.appointmentPublicId) {
    throw new Error('appointment source mapping already belongs to another appointment');
  }
  throw new Error('appointment source mapping already exists without replay evidence');
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    appointmentPublicId: string;
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
    ) VALUES (?, 'appointment', ?, ?, ?, ?, 'mapped', 1, NULL, ?, ?, ?)
  `).bind(
    input.tenantId,
    input.appointmentPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

function statusEventStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    appointmentPublicId: string;
    eventType: string;
    fromStatus: AppointmentStatus | null;
    toStatus: AppointmentStatus;
    sequence: number;
    reasonCode: string;
    actorUserPublicId: string | null;
    actorSystemKey: string | null;
    idempotencyKey: string;
    sourceEvidenceSha256: string;
    occurredAtUtc: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_appointment_status_events (
      tenant_id,event_public_id,appointment_public_id,event_type,from_status,to_status,
      sequence,reason_code,safe_note,actor_user_public_id,actor_system_key,
      idempotency_key,source_evidence_sha256,occurred_at_utc,created_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.eventPublicId,
    input.appointmentPublicId,
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

function safeStatusResult(
  appointmentPublicId: string,
  currentStatus: AppointmentStatus,
  statusVersion: number,
): AppointmentStatusResult {
  return { appointmentPublicId, currentStatus, statusVersion };
}

export async function createAppointmentIntent(
  db: CanonicalBatchDatabase,
  raw: CreateAppointmentIntentInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<AppointmentStatusResult>> {
  const base = commandBase(raw);
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = hash(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const appointmentPublicId = await deterministicId(
    'appt', base.tenantId, sourceType, sourcePublicId, raw.appointmentPublicId, 'appointmentPublicId',
  );
  const patientLinkPublicId = exact(raw.patientLinkPublicId, 'patientLinkPublicId');
  const requestedPractitionerPublicId = optionalExact(
    raw.requestedPractitionerPublicId, 'requestedPractitionerPublicId',
  );
  const requestedServiceItemPublicId = optionalExact(
    raw.requestedServiceItemPublicId, 'requestedServiceItemPublicId',
  );
  const requestedLocationPublicId = optionalExact(raw.requestedLocationPublicId, 'requestedLocationPublicId');
  const referralPractitionerPublicId = optionalExact(
    raw.referralPractitionerPublicId, 'referralPractitionerPublicId',
  );
  const resolvedKind = appointmentKind(raw.appointmentKind);
  const resolvedModality = appointmentModality(raw.modality);
  const resolvedChannel = schedulingChannel(raw.schedulingChannel);
  const interval = validateInterval(raw.requestedStartUtc, raw.requestedEndUtc);
  const timezone = exact(raw.timezone, 'timezone');
  const resolvedQueue = queueNumber(raw.\u0074okenAssignmentType, raw.\u0074okenNumber);
  const legacyBootstrap = raw.legacyBootstrap ?? null;
  let initialStatus: AppointmentStatus;
  let bootstrapEncounterPublicId: string | null = null;
  let bootstrapLinkType: AppointmentEncounterLinkType | null = null;
  if (legacyBootstrap) {
    if (!['legacy_appointment', 'legacy_consultation'].includes(sourceType)) {
      throw new Error('legacy appointment bootstrap requires a reviewed legacy source type');
    }
    if (base.actorSystemKey !== 'canonical.appointment.route-bootstrap') {
      throw new Error('legacy appointment bootstrap requires the reviewed route-bootstrap actor');
    }
    initialStatus = appointmentStatus(legacyBootstrap.currentStatus, 'legacyBootstrap.currentStatus');
    bootstrapEncounterPublicId = optionalExact(
      legacyBootstrap.encounterPublicId,
      'legacyBootstrap.encounterPublicId',
    );
    bootstrapLinkType = legacyBootstrap.linkType == null
      ? null
      : validateLinkType(legacyBootstrap.linkType);
    if (initialStatus === 'fulfilled' && !bootstrapEncounterPublicId) {
      throw new Error('fulfilled legacy appointment bootstrap requires exact encounter evidence');
    }
    if (initialStatus === 'fulfilled' && bootstrapLinkType == null) bootstrapLinkType = 'fulfilled_by';
    if (initialStatus !== 'fulfilled' && (bootstrapEncounterPublicId || bootstrapLinkType)) {
      throw new Error('legacy bootstrap encounter evidence is allowed only for fulfilled status');
    }
  } else {
    initialStatus = appointmentStatus(raw.initialStatus ?? 'scheduled', 'initialStatus');
    if (!['requested', 'scheduled', 'confirmed'].includes(initialStatus)) {
      throw new RangeError('initialStatus must be requested, scheduled, or confirmed');
    }
  }
  const requestNote = optionalExact(raw.requestNote, 'requestNote');
  const resolvedQuote = validateQuote(raw.quote);
  const resolvedOutboxEventId = await outboxEventId(base.tenantId, base.idempotencyKey, raw.eventPublicId);
  const resolvedStatusEventId = await statusEventId(base.tenantId, base.idempotencyKey);

  const request = {
    appointmentPublicId,
    patientLinkPublicId,
    requestedPractitionerPublicId,
    requestedServiceItemPublicId,
    requestedLocationPublicId,
    appointmentKind: resolvedKind,
    modality: resolvedModality,
    schedulingChannel: resolvedChannel,
    requestedStartUtc: interval.start,
    requestedEndUtc: interval.end,
    businessDate: base.businessDate,
    timezone,
    \u0074okenNumber: resolvedQueue.\u0074okenNumber,
    \u0074okenAssignmentType: resolvedQueue.\u0074okenAssignmentType,
    initialStatus,
    legacyBootstrap: legacyBootstrap ? {
      currentStatus: initialStatus,
      encounterPublicId: bootstrapEncounterPublicId,
      linkType: bootstrapLinkType,
    } : null,
    requestNote,
    referralPractitionerPublicId,
    quote: resolvedQuote,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
  };
  const replay = await readCanonicalCommandReplay<AppointmentStatusResult>(db, {
    tenantId: base.tenantId,
    commandName: CREATE_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const patientLink = await requirePatientLink(db, base.tenantId, patientLinkPublicId);
  await requireActivePractitioner(db, base.tenantId, requestedPractitionerPublicId, 'appointment');
  await requireActivePractitioner(db, base.tenantId, referralPractitionerPublicId, 'referral');
  await requireActiveService(db, base.tenantId, requestedServiceItemPublicId);

  let bootstrapLinkPublicId: string | null = null;
  if (bootstrapEncounterPublicId) {
    const encounter = await db.prepare(`
      SELECT legacy_patient_id,status FROM canonical_encounters
      WHERE tenant_id=? AND encounter_public_id=?
      LIMIT 1
    `).bind(base.tenantId, bootstrapEncounterPublicId).first<EncounterRow>();
    if (!encounter) throw new Error('legacy appointment bootstrap encounter not found');
    if (!['in_progress', 'completed'].includes(encounter.status)) {
      throw new Error(`legacy appointment bootstrap encounter status is ${encounter.status}`);
    }
    if (Number(patientLink.legacy_patient_id) !== Number(encounter.legacy_patient_id)) {
      throw new Error('legacy appointment bootstrap patient identity does not agree with encounter');
    }
    const activeLink = await db.prepare(`
      SELECT link_public_id,appointment_public_id,encounter_public_id,link_status
      FROM canonical_appointment_encounter_links
      WHERE tenant_id=? AND link_status='active' AND encounter_public_id=?
      LIMIT 1
    `).bind(base.tenantId, bootstrapEncounterPublicId).first<ActiveLinkRow>();
    if (activeLink) throw new Error('legacy appointment bootstrap encounter already has an active appointment link');
    bootstrapLinkPublicId = await appointmentLinkId(
      base.tenantId,
      appointmentPublicId,
      bootstrapEncounterPublicId,
      undefined,
    );
  }

  const existing = await db.prepare(`
    SELECT current_status,status_version
    FROM canonical_appointments
    WHERE tenant_id=? AND appointment_public_id=?
    LIMIT 1
  `).bind(base.tenantId, appointmentPublicId).first<{ current_status: string; status_version: number }>();
  if (existing) throw new Error('appointmentPublicId already exists');
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    sourceType,
    sourcePublicId,
    appointmentPublicId,
  });

  const result = safeStatusResult(appointmentPublicId, initialStatus, 1);
  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: CREATE_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_appointments (
          tenant_id,appointment_public_id,patient_link_public_id,
          requested_practitioner_public_id,requested_service_item_public_id,
          requested_location_public_id,appointment_kind,modality,scheduling_channel,
          requested_start_utc,requested_end_utc,business_date,timezone,token_number,
          token_assignment_type,current_status,status_version,
          rescheduled_from_appointment_public_id,request_note,referral_practitioner_public_id,
          quoted_amount_minor,currency_code,quote_source,quote_effective_at_utc,
          source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,NULL,?,?,?,?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        appointmentPublicId,
        patientLinkPublicId,
        requestedPractitionerPublicId,
        requestedServiceItemPublicId,
        requestedLocationPublicId,
        resolvedKind,
        resolvedModality,
        resolvedChannel,
        interval.start,
        interval.end,
        base.businessDate,
        timezone,
        resolvedQueue.\u0074okenNumber,
        resolvedQueue.\u0074okenAssignmentType,
        initialStatus,
        requestNote,
        referralPractitionerPublicId,
        resolvedQuote?.amountMinor ?? null,
        resolvedQuote?.currencyCode ?? null,
        resolvedQuote?.source ?? null,
        resolvedQuote?.effectiveAtUtc ?? null,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.occurredAtUtc,
      ),
      statusEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: resolvedStatusEventId,
        appointmentPublicId,
        eventType: 'created',
        fromStatus: null,
        toStatus: initialStatus,
        sequence: 1,
        reasonCode: 'created',
        actorUserPublicId: base.actorUserPublicId,
        actorSystemKey: base.actorSystemKey,
        idempotencyKey: base.idempotencyKey,
        sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        appointmentPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      ...(bootstrapEncounterPublicId && bootstrapLinkPublicId && bootstrapLinkType ? [db.prepare(`
        INSERT INTO canonical_appointment_encounter_links (
          tenant_id,link_public_id,appointment_public_id,encounter_public_id,
          link_type,link_status,source_evidence_sha256,created_at_utc,retired_at_utc
        ) VALUES (?,?,?,?,?,'active',?,?,NULL)
      `).bind(
        base.tenantId,
        bootstrapLinkPublicId,
        appointmentPublicId,
        bootstrapEncounterPublicId,
        bootstrapLinkType,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      )] : []),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_appointment',
      aggregatePublicId: appointmentPublicId,
      eventType: 'canonical.appointment.created',
      eventVersion: 1,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function transitionAppointmentStatus(
  db: CanonicalBatchDatabase,
  raw: TransitionAppointmentStatusInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<AppointmentStatusResult>> {
  const base = commandBase(raw);
  const appointmentPublicId = exact(raw.appointmentPublicId, 'appointmentPublicId');
  const toStatus = appointmentStatus(raw.toStatus, 'toStatus');
  if (toStatus === 'fulfilled' || toStatus === 'rescheduled') {
    throw new RangeError(`${toStatus} requires its dedicated command`);
  }
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = hash(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const resolvedOutboxEventId = await outboxEventId(base.tenantId, base.idempotencyKey, raw.eventPublicId);
  const resolvedStatusEventId = await statusEventId(base.tenantId, base.idempotencyKey);
  const request = {
    appointmentPublicId,
    toStatus,
    expectedVersion,
    reasonCode,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<AppointmentStatusResult>(db, {
    tenantId: base.tenantId,
    commandName: TRANSITION_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const current = await requireAppointment(db, base.tenantId, appointmentPublicId);
  const currentVersion = Number(current.status_version);
  if (currentVersion !== expectedVersion) {
    throw new Error(`expectedVersion ${expectedVersion} does not match current version ${currentVersion}`);
  }
  const fromStatus = appointmentStatus(current.current_status);
  if (!TRANSITIONS[fromStatus].includes(toStatus)) {
    throw new Error(`transition ${fromStatus} -> ${toStatus} is not allowed`);
  }
  const nextVersion = expectedVersion + 1;
  const result = safeStatusResult(appointmentPublicId, toStatus, nextVersion);
  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: TRANSITION_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_appointments
        SET current_status=?,status_version=status_version+1,
            source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND appointment_public_id=?
          AND current_status=? AND status_version=?
      `).bind(
        toStatus,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        appointmentPublicId,
        fromStatus,
        expectedVersion,
      ),
      statusEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: resolvedStatusEventId,
        appointmentPublicId,
        eventType: toStatus,
        fromStatus,
        toStatus,
        sequence: nextVersion,
        reasonCode,
        actorUserPublicId: base.actorUserPublicId,
        actorSystemKey: base.actorSystemKey,
        idempotencyKey: base.idempotencyKey,
        sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_appointment',
      aggregatePublicId: appointmentPublicId,
      eventType: `canonical.appointment.${toStatus}`,
      eventVersion: nextVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

export async function rescheduleAppointment(
  db: CanonicalBatchDatabase,
  raw: RescheduleAppointmentInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<RescheduleAppointmentResult>> {
  const base = commandBase(raw);
  const appointmentPublicId = exact(raw.appointmentPublicId, 'appointmentPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = hash(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const interval = validateInterval(raw.requestedStartUtc, raw.requestedEndUtc);
  const timezone = exact(raw.timezone, 'timezone');
  const practitionerOverrideProvided = raw.requestedPractitionerPublicId !== undefined;
  const requestedPractitionerPublicId = practitionerOverrideProvided
    ? optionalExact(raw.requestedPractitionerPublicId, 'requestedPractitionerPublicId')
    : undefined;
  const resolvedQueue = queueNumber(raw.\u0074okenAssignmentType, raw.\u0074okenNumber);
  const newAppointmentPublicId = await deterministicId(
    'appt', base.tenantId, sourceType, sourcePublicId, raw.newAppointmentPublicId, 'newAppointmentPublicId',
  );
  if (newAppointmentPublicId === appointmentPublicId) {
    throw new Error('reschedule requires a new appointment public ID');
  }
  const resolvedOutboxEventId = await outboxEventId(base.tenantId, base.idempotencyKey, raw.eventPublicId);
  const oldStatusEventId = await statusEventId(base.tenantId, base.idempotencyKey, 'reschedule_old');
  const newStatusEventId = await statusEventId(base.tenantId, `${base.idempotencyKey}:new`, 'reschedule_new');
  const request = {
    appointmentPublicId,
    expectedVersion,
    newAppointmentPublicId,
    practitionerOverrideProvided,
    requestedPractitionerPublicId: requestedPractitionerPublicId ?? null,
    requestedStartUtc: interval.start,
    requestedEndUtc: interval.end,
    businessDate: base.businessDate,
    timezone,
    \u0074okenNumber: resolvedQueue.\u0074okenNumber,
    \u0074okenAssignmentType: resolvedQueue.\u0074okenAssignmentType,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    reasonCode,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
  };
  const replay = await readCanonicalCommandReplay<RescheduleAppointmentResult>(db, {
    tenantId: base.tenantId,
    commandName: RESCHEDULE_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const current = await requireAppointment(db, base.tenantId, appointmentPublicId);
  const currentVersion = Number(current.status_version);
  if (currentVersion !== expectedVersion) {
    throw new Error(`expectedVersion ${expectedVersion} does not match current version ${currentVersion}`);
  }
  if (!['requested', 'scheduled', 'confirmed', 'arrived', 'checked_in'].includes(current.current_status)) {
    throw new Error(`appointment cannot be rescheduled in status ${current.current_status}`);
  }
  if (practitionerOverrideProvided) {
    await requireActivePractitioner(
      db,
      base.tenantId,
      requestedPractitionerPublicId ?? null,
      'rescheduled appointment',
    );
  }
  const existingNew = await db.prepare(`
    SELECT current_status FROM canonical_appointments
    WHERE tenant_id=? AND appointment_public_id=?
    LIMIT 1
  `).bind(base.tenantId, newAppointmentPublicId).first<{ current_status: string }>();
  if (existingNew) throw new Error('new appointment public ID already exists');
  await requireSourceMappingAvailable(db, {
    tenantId: base.tenantId,
    sourceType,
    sourcePublicId,
    appointmentPublicId: newAppointmentPublicId,
  });

  const previousStatusVersion = expectedVersion + 1;
  const result: RescheduleAppointmentResult = {
    previousAppointmentPublicId: appointmentPublicId,
    previousStatusVersion,
    newAppointmentPublicId,
    newStatusVersion: 1,
  };
  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: RESCHEDULE_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_appointments
        SET current_status='rescheduled',status_version=status_version+1,
            source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND appointment_public_id=?
          AND current_status=? AND status_version=?
      `).bind(
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        appointmentPublicId,
        current.current_status,
        expectedVersion,
      ),
      statusEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: oldStatusEventId,
        appointmentPublicId,
        eventType: 'rescheduled',
        fromStatus: current.current_status,
        toStatus: 'rescheduled',
        sequence: previousStatusVersion,
        reasonCode,
        actorUserPublicId: base.actorUserPublicId,
        actorSystemKey: base.actorSystemKey,
        idempotencyKey: base.idempotencyKey,
        sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      db.prepare(`
        INSERT INTO canonical_appointments (
          tenant_id,appointment_public_id,patient_link_public_id,
          requested_practitioner_public_id,requested_service_item_public_id,
          requested_location_public_id,appointment_kind,modality,scheduling_channel,
          requested_start_utc,requested_end_utc,business_date,timezone,token_number,
          token_assignment_type,current_status,status_version,
          rescheduled_from_appointment_public_id,request_note,referral_practitioner_public_id,
          quoted_amount_minor,currency_code,quote_source,quote_effective_at_utc,
          source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        base.tenantId,
        newAppointmentPublicId,
        current.patient_link_public_id,
        practitionerOverrideProvided
          ? requestedPractitionerPublicId ?? null
          : current.requested_practitioner_public_id,
        current.requested_service_item_public_id,
        current.requested_location_public_id,
        current.appointment_kind,
        current.modality,
        current.scheduling_channel,
        interval.start,
        interval.end,
        base.businessDate,
        timezone,
        resolvedQueue.\u0074okenNumber,
        resolvedQueue.\u0074okenAssignmentType,
        'scheduled',
        appointmentPublicId,
        current.request_note,
        current.referral_practitioner_public_id,
        current.quoted_amount_minor,
        current.currency_code,
        current.quote_source,
        current.quote_effective_at_utc,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.occurredAtUtc,
      ),
      statusEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: newStatusEventId,
        appointmentPublicId: newAppointmentPublicId,
        eventType: 'created',
        fromStatus: null,
        toStatus: 'scheduled',
        sequence: 1,
        reasonCode: 'rescheduled_created',
        actorUserPublicId: base.actorUserPublicId,
        actorSystemKey: base.actorSystemKey,
        idempotencyKey: `${base.idempotencyKey}:new`,
        sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
      sourceMappingStatement(db, {
        tenantId: base.tenantId,
        appointmentPublicId: newAppointmentPublicId,
        sourceType,
        sourcePublicId,
        sourceTable,
        sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_appointment',
      aggregatePublicId: appointmentPublicId,
      eventType: 'canonical.appointment.rescheduled',
      eventVersion: previousStatusVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

function validateLinkType(value: string): AppointmentEncounterLinkType {
  if (!['fulfilled_by', 'converted_to_emergency', 'converted_to_inpatient', 'approved_manual'].includes(value)) {
    throw new RangeError('linkType is invalid');
  }
  return value as AppointmentEncounterLinkType;
}

export async function fulfilAppointment(
  db: CanonicalBatchDatabase,
  raw: FulfilAppointmentInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<FulfilAppointmentResult>> {
  const base = commandBase(raw);
  const appointmentPublicId = exact(raw.appointmentPublicId, 'appointmentPublicId');
  const encounterPublicId = exact(raw.encounterPublicId, 'encounterPublicId');
  const resolvedLinkType = validateLinkType(raw.linkType);
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = hash(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const linkPublicId = await appointmentLinkId(
    base.tenantId, appointmentPublicId, encounterPublicId, raw.linkPublicId,
  );
  const resolvedOutboxEventId = await outboxEventId(base.tenantId, base.idempotencyKey, raw.eventPublicId);
  const resolvedStatusEventId = await statusEventId(base.tenantId, base.idempotencyKey, 'fulfil');
  const request = {
    appointmentPublicId,
    encounterPublicId,
    linkPublicId,
    linkType: resolvedLinkType,
    expectedVersion,
    reasonCode,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<FulfilAppointmentResult>(db, {
    tenantId: base.tenantId,
    commandName: FULFIL_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const current = await requireAppointment(db, base.tenantId, appointmentPublicId);
  const currentVersion = Number(current.status_version);
  if (currentVersion !== expectedVersion) {
    throw new Error(`expectedVersion ${expectedVersion} does not match current version ${currentVersion}`);
  }
  const fromStatus = appointmentStatus(current.current_status);
  if (!['requested', 'scheduled', 'confirmed', 'arrived', 'checked_in'].includes(fromStatus)) {
    throw new Error(`appointment cannot be fulfilled in status ${fromStatus}`);
  }
  const patientLink = await requirePatientLink(db, base.tenantId, current.patient_link_public_id);
  const encounter = await db.prepare(`
    SELECT legacy_patient_id,status FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(base.tenantId, encounterPublicId).first<EncounterRow>();
  if (!encounter) throw new Error('encounter not found');
  if (!['in_progress', 'completed'].includes(encounter.status)) {
    throw new Error(`encounter cannot fulfil an appointment in status ${encounter.status}`);
  }
  if (Number(patientLink.legacy_patient_id) !== Number(encounter.legacy_patient_id)) {
    throw new Error('patient identity does not agree across appointment and encounter');
  }
  const activeLink = await db.prepare(`
    SELECT link_public_id,appointment_public_id,encounter_public_id,link_status
    FROM canonical_appointment_encounter_links
    WHERE tenant_id=? AND link_status='active'
      AND (appointment_public_id=? OR encounter_public_id=?)
    LIMIT 1
  `).bind(base.tenantId, appointmentPublicId, encounterPublicId).first<ActiveLinkRow>();
  if (activeLink) throw new Error('appointment or encounter already has an active fulfilment link');

  const nextVersion = expectedVersion + 1;
  const result: FulfilAppointmentResult = {
    appointmentPublicId,
    encounterPublicId,
    linkPublicId,
    currentStatus: 'fulfilled',
    statusVersion: nextVersion,
    linkStatus: 'active',
  };
  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: FULFIL_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_appointments
        SET current_status='fulfilled',status_version=status_version+1,
            source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND appointment_public_id=?
          AND current_status=? AND status_version=?
      `).bind(
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        appointmentPublicId,
        fromStatus,
        expectedVersion,
      ),
      db.prepare(`
        INSERT INTO canonical_appointment_encounter_links (
          tenant_id,link_public_id,appointment_public_id,encounter_public_id,
          link_type,link_status,source_evidence_sha256,created_at_utc,retired_at_utc
        ) VALUES (?,?,?,?,?,'active',?,?,NULL)
      `).bind(
        base.tenantId,
        linkPublicId,
        appointmentPublicId,
        encounterPublicId,
        resolvedLinkType,
        sourceEvidenceSha256,
        base.occurredAtUtc,
      ),
      statusEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: resolvedStatusEventId,
        appointmentPublicId,
        eventType: 'fulfilled',
        fromStatus,
        toStatus: 'fulfilled',
        sequence: nextVersion,
        reasonCode,
        actorUserPublicId: base.actorUserPublicId,
        actorSystemKey: base.actorSystemKey,
        idempotencyKey: base.idempotencyKey,
        sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_appointment',
      aggregatePublicId: appointmentPublicId,
      eventType: 'canonical.appointment.fulfilled',
      eventVersion: nextVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

function validateRetiredLinkStatus(value: string): AppointmentEncounterLinkStatus {
  if (value !== 'retired' && value !== 'rejected') throw new RangeError('linkStatus must be retired or rejected');
  return value;
}

export async function retireAppointmentEncounterLink(
  db: CanonicalBatchDatabase,
  raw: RetireAppointmentEncounterLinkInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<RetireAppointmentEncounterLinkResult>> {
  const base = commandBase(raw);
  const appointmentPublicId = exact(raw.appointmentPublicId, 'appointmentPublicId');
  const linkPublicId = exact(raw.linkPublicId, 'linkPublicId');
  const expectedVersion = positive(raw.expectedVersion, 'expectedVersion');
  const linkStatus = validateRetiredLinkStatus(raw.linkStatus);
  const reasonCode = exact(raw.reasonCode, 'reasonCode');
  const sourceEvidenceSha256 = hash(raw.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const resolvedOutboxEventId = await outboxEventId(base.tenantId, base.idempotencyKey, raw.eventPublicId);
  const resolvedStatusEventId = await statusEventId(base.tenantId, base.idempotencyKey, 'retire_link');
  const request = {
    appointmentPublicId,
    linkPublicId,
    expectedVersion,
    linkStatus,
    reasonCode,
    sourceEvidenceSha256,
    actorUserPublicId: base.actorUserPublicId,
    actorSystemKey: base.actorSystemKey,
    businessDate: base.businessDate,
  };
  const replay = await readCanonicalCommandReplay<RetireAppointmentEncounterLinkResult>(db, {
    tenantId: base.tenantId,
    commandName: RETIRE_LINK_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const current = await requireAppointment(db, base.tenantId, appointmentPublicId);
  const currentVersion = Number(current.status_version);
  if (currentVersion !== expectedVersion) {
    throw new Error(`expectedVersion ${expectedVersion} does not match current version ${currentVersion}`);
  }
  if (current.current_status !== 'fulfilled') {
    throw new Error(`encounter link can be retired only from fulfilled status, got ${current.current_status}`);
  }
  const link = await db.prepare(`
    SELECT link_public_id,appointment_public_id,encounter_public_id,link_status
    FROM canonical_appointment_encounter_links
    WHERE tenant_id=? AND link_public_id=? AND appointment_public_id=?
    LIMIT 1
  `).bind(base.tenantId, linkPublicId, appointmentPublicId).first<ActiveLinkRow>();
  if (!link) throw new Error('appointment encounter link not found');
  if (link.link_status !== 'active') throw new Error('appointment encounter link is not active');

  const nextVersion = expectedVersion + 1;
  const result: RetireAppointmentEncounterLinkResult = {
    appointmentPublicId,
    linkPublicId,
    currentStatus: 'entered_in_error',
    statusVersion: nextVersion,
    linkStatus,
  };
  return runCanonicalBatch(db, {
    tenantId: base.tenantId,
    commandName: RETIRE_LINK_COMMAND,
    idempotencyKey: base.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_appointment_encounter_links
        SET link_status=?,source_evidence_sha256=?,retired_at_utc=?
        WHERE tenant_id=? AND link_public_id=? AND appointment_public_id=? AND link_status='active'
      `).bind(
        linkStatus,
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        linkPublicId,
        appointmentPublicId,
      ),
      db.prepare(`
        UPDATE canonical_appointments
        SET current_status='entered_in_error',status_version=status_version+1,
            source_evidence_sha256=?,updated_at_utc=?
        WHERE tenant_id=? AND appointment_public_id=?
          AND current_status='fulfilled' AND status_version=?
      `).bind(
        sourceEvidenceSha256,
        base.occurredAtUtc,
        base.tenantId,
        appointmentPublicId,
        expectedVersion,
      ),
      statusEventStatement(db, {
        tenantId: base.tenantId,
        eventPublicId: resolvedStatusEventId,
        appointmentPublicId,
        eventType: 'entered_in_error',
        fromStatus: 'fulfilled',
        toStatus: 'entered_in_error',
        sequence: nextVersion,
        reasonCode,
        actorUserPublicId: base.actorUserPublicId,
        actorSystemKey: base.actorSystemKey,
        idempotencyKey: base.idempotencyKey,
        sourceEvidenceSha256,
        occurredAtUtc: base.occurredAtUtc,
      }),
    ],
    result,
    event: {
      eventPublicId: resolvedOutboxEventId,
      aggregateType: 'canonical_appointment',
      aggregatePublicId: appointmentPublicId,
      eventType: `canonical.appointment.encounter-link.${linkStatus}`,
      eventVersion: nextVersion,
      occurredAtUtc: base.occurredAtUtc,
      businessDate: base.businessDate,
      payload: result,
    },
  });
}

