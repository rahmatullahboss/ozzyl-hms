import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';
import {
  evaluateTenantFinancialReconciliation,
  type TenantFinancialAggregate,
  type TenantFinancialReconciliationReceipt,
  type TenantFinancialReconciliationSnapshot,
} from './tenant-financial-reconciliation';

export interface TenantFinancialAggregateRow extends Record<string, unknown> {
  legacy_invoice_count: unknown;
  legacy_invoice_gross_minor: unknown;
  legacy_invoice_discount_minor: unknown;
  legacy_invoice_net_minor: unknown;
  legacy_invoice_paid_minor: unknown;
  legacy_invoice_due_minor: unknown;
  legacy_receipt_count: unknown;
  legacy_receipt_total_minor: unknown;
  legacy_allocation_total_minor: unknown;
  legacy_deposit_received_minor: unknown;
  legacy_deposit_applied_minor: unknown;
  legacy_deposit_refunded_minor: unknown;
  legacy_credit_note_minor: unknown;
  legacy_refund_minor: unknown;
  legacy_reversal_minor: unknown;
  canonical_invoice_count: unknown;
  canonical_invoice_gross_minor: unknown;
  canonical_invoice_discount_minor: unknown;
  canonical_invoice_net_minor: unknown;
  canonical_invoice_paid_minor: unknown;
  canonical_invoice_due_minor: unknown;
  canonical_receipt_count: unknown;
  canonical_receipt_total_minor: unknown;
  canonical_allocation_total_minor: unknown;
  canonical_deposit_received_minor: unknown;
  canonical_deposit_applied_minor: unknown;
  canonical_deposit_refunded_minor: unknown;
  canonical_credit_note_minor: unknown;
  canonical_refund_minor: unknown;
  canonical_reversal_minor: unknown;
  source_mapping_duplicates: unknown;
  cross_tenant_rows: unknown;
  unresolved_critical_issues: unknown;
  blocked_outbox: unknown;
  blocked_accounting: unknown;
}

export interface TenantFinancialCollectionCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type TenantFinancialCollectionRunner = (
  args: string[],
) => TenantFinancialCollectionCommandResult;

export interface CollectTenantFinancialReconciliationOptions {
  outputPath: string;
  tenantId?: string;
  cutoffUtc?: string;
  secondPassNewRows: number;
  repositoryRoot?: string;
  runner?: TenantFinancialCollectionRunner;
}

export interface TenantFinancialReconciliationCollectionReceipt {
  schemaVersion: 1;
  evidenceReady: boolean;
  activationReady: boolean;
  tenantId: string;
  issueCount: number;
  aggregateOnly: true;
  networkRequestPerformed: true;
  productionMutationPerformed: false;
  rowsWritten: 0;
}

