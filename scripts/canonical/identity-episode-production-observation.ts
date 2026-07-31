import { containsNormalizedKey } from './protected-json-document';
import {
  IDENTITY_EPISODE_OBSERVATION_PROVIDERS,
  type IdentityEpisodeObservationAuthorization,
  type IdentityEpisodeObservationProvider,
} from './identity-episode-production-observation-authorization';

export interface IdentityEpisodeObservationAggregateRow {
  provider: IdentityEpisodeObservationProvider;
  source_count: number;
  mapped_source_count: number;
  missing_mapping_count: number;
  duplicate_active_mapping_count: number;
  invalid_canonical_target_count: number;
  cross_tenant_relationship_count: number;
  unresolved_critical_issue_count: number;
  enabled_flag_count: number;
  canonical_mode_flag_count: number;
}

export interface IdentityEpisodeObservationIteration {
  rows: IdentityEpisodeObservationAggregateRow[];
  durationMs: number;
  changedDb: boolean;
  rowsWritten: number;
}

export interface IdentityEpisodeProductionObservationInput {
  authorization: IdentityEpisodeObservationAuthorization;
  observedAtUtc: string;
  iterations: IdentityEpisodeObservationIteration[];
}

export type IdentityEpisodeProductionObservationIssueCode =
  | 'CDB113G_SENSITIVE_EVIDENCE_REJECTED'
  | 'CDB113G_INPUT_SCHEMA_INVALID'
  | 'CDB113G_ITERATION_COUNT_INVALID'
  | 'CDB113G_OBSERVATION_TIMING_INVALID'
  | 'CDB113G_PROVIDER_RESULT_INVALID'
  | 'CDB113G_READ_ONLY_BOUNDARY_VIOLATED'
  | 'CDB113G_AGGREGATE_DRIFT'
  | 'CDB113G_DUPLICATE_MAPPING'
  | 'CDB113G_INVALID_CANONICAL_TARGET'
  | 'CDB113G_CROSS_TENANT_RELATIONSHIP'
  | 'CDB113G_UNRESOLVED_CRITICAL_ISSUE'
  | 'CDB113G_PROVIDER_FLAG_ENABLED'
  | 'CDB113G_CANONICAL_MODE_PRESENT'
  | 'CDB113G_LATENCY_THRESHOLD_EXCEEDED';

export interface IdentityEpisodeProductionObservationIssue {
  code: IdentityEpisodeProductionObservationIssueCode;
}

export interface IdentityEpisodeProductionObservationResult {
  schemaVersion: 1;
  evidenceReady: boolean;
  observationReady: boolean;
  promotionReady: false;
  providerCount: number;
  measuredIterationCount: number;
  mappingBlockerCount: number;
  totalMissingMappingCount: number;
  p95DurationMs: number;
  maxDurationMs: number;
  issues: IdentityEpisodeProductionObservationIssue[];
  mappingBlockers: Array<{
    provider: IdentityEpisodeObservationProvider;
    missingMappingCount: number;
  }>;
  aggregateOnly: true;
  productionMutationPerformed: false;
  rowsWritten: number;
}

const RESULT_ROOT_KEYS = new Set(['authorization', 'observedAtUtc', 'iterations']);
const ITERATION_KEYS = new Set(['rows', 'durationMs', 'changedDb', 'rowsWritten']);
const ROW_KEYS = new Set([
  'provider',
  'source_count',
  'mapped_source_count',
  'missing_mapping_count',
  'duplicate_active_mapping_count',
  'invalid_canonical_target_count',
  'cross_tenant_relationship_count',
  'unresolved_critical_issue_count',
  'enabled_flag_count',
  'canonical_mode_flag_count',
]);
const SENSITIVE_EVIDENCE_KEYS = new Set([
  'header',
  'headers',
  'cookie',
  'cookies',
  'token',
  'password',
  'secret',
  'credential',
  'credentials',
  'rawoutput',
  'sql',
  'command',
  'path',
  'sourceid',
  'canonicalid',
  'patientid',
  'practitionerid',
  'appointmentid',
  'encounterid',
  'admissionid',
  'bedid',
  'mobile',
  'phone',
  'email',
  'address',
  'diagnosis',
  'notes',
  'amount',
  'price',
]);
const PROVIDERS = IDENTITY_EPISODE_OBSERVATION_PROVIDERS.map((entry) => entry.provider);

