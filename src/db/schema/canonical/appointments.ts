import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { canonicalEncounters } from './clinical';
import { canonicalPractitioners } from './identity';
import { canonicalTenantPatientLinks } from './patient-identity';
import { canonicalServiceCatalogItems } from './services';

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const canonicalAppointments = sqliteTable(
  'canonical_appointments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    appointmentPublicId: text('appointment_public_id').notNull(),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    requestedPractitionerPublicId: text('requested_practitioner_public_id'),
    requestedServiceItemPublicId: text('requested_service_item_public_id'),
    requestedLocationPublicId: text('requested_location_public_id'),
    appointmentKind: text('appointment_kind').notNull(),
    modality: text('modality').notNull(),
    schedulingChannel: text('scheduling_channel').notNull(),
    requestedStartUtc: text('requested_start_utc').notNull(),
    requestedEndUtc: text('requested_end_utc').notNull(),
    businessDate: text('business_date').notNull(),
    timezone: text('timezone').notNull(),
    tokenNumber: integer('token_number'),
    tokenAssignmentType: text('token_assignment_type').notNull().default('none'),
    currentStatus: text('current_status').notNull(),
    statusVersion: integer('status_version').notNull().default(1),
    rescheduledFromAppointmentPublicId: text('rescheduled_from_appointment_public_id'),
    requestNote: text('request_note'),
    referralPractitionerPublicId: text('referral_practitioner_public_id'),
    quotedAmountMinor: integer('quoted_amount_minor'),
    currencyCode: text('currency_code'),
    quoteSource: text('quote_source'),
    quoteEffectiveAtUtc: text('quote_effective_at_utc'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_appointments_public_id').on(table.tenantId, table.appointmentPublicId),
    uniqueIndex('uq_canonical_appointments_active_token')
      .on(table.tenantId, table.requestedPractitionerPublicId, table.businessDate, table.tokenNumber)
      .where(sql`${table.tokenNumber} IS NOT NULL
        AND ${table.tokenAssignmentType} != 'manual'
        AND ${table.currentStatus} NOT IN ('cancelled','no_show','rescheduled','entered_in_error')`),
    index('idx_canonical_appointments_patient_time').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.requestedStartUtc,
      table.appointmentPublicId,
    ),
    index('idx_canonical_appointments_practitioner_time').on(
      table.tenantId,
      table.requestedPractitionerPublicId,
      table.requestedStartUtc,
      table.appointmentPublicId,
    ),
    index('idx_canonical_appointments_date_status').on(
      table.tenantId,
      table.businessDate,
      table.currentStatus,
      table.requestedStartUtc,
      table.appointmentPublicId,
    ),
    index('idx_canonical_appointments_reschedule_lineage').on(
      table.tenantId,
      table.rescheduledFromAppointmentPublicId,
      table.appointmentPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_appointments_patient_link',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_appointments_requested_practitioner',
      columns: [table.tenantId, table.requestedPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_appointments_referral_practitioner',
      columns: [table.tenantId, table.referralPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_appointments_service_item',
      columns: [table.tenantId, table.requestedServiceItemPublicId],
      foreignColumns: [canonicalServiceCatalogItems.tenantId, canonicalServiceCatalogItems.servicePublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_appointments_rescheduled_from',
      columns: [table.tenantId, table.rescheduledFromAppointmentPublicId],
      foreignColumns: [table.tenantId, table.appointmentPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_appointments_kind_check',
      sql`${table.appointmentKind} IN (
        'new_patient','follow_up','report_review','free_visit',
        'emergency_request','telemedicine','other'
      )`,
    ),
    check(
      'canonical_appointments_modality_check',
      sql`${table.modality} IN ('in_person','telemedicine','home_visit','other')`,
    ),
    check(
      'canonical_appointments_channel_check',
      sql`${table.schedulingChannel} IN (
        'reception','patient_portal','marketplace','doctor_follow_up','import','other'
      )`,
    ),
    check(
      'canonical_appointments_status_check',
      sql`${table.currentStatus} IN (
        'requested','scheduled','confirmed','arrived','checked_in',
        'fulfilled','cancelled','no_show','rescheduled','entered_in_error'
      )`,
    ),
    check('canonical_appointments_status_version_check', sql`${table.statusVersion} > 0`),
    check(
      'canonical_appointments_interval_check',
      sql`substr(${table.requestedStartUtc}, -1) = 'Z'
        AND substr(${table.requestedEndUtc}, -1) = 'Z'
        AND ${table.requestedEndUtc} >= ${table.requestedStartUtc}`,
    ),
    check(
      'canonical_appointments_business_date_check',
      sql`${table.businessDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check('canonical_appointments_timezone_check', sql`length(trim(${table.timezone})) > 0`),
    check(
      'canonical_appointments_token_check',
      sql`(
        ${table.tokenAssignmentType} = 'none' AND ${table.tokenNumber} IS NULL
      ) OR (
        ${table.tokenAssignmentType} IN ('auto','reserved','manual')
        AND ${table.tokenNumber} IS NOT NULL
        AND ${table.tokenNumber} > 0
      )`,
    ),
    check(
      'canonical_appointments_reschedule_self_check',
      sql`${table.rescheduledFromAppointmentPublicId} IS NULL
        OR ${table.rescheduledFromAppointmentPublicId} != ${table.appointmentPublicId}`,
    ),
    check(
      'canonical_appointments_quote_check',
      sql`(
        ${table.quotedAmountMinor} IS NULL
        AND ${table.currencyCode} IS NULL
        AND ${table.quoteSource} IS NULL
        AND ${table.quoteEffectiveAtUtc} IS NULL
      ) OR (
        ${table.quotedAmountMinor} IS NOT NULL
        AND ${table.quotedAmountMinor} >= 0
        AND ${table.currencyCode} IS NOT NULL
        AND length(${table.currencyCode}) = 3
        AND ${table.currencyCode} = upper(${table.currencyCode})
        AND ${table.quoteSource} IS NOT NULL
        AND length(trim(${table.quoteSource})) > 0
        AND ${table.quoteEffectiveAtUtc} IS NOT NULL
        AND substr(${table.quoteEffectiveAtUtc}, -1) = 'Z'
      )`,
    ),
    check(
      'canonical_appointments_evidence_check',
      sql`length(${table.sourceEvidenceSha256}) = 64
        AND ${table.sourceEvidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const canonicalAppointmentStatusEvents = sqliteTable(
  'canonical_appointment_status_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    eventPublicId: text('event_public_id').notNull(),
    appointmentPublicId: text('appointment_public_id').notNull(),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    sequence: integer('sequence').notNull(),
    reasonCode: text('reason_code').notNull(),
    safeNote: text('safe_note'),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    idempotencyKey: text('idempotency_key').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    occurredAtUtc: text('occurred_at_utc').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_appointment_status_events_public_id').on(table.tenantId, table.eventPublicId),
    uniqueIndex('uq_canonical_appointment_status_events_sequence').on(
      table.tenantId,
      table.appointmentPublicId,
      table.sequence,
    ),
    uniqueIndex('uq_canonical_appointment_status_events_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_appointment_status_events_timeline').on(
      table.tenantId,
      table.appointmentPublicId,
      table.sequence,
      table.occurredAtUtc,
    ),
    foreignKey({
      name: 'fk_canonical_appointment_status_events_appointment',
      columns: [table.tenantId, table.appointmentPublicId],
      foreignColumns: [canonicalAppointments.tenantId, canonicalAppointments.appointmentPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_appointment_status_events_type_check',
      sql`${table.eventType} IN (
        'created','scheduled','confirmed','arrived','checked_in','fulfilled',
        'cancelled','no_show','rescheduled','entered_in_error'
      )`,
    ),
    check(
      'canonical_appointment_status_events_from_check',
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN (
        'requested','scheduled','confirmed','arrived','checked_in',
        'fulfilled','cancelled','no_show','rescheduled','entered_in_error'
      )`,
    ),
    check(
      'canonical_appointment_status_events_to_check',
      sql`${table.toStatus} IN (
        'requested','scheduled','confirmed','arrived','checked_in',
        'fulfilled','cancelled','no_show','rescheduled','entered_in_error'
      )`,
    ),
    check('canonical_appointment_status_events_sequence_check', sql`${table.sequence} > 0`),
    check('canonical_appointment_status_events_reason_check', sql`length(trim(${table.reasonCode})) > 0`),
    check(
      'canonical_appointment_status_events_actor_check',
      sql`${table.actorUserPublicId} IS NOT NULL OR ${table.actorSystemKey} IS NOT NULL`,
    ),
    check(
      'canonical_appointment_status_events_evidence_check',
      sql`length(${table.sourceEvidenceSha256}) = 64
        AND ${table.sourceEvidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      'canonical_appointment_status_events_occurred_check',
      sql`substr(${table.occurredAtUtc}, -1) = 'Z'`,
    ),
  ],
);

export const canonicalAppointmentEncounterLinks = sqliteTable(
  'canonical_appointment_encounter_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    linkPublicId: text('link_public_id').notNull(),
    appointmentPublicId: text('appointment_public_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    linkType: text('link_type').notNull(),
    linkStatus: text('link_status').notNull().default('active'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull(),
    retiredAtUtc: text('retired_at_utc'),
  },
  (table) => [
    uniqueIndex('uq_canonical_appointment_encounter_links_public_id').on(table.tenantId, table.linkPublicId),
    uniqueIndex('uq_canonical_appointment_encounter_links_active_appointment')
      .on(table.tenantId, table.appointmentPublicId)
      .where(sql`${table.linkStatus} = 'active'`),
    uniqueIndex('uq_canonical_appointment_encounter_links_active_encounter')
      .on(table.tenantId, table.encounterPublicId)
      .where(sql`${table.linkStatus} = 'active'`),
    index('idx_canonical_appointment_encounter_links_status').on(
      table.tenantId,
      table.linkStatus,
      table.appointmentPublicId,
      table.encounterPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_appointment_encounter_links_appointment',
      columns: [table.tenantId, table.appointmentPublicId],
      foreignColumns: [canonicalAppointments.tenantId, canonicalAppointments.appointmentPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_appointment_encounter_links_encounter',
      columns: [table.tenantId, table.encounterPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_appointment_encounter_links_type_check',
      sql`${table.linkType} IN (
        'fulfilled_by','converted_to_emergency','converted_to_inpatient','approved_manual'
      )`,
    ),
    check(
      'canonical_appointment_encounter_links_status_check',
      sql`${table.linkStatus} IN ('active','retired','rejected')`,
    ),
    check(
      'canonical_appointment_encounter_links_lifecycle_check',
      sql`(${table.linkStatus} = 'active' AND ${table.retiredAtUtc} IS NULL)
        OR (${table.linkStatus} IN ('retired','rejected') AND ${table.retiredAtUtc} IS NOT NULL)`,
    ),
    check(
      'canonical_appointment_encounter_links_time_check',
      sql`substr(${table.createdAtUtc}, -1) = 'Z'
        AND (
          ${table.retiredAtUtc} IS NULL
          OR (substr(${table.retiredAtUtc}, -1) = 'Z' AND ${table.retiredAtUtc} >= ${table.createdAtUtc})
        )`,
    ),
    check(
      'canonical_appointment_encounter_links_evidence_check',
      sql`length(${table.sourceEvidenceSha256}) = 64
        AND ${table.sourceEvidenceSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);