const TENANT_100_FINANCIAL_RECONCILIATION_SQL = `
WITH
legacy_payment_by_bill AS (
  SELECT bill_id,
    COUNT(*) AS payment_count,
    COALESCE(ROUND(SUM(COALESCE(amount,0)) * 100),0) AS payment_minor
  FROM payments
  WHERE CAST(tenant_id AS TEXT)='100'
  GROUP BY bill_id
),
legacy_deposit_application_by_bill AS (
  SELECT reference_bill_id AS bill_id,
    COUNT(*) AS adjustment_count,
    COALESCE(ROUND(SUM(COALESCE(amount,0)) * 100),0) AS deposit_applied_minor
  FROM billing_deposits
  WHERE CAST(tenant_id AS TEXT)='100'
    AND transaction_type='adjustment'
    AND COALESCE(is_active,1)=1
    AND reference_bill_id IS NOT NULL
  GROUP BY reference_bill_id
),
legacy_invoice_item_by_bill AS (
  SELECT bill_id,
    COUNT(*) AS line_count,
    COALESCE(ROUND(SUM(COALESCE(quantity,0) * COALESCE(unit_price,0)) * 100),0) AS line_gross_minor,
    COALESCE(ROUND(SUM(
      (COALESCE(quantity,0) * COALESCE(unit_price,0)) - COALESCE(line_total,0)
    ) * 100),0) AS line_discount_minor,
    COALESCE(ROUND(SUM(COALESCE(tax_amount,0)) * 100),0) AS line_tax_minor
  FROM invoice_items
  WHERE CAST(tenant_id AS TEXT)='100'
    AND cancelled_at IS NULL
    AND lower(COALESCE(status,'')) <> 'cancelled'
  GROUP BY bill_id
),
legacy_bill_facts AS (
  SELECT
    b.id,
    CASE WHEN COALESCE(i.line_count,0)>0
      THEN i.line_gross_minor
      ELSE COALESCE(ROUND((COALESCE(b.total,0) + COALESCE(b.discount,0) - COALESCE(b.tax_total,0)) * 100),0)
    END AS gross_minor,
    CASE WHEN COALESCE(i.line_count,0)>0
      THEN MAX(COALESCE(ROUND(COALESCE(b.discount,0) * 100),0), i.line_discount_minor)
      ELSE COALESCE(ROUND(COALESCE(b.discount,0) * 100),0)
    END AS discount_minor,
    COALESCE(ROUND(COALESCE(b.total,0) * 100),0) AS net_minor,
    COALESCE(ROUND((COALESCE(b.total,0) - COALESCE(b.due,0)) * 100),0) AS header_paid_minor,
    COALESCE(p.payment_minor,0) + COALESCE(d.deposit_applied_minor,0) AS verified_paid_minor,
    COALESCE(p.payment_minor,0) AS explicit_payment_minor,
    COALESCE(d.deposit_applied_minor,0) AS deposit_applied_minor
  FROM bills b
  LEFT JOIN legacy_payment_by_bill p ON p.bill_id=b.id
  LEFT JOIN legacy_deposit_application_by_bill d ON d.bill_id=b.id
  LEFT JOIN legacy_invoice_item_by_bill i ON i.bill_id=b.id
  WHERE CAST(b.tenant_id AS TEXT)='100'
),
legacy_bill_authority AS (
  SELECT
    id,gross_minor,discount_minor,net_minor,explicit_payment_minor,deposit_applied_minor,
    MIN(net_minor, MAX(header_paid_minor, verified_paid_minor)) AS paid_minor,
    net_minor - MIN(net_minor, MAX(header_paid_minor, verified_paid_minor)) AS due_minor,
    MAX(
      0,
      MIN(net_minor, MAX(header_paid_minor, verified_paid_minor))
        - explicit_payment_minor
        - deposit_applied_minor
    ) AS residual_minor,
    CASE WHEN
      MAX(
        0,
        MIN(net_minor, MAX(header_paid_minor, verified_paid_minor))
          - explicit_payment_minor
          - deposit_applied_minor
      ) > 0
    THEN 1 ELSE 0 END AS residual_receipt_count
  FROM legacy_bill_facts
),
legacy_invoice AS (
  SELECT
    COUNT(*) AS invoice_count,
    COALESCE(SUM(gross_minor),0) AS gross_minor,
    COALESCE(SUM(discount_minor),0) AS discount_minor,
    COALESCE(SUM(net_minor),0) AS net_minor,
    COALESCE(SUM(paid_minor),0) AS paid_minor,
    COALESCE(SUM(due_minor),0) AS due_minor,
    COALESCE(SUM(residual_minor),0) AS residual_minor,
    COALESCE(SUM(residual_receipt_count),0) AS residual_receipt_count
  FROM legacy_bill_authority
),
legacy_explicit_receipt AS (
  SELECT COUNT(*) AS payment_receipt_count,
    COALESCE(ROUND(SUM(COALESCE(amount,0)) * 100),0) AS payment_receipt_minor
  FROM payments WHERE CAST(tenant_id AS TEXT)='100'
),
legacy_deposit AS (
  SELECT
    COALESCE(SUM(CASE WHEN transaction_type='deposit' AND COALESCE(is_active,1)=1 THEN 1 ELSE 0 END),0) AS deposit_receipt_count,
    COALESCE(ROUND(SUM(CASE WHEN transaction_type='deposit' AND COALESCE(is_active,1)=1 THEN amount ELSE 0 END) * 100),0) AS received_minor,
    COALESCE(ROUND(SUM(CASE WHEN transaction_type='adjustment' AND COALESCE(is_active,1)=1 THEN amount ELSE 0 END) * 100),0) AS applied_minor,
    COALESCE(ROUND(SUM(CASE WHEN transaction_type='refund' AND COALESCE(is_active,1)=1 THEN amount ELSE 0 END) * 100),0) AS refunded_minor
  FROM billing_deposits WHERE CAST(tenant_id AS TEXT)='100'
),
legacy_receipt_authority AS (
  SELECT
    er.payment_receipt_count + ld.deposit_receipt_count + li.residual_receipt_count AS receipt_count,
    er.payment_receipt_minor + ld.received_minor + li.residual_minor AS receipt_total_minor,
    er.payment_receipt_minor + li.residual_minor AS allocation_total_minor
  FROM legacy_explicit_receipt er,legacy_deposit ld,legacy_invoice li
),
legacy_credit AS (
  SELECT COALESCE(ROUND(SUM(CASE
    WHEN COALESCE(is_active,1)=1 AND lower(COALESCE(status,'')) IN ('approved','posted')
    THEN COALESCE(total_amount,0) ELSE 0 END) * 100),0) AS credit_minor
  FROM billing_credit_notes WHERE CAST(tenant_id AS TEXT)='100'
),
legacy_refund AS (
  SELECT COALESCE(ROUND(SUM(CASE WHEN status='consumed' THEN COALESCE(amount,0) ELSE 0 END) * 100),0) AS refund_minor
  FROM billing_refund_cash_holds WHERE CAST(tenant_id AS TEXT)='100'
),
canonical_invoice AS (
  SELECT COUNT(*) AS invoice_count,
    COALESCE(SUM(subtotal_minor),0) AS gross_minor,
    COALESCE(SUM(CASE WHEN adjustment_total_minor < 0 THEN -adjustment_total_minor ELSE 0 END),0) AS discount_minor,
    COALESCE(SUM(total_minor),0) AS net_minor,
    COALESCE(SUM(paid_minor),0) AS paid_minor,
    COALESCE(SUM(due_minor),0) AS due_minor
  FROM canonical_invoices WHERE tenant_id='100'
),
canonical_receipt AS (
  SELECT COUNT(*) AS receipt_count,
    COALESCE(SUM(total_minor),0) AS receipt_total_minor
  FROM canonical_payment_receipts WHERE tenant_id='100'
),
canonical_allocation AS (
  SELECT COALESCE(SUM(amount_minor),0) AS allocation_total_minor
  FROM canonical_payment_allocations WHERE tenant_id='100'
),
canonical_deposit AS (
  SELECT COALESCE(SUM(amount_minor),0) AS received_minor,
    COALESCE(SUM(applied_minor),0) AS applied_minor,
    COALESCE(SUM(refunded_minor),0) AS refunded_minor
  FROM canonical_deposits WHERE tenant_id='100'
),
canonical_credit AS (
  SELECT COALESCE(SUM(total_minor),0) AS credit_minor
  FROM canonical_credit_notes WHERE tenant_id='100'
),
canonical_refund AS (
  SELECT COALESCE(SUM(amount_minor),0) AS refund_minor
  FROM canonical_refunds WHERE tenant_id='100' AND source_type='payment'
),
canonical_reversal AS (
  SELECT COALESCE(SUM(amount_minor),0) AS reversal_minor
  FROM canonical_payment_reversals WHERE tenant_id='100'
),
source_mapping_duplicates AS (
  SELECT COUNT(*) AS duplicate_count FROM (
    SELECT entity_type,source_type,source_public_id,COUNT(*) AS count_value
    FROM canonical_source_mappings
    WHERE tenant_id='100'
    GROUP BY entity_type,source_type,source_public_id
    HAVING COUNT(*) > 1
  )
),
scoped_financial_tenants AS (
  SELECT tenant_id FROM canonical_invoices WHERE tenant_id <> '100'
  UNION ALL
  SELECT tenant_id FROM canonical_payment_receipts WHERE tenant_id <> '100'
  UNION ALL
  SELECT tenant_id FROM canonical_deposits WHERE tenant_id <> '100'
  UNION ALL
  SELECT tenant_id FROM canonical_credit_notes WHERE tenant_id <> '100'
  UNION ALL
  SELECT tenant_id FROM canonical_refunds WHERE tenant_id <> '100'
),
cross_tenant_rows AS (
  SELECT COUNT(*) AS row_count
  FROM scoped_financial_tenants scoped
  WHERE NOT EXISTS (
    SELECT 1
    FROM canonical_feature_flags f
    WHERE f.tenant_id = scoped.tenant_id
      AND f.flag_key = 'canonical_financial_dual_write_v1'
      AND f.domain = 'financial'
      AND f.mode = 'shadow'
      AND f.is_enabled = 1
      AND f.config_json = '{"tenantScope":["' || scoped.tenant_id || '"],"writePolicy":"shadow"}'
  )
),
control_counts AS (
  SELECT
    (SELECT COUNT(*) FROM canonical_processing_issues
      WHERE tenant_id='100' AND status <> 'resolved' AND severity='critical') AS unresolved_critical_issues,
    (SELECT COUNT(*) FROM canonical_outbox_events
      WHERE tenant_id='100' AND status IN ('blocked','failed')) AS blocked_outbox,
    (SELECT COUNT(*) FROM canonical_processing_issues
      WHERE tenant_id='100' AND status <> 'resolved'
        AND (issue_type='accounting' OR issue_code LIKE '%ACCOUNTING%')) AS blocked_accounting
)
SELECT
  li.invoice_count AS legacy_invoice_count,
  li.gross_minor AS legacy_invoice_gross_minor,
  li.discount_minor AS legacy_invoice_discount_minor,
  li.net_minor AS legacy_invoice_net_minor,
  li.paid_minor AS legacy_invoice_paid_minor,
  li.due_minor AS legacy_invoice_due_minor,
  lra.receipt_count AS legacy_receipt_count,
  lra.receipt_total_minor AS legacy_receipt_total_minor,
  lra.allocation_total_minor AS legacy_allocation_total_minor,
  ld.received_minor AS legacy_deposit_received_minor,
  ld.applied_minor AS legacy_deposit_applied_minor,
  ld.refunded_minor AS legacy_deposit_refunded_minor,
  lc.credit_minor AS legacy_credit_note_minor,
  lf.refund_minor AS legacy_refund_minor,
  0 AS legacy_reversal_minor,
  ci.invoice_count AS canonical_invoice_count,
  ci.gross_minor AS canonical_invoice_gross_minor,
  ci.discount_minor AS canonical_invoice_discount_minor,
  ci.net_minor AS canonical_invoice_net_minor,
  ci.paid_minor AS canonical_invoice_paid_minor,
  ci.due_minor AS canonical_invoice_due_minor,
  cr.receipt_count AS canonical_receipt_count,
  cr.receipt_total_minor AS canonical_receipt_total_minor,
  ca.allocation_total_minor AS canonical_allocation_total_minor,
  cd.received_minor AS canonical_deposit_received_minor,
  cd.applied_minor AS canonical_deposit_applied_minor,
  cd.refunded_minor AS canonical_deposit_refunded_minor,
  cc.credit_minor AS canonical_credit_note_minor,
  cf.refund_minor AS canonical_refund_minor,
  cv.reversal_minor AS canonical_reversal_minor,
  smd.duplicate_count AS source_mapping_duplicates,
  ctr.row_count AS cross_tenant_rows,
  ctl.unresolved_critical_issues,
  ctl.blocked_outbox,
  ctl.blocked_accounting
FROM legacy_invoice li,legacy_receipt_authority lra,legacy_deposit ld,legacy_credit lc,legacy_refund lf,
  canonical_invoice ci,canonical_receipt cr,canonical_allocation ca,canonical_deposit cd,
  canonical_credit cc,canonical_refund cf,canonical_reversal cv,source_mapping_duplicates smd,
  cross_tenant_rows ctr,control_counts ctl;
`.trim();

