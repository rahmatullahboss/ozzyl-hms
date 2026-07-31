import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface EncounterAdmissionBedReconciliationPreparedStatement {
  bind(...values: unknown[]): EncounterAdmissionBedReconciliationPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface EncounterAdmissionBedReconciliationDatabase {
  prepare(sql: string): EncounterAdmissionBedReconciliationPreparedStatement;
}

export interface EncounterAdmissionBedReconciliationOptions {
  tenantId: string;
  runPublicId: string;
  migrationRunPublicId?: string;
  nowUtc?: string;
}

export interface EncounterAdmissionBedReconciliationCheck {
  name: string;
  mismatchCount: number;
}

export interface EncounterAdmissionBedReconciliationResult {
  runPublicId: string;
  status: 'passed' | 'failed';
  scannedChecks: number;
  matchedChecks: number;
  mismatchChecks: number;
  checks: EncounterAdmissionBedReconciliationCheck[];
  evidenceSha256: string;
}

interface CountRow { count: number }
interface RunRow { id: number; status?: string; result_summary_json?: string | null }
interface ConvergenceIssueRow {
  issue_code: string;
  entity_type: string;
  source_type: string | null;
  source_public_id: string | null;
}

const CHECK_NAMES = [
  'encounter_source_mapping_cardinality',
  'encounter_patient_link_validity',
  'encounter_status_version_validity',
  'planned_actual_care_classification',
  'encounter_participant_practitioner_tenant_validity',
  'admission_source_mapping_cardinality',
  'active_admission_per_inpatient_encounter',
  'admission_header_latest_event_parity',
  'admission_event_sequence_transition_validity',
  'encounter_admission_patient_agreement',
  'admission_interval_terminal_time_validity',
  'care_location_mapping_hierarchy_validity',
  'bed_resource_mapping_tenant_location_validity',
  'open_stay_cardinality_per_bed',
  'open_stay_cardinality_per_active_admission',
  'interval_overlap_per_bed',
  'interval_overlap_per_admission',
  'stay_admission_encounter_patient_consistency',
  'inactive_bed_active_occupancy',
  'legacy_bed_status_derived_occupancy',
  'unresolved_convergence_issues',
  'cross_tenant_references',
  'second_pass_zero_new_row_evidence',
] as const;

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

async function count(
  db: EncounterAdmissionBedReconciliationDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<CountRow>();
  return Math.max(0, Number(row?.count ?? 0) || 0);
}

async function tableExists(
  db: EncounterAdmissionBedReconciliationDatabase,
  table: string,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 AS found FROM sqlite_schema WHERE type='table' AND name=? LIMIT 1
  `).bind(table).first<{ found: number }>();
  return row != null;
}

async function tableColumnExists(
  db: EncounterAdmissionBedReconciliationDatabase,
  table: string,
  column: string,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 AS found FROM pragma_table_info(?) WHERE name=? LIMIT 1
  `).bind(table, column).first<{ found: number }>();
  return row != null;
}

async function sourceCardinalityMismatch(
  db: EncounterAdmissionBedReconciliationDatabase,
  input: {
    tenantId: string;
    sourceTable: string;
    entityType: string;
    sourceType: string;
  },
): Promise<number> {
  if (!(await tableExists(db, input.sourceTable))) return 0;
  const sourceCount = await count(
    db,
    `SELECT COUNT(*) count FROM ${input.sourceTable} WHERE CAST(tenant_id AS TEXT)=?`,
    [input.tenantId],
  );
  const dispositionCount = await count(db, `
    SELECT COUNT(*) count FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=?
      AND mapping_status IN ('mapped','ambiguous','rejected')
  `, [input.tenantId, input.entityType, input.sourceType]);
  return Math.abs(sourceCount - dispositionCount);
}

async function resolveMigrationRun(
  db: EncounterAdmissionBedReconciliationDatabase,
  tenantId: string,
  migrationRunPublicId?: string,
): Promise<RunRow | null> {
  if (migrationRunPublicId != null) {
    const row = await db.prepare(`
      SELECT id,status,result_summary_json FROM canonical_migration_runs
      WHERE tenant_id=? AND run_public_id=? LIMIT 1
    `).bind(tenantId, exact(migrationRunPublicId, 'migrationRunPublicId')).first<RunRow>();
    if (!row) throw new Error('Referenced encounter/admission/bed migration run was not found');
    return row;
  }
  return db.prepare(`
    SELECT id,status,result_summary_json FROM canonical_migration_runs
    WHERE tenant_id=? AND migration_kind='backfill'
      AND migration_name IN (
        'CDB-113E encounter admission bed convergence',
        '0548_canonical_encounter_admission_bed_convergence.sql'
      )
    ORDER BY id DESC LIMIT 1
  `).bind(tenantId).first<RunRow>();
}

async function encounterSourceMappingCardinality(
  db: EncounterAdmissionBedReconciliationDatabase,
  tenantId: string,
): Promise<number> {
  const cardinality = await sourceCardinalityMismatch(db, {
    tenantId,
    sourceTable: 'encounters',
    entityType: 'encounter',
    sourceType: 'legacy_encounter',
  });
  const brokenTargets = await count(db, `
    SELECT COUNT(*) count FROM canonical_source_mappings m
    LEFT JOIN canonical_encounters e
      ON e.tenant_id=m.tenant_id AND e.encounter_public_id=m.canonical_public_id
    WHERE m.tenant_id=? AND m.entity_type='encounter' AND m.source_type='legacy_encounter'
      AND m.mapping_status='mapped' AND e.encounter_public_id IS NULL
  `, [tenantId]);
  return cardinality + brokenTargets;
}

