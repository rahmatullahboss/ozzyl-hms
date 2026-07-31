import { createHash } from 'node:crypto';

export type IdentityEpisodeShadowProvider =
  | 'patient_identity'
  | 'practitioner'
  | 'appointment'
  | 'encounter'
  | 'admission_bed';

export type IdentityEpisodeShadowMode = 'legacy' | 'shadow' | 'canonical';

export type IdentityEpisodeVarianceClass =
  | 'MAPPING_MISSING'
  | 'MAPPING_AMBIGUOUS'
  | 'CROSS_TENANT_REFERENCE'
  | 'PATIENT_LINK_MISMATCH'
  | 'PRACTITIONER_LINK_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'INTERVAL_MISMATCH'
  | 'PARTICIPANT_MISMATCH'
  | 'LOCATION_MISMATCH'
  | 'BED_OCCUPANCY_MISMATCH'
  | 'LIFECYCLE_MISMATCH'
  | 'INTENT_ACTUAL_CARE_COLLAPSE'
  | 'PROVIDER_ERROR'
  | 'LATENCY_BUDGET_EXCEEDED';

export interface IdentityEpisodeShadowComparison {
  varianceClass: IdentityEpisodeVarianceClass;
  matches: boolean;
  critical: boolean;
  evidenceHash?: string;
  acceptedExceptionId?: string;
}

export interface IdentityEpisodeShadowEvidenceInput {
  provider: IdentityEpisodeShadowProvider;
  consumerId: string;
  tenantId: string;
  sourceType: string;
  sourcePublicId: string;
  mode: IdentityEpisodeShadowMode;
  comparisons: IdentityEpisodeShadowComparison[];
  elapsedMs: number;
  errorCount: number;
  latencyBudgetMs: number;
  observedAtUtc: string;
  acceptedExceptionIds: string[];
  metadata?: Record<string, unknown>;
}

export interface IdentityEpisodeShadowEvidenceReceipt {
  version: 1;
  checkpoint: 'CDB-113F';
  provider: IdentityEpisodeShadowProvider;
  consumerId: string;
  stableConsumerKeyHash: string;
  mode: IdentityEpisodeShadowMode;
  comparisonCount: number;
  parity: boolean;
  varianceClasses: IdentityEpisodeVarianceClass[];
  varianceIds: string[];
  acceptedExceptionIds: string[];
  elapsedMs: number;
  errorCount: number;
  observedAtUtc: string;
  rollbackMode: 'legacy';
  criticalUnexplainedVarianceCount: number;
}

const REVIEWED_VARIANCE_CLASSES = new Set<IdentityEpisodeVarianceClass>([
  'MAPPING_MISSING',
  'MAPPING_AMBIGUOUS',
  'CROSS_TENANT_REFERENCE',
  'PATIENT_LINK_MISMATCH',
  'PRACTITIONER_LINK_MISMATCH',
  'STATUS_MISMATCH',
  'INTERVAL_MISMATCH',
  'PARTICIPANT_MISMATCH',
  'LOCATION_MISMATCH',
  'BED_OCCUPANCY_MISMATCH',
  'LIFECYCLE_MISMATCH',
  'INTENT_ACTUAL_CARE_COLLAPSE',
  'PROVIDER_ERROR',
  'LATENCY_BUDGET_EXCEEDED',
]);

