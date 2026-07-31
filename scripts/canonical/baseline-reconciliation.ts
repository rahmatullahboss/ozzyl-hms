import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  snapshotSqliteSchema,
  type SchemaSnapshotReport,
  type SchemaTableSnapshot,
} from './snapshot-schema';

export type BaselineExceptionSeverity = 'error' | 'warning' | 'info';

export type BaselineExceptionStatus =
  | 'open'
  | 'accepted_import_compatibility';

export interface BaselineException {
  id: string;
  code: string;
  severity: BaselineExceptionSeverity;
  status: BaselineExceptionStatus;
  table: string;
  rowId?: string;
  count: number;
  summary: string;
  evidence: Record<string, string | number | boolean | null>;
}

export interface ProductionBaselineDomains {
  billing: {
    billCount: number;
    invoiceItemCount: number;
    billTotal: number;
    invoiceLineTotal: number;
    billLineMismatchCount: number;
    dueMismatchCount: number;
  };
  payments: {
    paymentCount: number;
    totalAmount: number;
  };
  deposits: {
    transactionCount: number;
    totalAmount: number;
  };
  refunds: {
    creditNoteCount: number;
    totalAmount: number;
  };
  commissions: {
    accrualCount: number;
    payableTotal: number;
    paidTotal: number;
    balanceTotal: number;
  };
  ipd: {
    ledgerEntryCount: number;
    debitTotal: number;
    creditTotal: number;
  };
  stock: {
    stockRowCount: number;
    balanceTotal: number;
    movementCount: number;
    movementQuantityTotal: number;
  };
  cash: {
    eventCount: number;
    totalAmount: number;
  };
  accounting: {
    voucherCount: number;
    lineCount: number;
    debitTotal: number;
    creditTotal: number;
    imbalancedVoucherCount: number;
  };
}

export interface BaselineDatabaseSummary {
  databaseFile: string;
  databaseSha256: string;
  tableCount: number;
  viewCount: number;
  triggerCount: number;
  columnCount: number;
  indexCount: number;
  foreignKeyCount: number;
  checkCount: number;
  totalRowCount: number;
  foreignKeyViolationCount: number;
}

export interface MigrationDriftSummary {
  migrationTablePresent: boolean;
  appliedMigrationCount: number;
  repositoryMigrationCount: number;
  duplicateAppliedNames: string[];
  appliedNotInRepository: string[];
  repositoryNotApplied: string[];
}

export interface ProductionBaselineReport {
  createdAtUtc: string;
  source: BaselineDatabaseSummary;
  clone?: BaselineDatabaseSummary;
  migrationDrift: MigrationDriftSummary;
  domains: ProductionBaselineDomains;
  exceptionCount: number;
  exceptionCountsByCode: Record<string, number>;
  exceptions: BaselineException[];
}

export interface ReconcileProductionBaselineOptions {
  sourceDatabase: string;
  cloneDatabase?: string;
  sourceSnapshot?: string;
  cloneSnapshot?: string;
  waiverManifest?: string;
  migrationDirectory?: string;
  output?: string;
  markdown?: string;
  exceptions?: string;
  now?: () => Date;
}

interface SqliteRow {
  [key: string]: string | number | null;
}

interface AggregateRow {
  row_count: number;
  total_amount: number | null;
}

interface StorageClassRow {
  storage_type: string;
  row_count: number;
}

interface ExceptionDraft {
  code: string;
  severity: BaselineExceptionSeverity;
  status?: BaselineExceptionStatus;
  table: string;
  rowId?: string;
  count?: number;
  summary: string;
  evidence?: Record<string, string | number | boolean | null>;
  stableKey: string;
}

interface WaiverManifestEntry {
  table: string;
  column?: string;
  columns?: string[];
  parentTable: string;
}

interface WaiverManifest {
  manualWaivers?: WaiverManifestEntry[];
  graphWaivers?: WaiverManifestEntry[];
}

const MONEY_COLUMNS: Record<string, string[]> = {
  bills: [
    'subtotal',
    'test_bill',
    'doctor_visit_bill',
    'admission_bill',
    'operation_bill',
    'medicine_bill',
    'discount',
    'tax',
    'total',
    'paid',
    'due',
    'co_payment_amount',
  ],
  invoice_items: ['unit_price', 'line_total', 'tax'],
  payments: ['amount'],
  income: ['amount'],
  expenses: ['amount'],
  billing_deposits: ['amount'],
  billing_credit_notes: ['total_amount', 'amount'],
  billing_refund_cash_holds: ['amount'],
  billing_settlements: ['total_amount', 'cash_amount', 'deposit_amount'],
  emp_cash_transactions: ['amount'],
  cash_drawer_movements: ['amount'],
  cash_ledger_entries: ['amount', 'expected_amount', 'received_amount', 'due_amount'],
  diagnostic_performer_reserves: [
    'service_amount',
    'discount_amount',
    'net_amount',
    'reserve_amount',
  ],
  doctor_commission_accruals: [
    'commission_amount',
    'earned_commission_amount',
    'payable_commission_amount',
    'paid_amount',
    'balance_amount',
  ],
  doctor_commission_settlements: [
    'total_amount',
    'gross_amount',
    'deduction_amount',
    'net_amount',
  ],
  doctor_commission_settlement_items: ['amount'],
  accounting_journal_lines: ['debit', 'credit', 'debit_amount', 'credit_amount'],
  journal_entries: ['amount', 'debit', 'credit', 'debit_amount', 'credit_amount'],
  ipd_ledger_entries: ['debit', 'credit', 'debit_amount', 'credit_amount', 'amount'],
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function parseJsonRows<T>(text: string, label: string): T[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`sqlite3 ${label} output was not an array`);
  }
  return parsed as T[];
}

function runSqliteJson<T>(database: string, sql: string, label: string): T[] {
  const result = spawnSync('sqlite3', ['-json', database, sql], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `sqlite3 ${label} failed (${result.status}): ${String(result.stderr).trim()}`,
    );
  }
  return parseJsonRows<T>(result.stdout, label);
}

function tableByName(
  snapshot: SchemaSnapshotReport,
  expected: string,
): SchemaTableSnapshot | undefined {
  const normalized = expected.toLowerCase();
  return snapshot.tables.find((table) => table.name.toLowerCase() === normalized);
}

function columnByName(
  table: SchemaTableSnapshot | undefined,
  candidates: string[],
): string | undefined {
  if (!table) return undefined;
  const byLower = new Map(table.columns.map((column) => [column.name.toLowerCase(), column.name]));
  for (const candidate of candidates) {
    const match = byLower.get(candidate.toLowerCase());
    if (match) return match;
  }
  return undefined;
}

function primaryKeyColumn(table: SchemaTableSnapshot | undefined): string | undefined {
  return table?.columns.find((column) => column.primaryKeyPosition === 1)?.name ??
    columnByName(table, ['id', 'Id']);
}

function numericExpression(column: string): string {
  const quoted = quoteIdentifier(column);
  return `CASE WHEN typeof(${quoted}) IN ('integer','real') THEN CAST(${quoted} AS REAL) ELSE 0 END`;
}

function qualifiedNumericExpression(alias: string, column: string): string {
  const qualified = `${alias}.${quoteIdentifier(column)}`;
  return `CASE WHEN typeof(${qualified}) IN ('integer','real') THEN CAST(${qualified} AS REAL) ELSE 0 END`;
}