function issue(code: IdentityEpisodeProductionObservationIssueCode): IdentityEpisodeProductionObservationIssue {
  return { code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: unknown, expected: ReadonlySet<string>): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validRow(value: unknown): value is IdentityEpisodeObservationAggregateRow {
  if (!exactKeys(value, ROW_KEYS)) return false;
  if (!PROVIDERS.includes(value.provider as IdentityEpisodeObservationProvider)) return false;
  return [...ROW_KEYS]
    .filter((key) => key !== 'provider')
    .every((key) => nonNegativeInteger(value[key]));
}

function normalizeRows(rows: IdentityEpisodeObservationAggregateRow[]): IdentityEpisodeObservationAggregateRow[] {
  return PROVIDERS.map((provider) => rows.find((row) => row.provider === provider)!)
    .map((row) => ({ ...row }));
}

function validateRows(rows: unknown): rows is IdentityEpisodeObservationAggregateRow[] {
  if (!Array.isArray(rows) || rows.length !== PROVIDERS.length || !rows.every(validRow)) return false;
  const names = rows.map((row) => row.provider);
  return new Set(names).size === PROVIDERS.length && PROVIDERS.every((provider) => names.includes(provider));
}

function nearestRankP95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function parseUtc(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function emptyResult(
  input: unknown,
  issues: IdentityEpisodeProductionObservationIssue[],
): IdentityEpisodeProductionObservationResult {
  const iterations = isRecord(input) && Array.isArray(input.iterations) ? input.iterations : [];
  return {
    schemaVersion: 1,
    evidenceReady: false,
    observationReady: false,
    promotionReady: false,
    providerCount: 0,
    measuredIterationCount: iterations.length,
    mappingBlockerCount: 0,
    totalMissingMappingCount: 0,
    p95DurationMs: 0,
    maxDurationMs: 0,
    issues,
    mappingBlockers: [],
    aggregateOnly: true,
    productionMutationPerformed: false,
    rowsWritten: 0,
  };
}

export function evaluateIdentityEpisodeProductionObservation(
  input: IdentityEpisodeProductionObservationInput,
): IdentityEpisodeProductionObservationResult {
  if (containsNormalizedKey(input, SENSITIVE_EVIDENCE_KEYS)) {
    return emptyResult(input, [issue('CDB113G_SENSITIVE_EVIDENCE_REJECTED')]);
  }
  if (!exactKeys(input, RESULT_ROOT_KEYS)
    || typeof input.observedAtUtc !== 'string'
    || !Array.isArray(input.iterations)) {
    return emptyResult(input, [issue('CDB113G_INPUT_SCHEMA_INVALID')]);
  }

  const issues: IdentityEpisodeProductionObservationIssue[] = [];
  const authorization = input.authorization;
  const expectedIterations = authorization?.thresholds?.measuredIterations;
  if (expectedIterations !== 5 || input.iterations.length !== expectedIterations) {
    issues.push(issue('CDB113G_ITERATION_COUNT_INVALID'));
  }

  const observed = parseUtc(input.observedAtUtc);
  const start = parseUtc(authorization?.timing?.observationStartUtc ?? '');
  const end = parseUtc(authorization?.timing?.observationEndUtc ?? '');
  if (observed == null || start == null || end == null || observed < start || observed > end) {
    issues.push(issue('CDB113G_OBSERVATION_TIMING_INVALID'));
  }

  let providerRowsValid = true;
  for (const iteration of input.iterations) {
    if (!exactKeys(iteration, ITERATION_KEYS)
      || !positiveDuration(iteration.durationMs)
      || typeof iteration.changedDb !== 'boolean'
      || !nonNegativeInteger(iteration.rowsWritten)
      || !validateRows(iteration.rows)) {
      providerRowsValid = false;
      break;
    }
  }
  if (!providerRowsValid) issues.push(issue('CDB113G_PROVIDER_RESULT_INVALID'));

  const rowsWritten = input.iterations.reduce((total, iteration) => (
    total + (nonNegativeInteger(iteration?.rowsWritten) ? iteration.rowsWritten : 0)
  ), 0);
  if (input.iterations.some((iteration) => iteration?.changedDb === true || Number(iteration?.rowsWritten ?? 0) !== 0)) {
    issues.push(issue('CDB113G_READ_ONLY_BOUNDARY_VIOLATED'));
  }

  const normalizedIterations = providerRowsValid
    ? input.iterations.map((iteration) => normalizeRows(iteration.rows))
    : [];
  if (normalizedIterations.length > 1) {
    const baseline = JSON.stringify(normalizedIterations[0]);
    if (normalizedIterations.slice(1).some((rows) => JSON.stringify(rows) !== baseline)) {
      issues.push(issue('CDB113G_AGGREGATE_DRIFT'));
    }
  }

  const finalRows = normalizedIterations.at(-1) ?? [];
  const mappingBlockers = finalRows
    .filter((row) => row.missing_mapping_count > 0)
    .map((row) => ({ provider: row.provider, missingMappingCount: row.missing_mapping_count }));
  const totalMissingMappingCount = mappingBlockers.reduce((total, blocker) => (
    total + blocker.missingMappingCount
  ), 0);

  const domainChecks: Array<[
    keyof IdentityEpisodeObservationAggregateRow,
    IdentityEpisodeProductionObservationIssueCode,
  ]> = [
    ['duplicate_active_mapping_count', 'CDB113G_DUPLICATE_MAPPING'],
    ['invalid_canonical_target_count', 'CDB113G_INVALID_CANONICAL_TARGET'],
    ['cross_tenant_relationship_count', 'CDB113G_CROSS_TENANT_RELATIONSHIP'],
    ['unresolved_critical_issue_count', 'CDB113G_UNRESOLVED_CRITICAL_ISSUE'],
    ['enabled_flag_count', 'CDB113G_PROVIDER_FLAG_ENABLED'],
    ['canonical_mode_flag_count', 'CDB113G_CANONICAL_MODE_PRESENT'],
  ];
  for (const [field, code] of domainChecks) {
    if (finalRows.some((row) => Number(row[field]) > 0)) issues.push(issue(code));
  }

  const durations = input.iterations
    .map((iteration) => iteration.durationMs)
    .filter(positiveDuration);
  const p95DurationMs = nearestRankP95(durations);
  const maxDurationMs = durations.length === 0 ? 0 : Math.max(...durations);
  if (
    p95DurationMs > Number(authorization?.thresholds?.p95DurationMs ?? 0)
    || maxDurationMs > Number(authorization?.thresholds?.maxDurationMs ?? 0)
  ) {
    issues.push(issue('CDB113G_LATENCY_THRESHOLD_EXCEEDED'));
  }

  const structuralCodes = new Set<IdentityEpisodeProductionObservationIssueCode>([
    'CDB113G_SENSITIVE_EVIDENCE_REJECTED',
    'CDB113G_INPUT_SCHEMA_INVALID',
    'CDB113G_ITERATION_COUNT_INVALID',
    'CDB113G_OBSERVATION_TIMING_INVALID',
    'CDB113G_PROVIDER_RESULT_INVALID',
    'CDB113G_READ_ONLY_BOUNDARY_VIOLATED',
    'CDB113G_AGGREGATE_DRIFT',
  ]);
  const evidenceReady = !issues.some((entry) => structuralCodes.has(entry.code));
  const observationReady = evidenceReady && issues.length === 0;

  return {
    schemaVersion: 1,
    evidenceReady,
    observationReady,
    promotionReady: false,
    providerCount: finalRows.length,
    measuredIterationCount: input.iterations.length,
    mappingBlockerCount: mappingBlockers.length,
    totalMissingMappingCount,
    p95DurationMs,
    maxDurationMs,
    issues,
    mappingBlockers,
    aggregateOnly: true,
    productionMutationPerformed: false,
    rowsWritten,
  };
}

export const IDENTITY_EPISODE_PRODUCTION_OBSERVATION_SQL = `
WITH
patient_source AS (
  SELECT COUNT(*) AS source_count
  FROM patients
  WHERE CAST(tenant_id AS TEXT)='100'
),
patient_mapped AS (
  SELECT COUNT(DISTINCT legacy_patient_id) AS mapped_source_count
  FROM canonical_tenant_patient_links
  WHERE tenant_id='100' AND link_status NOT IN ('rejected','retired') AND effective_to_utc IS NULL
),
patient_duplicate AS (
  SELECT COUNT(*) AS duplicate_active_mapping_count FROM (
    SELECT legacy_patient_id
    FROM canonical_tenant_patient_links
    WHERE tenant_id='100' AND link_status NOT IN ('rejected','retired') AND effective_to_utc IS NULL
    GROUP BY legacy_patient_id HAVING COUNT(*) > 1
  )
),
practitioner_sources AS (
  SELECT 'legacy_doctor' AS source_type, CAST(id AS TEXT) AS source_public_id
  FROM doctors WHERE CAST(tenant_id AS TEXT)='100'
  UNION ALL
  SELECT 'legacy_external_referrer', CAST(id AS TEXT)
  FROM external_referring_doctors WHERE CAST(tenant_id AS TEXT)='100'
),
appointment_sources AS (
  SELECT 'legacy_appointment' AS source_type, CAST(id AS TEXT) AS source_public_id
  FROM appointments WHERE CAST(tenant_id AS TEXT)='100'
  UNION ALL
  SELECT 'legacy_consultation', CAST(id AS TEXT)
  FROM consultations WHERE CAST(tenant_id AS TEXT)='100'
),
encounter_sources AS (
  SELECT 'legacy_encounter' AS source_type, CAST(id AS TEXT) AS source_public_id
  FROM encounters WHERE CAST(tenant_id AS TEXT)='100'
  UNION ALL
  SELECT 'legacy_visit', CAST(id AS TEXT)
  FROM visits WHERE CAST(tenant_id AS TEXT)='100'
  UNION ALL
  SELECT 'legacy_consultation', CAST(id AS TEXT)
  FROM consultations WHERE CAST(tenant_id AS TEXT)='100'
),
admission_bed_sources AS (
  SELECT 'admission' AS entity_type, 'legacy_admission' AS source_type, CAST(id AS TEXT) AS source_public_id
  FROM admissions WHERE CAST(tenant_id AS TEXT)='100'
  UNION ALL
  SELECT 'bed', 'legacy_bed', CAST(id AS TEXT)
  FROM beds WHERE CAST(tenant_id AS TEXT)='100'
  UNION ALL
  SELECT 'bed_stay', 'legacy_patient_bed_info', CAST(id AS TEXT)
  FROM patient_bed_infos WHERE CAST(tenant_id AS TEXT)='100'
),
practitioner_mapping AS (
  SELECT s.source_type,s.source_public_id,m.canonical_public_id,m.mapping_status
  FROM practitioner_sources s
  LEFT JOIN canonical_source_mappings m
    ON m.tenant_id='100' AND m.entity_type='practitioner'
   AND m.source_type=s.source_type AND m.source_public_id=s.source_public_id
),
appointment_mapping AS (
  SELECT s.source_type,s.source_public_id,m.canonical_public_id,m.mapping_status
  FROM appointment_sources s
  LEFT JOIN canonical_source_mappings m
    ON m.tenant_id='100' AND m.entity_type='appointment'
   AND m.source_type=s.source_type AND m.source_public_id=s.source_public_id
),
encounter_mapping AS (
  SELECT s.source_type,s.source_public_id,m.canonical_public_id,m.mapping_status
  FROM encounter_sources s
  LEFT JOIN canonical_source_mappings m
    ON m.tenant_id='100' AND m.entity_type='encounter'
   AND m.source_type=s.source_type AND m.source_public_id=s.source_public_id
),
admission_bed_mapping AS (
  SELECT s.entity_type,s.source_type,s.source_public_id,m.canonical_public_id,m.mapping_status
  FROM admission_bed_sources s
  LEFT JOIN canonical_source_mappings m
    ON m.tenant_id='100' AND m.entity_type=s.entity_type
   AND m.source_type=s.source_type AND m.source_public_id=s.source_public_id
),
flag_state AS (
  SELECT flag_key,
    SUM(CASE WHEN is_enabled=1 THEN 1 ELSE 0 END) AS enabled_flag_count,
    SUM(CASE WHEN is_enabled=1 AND mode='canonical' THEN 1 ELSE 0 END) AS canonical_mode_flag_count
  FROM canonical_feature_flags
  WHERE tenant_id='100' AND flag_key IN (
    'canonical_patient_identity_provider_v1',
    'canonical_practitioner_provider_v1',
    'canonical_appointment_provider_v1',
    'canonical_encounter_provider_v1',
    'canonical_admission_bed_provider_v1'
  )
  GROUP BY flag_key
)
SELECT 'patient_identity' AS provider,
  (SELECT source_count FROM patient_source) AS source_count,
  (SELECT mapped_source_count FROM patient_mapped) AS mapped_source_count,
  (SELECT source_count FROM patient_source)-(SELECT mapped_source_count FROM patient_mapped) AS missing_mapping_count,
  (SELECT duplicate_active_mapping_count FROM patient_duplicate) AS duplicate_active_mapping_count,
  (SELECT COUNT(*) FROM canonical_tenant_patient_links l
    WHERE l.tenant_id='100' AND l.link_status IN ('verified','merged')
      AND NOT EXISTS (SELECT 1 FROM global_patient_identity g WHERE g.global_uhid=l.global_patient_uhid AND g.is_active=1)
  ) AS invalid_canonical_target_count,
  (SELECT COUNT(*) FROM canonical_tenant_patient_links l
    WHERE l.tenant_id='100'
      AND NOT EXISTS (SELECT 1 FROM patients p WHERE CAST(p.tenant_id AS TEXT)='100' AND p.id=l.legacy_patient_id)
      AND EXISTS (SELECT 1 FROM patients p WHERE CAST(p.tenant_id AS TEXT)!='100' AND p.id=l.legacy_patient_id)
  ) AS cross_tenant_relationship_count,
  (SELECT COUNT(*) FROM canonical_processing_issues
    WHERE tenant_id='100' AND entity_type IN ('patient','patient_link','tenant_patient_link')
      AND severity='critical' AND status IN ('open','acknowledged')
  ) AS unresolved_critical_issue_count,
  COALESCE((SELECT enabled_flag_count FROM flag_state WHERE flag_key='canonical_patient_identity_provider_v1'),0) AS enabled_flag_count,
  COALESCE((SELECT canonical_mode_flag_count FROM flag_state WHERE flag_key='canonical_patient_identity_provider_v1'),0) AS canonical_mode_flag_count
UNION ALL
SELECT 'practitioner' AS provider,
  (SELECT COUNT(*) FROM practitioner_mapping) AS source_count,
  (SELECT COUNT(*) FROM practitioner_mapping WHERE mapping_status='mapped') AS mapped_source_count,
  (SELECT COUNT(*) FROM practitioner_mapping WHERE mapping_status IS NULL OR mapping_status!='mapped') AS missing_mapping_count,
  (SELECT COUNT(*) FROM (SELECT source_type,source_public_id FROM practitioner_mapping WHERE mapping_status='mapped' GROUP BY source_type,source_public_id HAVING COUNT(*)>1)) AS duplicate_active_mapping_count,
  (SELECT COUNT(*) FROM practitioner_mapping m WHERE m.mapping_status='mapped'
    AND NOT EXISTS (SELECT 1 FROM canonical_practitioners c WHERE c.tenant_id='100' AND c.practitioner_public_id=m.canonical_public_id)
  ) AS invalid_canonical_target_count,
  (SELECT COUNT(*) FROM practitioner_mapping m WHERE m.mapping_status='mapped'
    AND NOT EXISTS (SELECT 1 FROM canonical_practitioners c WHERE c.tenant_id='100' AND c.practitioner_public_id=m.canonical_public_id)
    AND EXISTS (SELECT 1 FROM canonical_practitioners c WHERE c.tenant_id!='100' AND c.practitioner_public_id=m.canonical_public_id)
  ) AS cross_tenant_relationship_count,
  (SELECT COUNT(*) FROM canonical_processing_issues WHERE tenant_id='100' AND entity_type='practitioner' AND severity='critical' AND status IN ('open','acknowledged')) AS unresolved_critical_issue_count,
  COALESCE((SELECT enabled_flag_count FROM flag_state WHERE flag_key='canonical_practitioner_provider_v1'),0) AS enabled_flag_count,
  COALESCE((SELECT canonical_mode_flag_count FROM flag_state WHERE flag_key='canonical_practitioner_provider_v1'),0) AS canonical_mode_flag_count
UNION ALL
SELECT 'appointment' AS provider,
  (SELECT COUNT(*) FROM appointment_mapping) AS source_count,
  (SELECT COUNT(*) FROM appointment_mapping WHERE mapping_status='mapped') AS mapped_source_count,
  (SELECT COUNT(*) FROM appointment_mapping WHERE mapping_status IS NULL OR mapping_status!='mapped') AS missing_mapping_count,
  (SELECT COUNT(*) FROM (SELECT source_type,source_public_id FROM appointment_mapping WHERE mapping_status='mapped' GROUP BY source_type,source_public_id HAVING COUNT(*)>1)) AS duplicate_active_mapping_count,
  (SELECT COUNT(*) FROM appointment_mapping m WHERE m.mapping_status='mapped'
    AND NOT EXISTS (SELECT 1 FROM canonical_appointments c WHERE c.tenant_id='100' AND c.appointment_public_id=m.canonical_public_id)
  ) AS invalid_canonical_target_count,
  (SELECT COUNT(*) FROM appointment_mapping m WHERE m.mapping_status='mapped'
    AND NOT EXISTS (SELECT 1 FROM canonical_appointments c WHERE c.tenant_id='100' AND c.appointment_public_id=m.canonical_public_id)
    AND EXISTS (SELECT 1 FROM canonical_appointments c WHERE c.tenant_id!='100' AND c.appointment_public_id=m.canonical_public_id)
  ) AS cross_tenant_relationship_count,
  (SELECT COUNT(*) FROM canonical_processing_issues WHERE tenant_id='100' AND entity_type='appointment' AND severity='critical' AND status IN ('open','acknowledged')) AS unresolved_critical_issue_count,
  COALESCE((SELECT enabled_flag_count FROM flag_state WHERE flag_key='canonical_appointment_provider_v1'),0) AS enabled_flag_count,
  COALESCE((SELECT canonical_mode_flag_count FROM flag_state WHERE flag_key='canonical_appointment_provider_v1'),0) AS canonical_mode_flag_count
UNION ALL
SELECT 'encounter' AS provider,
  (SELECT COUNT(*) FROM encounter_mapping) AS source_count,
  (SELECT COUNT(*) FROM encounter_mapping WHERE mapping_status='mapped') AS mapped_source_count,
  (SELECT COUNT(*) FROM encounter_mapping WHERE mapping_status IS NULL OR mapping_status!='mapped') AS missing_mapping_count,
  (SELECT COUNT(*) FROM (SELECT source_type,source_public_id FROM encounter_mapping WHERE mapping_status='mapped' GROUP BY source_type,source_public_id HAVING COUNT(*)>1)) AS duplicate_active_mapping_count,
  (SELECT COUNT(*) FROM encounter_mapping m WHERE m.mapping_status='mapped'
    AND NOT EXISTS (SELECT 1 FROM canonical_encounters c WHERE c.tenant_id='100' AND c.encounter_public_id=m.canonical_public_id)
  ) AS invalid_canonical_target_count,
  (SELECT COUNT(*) FROM encounter_mapping m WHERE m.mapping_status='mapped'
    AND NOT EXISTS (SELECT 1 FROM canonical_encounters c WHERE c.tenant_id='100' AND c.encounter_public_id=m.canonical_public_id)
    AND EXISTS (SELECT 1 FROM canonical_encounters c WHERE c.tenant_id!='100' AND c.encounter_public_id=m.canonical_public_id)
  ) AS cross_tenant_relationship_count,
  (SELECT COUNT(*) FROM canonical_processing_issues WHERE tenant_id='100' AND entity_type='encounter' AND severity='critical' AND status IN ('open','acknowledged')) AS unresolved_critical_issue_count,
  COALESCE((SELECT enabled_flag_count FROM flag_state WHERE flag_key='canonical_encounter_provider_v1'),0) AS enabled_flag_count,
  COALESCE((SELECT canonical_mode_flag_count FROM flag_state WHERE flag_key='canonical_encounter_provider_v1'),0) AS canonical_mode_flag_count
UNION ALL
SELECT 'admission_bed' AS provider,
  (SELECT COUNT(*) FROM admission_bed_mapping) AS source_count,
  (SELECT COUNT(*) FROM admission_bed_mapping WHERE mapping_status='mapped') AS mapped_source_count,
  (SELECT COUNT(*) FROM admission_bed_mapping WHERE mapping_status IS NULL OR mapping_status!='mapped') AS missing_mapping_count,
  (SELECT COUNT(*) FROM (SELECT entity_type,source_type,source_public_id FROM admission_bed_mapping WHERE mapping_status='mapped' GROUP BY entity_type,source_type,source_public_id HAVING COUNT(*)>1)) AS duplicate_active_mapping_count,
  (SELECT COUNT(*) FROM admission_bed_mapping m WHERE m.mapping_status='mapped' AND (
    (m.entity_type='admission' AND NOT EXISTS (SELECT 1 FROM canonical_admissions c WHERE c.tenant_id='100' AND c.admission_public_id=m.canonical_public_id))
    OR (m.entity_type='bed' AND NOT EXISTS (SELECT 1 FROM canonical_beds c WHERE c.tenant_id='100' AND c.bed_public_id=m.canonical_public_id))
    OR (m.entity_type='bed_stay' AND NOT EXISTS (SELECT 1 FROM canonical_bed_stays c WHERE c.tenant_id='100' AND c.bed_stay_public_id=m.canonical_public_id))
  )) AS invalid_canonical_target_count,
  (SELECT COUNT(*) FROM admission_bed_mapping m WHERE m.mapping_status='mapped' AND (
    (m.entity_type='admission' AND NOT EXISTS (SELECT 1 FROM canonical_admissions c WHERE c.tenant_id='100' AND c.admission_public_id=m.canonical_public_id) AND EXISTS (SELECT 1 FROM canonical_admissions c WHERE c.tenant_id!='100' AND c.admission_public_id=m.canonical_public_id))
    OR (m.entity_type='bed' AND NOT EXISTS (SELECT 1 FROM canonical_beds c WHERE c.tenant_id='100' AND c.bed_public_id=m.canonical_public_id) AND EXISTS (SELECT 1 FROM canonical_beds c WHERE c.tenant_id!='100' AND c.bed_public_id=m.canonical_public_id))
    OR (m.entity_type='bed_stay' AND NOT EXISTS (SELECT 1 FROM canonical_bed_stays c WHERE c.tenant_id='100' AND c.bed_stay_public_id=m.canonical_public_id) AND EXISTS (SELECT 1 FROM canonical_bed_stays c WHERE c.tenant_id!='100' AND c.bed_stay_public_id=m.canonical_public_id))
  )) AS cross_tenant_relationship_count,
  (SELECT COUNT(*) FROM canonical_processing_issues WHERE tenant_id='100' AND entity_type IN ('admission','bed','bed_stay') AND severity='critical' AND status IN ('open','acknowledged')) AS unresolved_critical_issue_count,
  COALESCE((SELECT enabled_flag_count FROM flag_state WHERE flag_key='canonical_admission_bed_provider_v1'),0) AS enabled_flag_count,
  COALESCE((SELECT canonical_mode_flag_count FROM flag_state WHERE flag_key='canonical_admission_bed_provider_v1'),0) AS canonical_mode_flag_count
`;
