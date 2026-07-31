import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { canonicalEncounters } from './clinical';
import { canonicalPractitioners } from './identity';
import { canonicalTenantPatientLinks } from './patient-identity';

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const lowercaseSha256 = (column: AnySQLiteColumn) => sql`length(${column}) = 64
  AND ${column} = lower(${column})
  AND ${column} NOT GLOB '*[^0-9a-f]*'`;

export const canonicalVitalObservationSets = sqliteTable(
  'canonical_vital_observation_sets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    observationSetPublicId: text('observation_set_public_id').notNull(),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    encounterPublicId: text('encounter_public_id'),
    practitionerPublicId: text('practitioner_public_id'),
    sourceKind: text('source_kind').notNull(),
    externalDeviceSourceType: text('external_device_source_type'),
    externalDeviceSourcePublicId: text('external_device_source_public_id'),
    effectiveAtUtc: text('effective_at_utc').notNull(),
    recordedAtUtc: text('recorded_at_utc').notNull(),
    reviewStatus: text('review_status').notNull().default('pending_review'),
    statusVersion: integer('status_version').notNull().default(1),
    supersedesObservationSetPublicId: text('supersedes_observation_set_public_id'),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprintSha256: text('request_fingerprint_sha256').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_vital_sets_public_id').on(table.tenantId, table.observationSetPublicId),
    uniqueIndex('uq_canonical_vital_sets_patient_scope').on(
      table.tenantId,
      table.observationSetPublicId,
      table.patientLinkPublicId,
    ),
    uniqueIndex('uq_canonical_vital_sets_idempotency').on(table.tenantId, table.idempotencyKey),
    uniqueIndex('uq_canonical_vital_sets_supersedes').on(
      table.tenantId,
      table.supersedesObservationSetPublicId,
    ),
    index('idx_canonical_vital_sets_patient_time').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.effectiveAtUtc,
      table.observationSetPublicId,
    ),
    index('idx_canonical_vital_sets_encounter_time').on(
      table.tenantId,
      table.encounterPublicId,
      table.effectiveAtUtc,
      table.observationSetPublicId,
    ),
    index('idx_canonical_vital_sets_review').on(
      table.tenantId,
      table.reviewStatus,
      table.recordedAtUtc,
      table.observationSetPublicId,
    ),
    index('idx_canonical_vital_sets_device').on(
      table.tenantId,
      table.externalDeviceSourceType,
      table.externalDeviceSourcePublicId,
      table.effectiveAtUtc,
    ),
    foreignKey({
      name: 'fk_canonical_vital_sets_patient_link',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_vital_sets_encounter_scope',
      columns: [table.tenantId, table.encounterPublicId, table.patientLinkPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId, canonicalEncounters.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_vital_sets_practitioner',
      columns: [table.tenantId, table.practitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_vital_sets_supersedes',
      columns: [table.tenantId, table.supersedesObservationSetPublicId],
      foreignColumns: [table.tenantId, table.observationSetPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_vital_sets_source_kind_check',
      sql`${table.sourceKind} IN (
        'practitioner_entered','nurse_entered','patient_reported',
        'device_imported','system_derived','legacy_backfill'
      )`,
    ),
    check(
      'canonical_vital_sets_practitioner_check',
      sql`${table.sourceKind} NOT IN ('practitioner_entered','nurse_entered')
        OR ${table.practitionerPublicId} IS NOT NULL`,
    ),
    check(
      'canonical_vital_sets_device_pair_check',
      sql`(${table.externalDeviceSourceType} IS NULL AND ${table.externalDeviceSourcePublicId} IS NULL)
        OR (${table.externalDeviceSourceType} IS NOT NULL AND ${table.externalDeviceSourcePublicId} IS NOT NULL)`,
    ),
    check(
      'canonical_vital_sets_device_source_check',
      sql`${table.sourceKind} != 'device_imported'
        OR (${table.externalDeviceSourceType} IS NOT NULL AND ${table.externalDeviceSourcePublicId} IS NOT NULL)`,
    ),
    check(
      'canonical_vital_sets_status_check',
      sql`${table.reviewStatus} IN ('pending_review','verified','rejected','superseded','entered_in_error')`,
    ),
    check('canonical_vital_sets_status_version_check', sql`${table.statusVersion} > 0`),
    check(
      'canonical_vital_sets_actor_check',
      sql`${table.actorUserPublicId} IS NOT NULL OR ${table.actorSystemKey} IS NOT NULL`,
    ),
    check(
      'canonical_vital_sets_self_supersession_check',
      sql`${table.supersedesObservationSetPublicId} IS NULL
        OR ${table.supersedesObservationSetPublicId} != ${table.observationSetPublicId}`,
    ),
    check(
      'canonical_vital_sets_time_check',
      sql`substr(${table.effectiveAtUtc}, -1) = 'Z'
        AND substr(${table.recordedAtUtc}, -1) = 'Z'
        AND ${table.recordedAtUtc} >= ${table.effectiveAtUtc}
        AND substr(${table.createdAtUtc}, -1) = 'Z'
        AND substr(${table.updatedAtUtc}, -1) = 'Z'`,
    ),
    check('canonical_vital_sets_fingerprint_check', lowercaseSha256(table.requestFingerprintSha256)),
    check('canonical_vital_sets_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

export const canonicalVitalObservationComponents = sqliteTable(
  'canonical_vital_observation_components',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    componentPublicId: text('component_public_id').notNull(),
    observationSetPublicId: text('observation_set_public_id').notNull(),
    componentSequence: integer('component_sequence').notNull(),
    measurementCode: text('measurement_code').notNull(),
    numericValue: real('numeric_value').notNull(),
    canonicalUnitCode: text('canonical_unit_code').notNull(),
    sourceNumericValue: real('source_numeric_value'),
    sourceUnitCode: text('source_unit_code'),
    methodCode: text('method_code'),
    bodySiteCode: text('body_site_code'),
    postureCode: text('posture_code'),
    lateralityCode: text('laterality_code'),
    fastingContextCode: text('fasting_context_code'),
    referenceLow: real('reference_low'),
    referenceHigh: real('reference_high'),
    alertLevel: text('alert_level'),
    isDerived: integer('is_derived').notNull().default(0),
    derivationFormulaKey: text('derivation_formula_key'),
    derivationFormulaVersion: text('derivation_formula_version'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_vital_components_public_id').on(table.tenantId, table.componentPublicId),
    uniqueIndex('uq_canonical_vital_components_sequence').on(
      table.tenantId,
      table.observationSetPublicId,
      table.componentSequence,
    ),
    uniqueIndex('uq_canonical_vital_components_measurement').on(
      table.tenantId,
      table.observationSetPublicId,
      table.measurementCode,
    ),
    index('idx_canonical_vital_components_set').on(
      table.tenantId,
      table.observationSetPublicId,
      table.componentSequence,
      table.componentPublicId,
    ),
    index('idx_canonical_vital_components_measurement').on(
      table.tenantId,
      table.measurementCode,
      table.canonicalUnitCode,
      table.observationSetPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_vital_components_set',
      columns: [table.tenantId, table.observationSetPublicId],
      foreignColumns: [canonicalVitalObservationSets.tenantId, canonicalVitalObservationSets.observationSetPublicId],
    }).onDelete('restrict'),
    check('canonical_vital_components_sequence_check', sql`${table.componentSequence} > 0`),
    check(
      'canonical_vital_components_code_check',
      sql`${table.measurementCode} IN (
        'body_temperature','heart_rate','respiratory_rate','oxygen_saturation',
        'blood_pressure_systolic','blood_pressure_diastolic','body_weight',
        'body_height','body_mass_index','pain_score','blood_glucose'
      )`,
    ),
    check(
      'canonical_vital_components_unit_check',
      sql`(${table.measurementCode} = 'body_temperature' AND ${table.canonicalUnitCode} = 'Cel')
        OR (${table.measurementCode} IN ('heart_rate','respiratory_rate') AND ${table.canonicalUnitCode} = '/min')
        OR (${table.measurementCode} = 'oxygen_saturation' AND ${table.canonicalUnitCode} = '%')
        OR (${table.measurementCode} IN ('blood_pressure_systolic','blood_pressure_diastolic') AND ${table.canonicalUnitCode} = 'mm[Hg]')
        OR (${table.measurementCode} = 'body_weight' AND ${table.canonicalUnitCode} = 'kg')
        OR (${table.measurementCode} = 'body_height' AND ${table.canonicalUnitCode} = 'cm')
        OR (${table.measurementCode} = 'body_mass_index' AND ${table.canonicalUnitCode} = 'kg/m2')
        OR (${table.measurementCode} = 'pain_score' AND ${table.canonicalUnitCode} = '{score}')
        OR (${table.measurementCode} = 'blood_glucose' AND ${table.canonicalUnitCode} = 'mg/dL')`,
    ),
    check(
      'canonical_vital_components_value_check',
      sql`${table.numericValue} = ${table.numericValue}
        AND CASE ${table.measurementCode}
          WHEN 'body_temperature' THEN ${table.numericValue} BETWEEN 20 AND 50
          WHEN 'heart_rate' THEN ${table.numericValue} BETWEEN 1 AND 350
          WHEN 'respiratory_rate' THEN ${table.numericValue} BETWEEN 1 AND 150
          WHEN 'oxygen_saturation' THEN ${table.numericValue} BETWEEN 0 AND 100
          WHEN 'blood_pressure_systolic' THEN ${table.numericValue} BETWEEN 20 AND 350
          WHEN 'blood_pressure_diastolic' THEN ${table.numericValue} BETWEEN 10 AND 250
          WHEN 'body_weight' THEN ${table.numericValue} > 0 AND ${table.numericValue} <= 1000
          WHEN 'body_height' THEN ${table.numericValue} > 0 AND ${table.numericValue} <= 300
          WHEN 'body_mass_index' THEN ${table.numericValue} > 0 AND ${table.numericValue} <= 200
          WHEN 'pain_score' THEN ${table.numericValue} BETWEEN 0 AND 10
            AND ${table.numericValue} = CAST(${table.numericValue} AS INTEGER)
          WHEN 'blood_glucose' THEN ${table.numericValue} > 0 AND ${table.numericValue} <= 3000
          ELSE 0
        END`,
    ),
    check(
      'canonical_vital_components_source_pair_check',
      sql`(${table.sourceNumericValue} IS NULL AND ${table.sourceUnitCode} IS NULL)
        OR (${table.sourceNumericValue} IS NOT NULL AND ${table.sourceUnitCode} IS NOT NULL)`,
    ),
    check(
      'canonical_vital_components_reference_check',
      sql`${table.referenceLow} IS NULL OR ${table.referenceHigh} IS NULL
        OR ${table.referenceLow} <= ${table.referenceHigh}`,
    ),
    check(
      'canonical_vital_components_alert_check',
      sql`${table.alertLevel} IS NULL OR ${table.alertLevel} IN ('normal','low','high','critical')`,
    ),
    check(
      'canonical_vital_components_derived_check',
      sql`(${table.measurementCode} = 'body_mass_index'
          AND ${table.isDerived} = 1
          AND ${table.derivationFormulaKey} IS NOT NULL
          AND ${table.derivationFormulaVersion} IS NOT NULL)
        OR (${table.measurementCode} != 'body_mass_index'
          AND ${table.isDerived} = 0
          AND ${table.derivationFormulaKey} IS NULL
          AND ${table.derivationFormulaVersion} IS NULL)`,
    ),
    check('canonical_vital_components_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
    check('canonical_vital_components_created_time_check', sql`substr(${table.createdAtUtc}, -1) = 'Z'`),
  ],
);

export const canonicalVitalObservationStatusEvents = sqliteTable(
  'canonical_vital_observation_status_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    eventPublicId: text('event_public_id').notNull(),
    observationSetPublicId: text('observation_set_public_id').notNull(),
    fromReviewStatus: text('from_review_status'),
    toReviewStatus: text('to_review_status').notNull(),
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
    uniqueIndex('uq_canonical_vital_events_public_id').on(table.tenantId, table.eventPublicId),
    uniqueIndex('uq_canonical_vital_events_version').on(
      table.tenantId,
      table.observationSetPublicId,
      table.eventVersion,
    ),
    index('idx_canonical_vital_events_timeline').on(
      table.tenantId,
      table.observationSetPublicId,
      table.eventVersion,
      table.occurredAtUtc,
      table.eventPublicId,
    ),
    index('idx_canonical_vital_events_status').on(
      table.tenantId,
      table.toReviewStatus,
      table.occurredAtUtc,
      table.observationSetPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_vital_events_set',
      columns: [table.tenantId, table.observationSetPublicId],
      foreignColumns: [canonicalVitalObservationSets.tenantId, canonicalVitalObservationSets.observationSetPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_vital_events_practitioner',
      columns: [table.tenantId, table.actorPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_vital_events_from_status_check',
      sql`${table.fromReviewStatus} IS NULL OR ${table.fromReviewStatus} IN (
        'pending_review','verified','rejected','superseded','entered_in_error'
      )`,
    ),
    check(
      'canonical_vital_events_to_status_check',
      sql`${table.toReviewStatus} IN ('pending_review','verified','rejected','superseded','entered_in_error')`,
    ),
    check('canonical_vital_events_version_check', sql`${table.eventVersion} > 0`),
    check(
      'canonical_vital_events_type_check',
      sql`${table.eventType} IN (
        'recorded','reviewed','verified','rejected','corrected','superseded','entered_in_error'
      )`,
    ),
    check('canonical_vital_events_reason_check', sql`length(trim(${table.reasonCode})) > 0`),
    check(
      'canonical_vital_events_actor_check',
      sql`${table.actorPractitionerPublicId} IS NOT NULL
        OR ${table.actorUserPublicId} IS NOT NULL
        OR ${table.actorSystemKey} IS NOT NULL`,
    ),
    check(
      'canonical_vital_events_time_check',
      sql`substr(${table.occurredAtUtc}, -1) = 'Z' AND substr(${table.createdAtUtc}, -1) = 'Z'`,
    ),
    check('canonical_vital_events_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);