function aggregateTable(
  database: string,
  table: SchemaTableSnapshot | undefined,
  amountColumn?: string,
): { count: number; total: number } {
  if (!table) return { count: 0, total: 0 };
  const amount = amountColumn
    ? `SUM(${numericExpression(amountColumn)})`
    : '0';
  const rows = runSqliteJson<AggregateRow>(
    database,
    `SELECT COUNT(*) AS row_count, COALESCE(${amount}, 0) AS total_amount FROM ${quoteIdentifier(table.name)};`,
    `aggregate ${table.name}`,
  );
  return {
    count: Number(rows[0]?.row_count ?? 0),
    total: Number(rows[0]?.total_amount ?? 0),
  };
}

function aggregateActiveInvoiceItems(
  database: string,
  table: SchemaTableSnapshot | undefined,
): { count: number; total: number } {
  if (!table) return { count: 0, total: 0 };
  const amount = columnByName(table, ['line_total', 'total', 'amount']);
  const cancelled = columnByName(table, ['is_cancelled', 'cancelled']);
  const status = columnByName(table, ['status']);
  const predicates = ['1 = 1'];
  if (cancelled) {
    predicates.push(`COALESCE(${quoteIdentifier(cancelled)}, 0) = 0`);
  }
  if (status) {
    predicates.push(
      `LOWER(COALESCE(${quoteIdentifier(status)}, 'active')) NOT IN ('cancelled','canceled','void','voided','inactive')`,
    );
  }
  const amountExpression = amount ? numericExpression(amount) : '0';
  const rows = runSqliteJson<AggregateRow>(
    database,
    `SELECT COUNT(*) AS row_count,
            COALESCE(SUM(${amountExpression}), 0) AS total_amount
     FROM ${quoteIdentifier(table.name)}
     WHERE ${predicates.join(' AND ')};`,
    `aggregate active invoice items ${table.name}`,
  );
  return {
    count: Number(rows[0]?.row_count ?? 0),
    total: Number(rows[0]?.total_amount ?? 0),
  };
}

function aggregateStockMovements(
  database: string,
  table: SchemaTableSnapshot | undefined,
): { count: number; total: number } {
  if (!table) return { count: 0, total: 0 };
  const quantity = columnByName(table, ['Quantity', 'quantity']);
  if (quantity) return aggregateTable(database, table, quantity);

  const inQuantity = columnByName(table, ['InQuantity', 'in_quantity']);
  const outQuantity = columnByName(table, ['OutQuantity', 'out_quantity']);
  if (!inQuantity && !outQuantity) return aggregateTable(database, table);
  const inExpression = inQuantity ? numericExpression(inQuantity) : '0';
  const outExpression = outQuantity ? numericExpression(outQuantity) : '0';
  const rows = runSqliteJson<AggregateRow>(
    database,
    `SELECT COUNT(*) AS row_count,
            COALESCE(SUM(${inExpression} - ${outExpression}), 0) AS total_amount
     FROM ${quoteIdentifier(table.name)};`,
    `aggregate stock movements ${table.name}`,
  );
  return {
    count: Number(rows[0]?.row_count ?? 0),
    total: Number(rows[0]?.total_amount ?? 0),
  };
}

