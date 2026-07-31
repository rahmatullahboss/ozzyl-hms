import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { canonicalEncounters } from './clinical';
import { canonicalPractitioners } from './identity';
import { canonicalTenantPatientLinks } from './patient-identity';

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const lowercaseSha256 = (column: unknown) => sql`length(${column}) = 64
  AND ${column} = lower(${column})
  AND ${column} NOT GLOB '*[^0-9a-f]*'`;

export const canonicalPrescriptions = sqliteTable(
  'canonical_prescriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    prescriptionPublicId: text('prescription_public_id').notNull(),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    prescribingPractitionerPublicId: text('prescribing_practitioner_public_id').notNull(),
    currentVersionPublicId: text('current_version_public_id'),
    currentStatus: text('current_status').notNull().default('draft'),
    statusVersion: integer('status_version').notNull().default(1),
    authoredAtUtc: text('authored_at_utc').notNull(),
    finalizedAtUtc: text('finalized_at_utc'),
    cancelledAtUtc: text('cancelled_at_utc'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprintSha256: text('request_fingerprint_sha256').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_prescriptions_public_id').on(table.tenantId, table.prescriptionPublicId),
    uniqueIndex('uq_canonical_prescriptions_identity_scope').on(
      table.tenantId,
      table.prescriptionPublicId,
      table.patientLinkPublicId,
      table.encounterPublicId,
      table.prescribingPractitionerPublicId,
    ),
    uniqueIndex('uq_canonical_prescriptions_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_prescriptions_patient_time').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.authoredAtUtc,
      table.prescriptionPublicId,
    ),
    index('idx_canonical_prescriptions_encounter_status').on(
      table.tenantId,
      table.encounterPublicId,
      table.currentStatus,
      table.authoredAtUtc,
      table.prescriptionPublicId,
    ),
    index('idx_canonical_prescriptions_prescriber_time').on(
      table.tenantId,
      table.prescribingPractitionerPublicId,
      table.authoredAtUtc,
      table.prescriptionPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_prescriptions_patient_link',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_prescriptions_encounter',
      columns: [table.tenantId, table.encounterPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_prescriptions_practitioner',
      columns: [table.tenantId, table.prescribingPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    // The circular prescription -> current version FK is enforced by migration 0554.
    // Keeping it out of Drizzle metadata avoids an unsafe circular table initializer.
    check(
      'canonical_prescriptions_status_check',
      sql`${table.currentStatus} IN ('draft','final','amended','cancelled','entered_in_error')`,
    ),
    check('canonical_prescriptions_status_version_check', sql`${table.statusVersion} > 0`),
    check(
      'canonical_prescriptions_lifecycle_check',
      sql`(${table.currentStatus} = 'draft'
          AND ${table.finalizedAtUtc} IS NULL
          AND ${table.cancelledAtUtc} IS NULL)
        OR (${table.currentStatus} IN ('final','amended')
          AND ${table.finalizedAtUtc} IS NOT NULL
          AND ${table.cancelledAtUtc} IS NULL)
        OR (${table.currentStatus} IN ('cancelled','entered_in_error')
          AND ${table.cancelledAtUtc} IS NOT NULL)`,
    ),
    check(
      'canonical_prescriptions_time_check',
      sql`substr(${table.authoredAtUtc}, -1) = 'Z'
        AND (${table.finalizedAtUtc} IS NULL OR (
          substr(${table.finalizedAtUtc}, -1) = 'Z'
          AND ${table.finalizedAtUtc} >= ${table.authoredAtUtc}
        ))
        AND (${table.cancelledAtUtc} IS NULL OR (
          substr(${table.cancelledAtUtc}, -1) = 'Z'
          AND ${table.cancelledAtUtc} >= ${table.authoredAtUtc}
        ))`,
    ),
    check('canonical_prescriptions_fingerprint_check', lowercaseSha256(table.requestFingerprintSha256)),
    check('canonical_prescriptions_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

export const canonicalPrescriptionVersions = sqliteTable(
  'canonical_prescription_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    versionPublicId: text('version_public_id').notNull(),
    prescriptionPublicId: text('prescription_public_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    supersedesVersionPublicId: text('supersedes_version_public_id'),
    versionStatus: text('version_status').notNull(),
    contentSha256: text('content_sha256').notNull(),
    signedSnapshotSha256: text('signed_snapshot_sha256'),
    authoredAtUtc: text('authored_at_utc').notNull(),
    finalizedAtUtc: text('finalized_at_utc'),
    authoringPractitionerPublicId: text('authoring_practitioner_public_id').notNull(),
    signingPractitionerPublicId: text('signing_practitioner_public_id'),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_prescription_versions_public_id').on(table.tenantId, table.versionPublicId),
    uniqueIndex('uq_canonical_prescription_versions_parent_public_id').on(
      table.tenantId,
      table.prescriptionPublicId,
      table.versionPublicId,
    ),
    uniqueIndex('uq_canonical_prescription_versions_number').on(
      table.tenantId,
      table.prescriptionPublicId,
      table.versionNumber,
    ),
    index('idx_canonical_prescription_versions_timeline').on(
      table.tenantId,
      table.prescriptionPublicId,
      table.versionNumber,
      table.authoredAtUtc,
    ),
    index('idx_canonical_prescription_versions_status').on(
      table.tenantId,
      table.versionStatus,
      table.finalizedAtUtc,
      table.versionPublicId,
    ),
    // The circular version -> prescription FK is enforced by migration 0554.
    // Non-circular consumers still receive typed tenant-scoped references below.
    foreignKey({
      name: 'fk_canonical_prescription_versions_supersedes',
      columns: [table.tenantId, table.prescriptionPublicId, table.supersedesVersionPublicId],
      foreignColumns: [table.tenantId, table.prescriptionPublicId, table.versionPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_prescription_versions_authoring_practitioner',
      columns: [table.tenantId, table.authoringPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_prescription_versions_signing_practitioner',
      columns: [table.tenantId, table.signingPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check('canonical_prescription_versions_number_check', sql`${table.versionNumber} > 0`),
    check(
      'canonical_prescription_versions_status_check',
      sql`${table.versionStatus} IN ('draft','final','amendment','retracted','entered_in_error')`,
    ),
    check(
      'canonical_prescription_versions_self_supersession_check',
      sql`${table.supersedesVersionPublicId} IS NULL
        OR ${table.supersedesVersionPublicId} != ${table.versionPublicId}`,
    ),
    check(
      'canonical_prescription_versions_actor_check',
      sql`${table.actorUserPublicId} IS NOT NULL OR ${table.actorSystemKey} IS NOT NULL`,
    ),
    check(
      'canonical_prescription_versions_lifecycle_check',
      sql`(${table.versionStatus} = 'draft'
          AND ${table.signedSnapshotSha256} IS NULL
          AND ${table.finalizedAtUtc} IS NULL)
        OR (${table.versionStatus} IN ('final','amendment')
          AND ${table.signedSnapshotSha256} IS NOT NULL
          AND ${table.finalizedAtUtc} IS NOT NULL
          AND ${table.signingPractitionerPublicId} IS NOT NULL)
        OR ${table.versionStatus} IN ('retracted','entered_in_error')`,
    ),
    check(
      'canonical_prescription_versions_time_check',
      sql`substr(${table.authoredAtUtc}, -1) = 'Z'
        AND (${table.finalizedAtUtc} IS NULL OR (
          substr(${table.finalizedAtUtc}, -1) = 'Z'
          AND ${table.finalizedAtUtc} >= ${table.authoredAtUtc}
        ))`,
    ),
    check('canonical_prescription_versions_content_hash_check', lowercaseSha256(table.contentSha256)),
    check(
      'canonical_prescription_versions_signature_hash_check',
      sql`${table.signedSnapshotSha256} IS NULL OR (${lowercaseSha256(table.signedSnapshotSha256)})`,
    ),
    check('canonical_prescription_versions_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

export const canonicalMedicationOrders = sqliteTable(
  'canonical_medication_orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    medicationOrderPublicId: text('medication_order_public_id').notNull(),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    prescribingPractitionerPublicId: text('prescribing_practitioner_public_id').notNull(),
    prescriptionPublicId: text('prescription_public_id'),
    prescriptionVersionPublicId: text('prescription_version_public_id'),
    medicationCodeSystem: text('medication_code_system'),
    medicationCode: text('medication_code'),
    medicationDisplay: text('medication_display').notNull(),
    genericDisplay: text('generic_display'),
    strengthSnapshot: text('strength_snapshot'),
    doseText: text('dose_text').notNull(),
    routeCode: text('route_code').notNull(),
    frequencyCode: text('frequency_code').notNull(),
    durationText: text('duration_text'),
    instructionsText: text('instructions_text'),
    priority: text('priority').notNull().default('routine'),
    intendedStartUtc: text('intended_start_utc').notNull(),
    intendedEndUtc: text('intended_end_utc'),
    currentStatus: text('current_status').notNull().default('draft'),
    statusVersion: integer('status_version').notNull().default(1),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprintSha256: text('request_fingerprint_sha256').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_medication_orders_public_id').on(table.tenantId, table.medicationOrderPublicId),
    uniqueIndex('uq_canonical_medication_orders_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_medication_orders_patient_status').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.currentStatus,
      table.intendedStartUtc,
      table.medicationOrderPublicId,
    ),
    index('idx_canonical_medication_orders_encounter_status').on(
      table.tenantId,
      table.encounterPublicId,
      table.currentStatus,
      table.intendedStartUtc,
      table.medicationOrderPublicId,
    ),
    index('idx_canonical_medication_orders_prescriber_status').on(
      table.tenantId,
      table.prescribingPractitionerPublicId,
      table.currentStatus,
      table.intendedStartUtc,
      table.medicationOrderPublicId,
    ),
    index('idx_canonical_medication_orders_prescription').on(
      table.tenantId,
      table.prescriptionPublicId,
      table.prescriptionVersionPublicId,
      table.medicationOrderPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_medication_orders_patient_link',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_medication_orders_encounter',
      columns: [table.tenantId, table.encounterPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_medication_orders_practitioner',
      columns: [table.tenantId, table.prescribingPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_medication_orders_prescription_scope',
      columns: [
        table.tenantId,
        table.prescriptionPublicId,
        table.patientLinkPublicId,
        table.encounterPublicId,
        table.prescribingPractitionerPublicId,
      ],
      foreignColumns: [
        canonicalPrescriptions.tenantId,
        canonicalPrescriptions.prescriptionPublicId,
        canonicalPrescriptions.patientLinkPublicId,
        canonicalPrescriptions.encounterPublicId,
        canonicalPrescriptions.prescribingPractitionerPublicId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_medication_orders_prescription_version',
      columns: [table.tenantId, table.prescriptionPublicId, table.prescriptionVersionPublicId],
      foreignColumns: [
        canonicalPrescriptionVersions.tenantId,
        canonicalPrescriptionVersions.prescriptionPublicId,
        canonicalPrescriptionVersions.versionPublicId,
      ],
    }).onDelete('restrict'),
    check(
      'canonical_medication_orders_status_check',
      sql`${table.currentStatus} IN (
        'draft','active','on_hold','completed','stopped','cancelled','entered_in_error'
      )`,
    ),
    check('canonical_medication_orders_status_version_check', sql`${table.statusVersion} > 0`),
    check('canonical_medication_orders_priority_check', sql`${table.priority} IN ('routine','urgent','stat','prn')`),
    check(
      'canonical_medication_orders_prescription_scope_check',
      sql`(${table.prescriptionPublicId} IS NULL AND ${table.prescriptionVersionPublicId} IS NULL)
        OR (${table.prescriptionPublicId} IS NOT NULL AND ${table.prescriptionVersionPublicId} IS NOT NULL)`,
    ),
    check(
      'canonical_medication_orders_code_pair_check',
      sql`(${table.medicationCodeSystem} IS NULL AND ${table.medicationCode} IS NULL)
        OR (${table.medicationCodeSystem} IS NOT NULL AND ${table.medicationCode} IS NOT NULL)`,
    ),
    check(
      'canonical_medication_orders_display_check',
      sql`length(trim(${table.medicationDisplay})) > 0
        AND length(trim(${table.doseText})) > 0
        AND length(trim(${table.routeCode})) > 0
        AND length(trim(${table.frequencyCode})) > 0`,
    ),
    check(
      'canonical_medication_orders_interval_check',
      sql`substr(${table.intendedStartUtc}, -1) = 'Z'
        AND (${table.intendedEndUtc} IS NULL OR (
          substr(${table.intendedEndUtc}, -1) = 'Z'
          AND ${table.intendedEndUtc} >= ${table.intendedStartUtc}
        ))`,
    ),
    check('canonical_medication_orders_fingerprint_check', lowercaseSha256(table.requestFingerprintSha256)),
    check('canonical_medication_orders_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

export const canonicalMedicationOrderStatusEvents = sqliteTable(
  'canonical_medication_order_status_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    eventPublicId: text('event_public_id').notNull(),
    medicationOrderPublicId: text('medication_order_public_id').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    eventVersion: integer('event_version').notNull(),
    reasonCode: text('reason_code').notNull(),
    safeNote: text('safe_note'),
    actorPractitionerPublicId: text('actor_practitioner_public_id'),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    idempotencyKey: text('idempotency_key').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    occurredAtUtc: text('occurred_at_utc').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_medication_order_status_events_public_id').on(table.tenantId, table.eventPublicId),
    uniqueIndex('uq_canonical_medication_order_status_events_version').on(
      table.tenantId,
      table.medicationOrderPublicId,
      table.eventVersion,
    ),
    uniqueIndex('uq_canonical_medication_order_status_events_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_medication_order_status_events_timeline').on(
      table.tenantId,
      table.medicationOrderPublicId,
      table.eventVersion,
      table.occurredAtUtc,
    ),
    foreignKey({
      name: 'fk_canonical_medication_order_status_events_order',
      columns: [table.tenantId, table.medicationOrderPublicId],
      foreignColumns: [canonicalMedicationOrders.tenantId, canonicalMedicationOrders.medicationOrderPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_medication_order_status_events_practitioner',
      columns: [table.tenantId, table.actorPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_medication_order_status_events_from_check',
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN (
        'draft','active','on_hold','completed','stopped','cancelled','entered_in_error'
      )`,
    ),
    check(
      'canonical_medication_order_status_events_to_check',
      sql`${table.toStatus} IN (
        'draft','active','on_hold','completed','stopped','cancelled','entered_in_error'
      )`,
    ),
    check(
      'canonical_medication_order_status_events_transition_check',
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} != ${table.toStatus}`,
    ),
    check('canonical_medication_order_status_events_version_check', sql`${table.eventVersion} > 0`),
    check('canonical_medication_order_status_events_reason_check', sql`length(trim(${table.reasonCode})) > 0`),
    check(
      'canonical_medication_order_status_events_actor_check',
      sql`${table.actorPractitionerPublicId} IS NOT NULL
        OR ${table.actorUserPublicId} IS NOT NULL
        OR ${table.actorSystemKey} IS NOT NULL`,
    ),
    check('canonical_medication_order_status_events_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
    check('canonical_medication_order_status_events_time_check', sql`substr(${table.occurredAtUtc}, -1) = 'Z'`),
  ],
);

export const canonicalPrescriptionSafetyEvents = sqliteTable(
  'canonical_prescription_safety_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    eventPublicId: text('event_public_id').notNull(),
    prescriptionPublicId: text('prescription_public_id').notNull(),
    prescriptionVersionPublicId: text('prescription_version_public_id'),
    medicationOrderPublicId: text('medication_order_public_id'),
    eventType: text('event_type').notNull(),
    outcome: text('outcome').notNull(),
    severity: text('severity'),
    evidenceCode: text('evidence_code').notNull(),
    actorPractitionerPublicId: text('actor_practitioner_public_id'),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    idempotencyKey: text('idempotency_key').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    occurredAtUtc: text('occurred_at_utc').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_prescription_safety_events_public_id').on(table.tenantId, table.eventPublicId),
    uniqueIndex('uq_canonical_prescription_safety_events_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_prescription_safety_events_prescription').on(
      table.tenantId,
      table.prescriptionPublicId,
      table.occurredAtUtc,
      table.eventPublicId,
    ),
    index('idx_canonical_prescription_safety_events_order').on(
      table.tenantId,
      table.medicationOrderPublicId,
      table.occurredAtUtc,
      table.eventPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_prescription_safety_events_prescription',
      columns: [table.tenantId, table.prescriptionPublicId],
      foreignColumns: [canonicalPrescriptions.tenantId, canonicalPrescriptions.prescriptionPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_prescription_safety_events_version',
      columns: [table.tenantId, table.prescriptionPublicId, table.prescriptionVersionPublicId],
      foreignColumns: [
        canonicalPrescriptionVersions.tenantId,
        canonicalPrescriptionVersions.prescriptionPublicId,
        canonicalPrescriptionVersions.versionPublicId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_prescription_safety_events_order',
      columns: [table.tenantId, table.medicationOrderPublicId],
      foreignColumns: [canonicalMedicationOrders.tenantId, canonicalMedicationOrders.medicationOrderPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_prescription_safety_events_practitioner',
      columns: [table.tenantId, table.actorPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_prescription_safety_events_type_check',
      sql`${table.eventType} IN (
        'allergy_check','interaction_check','duplicate_therapy_check',
        'dose_check','override','waiver','other'
      )`,
    ),
    check(
      'canonical_prescription_safety_events_outcome_check',
      sql`${table.outcome} IN ('passed','warning','blocked','overridden','not_applicable')`,
    ),
    check(
      'canonical_prescription_safety_events_severity_check',
      sql`${table.severity} IS NULL OR ${table.severity} IN (
        'none','low','moderate','high','critical','unknown'
      )`,
    ),
    check('canonical_prescription_safety_events_evidence_code_check', sql`length(trim(${table.evidenceCode})) > 0`),
    check(
      'canonical_prescription_safety_events_actor_check',
      sql`${table.actorPractitionerPublicId} IS NOT NULL
        OR ${table.actorUserPublicId} IS NOT NULL
        OR ${table.actorSystemKey} IS NOT NULL`,
    ),
    check(
      'canonical_prescription_safety_events_override_check',
      sql`${table.eventType} NOT IN ('override','waiver')
        OR (${table.outcome} = 'overridden' AND ${table.actorPractitionerPublicId} IS NOT NULL)`,
    ),
    check('canonical_prescription_safety_events_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
    check('canonical_prescription_safety_events_time_check', sql`substr(${table.occurredAtUtc}, -1) = 'Z'`),
  ],
);