async function admissionSourceMappingCardinality(
  db: EncounterAdmissionBedReconciliationDatabase,
  tenantId: string,
): Promise<number> {
  const cardinality = await sourceCardinalityMismatch(db, {
    tenantId,
    sourceTable: 'admissions',
    entityType: 'admission',
    sourceType: 'legacy_admission',
  });
  const brokenTargets = await count(db, `
    SELECT COUNT(*) count FROM canonical_source_mappings m
    LEFT JOIN canonical_admissions a
      ON a.tenant_id=m.tenant_id AND a.admission_public_id=m.canonical_public_id
    WHERE m.tenant_id=? AND m.entity_type='admission' AND m.source_type='legacy_admission'
      AND m.mapping_status='mapped' AND a.admission_public_id IS NULL
  `, [tenantId]);
  return cardinality + brokenTargets;
}

async function careLocationMappingHierarchyValidity(
  db: EncounterAdmissionBedReconciliationDatabase,
  tenantId: string,
): Promise<number> {
  const mappingTargets = await count(db, `
    SELECT COUNT(*) count FROM canonical_source_mappings m
    LEFT JOIN canonical_care_locations l
      ON l.tenant_id=m.tenant_id AND l.location_public_id=m.canonical_public_id
    WHERE m.tenant_id=? AND m.entity_type='care_location'
      AND m.source_type='legacy_bed_location' AND m.mapping_status='mapped'
      AND l.location_public_id IS NULL
  `, [tenantId]);
  const hierarchy = await count(db, `
    SELECT COUNT(*) count FROM canonical_care_locations l
    LEFT JOIN canonical_care_locations p
      ON p.tenant_id=l.tenant_id AND p.location_public_id=l.parent_location_public_id
    WHERE l.tenant_id=? AND (
      l.location_public_id=l.parent_location_public_id
      OR (l.parent_location_public_id IS NOT NULL AND p.location_public_id IS NULL)
    )
  `, [tenantId]);
  return mappingTargets + hierarchy;
}

async function bedResourceMappingTenantLocationValidity(
  db: EncounterAdmissionBedReconciliationDatabase,
  tenantId: string,
): Promise<number> {
  const cardinality = await sourceCardinalityMismatch(db, {
    tenantId,
    sourceTable: 'beds',
    entityType: 'bed',
    sourceType: 'legacy_bed',
  });
  const invalid = await count(db, `
    SELECT COUNT(*) count FROM canonical_source_mappings m
    LEFT JOIN canonical_beds b
      ON b.tenant_id=m.tenant_id AND b.bed_public_id=m.canonical_public_id
    LEFT JOIN canonical_care_locations l
      ON l.tenant_id=b.tenant_id AND l.location_public_id=b.location_public_id
    WHERE m.tenant_id=? AND m.entity_type='bed' AND m.source_type='legacy_bed'
      AND m.mapping_status='mapped'
      AND (b.bed_public_id IS NULL OR l.location_public_id IS NULL)
  `, [tenantId]);
  return cardinality + invalid;
}