function inspectMigrationDrift(
  database: string,
  snapshot: SchemaSnapshotReport,
  migrationDirectory: string | undefined,
  drafts: ExceptionDraft[],
): MigrationDriftSummary {
  const migrationTable = tableByName(snapshot, 'd1_migrations');
  const migrationName = columnByName(migrationTable, ['name']);
  const appliedRows = migrationTable && migrationName
    ? runSqliteJson<SqliteRow>(
        database,
        `SELECT CAST(${quoteIdentifier(migrationName)} AS TEXT) AS migration_name,
                COUNT(*) AS duplicate_count
         FROM ${quoteIdentifier(migrationTable.name)}
         GROUP BY ${quoteIdentifier(migrationName)}
         ORDER BY migration_name;`,
        'applied migration names',
      )
    : [];
  const appliedNames = appliedRows
    .map((row) => String(row.migration_name))
    .sort();
  const duplicateAppliedNames = appliedRows
    .filter((row) => Number(row.duplicate_count) > 1)
    .map((row) => String(row.migration_name))
    .sort();

  for (const name of duplicateAppliedNames) {
    drafts.push({
      code: 'MIGRATION_DUPLICATE_APPLIED_NAME',
      severity: 'error',
      table: migrationTable?.name ?? 'd1_migrations',
      summary: 'The production migration ledger contains the same migration name more than once.',
      evidence: { migrationName: name },
      stableKey: name,
    });
  }

  if (!migrationDirectory) {
    return {
      migrationTablePresent: Boolean(migrationTable),
      appliedMigrationCount: appliedRows.reduce(
        (sum, row) => sum + Number(row.duplicate_count),
        0,
      ),
      repositoryMigrationCount: 0,
      duplicateAppliedNames,
      appliedNotInRepository: [],
      repositoryNotApplied: [],
    };
  }

  const resolvedDirectory = resolve(migrationDirectory);
  if (!existsSync(resolvedDirectory)) {
    throw new Error(`Migration directory not found: ${resolvedDirectory}`);
  }
  const repositoryNames = readdirSync(resolvedDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
  const appliedSet = new Set(appliedNames);
  const repositorySet = new Set(repositoryNames);
  const appliedNotInRepository = appliedNames.filter(
    (name) => !repositorySet.has(name),
  );
  const repositoryNotApplied = repositoryNames.filter(
    (name) => !appliedSet.has(name),
  );

  for (const name of appliedNotInRepository) {
    drafts.push({
      code: 'MIGRATION_APPLIED_NOT_IN_REPOSITORY',
      severity: 'warning',
      table: migrationTable?.name ?? 'd1_migrations',
      summary: 'Migration is recorded as applied in production but no same-named SQL file exists in the repository.',
      evidence: { migrationName: name },
      stableKey: name,
    });
  }
  for (const name of repositoryNotApplied) {
    drafts.push({
      code: 'MIGRATION_REPOSITORY_NOT_APPLIED',
      severity: 'warning',
      table: migrationTable?.name ?? 'd1_migrations',
      summary: 'Repository SQL migration is not recorded as applied in the production migration ledger.',
      evidence: { migrationName: name },
      stableKey: name,
    });
  }

  return {
    migrationTablePresent: Boolean(migrationTable),
    appliedMigrationCount: appliedRows.reduce(
      (sum, row) => sum + Number(row.duplicate_count),
      0,
    ),
    repositoryMigrationCount: repositoryNames.length,
    duplicateAppliedNames,
    appliedNotInRepository,
    repositoryNotApplied,
  };
}

function stableExceptionId(code: string, stableKey: string): string {
  const digest = createHash('sha256')
    .update(`${code}\u0000${stableKey}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `P01-${code}-${digest}`;
}

function finalizeExceptions(drafts: ExceptionDraft[]): BaselineException[] {
  const byId = new Map<string, BaselineException>();
  for (const draft of drafts) {
    const id = stableExceptionId(draft.code, draft.stableKey);
    byId.set(id, {
      id,
      code: draft.code,
      severity: draft.severity,
      status: draft.status ?? 'open',
      table: draft.table,
      rowId: draft.rowId,
      count: draft.count ?? 1,
      summary: draft.summary,
      evidence: draft.evidence ?? {},
    });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function addForeignKeyExceptions(
  snapshot: SchemaSnapshotReport,
  drafts: ExceptionDraft[],
): void {
  for (const violation of snapshot.foreignKeyViolations) {
    const stableKey = `${violation.table}:${String(violation.rowId)}:${violation.parentTable}:${violation.foreignKeyId}`;
    drafts.push({
      code: 'FOREIGN_KEY_VIOLATION',
      severity: 'error',
      table: violation.table,
      rowId: String(violation.rowId),
      summary: 'Legacy row does not resolve to its declared foreign-key parent.',
      evidence: {
        parentTable: violation.parentTable,
        foreignKeyId: violation.foreignKeyId,
      },
      stableKey,
    });

    const table = tableByName(snapshot, violation.table);
    const fk = table?.foreignKeys.find((foreignKey) => foreignKey.id === violation.foreignKeyId);
    if (fk && /tenant/i.test(fk.fromColumn)) {
      drafts.push({
        code: 'TENANT_REFERENCE_MISMATCH',
        severity: 'error',
        table: violation.table,
        rowId: String(violation.rowId),
        summary: 'Tenant-scoped reference does not resolve to the declared tenant parent.',
        evidence: {
          fromColumn: fk.fromColumn,
          parentTable: fk.parentTable,
        },
        stableKey,
      });
    }
  }
}

function addCrossTenantExceptions(
  database: string,
  snapshot: SchemaSnapshotReport,
  drafts: ExceptionDraft[],
): void {
  for (const child of snapshot.tables) {
    const childTenant = columnByName(child, ['tenant_id', 'TenantId']);
    const childPk = primaryKeyColumn(child);
    if (!childTenant || !childPk) continue;

    const grouped = new Map<number, typeof child.foreignKeys>();
    for (const foreignKey of child.foreignKeys) {
      const rows = grouped.get(foreignKey.id) ?? [];
      rows.push(foreignKey);
      grouped.set(foreignKey.id, rows);
    }

    for (const foreignKeys of grouped.values()) {
      if (foreignKeys.length !== 1) continue;
      const foreignKey = foreignKeys[0];
      if (/tenant/i.test(foreignKey.fromColumn)) continue;
      const parent = tableByName(snapshot, foreignKey.parentTable);
      const parentTenant = columnByName(parent, ['tenant_id', 'TenantId']);
      const parentPk = foreignKey.toColumn ?? primaryKeyColumn(parent);
      if (!parent || !parentTenant || !parentPk) continue;

      const rows = runSqliteJson<SqliteRow>(
        database,
        `SELECT CAST(c.${quoteIdentifier(childPk)} AS TEXT) AS row_id,
                CAST(c.${quoteIdentifier(childTenant)} AS TEXT) AS child_tenant,
                CAST(p.${quoteIdentifier(parentTenant)} AS TEXT) AS parent_tenant
         FROM ${quoteIdentifier(child.name)} c
         JOIN ${quoteIdentifier(parent.name)} p
           ON p.${quoteIdentifier(parentPk)} = c.${quoteIdentifier(foreignKey.fromColumn)}
         WHERE CAST(c.${quoteIdentifier(childTenant)} AS TEXT) <> CAST(p.${quoteIdentifier(parentTenant)} AS TEXT)
         ORDER BY c.${quoteIdentifier(childPk)};`,
        `tenant references ${child.name}.${foreignKey.fromColumn}`,
      );
      for (const row of rows) {
        const rowId = String(row.row_id);
        drafts.push({
          code: 'TENANT_REFERENCE_MISMATCH',
          severity: 'error',
          table: child.name,
          rowId,
          summary: 'Child and parent rows have different tenant ownership.',
          evidence: {
            parentTable: parent.name,
            fromColumn: foreignKey.fromColumn,
            childTenantId: String(row.child_tenant),
            parentTenantId: String(row.parent_tenant),
          },
          stableKey: `${child.name}:${rowId}:${parent.name}:${foreignKey.fromColumn}`,
        });
      }
    }
  }
}

function addDuplicateReferenceExceptions(
  database: string,
  snapshot: SchemaSnapshotReport,
  drafts: ExceptionDraft[],
): void {
  for (const table of snapshot.tables) {
    const referenceId = columnByName(table, ['reference_id', 'ReferenceId']);
    const referenceType = columnByName(table, [
      'reference_type',
      'source_type',
      'item_category',
      'TransactionType',
    ]);
    const tenant = columnByName(table, ['tenant_id', 'TenantId']);
    if (!referenceId || !referenceType) continue;

    const tenantSelect = tenant
      ? `CAST(${quoteIdentifier(tenant)} AS TEXT)`
      : "''";
    const rows = runSqliteJson<SqliteRow>(
      database,
      `SELECT ${tenantSelect} AS tenant_id,
              CAST(${quoteIdentifier(referenceType)} AS TEXT) AS reference_type,
              CAST(${quoteIdentifier(referenceId)} AS TEXT) AS reference_id,
              COUNT(*) AS duplicate_count
       FROM ${quoteIdentifier(table.name)}
       WHERE ${quoteIdentifier(referenceId)} IS NOT NULL
       GROUP BY ${tenant ? quoteIdentifier(tenant) + ',' : ''} ${quoteIdentifier(referenceType)}, ${quoteIdentifier(referenceId)}
       HAVING COUNT(*) > 1
       ORDER BY tenant_id, reference_type, reference_id;`,
      `duplicate references ${table.name}`,
    );
    for (const row of rows) {
      const stableKey = `${table.name}:${String(row.tenant_id)}:${String(row.reference_type)}:${String(row.reference_id)}`;
      drafts.push({
        code: 'DUPLICATE_SOURCE_REFERENCE',
        severity: 'warning',
        table: table.name,
        count: Number(row.duplicate_count),
        summary: 'Multiple rows share the same untyped or convention-typed source reference.',
        evidence: {
          tenantId: String(row.tenant_id),
          referenceType: String(row.reference_type),
          referenceId: String(row.reference_id),
        },
        stableKey,
      });
    }
  }
}

function addMoneyExceptions(
  database: string,
  snapshot: SchemaSnapshotReport,
  drafts: ExceptionDraft[],
): void {
  for (const [expectedTable, expectedColumns] of Object.entries(MONEY_COLUMNS)) {
    const table = tableByName(snapshot, expectedTable);
    if (!table) continue;
    for (const expectedColumn of expectedColumns) {
      const column = table.columns.find(
        (candidate) => candidate.name.toLowerCase() === expectedColumn.toLowerCase(),
      );
      if (!column) continue;
      const declared = column.declaredType.toUpperCase();
      if (/REAL|FLOAT|DOUBLE/.test(declared)) {
        drafts.push({
          code: 'MONEY_REAL_DECLARATION',
          severity: 'warning',
          table: table.name,
          summary: 'Money-like column is declared with floating-point affinity.',
          evidence: {
            column: column.name,
            declaredType: column.declaredType,
          },
          stableKey: `${table.name}:${column.name}`,
        });
      }

      const storageRows = runSqliteJson<StorageClassRow>(
        database,
        `SELECT typeof(${quoteIdentifier(column.name)}) AS storage_type, COUNT(*) AS row_count
         FROM ${quoteIdentifier(table.name)}
         WHERE ${quoteIdentifier(column.name)} IS NOT NULL
         GROUP BY typeof(${quoteIdentifier(column.name)})
         ORDER BY storage_type;`,
        `money storage ${table.name}.${column.name}`,
      );
      const types = storageRows.map((row) => row.storage_type);
      const hasUnexpected = types.some((type) => !['integer', 'real'].includes(type));
      if (types.length > 1 || hasUnexpected) {
        drafts.push({
          code: 'MONEY_MIXED_STORAGE',
          severity: 'error',
          table: table.name,
          count: storageRows.reduce((sum, row) => sum + Number(row.row_count), 0),
          summary: 'Money-like column contains mixed or non-numeric SQLite storage classes.',
          evidence: {
            column: column.name,
            storageClasses: storageRows
              .map((row) => `${row.storage_type}:${Number(row.row_count)}`)
              .join(','),
          },
          stableKey: `${table.name}:${column.name}`,
        });
      }
    }
  }
}

function addBillingExceptions(
  database: string,
  snapshot: SchemaSnapshotReport,
  drafts: ExceptionDraft[],
): {
  billLineMismatchCount: number;
  dueMismatchCount: number;
} {
  const bills = tableByName(snapshot, 'bills');
  const items = tableByName(snapshot, 'invoice_items');
  const billPk = primaryKeyColumn(bills);
  const billTotal = columnByName(bills, ['total', 'net_total']);
  const billPaid = columnByName(bills, ['paid', 'paid_amount']);
  const billDue = columnByName(bills, ['due', 'due_amount']);
  const itemBillId = columnByName(items, ['bill_id']);
  const itemAmount = columnByName(items, ['line_total', 'total', 'amount']);
  const itemCancelled = columnByName(items, ['is_cancelled', 'cancelled']);
  const itemStatus = columnByName(items, ['status']);

  let billLineMismatchCount = 0;
  if (bills && items && billPk && billTotal && itemBillId && itemAmount) {
    const activePredicates = ['1 = 1'];
    if (itemCancelled) {
      activePredicates.push(`COALESCE(i.${quoteIdentifier(itemCancelled)}, 0) = 0`);
    }
    if (itemStatus) {
      activePredicates.push(
        `LOWER(COALESCE(i.${quoteIdentifier(itemStatus)}, 'active')) NOT IN ('cancelled','canceled','void','voided','inactive')`,
      );
    }
    const activePredicate = activePredicates.join(' AND ');
    const headerTotalExpression = qualifiedNumericExpression('b', billTotal);
    const lineAmountExpression = qualifiedNumericExpression('i', itemAmount);
    const rows = runSqliteJson<SqliteRow>(
      database,
      `WITH active_line_totals AS (
         SELECT i.${quoteIdentifier(itemBillId)} AS bill_id,
                SUM(CASE WHEN ${activePredicate} THEN ${lineAmountExpression} ELSE 0 END) AS active_line_total
         FROM ${quoteIdentifier(items.name)} i
         GROUP BY i.${quoteIdentifier(itemBillId)}
       )
       SELECT CAST(b.${quoteIdentifier(billPk)} AS TEXT) AS row_id,
              ${headerTotalExpression} AS header_total,
              COALESCE(l.active_line_total, 0) AS active_line_total
       FROM ${quoteIdentifier(bills.name)} b
       LEFT JOIN active_line_totals l
         ON l.bill_id = b.${quoteIdentifier(billPk)}
       WHERE ABS(${headerTotalExpression} - COALESCE(l.active_line_total, 0)) > 0.000001
       ORDER BY b.${quoteIdentifier(billPk)};`,
      'bill line reconciliation',
    );
    billLineMismatchCount = rows.length;
    for (const row of rows) {
      const rowId = String(row.row_id);
      drafts.push({
        code: 'BILL_LINE_TOTAL_MISMATCH',
        severity: 'error',
        table: bills.name,
        rowId,
        summary: 'Bill header total does not equal the active invoice-item total.',
        evidence: {
          billTotal: Number(row.header_total),
          invoiceLineTotal: Number(row.active_line_total),
        },
        stableKey: `${bills.name}:${rowId}`,
      });
    }
  }

  let dueMismatchCount = 0;
  if (bills && billPk && billTotal && billPaid && billDue) {
    const totalExpression = numericExpression(billTotal);
    const paidExpression = numericExpression(billPaid);
    const dueExpression = numericExpression(billDue);
    const rows = runSqliteJson<SqliteRow>(
      database,
      `SELECT CAST(${quoteIdentifier(billPk)} AS TEXT) AS row_id,
              ${totalExpression} AS bill_total,
              ${paidExpression} AS bill_paid,
              ${dueExpression} AS bill_due,
              MAX(0, ${totalExpression} - ${paidExpression}) AS expected_due
       FROM ${quoteIdentifier(bills.name)}
       WHERE ABS(${dueExpression} - MAX(0, ${totalExpression} - ${paidExpression})) > 0.000001
       ORDER BY ${quoteIdentifier(billPk)};`,
      'bill due reconciliation',
    );
    dueMismatchCount = rows.length;
    for (const row of rows) {
      const rowId = String(row.row_id);
      drafts.push({
        code: 'BILL_DUE_MISMATCH',
        severity: 'error',
        table: bills.name,
        rowId,
        summary: 'Bill due cache does not equal total minus paid under the legacy baseline equation.',
        evidence: {
          billTotal: Number(row.bill_total),
          billPaid: Number(row.bill_paid),
          actualDue: Number(row.bill_due),
          expectedDue: Number(row.expected_due),
        },
        stableKey: `${bills.name}:${rowId}`,
      });
    }
  }

  return { billLineMismatchCount, dueMismatchCount };
}

function addStockExceptions(
  database: string,
  snapshot: SchemaSnapshotReport,
  drafts: ExceptionDraft[],
): void {
  const stock = tableByName(snapshot, 'InventoryStock');
  const balance = columnByName(stock, [
    'AvailableQuantity',
    'available_quantity',
    'CurrentStock',
    'current_stock',
    'quantity',
    'Quantity',
    'balance',
  ]);
  const pk = primaryKeyColumn(stock);
  if (!stock || !balance || !pk) return;
  const rows = runSqliteJson<SqliteRow>(
    database,
    `SELECT CAST(${quoteIdentifier(pk)} AS TEXT) AS row_id,
            ${numericExpression(balance)} AS balance
     FROM ${quoteIdentifier(stock.name)}
     WHERE ${numericExpression(balance)} < 0
     ORDER BY ${quoteIdentifier(pk)};`,
    'negative stock balances',
  );
  for (const row of rows) {
    const rowId = String(row.row_id);
    drafts.push({
      code: 'NEGATIVE_STOCK_BALANCE',
      severity: 'error',
      table: stock.name,
      rowId,
      summary: 'Operational stock balance is negative.',
      evidence: { balance: Number(row.balance) },
      stableKey: `${stock.name}:${rowId}`,
    });
  }
}

function addAccountingExceptions(
  database: string,
  snapshot: SchemaSnapshotReport,
  drafts: ExceptionDraft[],
): number {
  const vouchers = tableByName(snapshot, 'accounting_vouchers');
  const lines = tableByName(snapshot, 'accounting_journal_lines');
  const voucherPk = primaryKeyColumn(vouchers);
  const lineVoucherId = columnByName(lines, ['voucher_id']);
  const debit = columnByName(lines, ['debit', 'debit_amount']);
  const credit = columnByName(lines, ['credit', 'credit_amount']);
  if (!vouchers || !lines || !voucherPk || !lineVoucherId || !debit || !credit) return 0;
  const rows = runSqliteJson<SqliteRow>(
    database,
    `WITH voucher_totals AS (
       SELECT l.${quoteIdentifier(lineVoucherId)} AS voucher_id,
              SUM(${qualifiedNumericExpression('l', debit)}) AS debit_total,
              SUM(${qualifiedNumericExpression('l', credit)}) AS credit_total
       FROM ${quoteIdentifier(lines.name)} l
       GROUP BY l.${quoteIdentifier(lineVoucherId)}
     )
     SELECT CAST(v.${quoteIdentifier(voucherPk)} AS TEXT) AS row_id,
            COALESCE(t.debit_total, 0) AS debit_total,
            COALESCE(t.credit_total, 0) AS credit_total
     FROM ${quoteIdentifier(vouchers.name)} v
     LEFT JOIN voucher_totals t
       ON t.voucher_id = v.${quoteIdentifier(voucherPk)}
     WHERE ABS(COALESCE(t.debit_total, 0) - COALESCE(t.credit_total, 0)) > 0.000001
     ORDER BY v.${quoteIdentifier(voucherPk)};`,
    'accounting voucher balance',
  );
  for (const row of rows) {
    const rowId = String(row.row_id);
    drafts.push({
      code: 'ACCOUNTING_VOUCHER_IMBALANCE',
      severity: 'error',
      table: vouchers.name,
      rowId,
      summary: 'Accounting voucher debit and credit totals are not equal.',
      evidence: {
        debitTotal: Number(row.debit_total),
        creditTotal: Number(row.credit_total),
      },
      stableKey: `${vouchers.name}:${rowId}`,
    });
  }
  return rows.length;
}

function waiverIdentity(
  table: string,
  columns: string[],
  parentTable: string,
): string {
  return `${table}|${columns.join(',')}|${parentTable}`;
}

function loadWaiverIdentities(path: string | undefined): Set<string> {
  if (!path) return new Set();
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`Waiver manifest not found: ${resolved}`);
  const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as WaiverManifest;
  const entries = [
    ...(parsed.manualWaivers ?? []),
    ...(parsed.graphWaivers ?? []),
  ];
  return new Set(
    entries.map((entry, index) => {
      const columns = entry.columns ?? [entry.column ?? ''];
      if (
        typeof entry.table !== 'string' ||
        entry.table.trim().length === 0 ||
        typeof entry.parentTable !== 'string' ||
        entry.parentTable.trim().length === 0 ||
        columns.length === 0 ||
        columns.some(
          (column) => typeof column !== 'string' || column.trim().length === 0,
        )
      ) {
        throw new Error(`Invalid waiver manifest entry at index ${index}`);
      }
      return waiverIdentity(entry.table, columns, entry.parentTable);
    }),
  );
}

function normalizedForeignKeyKeys(table: SchemaTableSnapshot): Set<string> {
  const grouped = new Map<number, SchemaTableSnapshot['foreignKeys']>();
  for (const foreignKey of table.foreignKeys) {
    const rows = grouped.get(foreignKey.id) ?? [];
    rows.push(foreignKey);
    grouped.set(foreignKey.id, rows);
  }

  return new Set(
    [...grouped.values()].map((rows) => {
      const ordered = [...rows].sort(
        (left, right) => left.sequence - right.sequence,
      );
      const first = ordered[0];
      return [
        table.name,
        ordered.map((row) => row.fromColumn).join(','),
        first.parentTable,
        ordered.map((row) => row.toColumn ?? '').join(','),
        first.onUpdate,
        first.onDelete,
        first.match,
      ].join('|');
    }),
  );
}

function schemaComponentSignature(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function addSchemaComponentDifference(
  code: string,
  label: string,
  objectName: string,
  sourceValue: unknown[],
  cloneValue: unknown[],
  drafts: ExceptionDraft[],
): void {
  const sourceSignature = schemaComponentSignature(sourceValue);
  const cloneSignature = schemaComponentSignature(cloneValue);
  if (sourceSignature === cloneSignature) return;
  drafts.push({
    code,
    severity: 'error',
    table: objectName,
    summary: `Source and clone ${label} metadata differ.`,
    evidence: {
      objectType: label,
      sourceCount: sourceValue.length,
      cloneCount: cloneValue.length,
      sourceSignatureSha256: sourceSignature,
      cloneSignatureSha256: cloneSignature,
    },
    stableKey: objectName,
  });
}

function addSourceCloneExceptions(
  source: SchemaSnapshotReport,
  clone: SchemaSnapshotReport,
  waiverIdentities: Set<string>,
  drafts: ExceptionDraft[],
): void {
  const sourceTables = new Map(source.tables.map((table) => [table.name, table]));
  const cloneTables = new Map(clone.tables.map((table) => [table.name, table]));
  const allTables = [...new Set([...sourceTables.keys(), ...cloneTables.keys()])].sort();

  for (const tableName of allTables) {
    const sourceTable = sourceTables.get(tableName);
    const cloneTable = cloneTables.get(tableName);
    if (!sourceTable || !cloneTable) {
      drafts.push({
        code: 'SOURCE_CLONE_TABLE_DIFFERENCE',
        severity: 'error',
        table: tableName,
        summary: 'Table exists on only one side of the source/clone comparison.',
        evidence: {
          sourcePresent: Boolean(sourceTable),
          clonePresent: Boolean(cloneTable),
        },
        stableKey: tableName,
      });
      continue;
    }
    if (sourceTable.rowCount !== cloneTable.rowCount) {
      drafts.push({
        code: 'SOURCE_CLONE_ROW_COUNT_DIFFERENCE',
        severity: 'error',
        table: tableName,
        summary: 'Source and clone table row counts differ.',
        evidence: {
          sourceRows: sourceTable.rowCount,
          cloneRows: cloneTable.rowCount,
        },
        stableKey: tableName,
      });
    }

    addSchemaComponentDifference(
      'SOURCE_CLONE_COLUMN_DIFFERENCE',
      'column',
      tableName,
      sourceTable.columns.map((column) => [
        column.name,
        column.declaredType,
        column.notNull,
        column.defaultValue,
        column.primaryKeyPosition,
      ]),
      cloneTable.columns.map((column) => [
        column.name,
        column.declaredType,
        column.notNull,
        column.defaultValue,
        column.primaryKeyPosition,
      ]),
      drafts,
    );
    addSchemaComponentDifference(
      'SOURCE_CLONE_INDEX_DIFFERENCE',
      'index',
      tableName,
      sourceTable.indexes.map((index) => [
        index.name,
        index.unique,
        index.origin,
        index.partial,
        index.columns,
      ]),
      cloneTable.indexes.map((index) => [
        index.name,
        index.unique,
        index.origin,
        index.partial,
        index.columns,
      ]),
      drafts,
    );
    addSchemaComponentDifference(
      'SOURCE_CLONE_CHECK_DIFFERENCE',
      'check constraint',
      tableName,
      [...sourceTable.checks].sort(),
      [...cloneTable.checks].sort(),
      drafts,
    );

    const sourceFks = normalizedForeignKeyKeys(sourceTable);
    const cloneFks = normalizedForeignKeyKeys(cloneTable);
    for (const key of [...sourceFks].filter((candidate) => !cloneFks.has(candidate)).sort()) {
      const [fkTable, fromColumns, parentTable] = key.split('|');
      const acceptedImportWaiver = waiverIdentities.has(
        waiverIdentity(
          fkTable,
          fromColumns.split(',').filter((column) => column.length > 0),
          parentTable,
        ),
      );
      drafts.push({
        code: 'SOURCE_CLONE_FK_DIFFERENCE',
        severity: acceptedImportWaiver ? 'info' : 'warning',
        status: acceptedImportWaiver
          ? 'accepted_import_compatibility'
          : 'open',
        table: tableName,
        summary: acceptedImportWaiver
          ? 'Source foreign key is omitted from the clone under a documented import-compatibility waiver.'
          : 'Foreign-key declaration exists in source schema but not clone schema.',
        evidence: {
          direction: 'missing_from_clone',
          foreignKey: key,
          importCompatibilityWaiver: acceptedImportWaiver,
        },
        stableKey: `missing:${key}`,
      });
    }
    for (const key of [...cloneFks].filter((candidate) => !sourceFks.has(candidate)).sort()) {
      drafts.push({
        code: 'SOURCE_CLONE_FK_DIFFERENCE',
        severity: 'warning',
        table: tableName,
        summary: 'Foreign-key declaration exists in clone schema but not source schema.',
        evidence: { direction: 'extra_in_clone', foreignKey: key },
        stableKey: `extra:${key}`,
      });
    }
  }

  addSchemaComponentDifference(
    'SOURCE_CLONE_VIEW_DIFFERENCE',
    'view',
    'sqlite_schema:views',
    source.views.map((view) => [view.name, view.definitionSha256]),
    clone.views.map((view) => [view.name, view.definitionSha256]),
    drafts,
  );
  addSchemaComponentDifference(
    'SOURCE_CLONE_TRIGGER_DIFFERENCE',
    'trigger',
    'sqlite_schema:triggers',
    (source.triggers ?? []).map((trigger) => [
      trigger.name,
      trigger.tableName,
      trigger.definitionSha256,
    ]),
    (clone.triggers ?? []).map((trigger) => [
      trigger.name,
      trigger.tableName,
      trigger.definitionSha256,
    ]),
    drafts,
  );
}

function buildDomains(
  database: string,
  snapshot: SchemaSnapshotReport,
  billMismatchCounts: { billLineMismatchCount: number; dueMismatchCount: number },
  accountingImbalanceCount: number,
): ProductionBaselineDomains {
  const bills = tableByName(snapshot, 'bills');
  const invoiceItems = tableByName(snapshot, 'invoice_items');
  const payments = tableByName(snapshot, 'payments');
  const deposits = tableByName(snapshot, 'billing_deposits');
  const credits = tableByName(snapshot, 'billing_credit_notes');
  const commissions = tableByName(snapshot, 'doctor_commission_accruals');
  const ipd = tableByName(snapshot, 'ipd_ledger_entries');
  const stock = tableByName(snapshot, 'InventoryStock');
  const movements = tableByName(snapshot, 'InventoryStockTransaction');
  const empCash = tableByName(snapshot, 'emp_cash_transactions');
  const drawerCash = tableByName(snapshot, 'cash_drawer_movements');
  const vouchers = tableByName(snapshot, 'accounting_vouchers');
  const journalLines = tableByName(snapshot, 'accounting_journal_lines');

  const billAggregate = aggregateTable(database, bills, columnByName(bills, ['total']));
  const invoiceAggregate = aggregateActiveInvoiceItems(database, invoiceItems);
  const paymentAggregate = aggregateTable(
    database,
    payments,
    columnByName(payments, ['amount']),
  );
  const depositAggregate = aggregateTable(
    database,
    deposits,
    columnByName(deposits, ['amount']),
  );
  const creditAggregate = aggregateTable(
    database,
    credits,
    columnByName(credits, ['total_amount', 'amount']),
  );
  const commissionAggregate = aggregateTable(database, commissions);
  const payableAggregate = aggregateTable(
    database,
    commissions,
    columnByName(commissions, ['payable_commission_amount', 'commission_amount']),
  );
  const paidCommissionAggregate = aggregateTable(
    database,
    commissions,
    columnByName(commissions, ['paid_amount']),
  );
  const balanceCommissionAggregate = aggregateTable(
    database,
    commissions,
    columnByName(commissions, ['balance_amount']),
  );
  const ipdAggregate = aggregateTable(database, ipd);
  const ipdDebit = aggregateTable(
    database,
    ipd,
    columnByName(ipd, ['debit', 'debit_amount']),
  );
  const ipdCredit = aggregateTable(
    database,
    ipd,
    columnByName(ipd, ['credit', 'credit_amount']),
  );
  const stockAggregate = aggregateTable(
    database,
    stock,
    columnByName(stock, [
      'AvailableQuantity',
      'available_quantity',
      'CurrentStock',
      'current_stock',
      'Quantity',
      'quantity',
    ]),
  );
  const movementAggregate = aggregateStockMovements(database, movements);
  const empCashAggregate = aggregateTable(
    database,
    empCash,
    columnByName(empCash, ['amount']),
  );
  const drawerCashAggregate = aggregateTable(
    database,
    drawerCash,
    columnByName(drawerCash, ['amount']),
  );
  const voucherAggregate = aggregateTable(database, vouchers);
  const lineAggregate = aggregateTable(database, journalLines);
  const debitAggregate = aggregateTable(
    database,
    journalLines,
    columnByName(journalLines, ['debit', 'debit_amount']),
  );
  const creditLineAggregate = aggregateTable(
    database,
    journalLines,
    columnByName(journalLines, ['credit', 'credit_amount']),
  );

  return {
    billing: {
      billCount: billAggregate.count,
      invoiceItemCount: invoiceAggregate.count,
      billTotal: billAggregate.total,
      invoiceLineTotal: invoiceAggregate.total,
      billLineMismatchCount: billMismatchCounts.billLineMismatchCount,
      dueMismatchCount: billMismatchCounts.dueMismatchCount,
    },
    payments: {
      paymentCount: paymentAggregate.count,
      totalAmount: paymentAggregate.total,
    },
    deposits: {
      transactionCount: depositAggregate.count,
      totalAmount: depositAggregate.total,
    },
    refunds: {
      creditNoteCount: creditAggregate.count,
      totalAmount: creditAggregate.total,
    },
    commissions: {
      accrualCount: commissionAggregate.count,
      payableTotal: payableAggregate.total,
      paidTotal: paidCommissionAggregate.total,
      balanceTotal: balanceCommissionAggregate.total,
    },
    ipd: {
      ledgerEntryCount: ipdAggregate.count,
      debitTotal: ipdDebit.total,
      creditTotal: ipdCredit.total,
    },
    stock: {
      stockRowCount: stockAggregate.count,
      balanceTotal: stockAggregate.total,
      movementCount: movementAggregate.count,
      movementQuantityTotal: movementAggregate.total,
    },
    cash: {
      eventCount: empCashAggregate.count + drawerCashAggregate.count,
      totalAmount: empCashAggregate.total + drawerCashAggregate.total,
    },
    accounting: {
      voucherCount: voucherAggregate.count,
      lineCount: lineAggregate.count,
      debitTotal: debitAggregate.total,
      creditTotal: creditLineAggregate.total,
      imbalancedVoucherCount: accountingImbalanceCount,
    },
  };
}

function databaseSummary(snapshot: SchemaSnapshotReport): BaselineDatabaseSummary {
  return {
    databaseFile: snapshot.databaseFile,
    databaseSha256: snapshot.databaseSha256,
    tableCount: snapshot.tableCount,
    viewCount: snapshot.viewCount,
    triggerCount: snapshot.triggerCount,
    columnCount: snapshot.tables.reduce(
      (sum, table) => sum + table.columns.length,
      0,
    ),
    indexCount: snapshot.tables.reduce(
      (sum, table) => sum + table.indexes.length,
      0,
    ),
    foreignKeyCount: snapshot.tables.reduce(
      (sum, table) => sum + table.foreignKeys.length,
      0,
    ),
    checkCount: snapshot.tables.reduce(
      (sum, table) => sum + table.checks.length,
      0,
    ),
    totalRowCount: snapshot.totalRowCount,
    foreignKeyViolationCount: snapshot.foreignKeyViolationCount,
  };
}

function renderMarkdown(report: ProductionBaselineReport): string {
  const domains = report.domains;
  const openExceptions = report.exceptions.filter(
    (exception) => exception.status === 'open',
  ).length;
  const acceptedImportExceptions = report.exceptions.filter(
    (exception) => exception.status === 'accepted_import_compatibility',
  ).length;
  const cloneSummary = report.clone
    ? `| Clone rehearsal mirror | \`${report.clone.databaseFile}\` | ${report.clone.tableCount} | ${report.clone.totalRowCount} | ${report.clone.foreignKeyViolationCount} |`
    : '| Clone rehearsal mirror | Not supplied | — | — | — |';

  return `# P01 Production Baseline Reconciliation

**Task:** CDB-012 — Capture live schema and baseline reconciliation

**Generated:** ${report.createdAtUtc}

**Result:** Baseline captured; unresolved exceptions remain open for classification and migration planning.

## Source and clone roles

The source SQLite snapshot is the authority for exact legacy schema, foreign-key declarations, and source violations. The clone mirror is used for migration, backfill, aggregate, and reconciliation rehearsal. A clone import waiver is compatibility evidence only and is not authorization to omit future canonical production constraints.

| Role | File | Tables | Aggregate rows | FK violations under that schema |
|---|---|---:|---:|---:|
| Exact production-source snapshot | \`${report.source.databaseFile}\` | ${report.source.tableCount} | ${report.source.totalRowCount} | ${report.source.foreignKeyViolationCount} |
${cloneSummary}

Source SHA-256: \`${report.source.databaseSha256}\`

${report.clone ? `Clone SHA-256: \`${report.clone.databaseSha256}\`` : 'Clone SHA-256: not supplied'}

## Schema inventory

| Metric | Source | Clone |
|---|---:|---:|
| Tables | ${report.source.tableCount} | ${report.clone?.tableCount ?? '—'} |
| Columns | ${report.source.columnCount} | ${report.clone?.columnCount ?? '—'} |
| Indexes | ${report.source.indexCount} | ${report.clone?.indexCount ?? '—'} |
| Foreign-key rows | ${report.source.foreignKeyCount} | ${report.clone?.foreignKeyCount ?? '—'} |
| Check constraints | ${report.source.checkCount} | ${report.clone?.checkCount ?? '—'} |
| Views | ${report.source.viewCount} | ${report.clone?.viewCount ?? '—'} |
| Triggers | ${report.source.triggerCount} | ${report.clone?.triggerCount ?? '—'} |

Unexpected column, index, check, view, or trigger differences are emitted as open schema-drift exceptions. Documented FK import waivers are classified separately.

## Exception status

- Total exceptions: ${report.exceptionCount}
- Open exceptions: ${openExceptions}
- Accepted import-compatibility exceptions: ${acceptedImportExceptions}

Accepted import-compatibility status acknowledges the documented rehearsal import mechanism only. It is not authorization to omit future canonical production constraints.

## Migration drift

- Production migration table present: ${report.migrationDrift.migrationTablePresent}
- Production applied migration rows: ${report.migrationDrift.appliedMigrationCount}
- Repository SQL migration files: ${report.migrationDrift.repositoryMigrationCount}
- Duplicate applied migration names: ${report.migrationDrift.duplicateAppliedNames.length}
- Applied names absent from repository: ${report.migrationDrift.appliedNotInRepository.length}
- Repository names not recorded as applied: ${report.migrationDrift.repositoryNotApplied.length}

Applied-but-absent names:

${report.migrationDrift.appliedNotInRepository.length > 0
  ? report.migrationDrift.appliedNotInRepository.map((name) => `- \`${name}\``).join('\n')
  : '- None'}

Repository-not-applied names:

${report.migrationDrift.repositoryNotApplied.length > 0
  ? report.migrationDrift.repositoryNotApplied.map((name) => `- \`${name}\``).join('\n')
  : '- None'}

Migration drift is inventory evidence only. It does not authorize applying, deleting, renaming, or replaying a production migration.

## Domain aggregates

These are legacy source values in their stored representation. They have not been converted to canonical integer minor units, and they must not be treated as canonical posted-money totals.

| Domain | Primary count | Primary total | Secondary total |
|---|---:|---:|---:|
| Billing | ${domains.billing.billCount} bills / ${domains.billing.invoiceItemCount} lines | ${domains.billing.billTotal} | ${domains.billing.invoiceLineTotal} |
| Payments | ${domains.payments.paymentCount} | ${domains.payments.totalAmount} | 0 |
| Deposits | ${domains.deposits.transactionCount} | ${domains.deposits.totalAmount} | 0 |
| Credit/refund documents | ${domains.refunds.creditNoteCount} | ${domains.refunds.totalAmount} | 0 |
| Commission accruals | ${domains.commissions.accrualCount} | ${domains.commissions.payableTotal} | ${domains.commissions.balanceTotal} |
| IPD ledger | ${domains.ipd.ledgerEntryCount} | ${domains.ipd.debitTotal} | ${domains.ipd.creditTotal} |
| Stock | ${domains.stock.stockRowCount} balances / ${domains.stock.movementCount} movements | ${domains.stock.balanceTotal} | ${domains.stock.movementQuantityTotal} |
| Cash | ${domains.cash.eventCount} | ${domains.cash.totalAmount} | 0 |
| Accounting | ${domains.accounting.voucherCount} vouchers / ${domains.accounting.lineCount} lines | ${domains.accounting.debitTotal} | ${domains.accounting.creditTotal} |

## Reconciliation counters

- Bill-header versus active invoice-line mismatches: ${domains.billing.billLineMismatchCount}
- Bill due-cache mismatches under the legacy equation \`MAX(0, total - paid)\`: ${domains.billing.dueMismatchCount}
- Unbalanced accounting vouchers: ${domains.accounting.imbalancedVoucherCount}

A bill or due mismatch is evidence for investigation, not permission to rewrite the row. Legacy discounts, credits, deposits, cancellations, and route-specific semantics must be classified before backfill.

## Exception counts by code

${Object.entries(report.exceptionCountsByCode)
  .map(([code, count]) => `- \`${code}\`: ${count}`)
  .join('\n') || '- None'}

