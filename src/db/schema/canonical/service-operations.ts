import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { canonicalEncounters } from './clinical';
import { canonicalPractitioners } from './identity';
import { canonicalServiceCatalogItems } from './services';

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const canonicalServiceRequests = sqliteTable('canonical_service_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  requestPublicId: text('request_public_id').notNull(),
  legacyPatientId: integer('legacy_patient_id').notNull(),
  encounterPublicId: text('encounter_public_id'),
  servicePublicId: text('service_public_id').notNull(),
  requestedQuantity: integer('requested_quantity').notNull().default(1),
  fulfilledQuantity: integer('fulfilled_quantity').notNull().default(0),
  lastEventPublicId: text('last_event_public_id'),
  status: text('status').notNull(),
  requestedAtUtc: text('requested_at_utc').notNull(),
  cancelledAtUtc: text('cancelled_at_utc'),
  sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
  createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
}, (table) => [
  uniqueIndex('uq_canonical_service_requests_public_id').on(table.tenantId, table.requestPublicId),
  index('idx_canonical_service_requests_encounter').on(table.tenantId, table.encounterPublicId, table.requestedAtUtc, table.requestPublicId),
  index('idx_canonical_service_requests_service_status').on(table.tenantId, table.servicePublicId, table.status, table.requestedAtUtc),
  foreignKey({ name: 'fk_canonical_service_requests_encounter', columns: [table.tenantId, table.encounterPublicId], foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId] }).onDelete('restrict'),
  foreignKey({ name: 'fk_canonical_service_requests_catalog', columns: [table.tenantId, table.servicePublicId], foreignColumns: [canonicalServiceCatalogItems.tenantId, canonicalServiceCatalogItems.servicePublicId] }).onDelete('restrict'),
  check('canonical_service_requests_quantity_check', sql`requested_quantity > 0`),
  check('canonical_service_requests_fulfilled_quantity_check', sql`fulfilled_quantity >= 0 AND fulfilled_quantity <= requested_quantity`),
  check('canonical_service_requests_status_check', sql`status IN ('planned','active','partially_fulfilled','fulfilled','cancelled','unknown')`),
  check('canonical_service_requests_requested_at_check', sql`substr(requested_at_utc, -1) = 'Z'`),
  check('canonical_service_requests_cancelled_at_check', sql`cancelled_at_utc IS NULL OR substr(cancelled_at_utc, -1) = 'Z'`),
  check('canonical_service_requests_cancelled_state_check', sql`status = 'cancelled' OR cancelled_at_utc IS NULL`),
  check('canonical_service_requests_evidence_check', sql`length(source_evidence_sha256) = 64`),
]);

export const canonicalServiceEvents = sqliteTable('canonical_service_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  eventPublicId: text('event_public_id').notNull(),
  requestPublicId: text('request_public_id'),
  encounterPublicId: text('encounter_public_id'),
  servicePublicId: text('service_public_id').notNull(),
  eventType: text('event_type').notNull(),
  quantity: integer('quantity').notNull().default(1),
  status: text('status').notNull().default('posted'),
  occurredAtUtc: text('occurred_at_utc').notNull(),
  cancelledAtUtc: text('cancelled_at_utc'),
  sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
  createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
}, (table) => [
  uniqueIndex('uq_canonical_service_events_public_id').on(table.tenantId, table.eventPublicId),
  index('idx_canonical_service_events_request').on(table.tenantId, table.requestPublicId, table.occurredAtUtc, table.eventPublicId),
  index('idx_canonical_service_events_service_time').on(table.tenantId, table.servicePublicId, table.eventType, table.occurredAtUtc),
  index('idx_canonical_service_events_encounter').on(table.tenantId, table.encounterPublicId, table.occurredAtUtc),
  foreignKey({ name: 'fk_canonical_service_events_request', columns: [table.tenantId, table.requestPublicId], foreignColumns: [canonicalServiceRequests.tenantId, canonicalServiceRequests.requestPublicId] }).onDelete('restrict'),
  foreignKey({ name: 'fk_canonical_service_events_encounter', columns: [table.tenantId, table.encounterPublicId], foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId] }).onDelete('restrict'),
  foreignKey({ name: 'fk_canonical_service_events_catalog', columns: [table.tenantId, table.servicePublicId], foreignColumns: [canonicalServiceCatalogItems.tenantId, canonicalServiceCatalogItems.servicePublicId] }).onDelete('restrict'),
  check('canonical_service_events_type_check', sql`event_type IN ('accepted','delivered','completed','dispensed','occupied','cancelled','reversed')`),
  check('canonical_service_events_quantity_check', sql`quantity > 0`),
  check('canonical_service_events_status_check', sql`status IN ('posted','cancelled','reversed')`),
  check('canonical_service_events_occurred_at_check', sql`substr(occurred_at_utc, -1) = 'Z'`),
  check('canonical_service_events_cancelled_at_check', sql`cancelled_at_utc IS NULL OR substr(cancelled_at_utc, -1) = 'Z'`),
  check('canonical_service_events_cancelled_state_check', sql`status = 'posted' OR cancelled_at_utc IS NOT NULL`),
  check('canonical_service_events_evidence_check', sql`length(source_evidence_sha256) = 64`),
]);

export const canonicalServiceParticipants = sqliteTable('canonical_service_participants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  requestPublicId: text('request_public_id'),
  eventPublicId: text('event_public_id'),
  practitionerPublicId: text('practitioner_public_id').notNull(),
  participantRole: text('participant_role').notNull(),
  evidenceType: text('evidence_type').notNull(),
  createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
}, (table) => [
  uniqueIndex('uq_canonical_service_participants_role').on(table.tenantId, table.requestPublicId, table.eventPublicId, table.practitionerPublicId, table.participantRole, table.evidenceType),
  index('idx_canonical_service_participants_practitioner').on(table.tenantId, table.practitionerPublicId, table.participantRole, table.requestPublicId, table.eventPublicId),
  foreignKey({ name: 'fk_canonical_service_participants_request', columns: [table.tenantId, table.requestPublicId], foreignColumns: [canonicalServiceRequests.tenantId, canonicalServiceRequests.requestPublicId] }).onDelete('restrict'),
  foreignKey({ name: 'fk_canonical_service_participants_event', columns: [table.tenantId, table.eventPublicId], foreignColumns: [canonicalServiceEvents.tenantId, canonicalServiceEvents.eventPublicId] }).onDelete('restrict'),
  foreignKey({ name: 'fk_canonical_service_participants_practitioner', columns: [table.tenantId, table.practitionerPublicId], foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId] }).onDelete('restrict'),
  check('canonical_service_participants_target_check', sql`(request_public_id IS NOT NULL) <> (event_public_id IS NOT NULL)`),
  check('canonical_service_participants_role_check', sql`participant_role IN ('ordering','prescribing','performing','reporting','approving','referring')`),
  check('canonical_service_participants_evidence_check', sql`evidence_type IN ('legacy_lab_orderer','legacy_lab_processor','legacy_lab_verifier','legacy_radiology_prescriber','legacy_radiology_performer','legacy_consultation_doctor','legacy_procedure_orderer','legacy_procedure_performer','legacy_prescription_doctor','approved_manual')`),
]);
