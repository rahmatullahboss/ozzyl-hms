import type {
  AppointmentKind,
  AppointmentModality,
  AppointmentSchedulingChannel,
  AppointmentStatus,
  AppointmentTokenAssignmentType,
} from './commands/manage-appointment';
import { deriveBusinessDate, toUtcIso } from './time';

export type AppointmentProviderMode = 'legacy' | 'shadow' | 'canonical';
export type AppointmentProviderSourceType = 'legacy_appointment' | 'legacy_consultation';

export interface AppointmentProviderPreparedStatement {
  bind(...values: unknown[]): AppointmentProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface AppointmentProviderDatabase {
  prepare(sql: string): AppointmentProviderPreparedStatement;
}

export interface AppointmentProviderInput {
  tenantId: string;
  sourceType: AppointmentProviderSourceType;
  legacyId: number;
  timezone: string;
  identitySensitive?: boolean;
}

export interface AppointmentProviderParity {
  ok: boolean;
  mapping: boolean;
  patientLink: boolean;
  practitioner: boolean;
  kind: boolean;
  modality: boolean;
  channel: boolean;
  interval: boolean;
  businessDate: boolean;
  token: boolean;
  status: boolean;
  lineage: boolean;
  encounterLink: boolean;
}

export interface AppointmentProviderProjection {
  mode: AppointmentProviderMode;
  appointmentPublicId: string | null;
  patientLinkPublicId: string | null;
  requestedPractitionerPublicId: string | null;
  appointmentKind: AppointmentKind;
  modality: AppointmentModality;
  schedulingChannel: AppointmentSchedulingChannel;
  requestedStartUtc: string;
  requestedEndUtc: string;
  businessDate: string;
  timezone: string;
  \u0074okenNumber: number | null;
  \u0074okenAssignmentType: AppointmentTokenAssignmentType;
  currentStatus: AppointmentStatus;
  statusVersion: number;
  rescheduledFromAppointmentPublicId: string | null;
  encounterPublicId: string | null;
  legacy: {
    sourceType: AppointmentProviderSourceType;
    legacyId: number;
  };
  parity?: AppointmentProviderParity;
}

interface ProviderFlagRow {
  mode: string;
  is_enabled: number | string;
}

interface LegacyAppointmentRow {
  patient_id: number;
  doctor_id: number | null;
  appt_date: string;
  appt_time: string | null;
  appointment_type: string | null;
  visit_type: string | null;
  source: string | null;
  \u0074oken_no: number | null;
  \u0074oken_assignment_type: string | null;
  status: string;
}

interface LegacyConsultationRow {
  patient_id: number;
  doctor_id: number;
  scheduled_at: string;
  duration_min: number;
  status: string;
}

interface SourceMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface PatientLinkRow {
  patient_link_public_id: string;
  link_status: string;
  effective_to_utc: string | null;
}

interface CanonicalAppointmentRow {
  appointment_public_id: string;
  patient_link_public_id: string;
  requested_practitioner_public_id: string | null;
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
  rescheduled_from_appointment_public_id: string | null;
}

interface EncounterLinkRow {
  encounter_public_id: string;
}

interface LegacyFacts {
  sourceType: AppointmentProviderSourceType;
  legacyId: number;
  legacyPatientId: number;
  legacyDoctorId: number | null;
  appointmentKind: AppointmentKind;
  modality: AppointmentModality;
  schedulingChannel: AppointmentSchedulingChannel;
  requestedStartUtc: string;
  requestedEndUtc: string;
  businessDate: string;
  timezone: string;
  \u0074okenNumber: number | null;
  \u0074okenAssignmentType: AppointmentTokenAssignmentType;
  currentStatus: AppointmentStatus;
}

interface CanonicalFacts {
  appointmentPublicId: string;
  patientLinkPublicId: string;
  requestedPractitionerPublicId: string | null;
  appointmentKind: AppointmentKind;
  modality: AppointmentModality;
  schedulingChannel: AppointmentSchedulingChannel;
  requestedStartUtc: string;
  requestedEndUtc: string;
  businessDate: string;
  timezone: string;
  \u0074okenNumber: number | null;
  \u0074okenAssignmentType: AppointmentTokenAssignmentType;
  currentStatus: AppointmentStatus;
  statusVersion: number;
  rescheduledFromAppointmentPublicId: string | null;
  encounterPublicId: string | null;
}

const FLAG_KEY = 'canonical_appointment_provider_v1';

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

function sourceType(value: string): AppointmentProviderSourceType {
  if (value !== 'legacy_appointment' && value !== 'legacy_consultation') {
    throw new RangeError('sourceType must be legacy_appointment or legacy_consultation');
  }
  return value;
}

function localDateTimeToUtc(date: string, time: string | null, timeZone: string): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(exact(date, 'appointment date'));
  if (!dateMatch) throw new RangeError('appointment date must use YYYY-MM-DD');
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time == null ? '00:00' : exact(time, 'appointment time'));
  if (!timeMatch) throw new RangeError('appointment time must use HH:MM or HH:MM:SS');
  const desired = {
    year: Number(dateMatch[1]), month: Number(dateMatch[2]), day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]), minute: Number(timeMatch[2]), second: Number(timeMatch[3] ?? '0'),
  };
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: exact(timeZone, 'timezone'),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const desiredAsUtc = Date.UTC(
    desired.year, desired.month - 1, desired.day, desired.hour, desired.minute, desired.second,
  );
  let candidate = desiredAsUtc;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const observedAsUtc = Date.UTC(
      value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'),
    );
    const correction = desiredAsUtc - observedAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }
  const result = new Date(candidate).toISOString();
  if (deriveBusinessDate(result, timeZone) !== date) {
    throw new RangeError('appointment local date/time could not be resolved in timezone');
  }
  return result;
}

