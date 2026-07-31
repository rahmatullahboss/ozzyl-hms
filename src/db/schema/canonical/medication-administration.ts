import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { canonicalEncounters } from './clinical';
import { canonicalPractitioners } from './identity';
import {
  canonicalMedicationOrders,
  canonicalMedicationOrderStatusEvents,
  canonicalPrescriptionVersions,
} from './medication';
import { canonicalTenantPatientLinks } from './patient-identity';

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

const lowercaseSha256 = (column: ReturnType<typeof text>) => sql`length(${column}) = 64
  AND ${column} = lower(${column})
  AND ${column} NOT GLOB '*[^0-9a-f]*'`;

const paired = (left: ReturnType<typeof text>, right: ReturnType<typeof text>) => sql`
  (${left} IS NULL AND ${right} IS NULL)
  OR (${left} IS NOT NULL AND ${right} IS NOT NULL)
`;

export const canonicalMedicationAdministrationEvents = sqliteTable(
  'canonical_medication_administration_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    administrationEventPublicId: text('administration_event_public_id').notNull(),
    eventKind: text('event_kind').notNull(),
    medicationOrderPublicId: text('medication_order_public_id').notNull(),
    medicationOrderStatusVersion: integer('medication_order_status_version').notNull(),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    administeringPractitionerPublicId: text('administering_practitioner_public_id').notNull(),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    scheduledAtUtc: text('scheduled_at_utc'),
    occurredAtUtc: text('occurred_at_utc').notNull(),
    recordedAtUtc: text('recorded_at_utc').notNull(),
    lateEntryReasonCode: text('late_entry_reason_code'),
    outcomeCode: text('outcome_code'),
    administeredDoseValueDecimal: text('administered_dose_value_decimal'),
    administeredDoseUnitCode: text('administered_dose_unit_code'),
    routeCode: text('route_code'),
    siteCode: text('site_code'),
    methodCode: text('method_code'),
    reasonCode: text('reason_code'),
    dispenseSourceType: text('dispense_source_type'),
    dispenseSourcePublicId: text('dispense_source_public_id'),
    lotSourceType: text('lot_source_type'),
    lotSourcePublicId: text('lot_source_public_id'),
    barcodeSourceType: text('barcode_source_type'),
    barcodeSourcePublicId: text('barcode_source_public_id'),
    deviceSourceType: text('device_source_type'),
    deviceSourcePublicId: text('device_source_public_id'),
    supersedesAdministrationEventPublicId: text('supersedes_administration_event_public_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprintSha256: text('request_fingerprint_sha256').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_med_admin_public_id').on(table.tenantId, table.administrationEventPublicId),
    uniqueIndex('uq_canonical_med_admin_scope_public_id').on(
      table.tenantId,
      table.medicationOrderPublicId,
      table.patientLinkPublicId,
      table.encounterPublicId,
      table.administrationEventPublicId,
    ),
    uniqueIndex('uq_canonical_med_admin_supersedes').on(
      table.tenantId,
      table.supersedesAdministrationEventPublicId,
    ),
    uniqueIndex('uq_canonical_med_admin_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_med_admin_order_time').on(
      table.tenantId,
      table.medicationOrderPublicId,
      table.occurredAtUtc,
      table.administrationEventPublicId,
    ),
    index('idx_canonical_med_admin_patient_time').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.occurredAtUtc,
      table.administrationEventPublicId,
    ),
    index('idx_canonical_med_admin_encounter_time').on(
      table.tenantId,
      table.encounterPublicId,
      table.occurredAtUtc,
      table.administrationEventPublicId,
    ),
    index('idx_canonical_med_admin_outcome_time').on(
      table.tenantId,
      table.outcomeCode,
      table.occurredAtUtc,
      table.administrationEventPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_med_admin_order_scope',
      columns: [
        table.tenantId,
        table.medicationOrderPublicId,
        table.patientLinkPublicId,
        table.encounterPublicId,
      ],
      foreignColumns: [
        canonicalMedicationOrders.tenantId,
        canonicalMedicationOrders.medicationOrderPublicId,
        canonicalMedicationOrders.patientLinkPublicId,
        canonicalMedicationOrders.encounterPublicId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_admin_order_status_version',
      columns: [table.tenantId, table.medicationOrderPublicId, table.medicationOrderStatusVersion],
      foreignColumns: [
        canonicalMedicationOrderStatusEvents.tenantId,
        canonicalMedicationOrderStatusEvents.medicationOrderPublicId,
        canonicalMedicationOrderStatusEvents.eventVersion,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_admin_patient_link',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_admin_encounter_scope',
      columns: [table.tenantId, table.encounterPublicId, table.patientLinkPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId, canonicalEncounters.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_admin_practitioner',
      columns: [table.tenantId, table.administeringPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_admin_supersedes',
      columns: [
        table.tenantId,
        table.medicationOrderPublicId,
        table.patientLinkPublicId,
        table.encounterPublicId,
        table.supersedesAdministrationEventPublicId,
      ],
      foreignColumns: [
        table.tenantId,
        table.medicationOrderPublicId,
        table.patientLinkPublicId,
        table.encounterPublicId,
        table.administrationEventPublicId,
      ],
    }).onDelete('restrict'),
    check('canonical_med_admin_event_kind_check', sql`${table.eventKind} IN ('administration','correction','entered_in_error')`),
    check('canonical_med_admin_event_version_check', sql`${table.medicationOrderStatusVersion} > 0`),
    check('canonical_med_admin_actor_check', sql`${table.actorUserPublicId} IS NOT NULL OR ${table.actorSystemKey} IS NOT NULL`),
    check(
      'canonical_med_admin_supersession_check',
      sql`(${table.eventKind} = 'administration' AND ${table.supersedesAdministrationEventPublicId} IS NULL)
        OR (${table.eventKind} IN ('correction','entered_in_error')
          AND ${table.supersedesAdministrationEventPublicId} IS NOT NULL
          AND ${table.supersedesAdministrationEventPublicId} != ${table.administrationEventPublicId})`,
    ),
    check(
      'canonical_med_admin_outcome_check',
      sql`(${table.eventKind} IN ('administration','correction')
          AND ${table.outcomeCode} IN ('given','partially_given','withheld','refused','omitted','not_available','cancelled'))
        OR (${table.eventKind} = 'entered_in_error'
          AND ${table.outcomeCode} IS NULL
          AND ${table.administeredDoseValueDecimal} IS NULL
          AND ${table.administeredDoseUnitCode} IS NULL
          AND ${table.routeCode} IS NULL
          AND ${table.siteCode} IS NULL
          AND ${table.methodCode} IS NULL
          AND ${table.reasonCode} IS NOT NULL)`,
    ),
    check(
      'canonical_med_admin_dose_pair_check',
      sql`(${table.administeredDoseValueDecimal} IS NULL AND ${table.administeredDoseUnitCode} IS NULL)
        OR (${table.administeredDoseValueDecimal} IS NOT NULL
          AND ${table.administeredDoseUnitCode} IS NOT NULL
          AND ${table.administeredDoseValueDecimal} = trim(${table.administeredDoseValueDecimal})
          AND length(${table.administeredDoseValueDecimal}) > 0
          AND ${table.administeredDoseValueDecimal} NOT GLOB '*[^0-9.-]*'
          AND ${table.administeredDoseValueDecimal} NOT LIKE '.%'
          AND ${table.administeredDoseValueDecimal} NOT LIKE '%.'
          AND ${table.administeredDoseValueDecimal} NOT GLOB '*.*.*'
          AND ${table.administeredDoseValueDecimal} NOT GLOB '*-*-*'
          AND (instr(${table.administeredDoseValueDecimal}, '-') = 0 OR instr(${table.administeredDoseValueDecimal}, '-') = 1)
          AND CAST(${table.administeredDoseValueDecimal} AS REAL) > 0
          AND length(trim(${table.administeredDoseUnitCode})) > 0)`,
    ),
    check(
      'canonical_med_admin_given_check',
      sql`${table.outcomeCode} NOT IN ('given','partially_given')
        OR (${table.administeredDoseValueDecimal} IS NOT NULL
          AND ${table.administeredDoseUnitCode} IS NOT NULL
          AND ${table.routeCode} IS NOT NULL
          AND length(trim(${table.routeCode})) > 0)`,
    ),
    check(
      'canonical_med_admin_non_administration_check',
      sql`${table.outcomeCode} NOT IN ('withheld','refused','omitted','not_available','cancelled')
        OR (${table.administeredDoseValueDecimal} IS NULL
          AND ${table.administeredDoseUnitCode} IS NULL
          AND ${table.routeCode} IS NULL
          AND ${table.reasonCode} IS NOT NULL
          AND length(trim(${table.reasonCode})) > 0)`,
    ),
    check(
      'canonical_med_admin_time_check',
      sql`(${table.scheduledAtUtc} IS NULL OR substr(${table.scheduledAtUtc}, -1) = 'Z')
        AND substr(${table.occurredAtUtc}, -1) = 'Z'
        AND substr(${table.recordedAtUtc}, -1) = 'Z'
        AND (${table.recordedAtUtc} >= ${table.occurredAtUtc}
          OR (${table.lateEntryReasonCode} IS NOT NULL AND length(trim(${table.lateEntryReasonCode})) > 0))
        AND substr(${table.createdAtUtc}, -1) = 'Z'`,
    ),
    check('canonical_med_admin_dispense_pair_check', paired(table.dispenseSourceType, table.dispenseSourcePublicId)),
    check('canonical_med_admin_lot_pair_check', paired(table.lotSourceType, table.lotSourcePublicId)),
    check('canonical_med_admin_barcode_pair_check', paired(table.barcodeSourceType, table.barcodeSourcePublicId)),
    check('canonical_med_admin_device_pair_check', paired(table.deviceSourceType, table.deviceSourcePublicId)),
    check('canonical_med_admin_fingerprint_check', lowercaseSha256(table.requestFingerprintSha256)),
    check('canonical_med_admin_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

export const canonicalMedicationReconciliations = sqliteTable(
  'canonical_medication_reconciliations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    reconciliationPublicId: text('reconciliation_public_id').notNull(),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    reconciliationType: text('reconciliation_type').notNull(),
    currentVersionPublicId: text('current_version_public_id'),
    currentStatus: text('current_status').notNull().default('draft'),
    statusVersion: integer('status_version').notNull().default(1),
    creatingPractitionerPublicId: text('creating_practitioner_public_id').notNull(),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprintSha256: text('request_fingerprint_sha256').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_med_reconciliation_public_id').on(table.tenantId, table.reconciliationPublicId),
    uniqueIndex('uq_canonical_med_reconciliation_scope').on(
      table.tenantId,
      table.reconciliationPublicId,
      table.patientLinkPublicId,
      table.encounterPublicId,
    ),
    uniqueIndex('uq_canonical_med_reconciliation_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_med_reconciliation_patient_status').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.currentStatus,
      table.reconciliationPublicId,
    ),
    index('idx_canonical_med_reconciliation_encounter_type').on(
      table.tenantId,
      table.encounterPublicId,
      table.reconciliationType,
      table.currentStatus,
    ),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_patient_link',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_encounter_scope',
      columns: [table.tenantId, table.encounterPublicId, table.patientLinkPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId, canonicalEncounters.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_creator',
      columns: [table.tenantId, table.creatingPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check('canonical_med_reconciliation_type_check', sql`${table.reconciliationType} IN ('admission','transfer','discharge')`),
    check('canonical_med_reconciliation_status_check', sql`${table.currentStatus} IN ('draft','final','cancelled','entered_in_error')`),
    check('canonical_med_reconciliation_status_version_check', sql`${table.statusVersion} > 0`),
    check('canonical_med_reconciliation_actor_check', sql`${table.actorUserPublicId} IS NOT NULL OR ${table.actorSystemKey} IS NOT NULL`),
    check('canonical_med_reconciliation_fingerprint_check', lowercaseSha256(table.requestFingerprintSha256)),
    check('canonical_med_reconciliation_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
    check(
      'canonical_med_reconciliation_time_check',
      sql`substr(${table.createdAtUtc}, -1) = 'Z' AND substr(${table.updatedAtUtc}, -1) = 'Z'`,
    ),
  ],
);

export const canonicalMedicationReconciliationVersions = sqliteTable(
  'canonical_medication_reconciliation_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    versionPublicId: text('version_public_id').notNull(),
    reconciliationPublicId: text('reconciliation_public_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    supersedesVersionPublicId: text('supersedes_version_public_id'),
    versionStatus: text('version_status').notNull().default('draft'),
    sourceSummarySha256: text('source_summary_sha256').notNull(),
    contentSha256: text('content_sha256').notNull(),
    signedContentSha256: text('signed_content_sha256'),
    authoringPractitionerPublicId: text('authoring_practitioner_public_id').notNull(),
    finalizingPractitionerPublicId: text('finalizing_practitioner_public_id'),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    authoredAtUtc: text('authored_at_utc').notNull(),
    finalizedAtUtc: text('finalized_at_utc'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_med_reconciliation_version_public_id').on(table.tenantId, table.versionPublicId),
    uniqueIndex('uq_canonical_med_reconciliation_version_scope').on(
      table.tenantId,
      table.reconciliationPublicId,
      table.versionPublicId,
    ),
    uniqueIndex('uq_canonical_med_reconciliation_version_number').on(
      table.tenantId,
      table.reconciliationPublicId,
      table.versionNumber,
    ),
    uniqueIndex('uq_canonical_med_reconciliation_version_supersedes').on(
      table.tenantId,
      table.reconciliationPublicId,
      table.supersedesVersionPublicId,
    ),
    index('idx_canonical_med_reconciliation_versions_timeline').on(
      table.tenantId,
      table.reconciliationPublicId,
      table.versionNumber,
      table.versionPublicId,
    ),
    index('idx_canonical_med_reconciliation_versions_status').on(
      table.tenantId,
      table.versionStatus,
      table.finalizedAtUtc,
      table.versionPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_version_header',
      columns: [table.tenantId, table.reconciliationPublicId],
      foreignColumns: [canonicalMedicationReconciliations.tenantId, canonicalMedicationReconciliations.reconciliationPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_version_supersedes',
      columns: [table.tenantId, table.reconciliationPublicId, table.supersedesVersionPublicId],
      foreignColumns: [table.tenantId, table.reconciliationPublicId, table.versionPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_version_author',
      columns: [table.tenantId, table.authoringPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_version_finalizer',
      columns: [table.tenantId, table.finalizingPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check('canonical_med_reconciliation_version_number_check', sql`${table.versionNumber} > 0`),
    check('canonical_med_reconciliation_version_status_check', sql`${table.versionStatus} IN ('draft','final','cancelled','entered_in_error')`),
    check(
      'canonical_med_reconciliation_version_lifecycle_check',
      sql`(${table.versionStatus} = 'draft'
          AND ${table.signedContentSha256} IS NULL
          AND ${table.finalizingPractitionerPublicId} IS NULL
          AND ${table.finalizedAtUtc} IS NULL)
        OR (${table.versionStatus} = 'final'
          AND ${table.signedContentSha256} IS NOT NULL
          AND ${table.signedContentSha256} = ${table.contentSha256}
          AND ${table.finalizingPractitionerPublicId} IS NOT NULL
          AND ${table.finalizedAtUtc} IS NOT NULL)
        OR ${table.versionStatus} IN ('cancelled','entered_in_error')`,
    ),
    check('canonical_med_reconciliation_version_actor_check', sql`${table.actorUserPublicId} IS NOT NULL OR ${table.actorSystemKey} IS NOT NULL`),
    check(
      'canonical_med_reconciliation_version_self_supersession_check',
      sql`${table.supersedesVersionPublicId} IS NULL OR ${table.supersedesVersionPublicId} != ${table.versionPublicId}`,
    ),
    check(
      'canonical_med_reconciliation_version_time_check',
      sql`substr(${table.authoredAtUtc}, -1) = 'Z'
        AND (${table.finalizedAtUtc} IS NULL
          OR (substr(${table.finalizedAtUtc}, -1) = 'Z' AND ${table.finalizedAtUtc} >= ${table.authoredAtUtc}))
        AND substr(${table.createdAtUtc}, -1) = 'Z'`,
    ),
    check('canonical_med_reconciliation_version_source_hash_check', lowercaseSha256(table.sourceSummarySha256)),
    check('canonical_med_reconciliation_version_content_hash_check', lowercaseSha256(table.contentSha256)),
    check(
      'canonical_med_reconciliation_version_signed_hash_check',
      sql`${table.signedContentSha256} IS NULL OR (${lowercaseSha256(table.signedContentSha256)})`,
    ),
    check('canonical_med_reconciliation_version_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

export const canonicalMedicationReconciliationItems = sqliteTable(
  'canonical_medication_reconciliation_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    itemPublicId: text('item_public_id').notNull(),
    reconciliationPublicId: text('reconciliation_public_id').notNull(),
    versionPublicId: text('version_public_id').notNull(),
    itemSequence: integer('item_sequence').notNull(),
    sourceKind: text('source_kind').notNull(),
    decisionCode: text('decision_code').notNull(),
    prescriptionPublicId: text('prescription_public_id'),
    prescriptionVersionPublicId: text('prescription_version_public_id'),
    medicationOrderPublicId: text('medication_order_public_id'),
    medicationDescriptionSnapshot: text('medication_description_snapshot').notNull(),
    priorDoseSnapshot: text('prior_dose_snapshot'),
    priorRouteSnapshot: text('prior_route_snapshot'),
    priorFrequencySnapshot: text('prior_frequency_snapshot'),
    proposedDoseSnapshot: text('proposed_dose_snapshot'),
    proposedRouteSnapshot: text('proposed_route_snapshot'),
    proposedFrequencySnapshot: text('proposed_frequency_snapshot'),
    reasonCode: text('reason_code').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_med_reconciliation_item_public_id').on(table.tenantId, table.itemPublicId),
    uniqueIndex('uq_canonical_med_reconciliation_item_sequence').on(
      table.tenantId,
      table.reconciliationPublicId,
      table.versionPublicId,
      table.itemSequence,
    ),
    index('idx_canonical_med_reconciliation_items_version').on(
      table.tenantId,
      table.reconciliationPublicId,
      table.versionPublicId,
      table.itemSequence,
    ),
    index('idx_canonical_med_reconciliation_items_order').on(
      table.tenantId,
      table.medicationOrderPublicId,
      table.reconciliationPublicId,
      table.versionPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_item_version',
      columns: [table.tenantId, table.reconciliationPublicId, table.versionPublicId],
      foreignColumns: [
        canonicalMedicationReconciliationVersions.tenantId,
        canonicalMedicationReconciliationVersions.reconciliationPublicId,
        canonicalMedicationReconciliationVersions.versionPublicId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_item_prescription_version',
      columns: [table.tenantId, table.prescriptionPublicId, table.prescriptionVersionPublicId],
      foreignColumns: [
        canonicalPrescriptionVersions.tenantId,
        canonicalPrescriptionVersions.prescriptionPublicId,
        canonicalPrescriptionVersions.versionPublicId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_item_order',
      columns: [table.tenantId, table.medicationOrderPublicId],
      foreignColumns: [canonicalMedicationOrders.tenantId, canonicalMedicationOrders.medicationOrderPublicId],
    }).onDelete('restrict'),
    check('canonical_med_reconciliation_item_sequence_check', sql`${table.itemSequence} > 0`),
    check('canonical_med_reconciliation_item_source_check', sql`${table.sourceKind} IN ('home','inpatient','new','unknown')`),
    check('canonical_med_reconciliation_item_decision_check', sql`${table.decisionCode} IN ('continue','modify','discontinue','add')`),
    check('canonical_med_reconciliation_item_prescription_pair_check', paired(table.prescriptionPublicId, table.prescriptionVersionPublicId)),
    check('canonical_med_reconciliation_item_description_check', sql`length(trim(${table.medicationDescriptionSnapshot})) > 0`),
    check('canonical_med_reconciliation_item_reason_check', sql`length(trim(${table.reasonCode})) > 0`),
    check(
      'canonical_med_reconciliation_item_proposal_check',
      sql`${table.decisionCode} NOT IN ('modify','add')
        OR (${table.proposedDoseSnapshot} IS NOT NULL
          OR ${table.proposedRouteSnapshot} IS NOT NULL
          OR ${table.proposedFrequencySnapshot} IS NOT NULL)`,
    ),
    check('canonical_med_reconciliation_item_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
    check('canonical_med_reconciliation_item_time_check', sql`substr(${table.createdAtUtc}, -1) = 'Z'`),
  ],
);

export const canonicalMedicationReconciliationStatusEvents = sqliteTable(
  'canonical_medication_reconciliation_status_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    eventPublicId: text('event_public_id').notNull(),
    reconciliationPublicId: text('reconciliation_public_id').notNull(),
    versionPublicId: text('version_public_id').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    eventVersion: integer('event_version').notNull(),
    eventType: text('event_type').notNull(),
    reasonCode: text('reason_code').notNull(),
    actorPractitionerPublicId: text('actor_practitioner_public_id'),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    occurredAtUtc: text('occurred_at_utc').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_med_reconciliation_event_public_id').on(table.tenantId, table.eventPublicId),
    uniqueIndex('uq_canonical_med_reconciliation_event_version').on(
      table.tenantId,
      table.reconciliationPublicId,
      table.eventVersion,
    ),
    index('idx_canonical_med_reconciliation_events_timeline').on(
      table.tenantId,
      table.reconciliationPublicId,
      table.eventVersion,
      table.occurredAtUtc,
    ),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_event_header',
      columns: [table.tenantId, table.reconciliationPublicId],
      foreignColumns: [canonicalMedicationReconciliations.tenantId, canonicalMedicationReconciliations.reconciliationPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_event_version',
      columns: [table.tenantId, table.reconciliationPublicId, table.versionPublicId],
      foreignColumns: [
        canonicalMedicationReconciliationVersions.tenantId,
        canonicalMedicationReconciliationVersions.reconciliationPublicId,
        canonicalMedicationReconciliationVersions.versionPublicId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_med_reconciliation_event_practitioner',
      columns: [table.tenantId, table.actorPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_med_reconciliation_event_from_check',
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('draft','final','cancelled','entered_in_error')`,
    ),
    check('canonical_med_reconciliation_event_to_check', sql`${table.toStatus} IN ('draft','final','cancelled','entered_in_error')`),
    check('canonical_med_reconciliation_event_version_check', sql`${table.eventVersion} > 0`),
    check(
      'canonical_med_reconciliation_event_type_check',
      sql`${table.eventType} IN ('draft_created','draft_replaced','finalized','cancelled','entered_in_error')`,
    ),
    check('canonical_med_reconciliation_event_reason_check', sql`length(trim(${table.reasonCode})) > 0`),
    check(
      'canonical_med_reconciliation_event_actor_check',
      sql`${table.actorPractitionerPublicId} IS NOT NULL
        OR ${table.actorUserPublicId} IS NOT NULL
        OR ${table.actorSystemKey} IS NOT NULL`,
    ),
    check(
      'canonical_med_reconciliation_event_time_check',
      sql`substr(${table.occurredAtUtc}, -1) = 'Z' AND substr(${table.createdAtUtc}, -1) = 'Z'`,
    ),
    check('canonical_med_reconciliation_event_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);