const FORBIDDEN_KEY_PATTERN = /(?:^|_)(?:name|father|guardian|mobile|phone|email|address|care|diagnosis|clinical|narrative|prescription|result|note|notes|label|invoice|payment|deposit|amount|money|password|secret|credential|token|payload)(?:$|_)/i;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function exact(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} cannot be empty`);
  if (value !== value.trim()) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function utcTimestamp(value: string, label: string): string {
  const exactValue = exact(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(exactValue)
    || Number.isNaN(Date.parse(exactValue))) {
    throw new TypeError(`${label} must be a valid UTC timestamp`);
  }
  return exactValue;
}

function normalizedKey(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
}

function assertAggregateOnly(value: unknown, path = 'metadata'): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertAggregateOnly(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizedKey(key);
    if (FORBIDDEN_KEY_PATTERN.test(normalized)) {
      throw new TypeError(`forbidden shadow evidence key: ${path}.${key}`);
    }
    assertAggregateOnly(child, `${path}.${key}`);
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function evidenceHash(value: string | undefined): string {
  if (value == null) return sha256('no-reviewed-evidence-hash');
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new TypeError('comparison evidenceHash must be SHA-256');
  return value.toLowerCase();
}

export function createIdentityEpisodeShadowEvidence(
  input: IdentityEpisodeShadowEvidenceInput,
): IdentityEpisodeShadowEvidenceReceipt {
  const provider = exact(input.provider, 'provider') as IdentityEpisodeShadowProvider;
  const consumerId = exact(input.consumerId, 'consumerId');
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourceType = exact(input.sourceType, 'sourceType');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const observedAtUtc = utcTimestamp(input.observedAtUtc, 'observedAtUtc');
  const elapsedMs = nonNegativeInteger(input.elapsedMs, 'elapsedMs');
  const errorCount = nonNegativeInteger(input.errorCount, 'errorCount');
  const latencyBudgetMs = positiveInteger(input.latencyBudgetMs, 'latencyBudgetMs');
  if (!Array.isArray(input.comparisons)) throw new TypeError('comparisons must be an array');
  if (!Array.isArray(input.acceptedExceptionIds)) throw new TypeError('acceptedExceptionIds must be an array');
  assertAggregateOnly(input.metadata);

  const acceptedExceptionIds = uniqueSorted(input.acceptedExceptionIds.map((value) => exact(value, 'acceptedExceptionId')));
  const accepted = new Set(acceptedExceptionIds);
  const stableConsumerKeyHash = sha256(JSON.stringify([
    'CDB-113F', provider, consumerId, tenantId, sourceType, sourcePublicId,
  ]));

  const variances: Array<{
    varianceClass: IdentityEpisodeVarianceClass;
    varianceId: string;
    critical: boolean;
    accepted: boolean;
  }> = [];

  for (const comparison of input.comparisons) {
    if (!REVIEWED_VARIANCE_CLASSES.has(comparison.varianceClass)) {
      throw new RangeError(`comparison requires a reviewed variance class: ${String(comparison.varianceClass)}`);
    }
    if (comparison.matches) continue;
    const acceptedExceptionId = comparison.acceptedExceptionId == null
      ? null
      : exact(comparison.acceptedExceptionId, 'acceptedExceptionId');
    if (acceptedExceptionId != null && !accepted.has(acceptedExceptionId)) {
      throw new Error(`comparison accepted exception is not governed: ${acceptedExceptionId}`);
    }
    const reviewedEvidenceHash = evidenceHash(comparison.evidenceHash);
    variances.push({
      varianceClass: comparison.varianceClass,
      varianceId: sha256(JSON.stringify([
        'CDB-113F', stableConsumerKeyHash, comparison.varianceClass, reviewedEvidenceHash,
      ])),
      critical: comparison.critical,
      accepted: acceptedExceptionId != null,
    });
  }

  if (elapsedMs > latencyBudgetMs) {
    variances.push({
      varianceClass: 'LATENCY_BUDGET_EXCEEDED',
      varianceId: sha256(JSON.stringify([
        'CDB-113F', stableConsumerKeyHash, 'LATENCY_BUDGET_EXCEEDED', elapsedMs, latencyBudgetMs,
      ])),
      critical: true,
      accepted: false,
    });
  }
  if (errorCount > 0) {
    variances.push({
      varianceClass: 'PROVIDER_ERROR',
      varianceId: sha256(JSON.stringify([
        'CDB-113F', stableConsumerKeyHash, 'PROVIDER_ERROR', errorCount,
      ])),
      critical: true,
      accepted: false,
    });
  }

  return {
    version: 1,
    checkpoint: 'CDB-113F',
    provider,
    consumerId,
    stableConsumerKeyHash,
    mode: input.mode,
    comparisonCount: input.comparisons.length,
    parity: variances.length === 0,
    varianceClasses: variances.map((variance) => variance.varianceClass),
    varianceIds: variances.map((variance) => variance.varianceId),
    acceptedExceptionIds,
    elapsedMs,
    errorCount,
    observedAtUtc,
    rollbackMode: 'legacy',
    criticalUnexplainedVarianceCount: variances.filter((variance) => variance.critical && !variance.accepted).length,
  };
}
