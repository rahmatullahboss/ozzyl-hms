import type { D1Database } from '@cloudflare/workers-types';
import type {
  ReceivableAuthorityMode,
  ReceivableAuthorityResolution,
} from './types';

const FEATURE_FLAG_KEY = 'billing.receivables';

const SHADOW_REQUIRED_COLUMNS = [
  'tenant_id',
  'invoice_public_id',
  'invoice_number',
  'legacy_patient_id',
  'currency_code',
  'total_minor',
  'status',
  'issued_at_utc',
  'paid_minor',
  'due_minor',
] as const;

const CANONICAL_ONLY_REQUIRED_COLUMNS = [
  'credited_minor',
  'net_due_minor',
] as const;

const CANONICAL_RECEIVABLE_ADJUSTMENT_REQUIRED_SCHEMA = {
  canonical_invoices: ['updated_at_utc'],
  billing_mutation_idempotency_keys: [
    'tenant_id',
    'mutation_type',
    'idempotency_key',
    'request_hash',
    'status',
    'source_id',
    'response_json',
    'created_by',
    'updated_at',
  ],
  canonical_source_mappings: [
    'id',
    'tenant_id',
    'entity_type',
    'canonical_public_id',
    'source_type',
    'source_public_id',
    'source_table',
    'mapping_status',
    'mapping_version',
    'evidence_sha256',
  ],
  canonical_outbox_events: [
    'tenant_id',
    'event_public_id',
    'aggregate_type',
    'aggregate_public_id',
    'event_type',
    'event_version',
    'payload_json',
    'occurred_at_utc',
    'business_date',
    'idempotency_key',
    'status',
  ],
  canonical_credit_notes: [
    'tenant_id',
    'credit_note_public_id',
    'credit_note_number',
    'invoice_public_id',
    'legacy_patient_id',
    'currency_code',
    'reason_code',
    'total_minor',
    'invoice_credited_before_minor',
    'invoice_credited_after_minor',
    'invoice_net_due_before_minor',
    'invoice_net_due_after_minor',
    'status',
    'issued_at_utc',
    'business_date',
    'posted_at_utc',
    'reconciliation_guard',
    'source_evidence_sha256',
  ],
  canonical_credit_note_lines: [
    'tenant_id',
    'credit_line_public_id',
    'credit_note_public_id',
    'invoice_public_id',
    'invoice_line_public_id',
    'amount_minor',
    'reason_code',
    'source_evidence_sha256',
  ],
  canonical_compensation_accruals: [
    'tenant_id',
    'invoice_public_id',
    'settled_minor',
  ],
  fiscal_years: [
    'id',
    'tenant_id',
    'start_date',
    'end_date',
    'is_active',
    'is_closed',
  ],
  accounting_period_closes: [
    'tenant_id',
    'fiscal_year_id',
    'period_name',
    'status',
  ],
} as const;

interface FeatureFlagRow {
  mode: string;
  isEnabled: number;
}

interface NameRow {
  name: string;
}

export class ReceivableAuthorityConfigurationError extends Error {
  readonly requestedMode: string;
  readonly missingRequirements: string[];

  constructor(requestedMode: string, missingRequirements: string[]) {
    super(
      `Receivable authority ${requestedMode} is not available: ${missingRequirements.join(', ')}`,
    );
    this.name = 'ReceivableAuthorityConfigurationError';
    this.requestedMode = requestedMode;
    this.missingRequirements = missingRequirements;
  }
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).bind(tableName).first<NameRow>();

  return row !== null;
}

async function tableColumns(db: D1Database, tableName: string): Promise<Set<string>> {
  if (!await tableExists(db, tableName)) return new Set();

  const result = await db.prepare(`PRAGMA table_info('${tableName}')`).all<NameRow>();
  return new Set((result.results ?? []).map((row) => row.name));
}

function missingColumns(columns: Set<string>, required: readonly string[]): string[] {
  return required
    .filter((column) => !columns.has(column))
    .map((column) => `canonical_invoices.${column}`);
}

async function missingSchema(
  db: D1Database,
  required: Record<string, readonly string[]>,
): Promise<string[]> {
  const checks = await Promise.all(Object.entries(required).map(async ([tableName, requiredColumns]) => {
    if (!await tableExists(db, tableName)) return [tableName];
    const columns = await tableColumns(db, tableName);
    return requiredColumns
      .filter((column) => !columns.has(column))
      .map((column) => `${tableName}.${column}`);
  }));
  return checks.flat();
}

function isAuthorityMode(value: string): value is ReceivableAuthorityMode {
  return value === 'legacy' || value === 'shadow' || value === 'canonical';
}

export async function resolveReceivableAuthority(input: {
  db: D1Database;
  tenantId: string;
}): Promise<ReceivableAuthorityResolution> {
  const canonicalColumns = await tableColumns(input.db, 'canonical_invoices');
  const shadowMissing = missingColumns(canonicalColumns, SHADOW_REQUIRED_COLUMNS);
  const canonicalSchemaAvailable = shadowMissing.length === 0;

  if (!await tableExists(input.db, 'canonical_feature_flags')) {
    return {
      mode: 'legacy',
      requestedMode: null,
      canonicalSchemaAvailable,
    };
  }

  const flag = await input.db.prepare(`
    SELECT mode, is_enabled AS isEnabled
    FROM canonical_feature_flags
    WHERE tenant_id = ? AND flag_key = ?
    LIMIT 1
  `).bind(input.tenantId, FEATURE_FLAG_KEY).first<FeatureFlagRow>();

  if (!flag || Number(flag.isEnabled) !== 1 || flag.mode === 'disabled') {
    return {
      mode: 'legacy',
      requestedMode: null,
      canonicalSchemaAvailable,
    };
  }

  if (!isAuthorityMode(flag.mode)) {
    throw new ReceivableAuthorityConfigurationError(flag.mode, [
      `canonical_feature_flags.mode:${flag.mode}`,
    ]);
  }

  if (flag.mode === 'legacy') {
    return {
      mode: 'legacy',
      requestedMode: 'legacy',
      canonicalSchemaAvailable,
    };
  }

  const requiredMissing = flag.mode === 'canonical'
    ? [
        ...shadowMissing,
        ...missingColumns(canonicalColumns, CANONICAL_ONLY_REQUIRED_COLUMNS),
      ]
    : shadowMissing;

  if (requiredMissing.length > 0) {
    throw new ReceivableAuthorityConfigurationError(flag.mode, requiredMissing);
  }

  return {
    mode: flag.mode,
    requestedMode: flag.mode,
    canonicalSchemaAvailable: true,
  };
}

export async function getReceivableAdjustmentReadiness(input: {
  db: D1Database;
  authorityMode: ReceivableAuthorityMode;
}): Promise<{ ready: boolean; missingRequirements: string[] }> {
  const missingRequirements = input.authorityMode === 'canonical'
    ? await missingSchema(input.db, CANONICAL_RECEIVABLE_ADJUSTMENT_REQUIRED_SCHEMA)
    : [];
  return {
    ready: missingRequirements.length === 0,
    missingRequirements,
  };
}

export async function assertReceivableAdjustmentAuthorityReady(input: {
  db: D1Database;
  authorityMode: ReceivableAuthorityMode;
}): Promise<void> {
  const readiness = await getReceivableAdjustmentReadiness(input);
  if (!readiness.ready) {
    throw new ReceivableAuthorityConfigurationError(
      input.authorityMode,
      readiness.missingRequirements,
    );
  }
}