export function normalizeTenantFinancialReconciliationTenantId(value: string): string {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('tenantId must be a positive decimal integer without surrounding whitespace');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('tenantId must be a positive safe integer');
  }
  return value;
}

export function buildTenantFinancialReconciliationSql(tenantId: string): string {
  const normalized = normalizeTenantFinancialReconciliationTenantId(tenantId);
  return TENANT_100_FINANCIAL_RECONCILIATION_SQL.replaceAll("'100'", `'${normalized}'`);
}

export const TENANT_FINANCIAL_RECONCILIATION_SQL = buildTenantFinancialReconciliationSql('100');

const FIELD_MAP: Array<[
  keyof TenantFinancialAggregate,
  keyof TenantFinancialAggregateRow,
  keyof TenantFinancialAggregateRow,
]> = [
  ['invoiceCount', 'legacy_invoice_count', 'canonical_invoice_count'],
  ['invoiceGrossMinor', 'legacy_invoice_gross_minor', 'canonical_invoice_gross_minor'],
  ['invoiceDiscountMinor', 'legacy_invoice_discount_minor', 'canonical_invoice_discount_minor'],
  ['invoiceNetMinor', 'legacy_invoice_net_minor', 'canonical_invoice_net_minor'],
  ['invoicePaidMinor', 'legacy_invoice_paid_minor', 'canonical_invoice_paid_minor'],
  ['invoiceDueMinor', 'legacy_invoice_due_minor', 'canonical_invoice_due_minor'],
  ['receiptCount', 'legacy_receipt_count', 'canonical_receipt_count'],
  ['receiptTotalMinor', 'legacy_receipt_total_minor', 'canonical_receipt_total_minor'],
  ['allocationTotalMinor', 'legacy_allocation_total_minor', 'canonical_allocation_total_minor'],
  ['depositReceivedMinor', 'legacy_deposit_received_minor', 'canonical_deposit_received_minor'],
  ['depositAppliedMinor', 'legacy_deposit_applied_minor', 'canonical_deposit_applied_minor'],
  ['depositRefundedMinor', 'legacy_deposit_refunded_minor', 'canonical_deposit_refunded_minor'],
  ['creditNoteMinor', 'legacy_credit_note_minor', 'canonical_credit_note_minor'],
  ['refundMinor', 'legacy_refund_minor', 'canonical_refund_minor'],
  ['reversalMinor', 'legacy_reversal_minor', 'canonical_reversal_minor'],
];

function exactNonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return parsed;
}

function parseUtc(value: string): string {
  if (!value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new Error('cutoffUtc must be an absolute UTC timestamp');
  }
  return new Date(value).toISOString();
}

export function buildTenantFinancialSnapshotFromAggregateRow(
  row: TenantFinancialAggregateRow,
  cutoffUtc: string,
  secondPassNewRows: number,
  tenantId = '100',
): TenantFinancialReconciliationSnapshot {
  if (secondPassNewRows !== 0) {
    throw new Error('second-pass new rows must equal zero before reconciliation evidence');
  }
  const normalizedTenantId = normalizeTenantFinancialReconciliationTenantId(tenantId);
  const legacy = {} as TenantFinancialAggregate;
  const canonical = {} as TenantFinancialAggregate;
  for (const [key, legacyField, canonicalField] of FIELD_MAP) {
    legacy[key] = exactNonNegativeInteger(row[legacyField], String(legacyField));
    canonical[key] = exactNonNegativeInteger(row[canonicalField], String(canonicalField));
  }
  return {
    tenantId: normalizedTenantId,
    cutoffUtc: parseUtc(cutoffUtc),
    legacy,
    canonical,
    controls: {
      secondPassNewRows,
      sourceMappingDuplicates: exactNonNegativeInteger(row.source_mapping_duplicates, 'source_mapping_duplicates'),
      crossTenantRows: exactNonNegativeInteger(row.cross_tenant_rows, 'cross_tenant_rows'),
      unresolvedCriticalIssues: exactNonNegativeInteger(row.unresolved_critical_issues, 'unresolved_critical_issues'),
      blockedOutbox: exactNonNegativeInteger(row.blocked_outbox, 'blocked_outbox'),
      blockedAccounting: exactNonNegativeInteger(row.blocked_accounting, 'blocked_accounting'),
    },
  };
}

