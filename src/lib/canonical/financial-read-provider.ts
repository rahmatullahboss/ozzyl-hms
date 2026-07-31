import { createHash } from 'node:crypto';

export type FinancialReadProviderMode = 'legacy' | 'shadow' | 'canonical';

export interface FinancialReadPreparedStatement {
  bind(...values: unknown[]): FinancialReadPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface FinancialReadDatabase {
  prepare(sql: string): FinancialReadPreparedStatement;
}

export type FinancialReadVarianceClass =
  | 'MAPPING_MISSING'
  | 'MAPPING_AMBIGUOUS'
  | 'ROW_KEY_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'SETTLEMENT_STATUS_MISMATCH'
  | 'ROW_COUNT_MISMATCH'
  | 'TOTAL_MINOR_MISMATCH'
  | 'PAID_MINOR_MISMATCH'
  | 'DUE_MINOR_MISMATCH'
  | 'ALLOCATED_MINOR_MISMATCH'
  | 'UNALLOCATED_MINOR_MISMATCH'
  | 'APPLIED_MINOR_MISMATCH'
  | 'REFUNDED_MINOR_MISMATCH'
  | 'AVAILABLE_MINOR_MISMATCH'
  | 'EARNED_MINOR_MISMATCH'
  | 'ADJUSTED_MINOR_MISMATCH'
  | 'SETTLED_MINOR_MISMATCH'
  | 'PAYABLE_MINOR_MISMATCH'
  | 'LATENCY_BUDGET_EXCEEDED';

export interface FinancialReadComparison {
  varianceClass: FinancialReadVarianceClass;
  matches: boolean;
  expected: string | number | null;
  actual: string | number | null;
}

export interface FinancialReadShadowEvidence {
  version: 1;
  checkpoint: 'CDB-V1-040';
  runPublicId: string;
  providerKey: string;
  consumerId: string;
  sourceRowKey: string;
  canonicalRowKey: string | null;
  parity: boolean;
  varianceClasses: FinancialReadVarianceClass[];
  varianceIds: string[];
  elapsedMs: number;
  latencyBudgetMs: number;
  observedAtUtc: string;
  rollbackMode: 'legacy';
  criticalUnexplainedVarianceCount: number;
}

interface FeatureFlagRow {
  mode: string;
  is_enabled: number | string;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  mapping_version: number | string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function exactFinancialReadValue(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} cannot be empty`);
  if (value !== value.trim()) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

export function financialReadNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function financialReadUtcTimestamp(value: string, label: string): string {
  const exactValue = exactFinancialReadValue(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(exactValue)
    || Number.isNaN(Date.parse(exactValue))) {
    throw new TypeError(`${label} must be a valid UTC timestamp`);
  }
  return exactValue;
}

export function decimalToMinorUnits(value: unknown, label: string): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) throw new RangeError(`${label} must be finite`);
  const minor = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(minor)) throw new RangeError(`${label} exceeds safe minor-unit range`);
  return minor;
}

export async function resolveFinancialReadProviderMode(
  db: FinancialReadDatabase,
  tenantId: string,
  providerKey: string,
): Promise<FinancialReadProviderMode> {
  const tenant = exactFinancialReadValue(tenantId, 'tenantId');
  const key = exactFinancialReadValue(providerKey, 'providerKey');
  try {
    const row = await db.prepare(`
      SELECT mode,is_enabled
      FROM canonical_feature_flags
      WHERE tenant_id=? AND flag_key=?
      LIMIT 1
    `).bind(tenant, key).first<FeatureFlagRow>();
    if (!row || Number(row.is_enabled) !== 1) return 'legacy';
    if (row.mode === 'shadow') return 'shadow';
    if (row.mode === 'canonical') return 'canonical';
    return 'legacy';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*canonical_feature_flags/i.test(message)) return 'legacy';
    throw error;
  }
}

export async function resolveExactFinancialSourceMapping(
  db: FinancialReadDatabase,
  input: {
    tenantId: string;
    entityType: string;
    sourceType: string;
    sourcePublicId: string;
  },
): Promise<string | null> {
  const tenantId = exactFinancialReadValue(input.tenantId, 'tenantId');
  const entityType = exactFinancialReadValue(input.entityType, 'entityType');
  const sourceType = exactFinancialReadValue(input.sourceType, 'sourceType');
  const sourcePublicId = exactFinancialReadValue(input.sourcePublicId, 'sourcePublicId');
  const rows = (await db.prepare(`
    SELECT canonical_public_id,mapping_status,mapping_version
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    ORDER BY mapping_version DESC
    LIMIT 2
  `).bind(tenantId, entityType, sourceType, sourcePublicId).all<MappingRow>()).results;
  const mapped = rows.filter((row) => row.mapping_status === 'mapped' && row.canonical_public_id != null);
  if (mapped.length === 0) return null;
  if (mapped.length !== 1 || rows.length !== 1) {
    throw new Error(`ambiguous Canonical source mapping for ${entityType}:${sourcePublicId}`);
  }
  return exactFinancialReadValue(String(mapped[0].canonical_public_id), 'canonicalPublicId');
}

export async function persistFinancialReadShadowEvidence(
  db: FinancialReadDatabase,
  input: {
    tenantId: string;
    providerKey: string;
    domain: string;
    consumerId: string;
    sourceRowKey: string;
    canonicalRowKey: string | null;
    sourcePublicId: string;
    legacyStatus: string;
    canonicalStatus: string | null;
    legacyTotalMinor: number;
    canonicalTotalMinor: number | null;
    expectedMinor: number;
    actualMinor: number | null;
    currencyCode: string;
    comparisons: readonly FinancialReadComparison[];
    elapsedMs: number;
    latencyBudgetMs: number;
    observedAtUtc: string;
    buildSha: string;
    metadata: Record<string, string | number | boolean | null>;
  },
): Promise<FinancialReadShadowEvidence> {
  const tenantId = exactFinancialReadValue(input.tenantId, 'tenantId');
  const providerKey = exactFinancialReadValue(input.providerKey, 'providerKey');
  const domain = exactFinancialReadValue(input.domain, 'domain');
  const consumerId = exactFinancialReadValue(input.consumerId, 'consumerId');
  const sourceRowKey = exactFinancialReadValue(input.sourceRowKey, 'sourceRowKey');
  const sourcePublicId = exactFinancialReadValue(input.sourcePublicId, 'sourcePublicId');
  const legacyStatus = exactFinancialReadValue(input.legacyStatus, 'legacyStatus');
  const currencyCode = exactFinancialReadValue(input.currencyCode, 'currencyCode');
  const buildSha = exactFinancialReadValue(input.buildSha, 'buildSha');
  const observedAtUtc = financialReadUtcTimestamp(input.observedAtUtc, 'observedAtUtc');
  const elapsedMs = financialReadNonNegativeInteger(input.elapsedMs, 'elapsedMs');
  const latencyBudgetMs = financialReadNonNegativeInteger(input.latencyBudgetMs, 'latencyBudgetMs');
  if (latencyBudgetMs <= 0) throw new RangeError('latencyBudgetMs must be positive');

  const failed = input.comparisons.filter((comparison) => !comparison.matches);
  if (elapsedMs > latencyBudgetMs) {
    failed.push({
      varianceClass: 'LATENCY_BUDGET_EXCEEDED',
      matches: false,
      expected: latencyBudgetMs,
      actual: elapsedMs,
    });
  }
  const varianceIds = failed.map((comparison) => sha256(JSON.stringify([
    'CDB-V1-040', providerKey, tenantId, consumerId, sourcePublicId,
    comparison.varianceClass, comparison.expected, comparison.actual,
  ])));
  const runPublicId = `recon_${sha256(JSON.stringify([
    'CDB-V1-040', providerKey, tenantId, consumerId, sourcePublicId, observedAtUtc,
  ])).slice(0, 32)}`;
  const summary = {
    checkpoint: 'CDB-V1-040',
    providerKey,
    consumerId,
    sourceRowKey,
    canonicalRowKey: input.canonicalRowKey,
    legacyStatus,
    canonicalStatus: input.canonicalStatus,
    legacyTotalMinor: input.legacyTotalMinor,
    canonicalTotalMinor: input.canonicalTotalMinor,
    varianceClasses: failed.map((comparison) => comparison.varianceClass),
    varianceIds,
    elapsedMs,
    latencyBudgetMs,
    observedAtUtc,
    buildSha,
    rollbackMode: 'legacy',
    ...input.metadata,
  };
  const summaryJson = JSON.stringify(summary);
  const evidenceSha256 = sha256(summaryJson);
  const expectedMinor = financialReadNonNegativeInteger(input.expectedMinor, 'expectedMinor');
  const actualMinor = input.actualMinor == null
    ? null
    : financialReadNonNegativeInteger(input.actualMinor, 'actualMinor');
  const actualForStorage = actualMinor ?? 0;
  const varianceMinor = actualForStorage - expectedMinor;
  const parity = failed.length === 0;

  await db.prepare(`
    INSERT INTO canonical_reconciliation_runs (
      tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
      scanned_count,matched_count,mismatch_count,exception_count,
      expected_total_minor,actual_total_minor,variance_minor,currency_code,
      evidence_sha256,result_summary_json,started_at_utc,completed_at_utc,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,NULL,?,'shadow',?,1,?,?,0,?,?,?,?,?,?,?, ?,?,?)
    ON CONFLICT(tenant_id,run_public_id) DO UPDATE SET
      status=excluded.status,
      matched_count=excluded.matched_count,
      mismatch_count=excluded.mismatch_count,
      expected_total_minor=excluded.expected_total_minor,
      actual_total_minor=excluded.actual_total_minor,
      variance_minor=excluded.variance_minor,
      currency_code=excluded.currency_code,
      evidence_sha256=excluded.evidence_sha256,
      result_summary_json=excluded.result_summary_json,
      completed_at_utc=excluded.completed_at_utc,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    tenantId,
    runPublicId,
    domain,
    parity ? 'passed' : 'failed',
    parity ? 1 : 0,
    parity ? 0 : 1,
    expectedMinor,
    actualForStorage,
    varianceMinor,
    currencyCode,
    evidenceSha256,
    summaryJson,
    observedAtUtc,
    observedAtUtc,
    observedAtUtc,
    observedAtUtc,
  ).run();

  return {
    version: 1,
    checkpoint: 'CDB-V1-040',
    runPublicId,
    providerKey,
    consumerId,
    sourceRowKey,
    canonicalRowKey: input.canonicalRowKey,
    parity,
    varianceClasses: failed.map((comparison) => comparison.varianceClass),
    varianceIds,
    elapsedMs,
    latencyBudgetMs,
    observedAtUtc,
    rollbackMode: 'legacy',
    criticalUnexplainedVarianceCount: failed.length,
  };
}