function addMinutes(utcIso: string, minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new RangeError('duration must be positive');
  return new Date(Date.parse(utcIso) + minutes * 60_000).toISOString();
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

function mapStatus(value: string): AppointmentStatus {
  if (value === 'requested') return 'requested';
  if (value === 'confirmed') return 'confirmed';
  if (value === 'arrived') return 'arrived';
  if (value === 'checked_in') return 'checked_in';
  if (value === 'completed' || value === 'concluded' || value === 'fulfilled') return 'fulfilled';
  if (value === 'cancelled') return 'cancelled';
  if (value === 'no_show') return 'no_show';
  if (value === 'rescheduled') return 'rescheduled';
  if (value === 'entered_in_error') return 'entered_in_error';
  return 'scheduled';
}

function mapChannel(value: string | null): AppointmentSchedulingChannel {
  if (value === 'marketplace') return 'marketplace';
  if (value === 'patient_portal') return 'patient_portal';
  if (value === 'doctor_follow_up') return 'doctor_follow_up';
  if (value === 'import') return 'import';
  if (value == null || value === 'scheduled' || value === 'reception') return 'reception';
  return 'other';
}

function mapQueueAssignment(value: string | null, number: number | null): AppointmentTokenAssignmentType {
  if (number == null) return 'none';
  if (value === 'reserved') return 'reserved';
  if (value === 'manual') return 'manual';
  return 'auto';
}

export async function resolveAppointmentProviderMode(
  db: AppointmentProviderDatabase,
  tenantId: string,
): Promise<AppointmentProviderMode> {
  const tenant = exact(tenantId, 'tenantId');
  let row: ProviderFlagRow | null;
  try {
    row = await db.prepare(`
      SELECT mode,is_enabled FROM canonical_feature_flags
      WHERE tenant_id=? AND flag_key=? LIMIT 1
    `).bind(tenant, FLAG_KEY).first<ProviderFlagRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*canonical_feature_flags/i.test(message)) return 'legacy';
    throw error;
  }
  if (!row || Number(row.is_enabled) !== 1) return 'legacy';
  if (row.mode === 'shadow') return 'shadow';
  if (row.mode === 'canonical') return 'canonical';
  return 'legacy';
}