The row-level exception registry is stored in \`P01-exceptions.yaml\` using stable IDs. No names, phone numbers, diagnoses, clinical notes, prescription text, or free-text row content are included.
`;
}

function yamlScalar(value: string | number | boolean | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function renderExceptionsYaml(report: ProductionBaselineReport): string {
  const openCount = report.exceptions.filter(
    (exception) => exception.status === 'open',
  ).length;
  const acceptedImportCount = report.exceptions.filter(
    (exception) => exception.status === 'accepted_import_compatibility',
  ).length;
  const lines = [
    'version: 1',
    `generated_at: ${JSON.stringify(report.createdAtUtc)}`,
    `source_database: ${JSON.stringify(report.source.databaseFile)}`,
    `clone_database: ${report.clone ? JSON.stringify(report.clone.databaseFile) : 'null'}`,
    `exception_count: ${report.exceptionCount}`,
    `open_exception_count: ${openCount}`,
    `accepted_import_compatibility_count: ${acceptedImportCount}`,
    'migration_drift:',
    `  migration_table_present: ${report.migrationDrift.migrationTablePresent}`,
    `  applied_migration_count: ${report.migrationDrift.appliedMigrationCount}`,
    `  repository_migration_count: ${report.migrationDrift.repositoryMigrationCount}`,
    `  applied_not_in_repository: ${JSON.stringify(report.migrationDrift.appliedNotInRepository)}`,
    `  repository_not_applied: ${JSON.stringify(report.migrationDrift.repositoryNotApplied)}`,
    'exceptions:',
  ];
  if (report.exceptions.length === 0) {
    lines[lines.length - 1] = 'exceptions: []';
    return `${lines.join('\n')}\n`;
  }
  for (const exception of report.exceptions) {
    lines.push(`  - id: ${JSON.stringify(exception.id)}`);
    lines.push(`    code: ${JSON.stringify(exception.code)}`);
    lines.push(`    severity: ${exception.severity}`);
    lines.push(`    status: ${exception.status}`);
    lines.push(`    table: ${JSON.stringify(exception.table)}`);
    if (exception.rowId !== undefined) {
      lines.push(`    row_id: ${JSON.stringify(exception.rowId)}`);
    }
    lines.push(`    count: ${exception.count}`);
    lines.push(`    summary: ${JSON.stringify(exception.summary)}`);
    lines.push('    evidence:');
    const evidenceEntries = Object.entries(exception.evidence).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (evidenceEntries.length === 0) lines.push('      {}');
    else {
      for (const [key, value] of evidenceEntries) {
        lines.push(`      ${key}: ${yamlScalar(value)}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function writeProtected(path: string, content: string): void {
  if (existsSync(path)) throw new Error(`Refusing to overwrite existing evidence: ${path}`);
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

function loadOrCreateSnapshot(
  database: string,
  snapshotPath: string | undefined,
  now: (() => Date) | undefined,
): SchemaSnapshotReport {
  if (!snapshotPath) return snapshotSqliteSchema({ database, now });
  const resolvedSnapshot = resolve(snapshotPath);
  if (!existsSync(resolvedSnapshot)) {
    throw new Error(`Schema snapshot not found: ${resolvedSnapshot}`);
  }
  const parsed = JSON.parse(readFileSync(resolvedSnapshot, 'utf8')) as SchemaSnapshotReport;
  if (!parsed || !Array.isArray(parsed.tables) || typeof parsed.databaseSha256 !== 'string') {
    throw new Error(`Invalid schema snapshot: ${resolvedSnapshot}`);
  }
  const actualSha256 = createHash('sha256')
    .update(readFileSync(database))
    .digest('hex');
  if (actualSha256 !== parsed.databaseSha256) {
    throw new Error(
      `Schema snapshot checksum mismatch for ${basename(database)}: ${resolvedSnapshot}`,
    );
  }
  return parsed;
}

export function reconcileProductionBaseline(
  options: ReconcileProductionBaselineOptions,
): ProductionBaselineReport {
  const sourceDatabase = resolve(options.sourceDatabase);
  if (!existsSync(sourceDatabase)) {
    throw new Error(`Source SQLite database not found: ${sourceDatabase}`);
  }
  const cloneDatabase = options.cloneDatabase ? resolve(options.cloneDatabase) : undefined;
  if (cloneDatabase && !existsSync(cloneDatabase)) {
    throw new Error(`Clone SQLite database not found: ${cloneDatabase}`);
  }

  const sourceSnapshot = loadOrCreateSnapshot(
    sourceDatabase,
    options.sourceSnapshot,
    options.now,
  );
  const cloneSnapshot = cloneDatabase
    ? loadOrCreateSnapshot(cloneDatabase, options.cloneSnapshot, options.now)
    : undefined;
  const drafts: ExceptionDraft[] = [];

  addForeignKeyExceptions(sourceSnapshot, drafts);
  addCrossTenantExceptions(sourceDatabase, sourceSnapshot, drafts);
  addDuplicateReferenceExceptions(sourceDatabase, sourceSnapshot, drafts);
  addMoneyExceptions(sourceDatabase, sourceSnapshot, drafts);
  const billingMismatchCounts = addBillingExceptions(sourceDatabase, sourceSnapshot, drafts);
  addStockExceptions(sourceDatabase, sourceSnapshot, drafts);
  const accountingImbalanceCount = addAccountingExceptions(
    sourceDatabase,
    sourceSnapshot,
    drafts,
  );
  const migrationDrift = inspectMigrationDrift(
    sourceDatabase,
    sourceSnapshot,
    options.migrationDirectory,
    drafts,
  );
  const waiverIdentities = loadWaiverIdentities(options.waiverManifest);
  if (cloneSnapshot) {
    addSourceCloneExceptions(
      sourceSnapshot,
      cloneSnapshot,
      waiverIdentities,
      drafts,
    );
  }

  const exceptions = finalizeExceptions(drafts);
  const exceptionCountsByCode = Object.fromEntries(
    [...new Set(exceptions.map((exception) => exception.code))]
      .sort()
      .map((code) => [
        code,
        exceptions.filter((exception) => exception.code === code).length,
      ]),
  );
  const report: ProductionBaselineReport = {
    createdAtUtc: (options.now ?? (() => new Date()))().toISOString(),
    source: databaseSummary(sourceSnapshot),
    clone: cloneSnapshot ? databaseSummary(cloneSnapshot) : undefined,
    migrationDrift,
    domains: buildDomains(
      sourceDatabase,
      sourceSnapshot,
      billingMismatchCounts,
      accountingImbalanceCount,
    ),
    exceptionCount: exceptions.length,
    exceptionCountsByCode,
    exceptions,
  };

  if (options.output) {
    writeProtected(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.markdown) {
    writeProtected(resolve(options.markdown), renderMarkdown(report));
  }
  if (options.exceptions) {
    writeProtected(resolve(options.exceptions), renderExceptionsYaml(report));
  }
  return report;
}

interface CliOptions {
  sourceDatabase: string;
  cloneDatabase?: string;
  sourceSnapshot?: string;
  cloneSnapshot?: string;
  waiverManifest?: string;
  migrationDirectory?: string;
  output?: string;
  markdown?: string;
  exceptions?: string;
}

function parseCliArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--')) continue;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    values.set(key, value);
    index += 1;
  }
  const sourceDatabase = values.get('--source');
  if (!sourceDatabase) {
    throw new Error(
      'Required arguments: --source <sqlite> [--clone <sqlite>] [--source-snapshot <json>] [--clone-snapshot <json>] [--waiver-manifest <json>] [--migration-directory <dir>] [--output <json>] [--markdown <md>] [--exceptions <yaml>]',
    );
  }
  return {
    sourceDatabase,
    cloneDatabase: values.get('--clone'),
    sourceSnapshot: values.get('--source-snapshot'),
    cloneSnapshot: values.get('--clone-snapshot'),
    waiverManifest: values.get('--waiver-manifest'),
    migrationDirectory: values.get('--migration-directory'),
    output: values.get('--output'),
    markdown: values.get('--markdown'),
    exceptions: values.get('--exceptions'),
  };
}

function main(): void {
  try {
    const report = reconcileProductionBaseline(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(
      `${JSON.stringify(
        {
          sourceDatabase: basename(report.source.databaseFile),
          cloneDatabase: report.clone?.databaseFile ?? null,
          sourceTableCount: report.source.tableCount,
          sourceTotalRowCount: report.source.totalRowCount,
          exceptionCount: report.exceptionCount,
          exceptionCountsByCode: report.exceptionCountsByCode,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Baseline reconciliation failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