async function legacyBedStatusDerivedOccupancy(
  db: EncounterAdmissionBedReconciliationDatabase,
  tenantId: string,
): Promise<number> {
  if (!(await tableExists(db, 'beds')) || !(await tableExists(db, 'patient_bed_infos'))) return 0;
  const sourceEndColumn = await tableColumnExists(db, 'patient_bed_infos', 'ended_at_utc')
    ? 'ended_at_utc'
    : await tableColumnExists(db, 'patient_bed_infos', 'ended_on')
      ? 'ended_on'
      : null;
  if (sourceEndColumn == null) return 0;
  return count(db, `
    SELECT COUNT(*) count FROM beds legacy
    JOIN canonical_source_mappings m
      ON m.tenant_id=CAST(legacy.tenant_id AS TEXT)
     AND m.entity_type='bed' AND m.source_type='legacy_bed'
     AND m.source_public_id=CAST(legacy.id AS TEXT) AND m.mapping_status='mapped'
    WHERE CAST(legacy.tenant_id AS TEXT)=?
      AND (
        (lower(trim(CAST(legacy.status AS TEXT))) IN ('occupied','in_use','in-use') AND NOT EXISTS (
          SELECT 1 FROM canonical_bed_stays s
          WHERE s.tenant_id=m.tenant_id AND s.bed_public_id=m.canonical_public_id
            AND s.status='active' AND s.ended_at_utc IS NULL
        ))
        OR
        (lower(trim(CAST(legacy.status AS TEXT))) IN ('available','free','vacant') AND EXISTS (
          SELECT 1 FROM canonical_bed_stays s
          WHERE s.tenant_id=m.tenant_id AND s.bed_public_id=m.canonical_public_id
            AND s.status='active' AND s.ended_at_utc IS NULL
        ))
      )
      AND NOT (
        EXISTS (
          SELECT 1 FROM canonical_processing_issues i
          WHERE i.tenant_id=m.tenant_id
            AND i.issue_type='encounter_admission_bed_backfill'
            AND i.issue_code='CDB113E_LEGACY_BED_STATUS_CACHE_VARIANCE'
            AND i.entity_type='bed' AND i.source_type='legacy_bed'
            AND i.source_public_id=CAST(legacy.id AS TEXT)
            AND i.status IN ('open','acknowledged','waived')
        )
        OR
        (
          EXISTS (
            SELECT 1 FROM patient_bed_infos p
            WHERE CAST(p.tenant_id AS TEXT)=CAST(legacy.tenant_id AS TEXT)
              AND p.bed_id=legacy.id AND p.${sourceEndColumn} IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM canonical_bed_stays s
            WHERE s.tenant_id=m.tenant_id AND s.bed_public_id=m.canonical_public_id
              AND s.status='active' AND s.ended_at_utc IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM patient_bed_infos p
            LEFT JOIN canonical_source_mappings stay_mapping
              ON stay_mapping.tenant_id=CAST(p.tenant_id AS TEXT)
             AND stay_mapping.entity_type='bed_stay'
             AND stay_mapping.source_type='legacy_patient_bed_info'
             AND stay_mapping.source_public_id=CAST(p.id AS TEXT)
            WHERE CAST(p.tenant_id AS TEXT)=CAST(legacy.tenant_id AS TEXT)
              AND p.bed_id=legacy.id AND p.${sourceEndColumn} IS NULL
              AND NOT (
                stay_mapping.mapping_status='ambiguous'
                AND stay_mapping.canonical_public_id IS NULL
                AND EXISTS (
                  SELECT 1 FROM canonical_processing_issues i
                  WHERE i.tenant_id=stay_mapping.tenant_id
                    AND i.issue_type='encounter_admission_bed_backfill'
                    AND i.entity_type='bed_stay'
                    AND i.source_type='legacy_patient_bed_info'
                    AND i.source_public_id=stay_mapping.source_public_id
                    AND i.issue_code IN (
                      'CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING',
                      'CDB113E_BED_STAY_BED_MAPPING_MISSING',
                      'CDB113E_BED_STAY_PATIENT_MISMATCH',
                      'CDB113E_BED_STAY_INTERVAL_INVALID',
                      'CDB113E_BED_STAY_INTERVAL_OVERLAP',
                      'CDB113E_MAINTENANCE_BED_OCCUPANCY',
                      'CDB113E_INACTIVE_BED_OCCUPANCY',
                      'CDB113E_PATIENT_LINK_MISSING',
                      'CDB113E_PATIENT_LINK_AMBIGUOUS'
                    )
                    AND i.status IN ('open','acknowledged','waived')
                )
              )
          )
        )
      )
  `, [tenantId]);
}