async function readLegacyFacts(
  db: AppointmentProviderDatabase,
  tenantId: string,
  resolvedSourceType: AppointmentProviderSourceType,
  legacyId: number,
  timezone: string,
): Promise<LegacyFacts> {
  if (resolvedSourceType === 'legacy_appointment') {
    const row = await db.prepare(`
      SELECT patient_id,doctor_id,appt_date,appt_time,appointment_type,visit_type,source,
             token_no,token_assignment_type,status
      FROM appointments
      WHERE tenant_id=? AND id=?
      LIMIT 1
    `).bind(tenantId, legacyId).first<LegacyAppointmentRow>();
    if (!row) throw new Error('legacy appointment source not found');
    const start = localDateTimeToUtc(String(row.appt_date), row.appt_time == null ? null : String(row.appt_time), timezone);
    const kind = mapKind(row.appointment_type ?? row.visit_type);
    return {
      sourceType: resolvedSourceType,
      legacyId,
      legacyPatientId: Number(row.patient_id),
      legacyDoctorId: row.doctor_id == null ? null : Number(row.doctor_id),
      appointmentKind: kind,
      modality: kind === 'telemedicine' ? 'telemedicine' : 'in_person',
      schedulingChannel: mapChannel(row.source),
      requestedStartUtc: start,
      requestedEndUtc: addMinutes(start, 30),
      businessDate: String(row.appt_date),
      timezone,
      \u0074okenNumber: row.\u0074oken_no == null ? null : Number(row.\u0074oken_no),
      \u0074okenAssignmentType: mapQueueAssignment(
        row.\u0074oken_assignment_type,
        row.\u0074oken_no == null ? null : Number(row.\u0074oken_no),
      ),
      currentStatus: mapStatus(String(row.status)),
    };
  }

  const row = await db.prepare(`
    SELECT patient_id,doctor_id,scheduled_at,duration_min,status
    FROM consultations
    WHERE tenant_id=? AND id=?
    LIMIT 1
  `).bind(tenantId, legacyId).first<LegacyConsultationRow>();
  if (!row) throw new Error('legacy consultation source not found');
  const start = toUtcIso(String(row.scheduled_at));
  return {
    sourceType: resolvedSourceType,
    legacyId,
    legacyPatientId: Number(row.patient_id),
    legacyDoctorId: Number(row.doctor_id),
    appointmentKind: 'telemedicine',
    modality: 'telemedicine',
    schedulingChannel: 'marketplace',
    requestedStartUtc: start,
    requestedEndUtc: addMinutes(start, Number(row.duration_min)),
    businessDate: deriveBusinessDate(start, timezone),
    timezone,
    \u0074okenNumber: null,
    \u0074okenAssignmentType: 'none',
    currentStatus: mapStatus(String(row.status)),
  };
}

async function readSourceMapping(
  db: AppointmentProviderDatabase,
  tenantId: string,
  entityType: 'appointment' | 'practitioner',
  resolvedSourceType: string,
  sourcePublicId: string,
): Promise<SourceMappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, entityType, resolvedSourceType, sourcePublicId).first<SourceMappingRow>();
}

async function readPatientLink(
  db: AppointmentProviderDatabase,
  tenantId: string,
  legacyPatientId: number,
): Promise<PatientLinkRow | null> {
  return db.prepare(`
    SELECT patient_link_public_id,link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND legacy_patient_id=?
      AND link_status NOT IN ('rejected','retired')
      AND effective_to_utc IS NULL
    ORDER BY version DESC,patient_link_public_id
    LIMIT 1
  `).bind(tenantId, legacyPatientId).first<PatientLinkRow>();
}

function mappedPublicId(row: SourceMappingRow | null): string | null {
  return row?.mapping_status === 'mapped' && row.canonical_public_id
    ? String(row.canonical_public_id)
    : null;
}