function createRunner(root: string): TenantFinancialCollectionRunner {
  return (args) => {
    const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    if (result.error) throw result.error;
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.status ?? 1,
    };
  };
}

function extractJsonDocument(text: string): unknown {
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
  }
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    return JSON.parse(text.slice(objectStart, objectEnd + 1));
  }
  throw new Error('Wrangler output did not contain JSON');
}

function assertCommand(label: string, result: TenantFinancialCollectionCommandResult): void {
  if (result.exitCode !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`);
}

function prepareOutput(outputPath: string, repositoryRoot: string): string {
  const absolute = resolve(outputPath);
  const repository = resolve(repositoryRoot);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Financial reconciliation evidence must remain outside the repository');
  }
  const parentPath = dirname(absolute);
  if (!existsSync(parentPath)) mkdirSync(parentPath, { recursive: false, mode: 0o700 });
  const parent = lstatSync(parentPath);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error('Financial reconciliation evidence parent must use mode 700');
  }
  return absolute;
}

export function collectTenantFinancialReconciliation(
  options: CollectTenantFinancialReconciliationOptions,
): {
  snapshot: TenantFinancialReconciliationSnapshot;
  reconciliation: TenantFinancialReconciliationReceipt;
  receipt: TenantFinancialReconciliationCollectionReceipt;
} {
  const root = options.repositoryRoot ?? process.cwd();
  const tenantId = normalizeTenantFinancialReconciliationTenantId(options.tenantId ?? '100');
  const runner = options.runner ?? createRunner(root);
  const identity = runner(['d1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--json']);
  assertCommand('production D1 identity check', identity);
  const database = extractJsonDocument(identity.stdout) as { name?: unknown; uuid?: unknown };
  if (database.name !== CDB101_PRODUCTION_DATABASE_NAME || database.uuid !== CDB101_PRODUCTION_DATABASE_ID) {
    throw new Error('Production D1 identity mismatch');
  }

  const aggregate = runner([
    'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
    '--env', 'production', '--remote', '--json',
    '--command', buildTenantFinancialReconciliationSql(tenantId),
  ]);
  assertCommand('tenant financial aggregate query', aggregate);
  const parsed = extractJsonDocument(aggregate.stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error('Expected one D1 aggregate envelope');
  const envelope = parsed[0] as {
    success?: unknown;
    results?: unknown[];
    meta?: { changed_db?: unknown; rows_written?: unknown };
  };
  if (envelope.success !== true || !Array.isArray(envelope.results) || envelope.results.length !== 1) {
    throw new Error('Expected one successful tenant financial aggregate row');
  }
  if (envelope.meta?.changed_db !== false || Number(envelope.meta?.rows_written ?? 0) !== 0) {
    throw new Error('Tenant financial collector violated the read-only boundary');
  }

  const snapshot = buildTenantFinancialSnapshotFromAggregateRow(
    envelope.results[0] as TenantFinancialAggregateRow,
    options.cutoffUtc ?? new Date().toISOString(),
    options.secondPassNewRows,
    tenantId,
  );
  const reconciliation = evaluateTenantFinancialReconciliation(snapshot);
  const output = prepareOutput(options.outputPath, root);
  writeFileSync(output, `${JSON.stringify({ snapshot, reconciliation }, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(output, 0o600);

  return {
    snapshot,
    reconciliation,
    receipt: {
      schemaVersion: 1,
      evidenceReady: reconciliation.evidenceReady,
      activationReady: reconciliation.activationReady,
      tenantId,
      issueCount: reconciliation.issues.length,
      aggregateOnly: true,
      networkRequestPerformed: true,
      productionMutationPerformed: false,
      rowsWritten: 0,
    },
  };
}

function parseArgs(args: string[]): {
  outputPath: string;
  tenantId: string;
  cutoffUtc?: string;
  secondPassNewRows: number;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values.set(arg, value);
    index += 1;
  }
  const outputPath = values.get('--output');
  const secondPassText = values.get('--second-pass-new-rows');
  if (!outputPath || secondPassText === undefined) {
    throw new Error('--output and --second-pass-new-rows are required');
  }
  const secondPassNewRows = Number(secondPassText);
  if (!Number.isSafeInteger(secondPassNewRows) || secondPassNewRows < 0) {
    throw new Error('--second-pass-new-rows must be a non-negative integer');
  }
  return {
    outputPath,
    tenantId: normalizeTenantFinancialReconciliationTenantId(values.get('--tenant') ?? '100'),
    cutoffUtc: values.get('--cutoff-utc'),
    secondPassNewRows,
  };
}

function main(): void {
  try {
    const result = collectTenantFinancialReconciliation(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result.receipt, null, 2)}\n`);
    if (!result.receipt.activationReady) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