async function unresolvedConvergenceIssueCount(
  db: EncounterAdmissionBedReconciliationDatabase,
  tenantId: string,
): Promise<number> {
  const issues = (await db.prepare(`
    SELECT issue_code,entity_type,source_type,source_public_id
    FROM canonical_processing_issues
    WHERE tenant_id=? AND issue_type='encounter_admission_bed_backfill'
      AND status IN ('open','acknowledged')
    ORDER BY issue_code,entity_type,source_type,source_public_id
  `).bind(tenantId).all<ConvergenceIssueRow>()).results;
  const sourceEndColumn = await tableColumnExists(db, 'patient_bed_infos', 'ended_at_utc')
    ? 'ended_at_utc'
    : await tableColumnExists(db, 'patient_bed_infos', 'ended_on')
      ? 'ended_on'
      : null;
  const admissionEncounterColumn = await tableColumnExists(db, 'admissions', 'encounter_id')
    ? 'encounter_id'
    : null;
  const directAdmissionEncounterMappingPredicate = admissionEncounterColumn == null
    ? '0'
    : `(source.${admissionEncounterColumn} IS NOT NULL
        AND m.source_type='legacy_encounter'
        AND m.source_public_id=CAST(source.${admissionEncounterColumn} AS TEXT))`;
  let unresolved = 0;
  for (const issue of issues) {
    const sourcePublicId = issue.source_public_id;
    let exactDisposition = false;
    if (
      issue.issue_code === 'CDB113E_PATIENT_LINK_MISSING'
      && issue.entity_type === 'encounter'
      && issue.source_type === 'canonical_encounter'
      && sourcePublicId != null
    ) {
      exactDisposition = await count(db, `
        SELECT COUNT(*) count FROM canonical_encounters e
        WHERE e.tenant_id=? AND e.encounter_public_id=?
          AND e.patient_link_public_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM canonical_tenant_patient_links p
            WHERE p.tenant_id=e.tenant_id AND p.legacy_patient_id=e.legacy_patient_id
              AND p.link_status NOT IN ('rejected','retired') AND p.effective_to_utc IS NULL
          )
      `, [tenantId, sourcePublicId]) === 1;
    } else if (
      issue.issue_code === 'CDB113E_PATIENT_LINK_MISSING'
      && issue.entity_type === 'admission'
      && issue.source_type === 'legacy_admission'
      && sourcePublicId != null
    ) {
      exactDisposition = await count(db, `
        SELECT COUNT(*) count FROM admissions source
        JOIN canonical_source_mappings disposition
          ON disposition.tenant_id=CAST(source.tenant_id AS TEXT)
         AND disposition.entity_type='admission'
         AND disposition.source_type='legacy_admission'
         AND disposition.source_public_id=CAST(source.id AS TEXT)
         AND disposition.mapping_status='ambiguous'
         AND disposition.canonical_public_id IS NULL
        WHERE CAST(source.tenant_id AS TEXT)=? AND CAST(source.id AS TEXT)=?
          AND NOT EXISTS (
            SELECT 1 FROM canonical_tenant_patient_links p
            WHERE p.tenant_id=CAST(source.tenant_id AS TEXT)
              AND p.legacy_patient_id=source.patient_id
              AND p.link_status NOT IN ('rejected','retired') AND p.effective_to_utc IS NULL
          )
      `, [tenantId, sourcePublicId]) === 1;
    } else if (
      issue.issue_code === 'CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT'
      && issue.entity_type === 'admission'
      && issue.source_type === 'legacy_admission'
      && sourcePublicId != null
    ) {
      exactDisposition = await count(db, `
        SELECT COUNT(*) count FROM admissions source
        JOIN canonical_source_mappings disposition
          ON disposition.tenant_id=CAST(source.tenant_id AS TEXT)
         AND disposition.entity_type='admission'
         AND disposition.source_type='legacy_admission'
         AND disposition.source_public_id=CAST(source.id AS TEXT)
         AND disposition.mapping_status='ambiguous'
         AND disposition.canonical_public_id IS NULL
        WHERE CAST(source.tenant_id AS TEXT)=? AND CAST(source.id AS TEXT)=?
          AND EXISTS (
            SELECT 1 FROM canonical_encounters e
            WHERE e.tenant_id=CAST(source.tenant_id AS TEXT)
              AND e.encounter_type<>'inpatient'
              AND e.encounter_public_id IN (
                SELECT m.canonical_public_id FROM canonical_source_mappings m
                WHERE m.tenant_id=CAST(source.tenant_id AS TEXT)
                  AND m.entity_type='encounter' AND m.mapping_status='mapped'
                  AND (
                    ${directAdmissionEncounterMappingPredicate}
                    OR (m.source_type='legacy_admission' AND m.source_public_id=CAST(source.id AS TEXT))
                  )
                UNION
                SELECT l.encounter_public_id FROM canonical_encounter_admission_links l
                WHERE l.tenant_id=CAST(source.tenant_id AS TEXT)
                  AND l.legacy_admission_id=source.id AND l.link_status='active'
              )
          )
      `, [tenantId, sourcePublicId]) === 1;
    } else if (
      issue.issue_code === 'CDB113E_ADMISSION_ENCOUNTER_MAPPING_MISSING'
      && issue.entity_type === 'admission'
      && issue.source_type === 'legacy_admission'
      && sourcePublicId != null
    ) {
      exactDisposition = await count(db, `
        SELECT COUNT(*) count FROM admissions source
        JOIN canonical_source_mappings disposition
          ON disposition.tenant_id=CAST(source.tenant_id AS TEXT)
         AND disposition.entity_type='admission'
         AND disposition.source_type='legacy_admission'
         AND disposition.source_public_id=CAST(source.id AS TEXT)
         AND disposition.mapping_status='ambiguous'
         AND disposition.canonical_public_id IS NULL
        WHERE CAST(source.tenant_id AS TEXT)=? AND CAST(source.id AS TEXT)=?
          AND NOT EXISTS (
            SELECT 1 FROM canonical_encounters e
            WHERE e.tenant_id=CAST(source.tenant_id AS TEXT)
              AND e.encounter_public_id IN (
                SELECT m.canonical_public_id FROM canonical_source_mappings m
                WHERE m.tenant_id=CAST(source.tenant_id AS TEXT)
                  AND m.entity_type='encounter' AND m.mapping_status='mapped'
                  AND (
                    ${directAdmissionEncounterMappingPredicate}
                    OR (m.source_type='legacy_admission' AND m.source_public_id=CAST(source.id AS TEXT))
                  )
                UNION
                SELECT l.encounter_public_id FROM canonical_encounter_admission_links l
                WHERE l.tenant_id=CAST(source.tenant_id AS TEXT)
                  AND l.legacy_admission_id=source.id AND l.link_status='active'
              )
          )
      `, [tenantId, sourcePublicId]) === 1;
    } else if (
      issue.issue_code === 'CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING'
      && issue.entity_type === 'bed_stay'
      && issue.source_type === 'legacy_patient_bed_info'
      && sourcePublicId != null
    ) {
      exactDisposition = await count(db, `
        SELECT COUNT(*) count FROM patient_bed_infos source
        JOIN canonical_source_mappings disposition
          ON disposition.tenant_id=CAST(source.tenant_id AS TEXT)
         AND disposition.entity_type='bed_stay'
         AND disposition.source_type='legacy_patient_bed_info'
         AND disposition.source_public_id=CAST(source.id AS TEXT)
         AND disposition.mapping_status='ambiguous'
         AND disposition.canonical_public_id IS NULL
        WHERE CAST(source.tenant_id AS TEXT)=? AND CAST(source.id AS TEXT)=?
          AND NOT EXISTS (
            SELECT 1 FROM canonical_source_mappings admission_mapping
            JOIN canonical_admissions a
              ON a.tenant_id=admission_mapping.tenant_id
             AND a.admission_public_id=admission_mapping.canonical_public_id
            WHERE admission_mapping.tenant_id=CAST(source.tenant_id AS TEXT)
              AND admission_mapping.entity_type='admission'
              AND admission_mapping.source_type='legacy_admission'
              AND admission_mapping.source_public_id=CAST(source.admission_id AS TEXT)
              AND admission_mapping.mapping_status='mapped'
          )
          AND NOT EXISTS (
            SELECT 1 FROM canonical_bed_stays s
            WHERE s.tenant_id=CAST(source.tenant_id AS TEXT)
              AND s.legacy_patient_bed_info_id=source.id
              AND NOT (
                s.status='invalid'
                AND s.admission_public_id IS NULL
                AND s.bed_public_id IS NULL
                AND s.patient_link_public_id IS NULL
                AND s.close_reason='CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING'
              )
          )
      `, [tenantId, sourcePublicId]) === 1;
    } else if (
      issue.issue_code === 'CDB113E_LEGACY_BED_STATUS_CACHE_VARIANCE'
      && issue.entity_type === 'bed'
      && issue.source_type === 'legacy_bed'
      && sourcePublicId != null
      && sourceEndColumn != null
    ) {
      exactDisposition = await count(db, `
        SELECT COUNT(*) count FROM beds legacy
        WHERE CAST(legacy.tenant_id AS TEXT)=? AND CAST(legacy.id AS TEXT)=?
          AND (
            (
              lower(trim(CAST(legacy.status AS TEXT))) IN ('occupied','in_use','in-use')
              AND NOT EXISTS (
                SELECT 1 FROM patient_bed_infos p
                WHERE CAST(p.tenant_id AS TEXT)=CAST(legacy.tenant_id AS TEXT)
                  AND p.bed_id=legacy.id AND p.${sourceEndColumn} IS NULL
              )
            )
            OR
            (
              lower(trim(CAST(legacy.status AS TEXT))) IN ('available','free','vacant')
              AND EXISTS (
                SELECT 1 FROM patient_bed_infos p
                WHERE CAST(p.tenant_id AS TEXT)=CAST(legacy.tenant_id AS TEXT)
                  AND p.bed_id=legacy.id AND p.${sourceEndColumn} IS NULL
              )
            )
          )
      `, [tenantId, sourcePublicId]) === 1;
    }
    if (!exactDisposition) unresolved += 1;
  }
  return unresolved;
}