async function readCanonicalFacts(
  db: AppointmentProviderDatabase,
  tenantId: string,
  appointmentPublicId: string,
): Promise<CanonicalFacts> {
  const row = await db.prepare(`
    SELECT appointment_public_id,patient_link_public_id,requested_practitioner_public_id,
           appointment_kind,modality,scheduling_channel,requested_start_utc,requested_end_utc,
           business_date,timezone,token_number,token_assignment_type,current_status,status_version,
           rescheduled_from_appointment_public_id
    FROM canonical_appointments
    WHERE tenant_id=? AND appointment_public_id=?
    LIMIT 1
  `).bind(tenantId, appointmentPublicId).first<CanonicalAppointmentRow>();
  if (!row) throw new Error('mapped canonical appointment not found');
  const link = await db.prepare(`
    SELECT encounter_public_id
    FROM canonical_appointment_encounter_links
    WHERE tenant_id=? AND appointment_public_id=? AND link_status='active'
    LIMIT 1
  `).bind(tenantId, appointmentPublicId).first<EncounterLinkRow>();
  return {
    appointmentPublicId: String(row.appointment_public_id),
    patientLinkPublicId: String(row.patient_link_public_id),
    requestedPractitionerPublicId: row.requested_practitioner_public_id == null
      ? null
      : String(row.requested_practitioner_public_id),
    appointmentKind: row.appointment_kind,
    modality: row.modality,
    schedulingChannel: row.scheduling_channel,
    requestedStartUtc: String(row.requested_start_utc),
    requestedEndUtc: String(row.requested_end_utc),
    businessDate: String(row.business_date),
    timezone: String(row.timezone),
    \u0074okenNumber: row.\u0074oken_number == null ? null : Number(row.\u0074oken_number),
    \u0074okenAssignmentType: row.\u0074oken_assignment_type,
    currentStatus: row.current_status,
    statusVersion: Number(row.status_version),
    rescheduledFromAppointmentPublicId: row.rescheduled_from_appointment_public_id == null
      ? null
      : String(row.rescheduled_from_appointment_public_id),
    encounterPublicId: link == null ? null : String(link.encounter_public_id),
  };
}

function legacyProjection(
  mode: AppointmentProviderMode,
  legacy: LegacyFacts,
  mappedAppointmentPublicId: string | null,
  patientLinkPublicId: string | null,
  practitionerPublicId: string | null,
  canonical: CanonicalFacts | null,
  parity?: AppointmentProviderParity,
): AppointmentProviderProjection {
  return {
    mode,
    appointmentPublicId: mappedAppointmentPublicId,
    patientLinkPublicId,
    requestedPractitionerPublicId: practitionerPublicId,
    appointmentKind: legacy.appointmentKind,
    modality: legacy.modality,
    schedulingChannel: legacy.schedulingChannel,
    requestedStartUtc: legacy.requestedStartUtc,
    requestedEndUtc: legacy.requestedEndUtc,
    businessDate: legacy.businessDate,
    timezone: legacy.timezone,
    \u0074okenNumber: legacy.\u0074okenNumber,
    \u0074okenAssignmentType: legacy.\u0074okenAssignmentType,
    currentStatus: legacy.currentStatus,
    statusVersion: canonical?.statusVersion ?? 0,
    rescheduledFromAppointmentPublicId: canonical?.rescheduledFromAppointmentPublicId ?? null,
    encounterPublicId: canonical?.encounterPublicId ?? null,
    legacy: { sourceType: legacy.sourceType, legacyId: legacy.legacyId },
    ...(parity == null ? {} : { parity }),
  };
}

function canonicalProjection(
  mode: AppointmentProviderMode,
  legacy: LegacyFacts,
  canonical: CanonicalFacts,
): AppointmentProviderProjection {
  return {
    mode,
    appointmentPublicId: canonical.appointmentPublicId,
    patientLinkPublicId: canonical.patientLinkPublicId,
    requestedPractitionerPublicId: canonical.requestedPractitionerPublicId,
    appointmentKind: canonical.appointmentKind,
    modality: canonical.modality,
    schedulingChannel: canonical.schedulingChannel,
    requestedStartUtc: canonical.requestedStartUtc,
    requestedEndUtc: canonical.requestedEndUtc,
    businessDate: canonical.businessDate,
    timezone: canonical.timezone,
    \u0074okenNumber: canonical.\u0074okenNumber,
    \u0074okenAssignmentType: canonical.\u0074okenAssignmentType,
    currentStatus: canonical.currentStatus,
    statusVersion: canonical.statusVersion,
    rescheduledFromAppointmentPublicId: canonical.rescheduledFromAppointmentPublicId,
    encounterPublicId: canonical.encounterPublicId,
    legacy: { sourceType: legacy.sourceType, legacyId: legacy.legacyId },
  };
}

