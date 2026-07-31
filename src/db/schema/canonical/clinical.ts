import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { canonicalPractitioners } from './identity';
import { canonicalTenantPatientLinks } from './patient-identity';

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const canonicalCareLocations = sqliteTable(
  'canonical_care_locations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    locationPublicId: text('location_public_id').notNull(),
    parentLocationPublicId: text('parent_location_public_id'),
    locationKind: text('location_kind').notNull(),
    locationCode: text('location_code').notNull(),
    displayName: text('display_name').notNull(),
    operationalStatus: text('operational_status').notNull().default('active'),
    timezone: text('timezone').notNull(),
    version: integer('version').notNull().default(1),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_care_locations_public_id').on(table.tenantId, table.locationPublicId),
    uniqueIndex('uq_canonical_care_locations_root_code')
      .on(table.tenantId, table.locationCode)
      .where(sql`${table.parentLocationPublicId} IS NULL`),
    uniqueIndex('uq_canonical_care_locations_child_code')
      .on(table.tenantId, table.parentLocationPublicId, table.locationCode)
      .where(sql`${table.parentLocationPublicId} IS NOT NULL`),
    index('idx_canonical_care_locations_parent').on(
      table.tenantId,
      table.parentLocationPublicId,
      table.operationalStatus,
      table.locationPublicId,
    ),
    index('idx_canonical_care_locations_kind_status').on(
      table.tenantId,
      table.locationKind,
      table.operationalStatus,
      table.locationCode,
    ),
    foreignKey({
      name: 'fk_canonical_care_locations_parent',
      columns: [table.tenantId, table.parentLocationPublicId],
      foreignColumns: [table.tenantId, table.locationPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_care_locations_self_parent_check',
      sql`${table.parentLocationPublicId} IS NULL OR ${table.parentLocationPublicId} != ${table.locationPublicId}`,
    ),
    check(
      'canonical_care_locations_kind_check',
      sql`${table.locationKind} IN ('facility','branch','floor','ward','room','care_area','other')`,
    ),
    check(
      'canonical_care_locations_status_check',
      sql`${table.operationalStatus} IN ('active','inactive','retired')`,
    ),
    check('canonical_care_locations_code_check', sql`length(trim(${table.locationCode})) > 0`),
    check('canonical_care_locations_name_check', sql`length(trim(${table.displayName})) > 0`),
    check('canonical_care_locations_timezone_check', sql`length(trim(${table.timezone})) > 0`),
    check('canonical_care_locations_version_check', sql`${table.version} > 0`),
    check(
      'canonical_care_locations_evidence_check',
      sql`length(${table.sourceEvidenceSha256}) = 64
        AND ${table.sourceEvidenceSha256} = lower(${table.sourceEvidenceSha256})
        AND ${table.sourceEvidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const canonicalBeds = sqliteTable(
  'canonical_beds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    bedPublicId: text('bed_public_id').notNull(),
    locationPublicId: text('location_public_id').notNull(),
    bedCode: text('bed_code').notNull(),
    bedClass: text('bed_class').notNull(),
    operationalStatus: text('operational_status').notNull().default('active'),
    version: integer('version').notNull().default(1),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_beds_public_id').on(table.tenantId, table.bedPublicId),
    uniqueIndex('uq_canonical_beds_location_code').on(table.tenantId, table.locationPublicId, table.bedCode),
    index('idx_canonical_beds_location_status').on(
      table.tenantId,
      table.locationPublicId,
      table.operationalStatus,
      table.bedCode,
    ),
    index('idx_canonical_beds_status').on(table.tenantId, table.operationalStatus, table.bedPublicId),
    foreignKey({
      name: 'fk_canonical_beds_location',
      columns: [table.tenantId, table.locationPublicId],
      foreignColumns: [canonicalCareLocations.tenantId, canonicalCareLocations.locationPublicId],
    }).onDelete('restrict'),
    check('canonical_beds_code_check', sql`length(trim(${table.bedCode})) > 0`),
    check('canonical_beds_class_check', sql`length(trim(${table.bedClass})) > 0`),
    check(
      'canonical_beds_status_check',
      sql`${table.operationalStatus} IN ('active','inactive','maintenance','retired')`,
    ),
    check('canonical_beds_version_check', sql`${table.version} > 0`),
    check(
      'canonical_beds_evidence_check',
      sql`length(${table.sourceEvidenceSha256}) = 64
        AND ${table.sourceEvidenceSha256} = lower(${table.sourceEvidenceSha256})
        AND ${table.sourceEvidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const canonicalEncounters = sqliteTable(
  'canonical_encounters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    legacyPatientId: integer('legacy_patient_id').notNull(),
    patientLinkPublicId: text('patient_link_public_id'),
    encounterType: text('encounter_type').notNull(),
    status: text('status').notNull(),
    encounterVersion: integer('encounter_version').notNull().default(1),
    careLocationPublicId: text('care_location_public_id'),
    sourceKind: text('source_kind').notNull().default('migration'),
    sourceCommandKey: text('source_command_key'),
    startedAtUtc: text('started_at_utc').notNull(),
    endedAtUtc: text('ended_at_utc'),
    signedSnapshotSha256: text('signed_snapshot_sha256'),
    signedAtUtc: text('signed_at_utc'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_encounters_public_id').on(table.tenantId, table.encounterPublicId),
    uniqueIndex('uq_canonical_encounters_source_command')
      .on(table.tenantId, table.sourceCommandKey)
      .where(sql`${table.sourceCommandKey} IS NOT NULL`),
    index('idx_canonical_encounters_patient_time').on(
      table.tenantId,
      table.legacyPatientId,
      table.startedAtUtc,
      table.encounterPublicId,
    ),
    index('idx_canonical_encounters_patient_link_time').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.startedAtUtc,
      table.encounterPublicId,
    ),
    index('idx_canonical_encounters_location_time').on(
      table.tenantId,
      table.careLocationPublicId,
      table.startedAtUtc,
      table.encounterPublicId,
    ),
    index('idx_canonical_encounters_type_status').on(
      table.tenantId,
      table.encounterType,
      table.status,
      table.startedAtUtc,
    ),
    index('idx_canonical_encounters_status_version').on(
      table.tenantId,
      table.status,
      table.encounterVersion,
      table.startedAtUtc,
    ),
    index('idx_canonical_encounters_signed').on(table.tenantId, table.signedAtUtc, table.encounterPublicId),
    foreignKey({
      name: 'fk_canonical_encounters_patient_link',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_encounters_care_location',
      columns: [table.tenantId, table.careLocationPublicId],
      foreignColumns: [canonicalCareLocations.tenantId, canonicalCareLocations.locationPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_encounters_type_check',
      sql`${table.encounterType} IN ('outpatient','inpatient','teleconsultation','emergency','other')`,
    ),
    check(
      'canonical_encounters_status_check',
      sql`${table.status} IN ('planned','in_progress','on_hold','completed','cancelled','entered_in_error','unknown')`,
    ),
    check('canonical_encounters_version_check', sql`${table.encounterVersion} > 0`),
    check(
      'canonical_encounters_source_kind_check',
      sql`${table.sourceKind} IN ('runtime','backfill','import','sync','manual','migration','other')`,
    ),
    check('canonical_encounters_interval_check', sql`${table.endedAtUtc} IS NULL OR ${table.endedAtUtc} >= ${table.startedAtUtc}`),
    check(
      'canonical_encounters_signature_hash_check',
      sql`${table.signedSnapshotSha256} IS NULL OR length(${table.signedSnapshotSha256}) = 64`,
    ),
    check(
      'canonical_encounters_evidence_check',
      sql`length(${table.sourceEvidenceSha256}) = 64
        AND ${table.sourceEvidenceSha256} = lower(${table.sourceEvidenceSha256})
        AND ${table.sourceEvidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const canonicalAdmissions = sqliteTable(
  'canonical_admissions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    admissionPublicId: text('admission_public_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    admissionNumber: text('admission_number').notNull(),
    admissionType: text('admission_type').notNull(),
    admissionSource: text('admission_source').notNull(),
    currentStatus: text('current_status').notNull(),
    statusVersion: integer('status_version').notNull().default(1),
    admittedAtUtc: text('admitted_at_utc').notNull(),
    dischargedAtUtc: text('discharged_at_utc'),
    reasonCode: text('reason_code'),
    safeNote: text('safe_note'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprintSha256: text('request_fingerprint_sha256').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_admissions_public_id').on(table.tenantId, table.admissionPublicId),
    uniqueIndex('uq_canonical_admissions_number').on(table.tenantId, table.admissionNumber),
    uniqueIndex('uq_canonical_admissions_idempotency').on(table.tenantId, table.idempotencyKey),
    uniqueIndex('uq_canonical_admissions_active_encounter')
      .on(table.tenantId, table.encounterPublicId)
      .where(sql`${table.currentStatus} IN ('planned','admitted','transfer_pending','discharge_pending')`),
    index('idx_canonical_admissions_patient_status').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.currentStatus,
      table.admittedAtUtc,
    ),
    index('idx_canonical_admissions_status_time').on(
      table.tenantId,
      table.currentStatus,
      table.admittedAtUtc,
      table.admissionPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_admissions_encounter',
      columns: [table.tenantId, table.encounterPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_admissions_patient_link',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_admissions_type_check',
      sql`${table.admissionType} IN ('inpatient','emergency','transfer','direct','conversion','other')`,
    ),
    check(
      'canonical_admissions_source_check',
      sql`${table.admissionSource} IN ('planned','emergency','transfer','direct','encounter_conversion','import','manual','other')`,
    ),
    check(
      'canonical_admissions_status_check',
      sql`${table.currentStatus} IN (
        'planned','admitted','transfer_pending','discharge_pending',
        'discharged','cancelled','entered_in_error'
      )`,
    ),
    check('canonical_admissions_version_check', sql`${table.statusVersion} > 0`),
    check(
      'canonical_admissions_interval_check',
      sql`${table.dischargedAtUtc} IS NULL OR ${table.dischargedAtUtc} >= ${table.admittedAtUtc}`,
    ),
    check(
      'canonical_admissions_discharge_time_check',
      sql`${table.currentStatus} != 'discharged' OR ${table.dischargedAtUtc} IS NOT NULL`,
    ),
    check(
      'canonical_admissions_fingerprint_check',
      sql`length(${table.requestFingerprintSha256}) = 64
        AND ${table.requestFingerprintSha256} = lower(${table.requestFingerprintSha256})
        AND ${table.requestFingerprintSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      'canonical_admissions_evidence_check',
      sql`length(${table.sourceEvidenceSha256}) = 64
        AND ${table.sourceEvidenceSha256} = lower(${table.sourceEvidenceSha256})
        AND ${table.sourceEvidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const canonicalAdmissionStatusEvents = sqliteTable(
  'canonical_admission_status_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    eventPublicId: text('event_public_id').notNull(),
    admissionPublicId: text('admission_public_id').notNull(),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    sequence: integer('sequence').notNull(),
    reasonCode: text('reason_code'),
    safeNote: text('safe_note'),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    idempotencyKey: text('idempotency_key').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    occurredAtUtc: text('occurred_at_utc').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_admission_status_events_public_id').on(table.tenantId, table.eventPublicId),
    uniqueIndex('uq_canonical_admission_status_events_sequence').on(
      table.tenantId,
      table.admissionPublicId,
      table.sequence,
    ),
    uniqueIndex('uq_canonical_admission_status_events_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_admission_status_events_timeline').on(
      table.tenantId,
      table.admissionPublicId,
      table.sequence,
      table.occurredAtUtc,
    ),
    index('idx_canonical_admission_status_events_status').on(
      table.tenantId,
      table.toStatus,
      table.occurredAtUtc,
      table.admissionPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_admission_status_events_admission',
      columns: [table.tenantId, table.admissionPublicId],
      foreignColumns: [canonicalAdmissions.tenantId, canonicalAdmissions.admissionPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_admission_status_events_type_check',
      sql`${table.eventType} IN (
        'created','admitted','transfer_requested','transfer_received','transfer_cancelled',
        'discharge_requested','discharge_cancelled','discharged','cancelled','entered_in_error'
      )`,
    ),
    check(
      'canonical_admission_status_events_from_check',
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN (
        'planned','admitted','transfer_pending','discharge_pending',
        'discharged','cancelled','entered_in_error'
      )`,
    ),
    check(
      'canonical_admission_status_events_to_check',
      sql`${table.toStatus} IN (
        'planned','admitted','transfer_pending','discharge_pending',
        'discharged','cancelled','entered_in_error'
      )`,
    ),
    check('canonical_admission_status_events_sequence_check', sql`${table.sequence} > 0`),
    check(
      'canonical_admission_status_events_actor_check',
      sql`${table.actorUserPublicId} IS NOT NULL OR ${table.actorSystemKey} IS NOT NULL`,
    ),
    check(
      'canonical_admission_status_events_evidence_check',
      sql`length(${table.sourceEvidenceSha256}) = 64
        AND ${table.sourceEvidenceSha256} = lower(${table.sourceEvidenceSha256})
        AND ${table.sourceEvidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const canonicalEncounterParticipants = sqliteTable(
  'canonical_encounter_participants',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    practitionerPublicId: text('practitioner_public_id').notNull(),
    participantRole: text('participant_role').notNull(),
    evidenceType: text('evidence_type').notNull(),
    activeFromUtc: text('active_from_utc'),
    activeToUtc: text('active_to_utc'),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_encounter_participants_role').on(
      table.tenantId,
      table.encounterPublicId,
      table.practitionerPublicId,
      table.participantRole,
      table.evidenceType,
    ),
    index('idx_canonical_encounter_participants_role').on(
      table.tenantId,
      table.practitionerPublicId,
      table.participantRole,
      table.encounterPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_encounter_participants_encounter',
      columns: [table.tenantId, table.encounterPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_encounter_participants_practitioner',
      columns: [table.tenantId, table.practitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_encounter_participants_role_check',
      sql`${table.participantRole} IN ('treating','consulting','admitting','referring','prescribing','performing','reporting','approving')`,
    ),
    check(
      'canonical_encounter_participants_evidence_check',
      sql`${table.evidenceType} IN ('legacy_encounter_provider','legacy_visit_doctor','legacy_consultation_doctor','legacy_admission_doctor','approved_manual')`,
    ),
    check(
      'canonical_encounter_participants_interval_check',
      sql`${table.activeToUtc} IS NULL OR ${table.activeFromUtc} IS NULL OR ${table.activeToUtc} >= ${table.activeFromUtc}`,
    ),
  ],
);

export const canonicalEncounterAdmissionLinks = sqliteTable(
  'canonical_encounter_admission_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    legacyAdmissionId: integer('legacy_admission_id').notNull(),
    admissionNo: text('admission_no').notNull(),
    linkStatus: text('link_status').notNull().default('active'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_encounter_admission_legacy').on(table.tenantId, table.legacyAdmissionId),
    uniqueIndex('uq_canonical_encounter_admission_no').on(table.tenantId, table.admissionNo),
    uniqueIndex('uq_canonical_encounter_admission_encounter').on(table.tenantId, table.encounterPublicId),
    index('idx_canonical_encounter_admission_links_status').on(
      table.tenantId,
      table.linkStatus,
      table.legacyAdmissionId,
    ),
    foreignKey({
      name: 'fk_canonical_encounter_admission_links_encounter',
      columns: [table.tenantId, table.encounterPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId],
    }).onDelete('restrict'),
    check('canonical_encounter_admission_links_status_check', sql`${table.linkStatus} IN ('active','retired','rejected')`),
  ],
);

export const canonicalEncounterAddenda = sqliteTable(
  'canonical_encounter_addenda',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    addendumPublicId: text('addendum_public_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    legacyAddendumId: integer('legacy_addendum_id').notNull(),
    previousSnapshotSha256: text('previous_snapshot_sha256'),
    addendumSha256: text('addendum_sha256').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_encounter_addenda_public_id').on(table.tenantId, table.addendumPublicId),
    uniqueIndex('uq_canonical_encounter_addenda_legacy').on(table.tenantId, table.legacyAddendumId),
    index('idx_canonical_encounter_addenda_encounter').on(
      table.tenantId,
      table.encounterPublicId,
      table.createdAtUtc,
      table.addendumPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_encounter_addenda_encounter',
      columns: [table.tenantId, table.encounterPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_encounter_addenda_previous_hash_check',
      sql`${table.previousSnapshotSha256} IS NULL OR length(${table.previousSnapshotSha256}) = 64`,
    ),
    check('canonical_encounter_addenda_hash_check', sql`length(${table.addendumSha256}) = 64`),
  ],
);

export const canonicalBedStays = sqliteTable(
  'canonical_bed_stays',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    bedStayPublicId: text('bed_stay_public_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    legacyPatientBedInfoId: integer('legacy_patient_bed_info_id'),
    legacyAdmissionId: integer('legacy_admission_id'),
    legacyBedId: integer('legacy_bed_id'),
    admissionPublicId: text('admission_public_id'),
    bedPublicId: text('bed_public_id'),
    patientLinkPublicId: text('patient_link_public_id'),
    startedAtUtc: text('started_at_utc').notNull(),
    endedAtUtc: text('ended_at_utc'),
    status: text('status').notNull(),
    stayVersion: integer('stay_version').notNull().default(1),
    movementReason: text('movement_reason').notNull().default('migration'),
    sourceCommandKey: text('source_command_key'),
    closeReason: text('close_reason'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_bed_stays_public_id').on(table.tenantId, table.bedStayPublicId),
    uniqueIndex('uq_canonical_bed_stays_legacy')
      .on(table.tenantId, table.legacyPatientBedInfoId)
      .where(sql`${table.legacyPatientBedInfoId} IS NOT NULL`),
    uniqueIndex('uq_canonical_bed_stays_source_command')
      .on(table.tenantId, table.sourceCommandKey)
      .where(sql`${table.sourceCommandKey} IS NOT NULL`),
    uniqueIndex('uq_canonical_bed_stays_open_bed')
      .on(table.tenantId, table.bedPublicId)
      .where(sql`${table.status} = 'active' AND ${table.bedPublicId} IS NOT NULL`),
    uniqueIndex('uq_canonical_bed_stays_open_admission')
      .on(table.tenantId, table.admissionPublicId)
      .where(sql`${table.status} = 'active' AND ${table.admissionPublicId} IS NOT NULL`),
    index('idx_canonical_bed_stays_encounter_time').on(
      table.tenantId,
      table.encounterPublicId,
      table.startedAtUtc,
      table.bedStayPublicId,
    ),
    index('idx_canonical_bed_stays_bed_time').on(
      table.tenantId,
      table.bedPublicId,
      table.startedAtUtc,
      table.endedAtUtc,
    ),
    index('idx_canonical_bed_stays_admission_time').on(
      table.tenantId,
      table.admissionPublicId,
      table.startedAtUtc,
      table.endedAtUtc,
    ),
    foreignKey({
      name: 'fk_canonical_bed_stays_encounter',
      columns: [table.tenantId, table.encounterPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_bed_stays_admission',
      columns: [table.tenantId, table.admissionPublicId],
      foreignColumns: [canonicalAdmissions.tenantId, canonicalAdmissions.admissionPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_bed_stays_bed',
      columns: [table.tenantId, table.bedPublicId],
      foreignColumns: [canonicalBeds.tenantId, canonicalBeds.bedPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_bed_stays_patient_link',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    check('canonical_bed_stays_status_check', sql`${table.status} IN ('active','completed','invalid')`),
    check('canonical_bed_stays_interval_check', sql`${table.endedAtUtc} IS NULL OR ${table.endedAtUtc} >= ${table.startedAtUtc}`),
    check('canonical_bed_stays_version_check', sql`${table.stayVersion} > 0`),
    check(
      'canonical_bed_stays_reason_check',
      sql`${table.movementReason} IN ('admission','transfer','readmission','correction','migration','other')`,
    ),
    check(
      'canonical_bed_stays_public_reference_check',
      sql`(
        ${table.admissionPublicId} IS NULL
        AND ${table.bedPublicId} IS NULL
        AND ${table.patientLinkPublicId} IS NULL
      ) OR (
        ${table.admissionPublicId} IS NOT NULL
        AND ${table.bedPublicId} IS NOT NULL
        AND ${table.patientLinkPublicId} IS NOT NULL
      )`,
    ),
    check(
      'canonical_bed_stays_evidence_check',
      sql`length(${table.sourceEvidenceSha256}) = 64
        AND ${table.sourceEvidenceSha256} = lower(${table.sourceEvidenceSha256})
        AND ${table.sourceEvidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);