async function crossTenantReferences(
  db: EncounterAdmissionBedReconciliationDatabase,
  tenantId: string,
): Promise<number> {
  return count(db, `
    SELECT COUNT(*) count FROM (
      SELECT a.id FROM canonical_admissions a
      WHERE a.tenant_id=? AND (
        (NOT EXISTS (
          SELECT 1 FROM canonical_encounters e
          WHERE e.tenant_id=a.tenant_id AND e.encounter_public_id=a.encounter_public_id
        ) AND EXISTS (
          SELECT 1 FROM canonical_encounters e
          WHERE e.tenant_id<>a.tenant_id AND e.encounter_public_id=a.encounter_public_id
        ))
        OR
        (NOT EXISTS (
          SELECT 1 FROM canonical_tenant_patient_links p
          WHERE p.tenant_id=a.tenant_id AND p.patient_link_public_id=a.patient_link_public_id
        ) AND EXISTS (
          SELECT 1 FROM canonical_tenant_patient_links p
          WHERE p.tenant_id<>a.tenant_id AND p.patient_link_public_id=a.patient_link_public_id
        ))
      )
      UNION ALL
      SELECT b.id FROM canonical_beds b
      WHERE b.tenant_id=? AND NOT EXISTS (
        SELECT 1 FROM canonical_care_locations l
        WHERE l.tenant_id=b.tenant_id AND l.location_public_id=b.location_public_id
      ) AND EXISTS (
        SELECT 1 FROM canonical_care_locations l
        WHERE l.tenant_id<>b.tenant_id AND l.location_public_id=b.location_public_id
      )
      UNION ALL
      SELECT s.id FROM canonical_bed_stays s
      WHERE s.tenant_id=? AND (
        (s.admission_public_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM canonical_admissions a
          WHERE a.tenant_id=s.tenant_id AND a.admission_public_id=s.admission_public_id
        ) AND EXISTS (
          SELECT 1 FROM canonical_admissions a
          WHERE a.tenant_id<>s.tenant_id AND a.admission_public_id=s.admission_public_id
        ))
        OR
        (s.bed_public_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM canonical_beds b
          WHERE b.tenant_id=s.tenant_id AND b.bed_public_id=s.bed_public_id
        ) AND EXISTS (
          SELECT 1 FROM canonical_beds b
          WHERE b.tenant_id<>s.tenant_id AND b.bed_public_id=s.bed_public_id
        ))
      )
    )
  `, [tenantId, tenantId, tenantId]);
}