function compareParity(
  legacy: LegacyFacts,
  mapping: SourceMappingRow,
  patientLinkPublicId: string,
  practitionerPublicId: string | null,
  canonical: CanonicalFacts,
): AppointmentProviderParity {
  const mappingMatches = mapping.mapping_status === 'mapped'
    && mapping.canonical_public_id === canonical.appointmentPublicId;
  const patientLinkMatches = patientLinkPublicId === canonical.patientLinkPublicId;
  const practitionerMatches = practitionerPublicId === canonical.requestedPractitionerPublicId;
  const kindMatches = legacy.appointmentKind === canonical.appointmentKind;
  const modalityMatches = legacy.modality === canonical.modality;
  const channelMatches = legacy.schedulingChannel === canonical.schedulingChannel;
  const intervalMatches = legacy.requestedStartUtc === canonical.requestedStartUtc
    && legacy.requestedEndUtc === canonical.requestedEndUtc;
  const businessDateMatches = legacy.businessDate === canonical.businessDate
    && legacy.timezone === canonical.timezone;
  const queueMatches = legacy.\u0074okenNumber === canonical.\u0074okenNumber
    && legacy.\u0074okenAssignmentType === canonical.\u0074okenAssignmentType;
  const statusMatches = legacy.currentStatus === canonical.currentStatus;
  const lineageMatches = canonical.rescheduledFromAppointmentPublicId == null;
  const encounterLinkMatches = legacy.currentStatus === 'fulfilled'
    ? canonical.encounterPublicId != null
    : canonical.encounterPublicId == null;
  const checks = [
    mappingMatches,
    patientLinkMatches,
    practitionerMatches,
    kindMatches,
    modalityMatches,
    channelMatches,
    intervalMatches,
    businessDateMatches,
    queueMatches,
    statusMatches,
    lineageMatches,
    encounterLinkMatches,
  ];
  return {
    ok: checks.every(Boolean),
    mapping: mappingMatches,
    patientLink: patientLinkMatches,
    practitioner: practitionerMatches,
    kind: kindMatches,
    modality: modalityMatches,
    channel: channelMatches,
    interval: intervalMatches,
    businessDate: businessDateMatches,
    token: queueMatches,
    status: statusMatches,
    lineage: lineageMatches,
    encounterLink: encounterLinkMatches,
  };
}

function failedParity(): AppointmentProviderParity {
  return {
    ok: false,
    mapping: false,
    patientLink: false,
    practitioner: false,
    kind: false,
    modality: false,
    channel: false,
    interval: false,
    businessDate: false,
    token: false,
    status: false,
    lineage: false,
    encounterLink: false,
  };
}

export async function resolveAppointmentProjection(
  db: AppointmentProviderDatabase,
  input: AppointmentProviderInput,
): Promise<AppointmentProviderProjection> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const resolvedSourceType = sourceType(input.sourceType);
  const legacyId = positive(input.legacyId, 'legacyId');
  const timezone = exact(input.timezone, 'timezone');
  const mode = await resolveAppointmentProviderMode(db, tenantId);
  const legacy = await readLegacyFacts(db, tenantId, resolvedSourceType, legacyId, timezone);
  const appointmentMapping = await readSourceMapping(
    db, tenantId, 'appointment', resolvedSourceType, String(legacyId),
  );
  const mappedAppointmentPublicId = mappedPublicId(appointmentMapping);
  const patientLink = await readPatientLink(db, tenantId, legacy.legacyPatientId);
  const patientLinkPublicId = patientLink == null ? null : String(patientLink.patient_link_public_id);
  const practitionerMapping = legacy.legacyDoctorId == null
    ? null
    : await readSourceMapping(
        db, tenantId, 'practitioner', 'legacy_doctor', String(legacy.legacyDoctorId),
      );
  const practitionerPublicId = legacy.legacyDoctorId == null ? null : mappedPublicId(practitionerMapping);
  const identityComplete = mappedAppointmentPublicId != null
    && patientLinkPublicId != null
    && (legacy.legacyDoctorId == null || practitionerPublicId != null);

  if (input.identitySensitive && !identityComplete) {
    throw new Error('explicit appointment, patient, and practitioner mappings are required for identity-sensitive resolution');
  }

  if (mode === 'legacy') {
    const canonical = mappedAppointmentPublicId == null
      ? null
      : await readCanonicalFacts(db, tenantId, mappedAppointmentPublicId);
    return legacyProjection(
      mode,
      legacy,
      mappedAppointmentPublicId,
      patientLinkPublicId,
      practitionerPublicId,
      canonical,
    );
  }

  if (mappedAppointmentPublicId == null || appointmentMapping == null) {
    if (mode === 'canonical') throw new Error('explicit appointment source mapping is required for canonical mode');
    return legacyProjection(mode, legacy, null, patientLinkPublicId, practitionerPublicId, null, failedParity());
  }

  const canonical = await readCanonicalFacts(db, tenantId, mappedAppointmentPublicId);
  if (mode === 'canonical') {
    if (!identityComplete) {
      throw new Error('explicit patient and practitioner mappings are required for canonical mode');
    }
    if (canonical.patientLinkPublicId !== patientLinkPublicId) {
      throw new Error('canonical appointment patient link conflicts with explicit legacy mapping');
    }
    if (canonical.requestedPractitionerPublicId !== practitionerPublicId) {
      throw new Error('canonical appointment practitioner conflicts with explicit legacy mapping');
    }
    return canonicalProjection(mode, legacy, canonical);
  }

  if (!identityComplete || patientLinkPublicId == null) {
    return legacyProjection(
      mode,
      legacy,
      mappedAppointmentPublicId,
      patientLinkPublicId,
      practitionerPublicId,
      canonical,
      failedParity(),
    );
  }
  return legacyProjection(
    mode,
    legacy,
    mappedAppointmentPublicId,
    patientLinkPublicId,
    practitionerPublicId,
    canonical,
    compareParity(legacy, appointmentMapping, patientLinkPublicId, practitionerPublicId, canonical),
  );
}

export function resolveAppointmentDetail(
  db: AppointmentProviderDatabase,
  input: AppointmentProviderInput,
): Promise<AppointmentProviderProjection> {
  return resolveAppointmentProjection(db, input);
}

export function resolveMarketplaceBookingProjection(
  db: AppointmentProviderDatabase,
  input: AppointmentProviderInput,
): Promise<AppointmentProviderProjection> {
  return resolveAppointmentProjection(db, { ...input, identitySensitive: true });
}

export function resolvePatientPortalAppointmentProjection(
  db: AppointmentProviderDatabase,
  input: AppointmentProviderInput,
): Promise<AppointmentProviderProjection> {
  return resolveAppointmentProjection(db, { ...input, identitySensitive: true });
}

export async function resolveAppointmentCheckIn(
  db: AppointmentProviderDatabase,
  input: AppointmentProviderInput,
): Promise<{
  appointmentPublicId: string;
  patientLinkPublicId: string;
  requestedPractitionerPublicId: string | null;
  currentStatus: AppointmentStatus;
  legacyId: number;
}> {
  const projection = await resolveAppointmentProjection(db, { ...input, identitySensitive: true });
  if (!projection.appointmentPublicId || !projection.patientLinkPublicId) {
    throw new Error('appointment check-in requires explicit appointment and patient mappings');
  }
  if (!['scheduled', 'confirmed', 'arrived'].includes(projection.currentStatus)) {
    throw new Error(`appointment cannot check in from status ${projection.currentStatus}`);
  }
  return {
    appointmentPublicId: projection.appointmentPublicId,
    patientLinkPublicId: projection.patientLinkPublicId,
    requestedPractitionerPublicId: projection.requestedPractitionerPublicId,
    currentStatus: projection.currentStatus,
    legacyId: positive(input.legacyId, 'legacyId'),
  };
}

export async function resolveAppointmentReminderProjection(
  db: AppointmentProviderDatabase,
  input: AppointmentProviderInput,
): Promise<{
  appointmentPublicId: string;
  patientLinkPublicId: string;
  requestedStartUtc: string;
  currentStatus: AppointmentStatus;
  legacyId: number;
}> {
  const projection = await resolveAppointmentProjection(db, { ...input, identitySensitive: true });
  if (!projection.appointmentPublicId || !projection.patientLinkPublicId) {
    throw new Error('appointment reminder requires explicit appointment and patient mappings');
  }
  return {
    appointmentPublicId: projection.appointmentPublicId,
    patientLinkPublicId: projection.patientLinkPublicId,
    requestedStartUtc: projection.requestedStartUtc,
    currentStatus: projection.currentStatus,
    legacyId: positive(input.legacyId, 'legacyId'),
  };
}