export async function reconcileEncounterAdmissionBedConvergence(
  db: EncounterAdmissionBedReconciliationDatabase,
  options: EncounterAdmissionBedReconciliationOptions,
): Promise<EncounterAdmissionBedReconciliationResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const nowUtc = toUtcIso(options.nowUtc ?? new Date());
  const migrationRun = await resolveMigrationRun(db, tenantId, options.migrationRunPublicId);
  const checks: EncounterAdmissionBedReconciliationCheck[] = [];
  const add = (name: typeof CHECK_NAMES[number], mismatchCount: number): void => {
    checks.push({ name, mismatchCount: Math.max(0, Number(mismatchCount) || 0) });
  };

  add('encounter_source_mapping_cardinality', await encounterSourceMappingCardinality(db, tenantId));

  add('encounter_patient_link_validity', await count(db, `
    SELECT COUNT(*) count FROM canonical_encounters e
    LEFT JOIN canonical_tenant_patient_links p
      ON p.tenant_id=e.tenant_id AND p.patient_link_public_id=e.patient_link_public_id
    WHERE e.tenant_id=? AND (
      (
        e.patient_link_public_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM canonical_processing_issues i
          WHERE i.tenant_id=e.tenant_id
            AND i.issue_type='encounter_admission_bed_backfill'
            AND i.issue_code IN ('CDB113E_PATIENT_LINK_MISSING','CDB113E_PATIENT_LINK_AMBIGUOUS')
            AND i.entity_type='encounter' AND i.source_type='canonical_encounter'
            AND i.source_public_id=e.encounter_public_id
            AND i.status IN ('open','acknowledged','waived')
            AND NOT EXISTS (
              SELECT 1 FROM canonical_tenant_patient_links candidate
              WHERE candidate.tenant_id=e.tenant_id
                AND candidate.legacy_patient_id=e.legacy_patient_id
                AND candidate.link_status NOT IN ('rejected','retired')
                AND candidate.effective_to_utc IS NULL
            )
        )
      )
      OR
      (
        e.patient_link_public_id IS NOT NULL
        AND (
          p.patient_link_public_id IS NULL
          OR p.link_status IN ('rejected','retired')
          OR p.effective_to_utc IS NOT NULL
          OR p.legacy_patient_id<>e.legacy_patient_id
        )
      )
    )
  `, [tenantId]));

  add('encounter_status_version_validity', await count(db, `
    SELECT COUNT(*) count FROM canonical_encounters
    WHERE tenant_id=? AND (
      encounter_version<1
      OR status NOT IN ('planned','in_progress','on_hold','completed','cancelled','entered_in_error','unknown')
    )
  `, [tenantId]));

  add('planned_actual_care_classification', await count(db, `
    SELECT COUNT(*) count FROM canonical_encounters e
    WHERE e.tenant_id=? AND e.status='planned' AND NOT EXISTS (
      SELECT 1 FROM canonical_processing_issues i
      WHERE i.tenant_id=e.tenant_id
        AND i.issue_type='encounter_admission_bed_backfill'
        AND i.issue_code='CDB113E_PLANNED_ACTUAL_CARE_STATE'
        AND i.entity_type='encounter'
        AND i.source_public_id=e.encounter_public_id
        AND i.status IN ('open','acknowledged','waived')
    )
  `, [tenantId]));

  add('encounter_participant_practitioner_tenant_validity', await count(db, `
    SELECT COUNT(*) count FROM canonical_encounter_participants ep
    LEFT JOIN canonical_encounters e
      ON e.tenant_id=ep.tenant_id AND e.encounter_public_id=ep.encounter_public_id
    LEFT JOIN canonical_practitioners p
      ON p.tenant_id=ep.tenant_id AND p.practitioner_public_id=ep.practitioner_public_id
    WHERE ep.tenant_id=? AND (e.encounter_public_id IS NULL OR p.practitioner_public_id IS NULL)
  `, [tenantId]));

  add('admission_source_mapping_cardinality', await admissionSourceMappingCardinality(db, tenantId));

  add('active_admission_per_inpatient_encounter', await count(db, `
    SELECT COUNT(*) count FROM (
      SELECT a.encounter_public_id
      FROM canonical_admissions a
      LEFT JOIN canonical_encounters e
        ON e.tenant_id=a.tenant_id AND e.encounter_public_id=a.encounter_public_id
      WHERE a.tenant_id=? AND a.current_status IN ('planned','admitted','transfer_pending','discharge_pending')
      GROUP BY a.encounter_public_id
      HAVING COUNT(*)>1 OR MAX(CASE WHEN e.encounter_type='inpatient' THEN 0 ELSE 1 END)>0
    )
  `, [tenantId]));

  add('admission_header_latest_event_parity', await count(db, `
    SELECT COUNT(*) count FROM canonical_admissions a
    LEFT JOIN canonical_admission_status_events latest
      ON latest.tenant_id=a.tenant_id AND latest.admission_public_id=a.admission_public_id
     AND latest.sequence=(
       SELECT MAX(x.sequence) FROM canonical_admission_status_events x
       WHERE x.tenant_id=a.tenant_id AND x.admission_public_id=a.admission_public_id
     )
    WHERE a.tenant_id=? AND (
      latest.event_public_id IS NULL
      OR latest.to_status<>a.current_status
      OR latest.sequence<>a.status_version
    )
  `, [tenantId]));

  add('admission_event_sequence_transition_validity', await count(db, `
    SELECT COUNT(*) count FROM (
      SELECT e.tenant_id,e.admission_public_id
      FROM canonical_admission_status_events e
      WHERE e.tenant_id=?
      GROUP BY e.tenant_id,e.admission_public_id
      HAVING MIN(e.sequence)<>1 OR MAX(e.sequence)<>COUNT(*)
      UNION ALL
      SELECT current.tenant_id,current.admission_public_id
      FROM canonical_admission_status_events current
      LEFT JOIN canonical_admission_status_events previous
        ON previous.tenant_id=current.tenant_id
       AND previous.admission_public_id=current.admission_public_id
       AND previous.sequence=current.sequence-1
      WHERE current.tenant_id=? AND current.sequence>1
        AND (previous.event_public_id IS NULL OR current.from_status<>previous.to_status)
    )
  `, [tenantId, tenantId]));

  add('encounter_admission_patient_agreement', await count(db, `
    SELECT COUNT(*) count FROM canonical_admissions a
    LEFT JOIN canonical_encounters e
      ON e.tenant_id=a.tenant_id AND e.encounter_public_id=a.encounter_public_id
    WHERE a.tenant_id=? AND (
      e.encounter_public_id IS NULL OR e.patient_link_public_id IS NULL
      OR e.patient_link_public_id<>a.patient_link_public_id
    )
  `, [tenantId]));

  add('admission_interval_terminal_time_validity', await count(db, `
    SELECT COUNT(*) count FROM canonical_admissions
    WHERE tenant_id=? AND (
      (discharged_at_utc IS NOT NULL AND discharged_at_utc<admitted_at_utc)
      OR (current_status='discharged' AND discharged_at_utc IS NULL)
      OR (current_status<>'discharged' AND discharged_at_utc IS NOT NULL)
    )
  `, [tenantId]));

  add('care_location_mapping_hierarchy_validity', await careLocationMappingHierarchyValidity(db, tenantId));
  add('bed_resource_mapping_tenant_location_validity', await bedResourceMappingTenantLocationValidity(db, tenantId));

  add('open_stay_cardinality_per_bed', await count(db, `
    SELECT COUNT(*) count FROM (
      SELECT bed_public_id FROM canonical_bed_stays
      WHERE tenant_id=? AND status='active' AND ended_at_utc IS NULL AND bed_public_id IS NOT NULL
      GROUP BY bed_public_id HAVING COUNT(*)>1
    )
  `, [tenantId]));

  add('open_stay_cardinality_per_active_admission', await count(db, `
    SELECT COUNT(*) count FROM (
      SELECT admission_public_id FROM canonical_bed_stays
      WHERE tenant_id=? AND status='active' AND ended_at_utc IS NULL AND admission_public_id IS NOT NULL
      GROUP BY admission_public_id HAVING COUNT(*)>1
    )
  `, [tenantId]));

  add('interval_overlap_per_bed', await count(db, `
    SELECT COUNT(*) count FROM canonical_bed_stays a
    JOIN canonical_bed_stays b
      ON b.tenant_id=a.tenant_id AND b.id>a.id AND b.bed_public_id=a.bed_public_id
     AND a.started_at_utc<COALESCE(b.ended_at_utc,'9999-12-31T23:59:59.999Z')
     AND b.started_at_utc<COALESCE(a.ended_at_utc,'9999-12-31T23:59:59.999Z')
    WHERE a.tenant_id=? AND a.status<>'invalid' AND b.status<>'invalid'
  `, [tenantId]));

  add('interval_overlap_per_admission', await count(db, `
    SELECT COUNT(*) count FROM canonical_bed_stays a
    JOIN canonical_bed_stays b
      ON b.tenant_id=a.tenant_id AND b.id>a.id AND b.admission_public_id=a.admission_public_id
     AND a.started_at_utc<COALESCE(b.ended_at_utc,'9999-12-31T23:59:59.999Z')
     AND b.started_at_utc<COALESCE(a.ended_at_utc,'9999-12-31T23:59:59.999Z')
    WHERE a.tenant_id=? AND a.status<>'invalid' AND b.status<>'invalid'
  `, [tenantId]));

  add('stay_admission_encounter_patient_consistency', await count(db, `
    SELECT COUNT(*) count FROM canonical_bed_stays s
    LEFT JOIN canonical_admissions a
      ON a.tenant_id=s.tenant_id AND a.admission_public_id=s.admission_public_id
    LEFT JOIN canonical_encounters e
      ON e.tenant_id=s.tenant_id AND e.encounter_public_id=s.encounter_public_id
    LEFT JOIN canonical_beds b
      ON b.tenant_id=s.tenant_id AND b.bed_public_id=s.bed_public_id
    LEFT JOIN canonical_tenant_patient_links p
      ON p.tenant_id=s.tenant_id AND p.patient_link_public_id=s.patient_link_public_id
    WHERE s.tenant_id=? AND NOT (
      (
        s.status='invalid'
        AND s.admission_public_id IS NULL
        AND s.bed_public_id IS NULL
        AND s.patient_link_public_id IS NULL
        AND s.ended_at_utc IS NOT NULL
        AND s.ended_at_utc>=s.started_at_utc
        AND s.close_reason IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM canonical_source_mappings m
          WHERE m.tenant_id=s.tenant_id AND m.entity_type='bed_stay'
            AND m.source_type='legacy_patient_bed_info'
            AND m.source_public_id=CAST(s.legacy_patient_bed_info_id AS TEXT)
            AND m.mapping_status='ambiguous' AND m.canonical_public_id IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM canonical_processing_issues i
          WHERE i.tenant_id=s.tenant_id
            AND i.issue_type='encounter_admission_bed_backfill'
            AND i.entity_type='bed_stay'
            AND i.source_type='legacy_patient_bed_info'
            AND i.source_public_id=CAST(s.legacy_patient_bed_info_id AS TEXT)
            AND i.issue_code=s.close_reason
            AND i.status IN ('open','acknowledged','waived')
        )
      )
      OR
      (
        s.status IN ('active','completed')
        AND a.admission_public_id IS NOT NULL
        AND e.encounter_public_id IS NOT NULL
        AND b.bed_public_id IS NOT NULL
        AND p.patient_link_public_id IS NOT NULL
        AND a.encounter_public_id=s.encounter_public_id
        AND a.patient_link_public_id=s.patient_link_public_id
        AND e.patient_link_public_id=s.patient_link_public_id
        AND (s.ended_at_utc IS NULL OR s.ended_at_utc>=s.started_at_utc)
        AND (s.status<>'active' OR s.ended_at_utc IS NULL)
        AND (s.status='active' OR s.ended_at_utc IS NOT NULL)
      )
    )
  `, [tenantId]));

  add('inactive_bed_active_occupancy', await count(db, `
    SELECT COUNT(*) count FROM canonical_bed_stays s
    JOIN canonical_beds b
      ON b.tenant_id=s.tenant_id AND b.bed_public_id=s.bed_public_id
    WHERE s.tenant_id=? AND s.status='active' AND s.ended_at_utc IS NULL
      AND b.operational_status<>'active'
  `, [tenantId]));

  add('legacy_bed_status_derived_occupancy', await legacyBedStatusDerivedOccupancy(db, tenantId));

  add('unresolved_convergence_issues', await unresolvedConvergenceIssueCount(db, tenantId));

  add('cross_tenant_references', await crossTenantReferences(db, tenantId));

  add('second_pass_zero_new_row_evidence', 0);

  // The final gate is intentionally evaluated outside the generic count helper so a
  // missing/invalid JSON receipt fails closed rather than being treated as zero rows.
  const secondPassIndex = checks.findIndex((check) => check.name === 'second_pass_zero_new_row_evidence');
  let secondPassMismatch = 1;
  if (migrationRun != null && migrationRun.status === 'succeeded') {
    try {
      const summary = migrationRun.result_summary_json == null
        ? null
        : JSON.parse(String(migrationRun.result_summary_json)) as { secondPassZeroNew?: unknown };
      secondPassMismatch = summary?.secondPassZeroNew === true ? 0 : 1;
    } catch {
      secondPassMismatch = 1;
    }
  }
  checks[secondPassIndex] = {
    name: 'second_pass_zero_new_row_evidence',
    mismatchCount: secondPassMismatch,
  };

  if (checks.length !== CHECK_NAMES.length) {
    throw new Error(`CDB-113E reconciliation requires ${CHECK_NAMES.length} checks, received ${checks.length}`);
  }
  if (checks.some((check, index) => check.name !== CHECK_NAMES[index])) {
    throw new Error('CDB-113E reconciliation check registry order drifted');
  }

  const mismatchChecks = checks.filter((check) => check.mismatchCount > 0).length;
  const scannedChecks = checks.length;
  const matchedChecks = scannedChecks - mismatchChecks;
  const status: 'passed' | 'failed' = mismatchChecks === 0 ? 'passed' : 'failed';
  const evidenceSha256 = await createSourceEvidenceSha256({
    schemaVersion: 1,
    checkpoint: 'CDB-113E',
    tenantId,
    checks,
  });
  const summary = stableCanonicalJson({
    schemaVersion: 1,
    checkpoint: 'CDB-113E',
    scannedChecks,
    matchedChecks,
    mismatchChecks,
    checks,
  });

  await db.prepare(`
    INSERT INTO canonical_reconciliation_runs (
      tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
      scanned_count,matched_count,mismatch_count,exception_count,evidence_sha256,
      result_summary_json,started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'clinical','backfill',?,?,?,?,?,?, ?,?,?,?,?)
    ON CONFLICT (tenant_id,run_public_id) DO UPDATE SET
      migration_run_id=excluded.migration_run_id,
      status=excluded.status,
      scanned_count=excluded.scanned_count,
      matched_count=excluded.matched_count,
      mismatch_count=excluded.mismatch_count,
      exception_count=excluded.exception_count,
      evidence_sha256=excluded.evidence_sha256,
      result_summary_json=excluded.result_summary_json,
      started_at_utc=excluded.started_at_utc,
      completed_at_utc=excluded.completed_at_utc,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    tenantId,
    runPublicId,
    migrationRun?.id ?? null,
    status,
    scannedChecks,
    matchedChecks,
    mismatchChecks,
    0,
    evidenceSha256,
    summary,
    nowUtc,
    nowUtc,
    nowUtc,
    nowUtc,
  ).run();

  return {
    runPublicId,
    status,
    scannedChecks,
    matchedChecks,
    mismatchChecks,
    checks,
    evidenceSha256,
  };
}
