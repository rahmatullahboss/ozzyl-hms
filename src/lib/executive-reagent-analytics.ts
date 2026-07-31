import { getDb } from '../db';
import type { Env } from '../types';
import type { ExecutiveDashboardPeriod } from './executive-dashboard-period';

export type ReagentReconciliationStatus =
  | 'ok'
  | 'unmapped'
  | 'missing_consumption'
  | 'over_consumption'
  | 'low_stock'
  | 'out_of_stock'
  | 'qc_blocked';

export interface ReagentReconciliationRow {
  consumableId: number;
  reagentCode: string | null;
  reagentName: string;
  unit: string;
  completedTests: number;
  expectedUsage: number;
  actualUsage: number;
  returnedQuantity: number;
  variance: number;
  currentStock: number;
  reorderLevel: number;
  status: ReagentReconciliationStatus;
}

export interface ReagentReconciliationResponse {
  period: ExecutiveDashboardPeriod;
  rows: ReagentReconciliationRow[];
  exceptions: {
    unmappedCompletedTests: number;
    consumptionExceptions: number;
    unmappedTests: Array<{ testId: number; testName: string; completedTests: number }>;
  };
  quantityTotals: Array<{ unit: string; quantity: number }>;
  availability: { mapping: boolean; movements: boolean; stock: boolean };
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

type ExpectedRow = {
  consumable_id?: number | string | null;
  reagent_code?: string | null;
  reagent_name?: string | null;
  unit?: string | null;
  completed_tests?: number | string | null;
  expected_usage?: number | string | null;
  reorder_level?: number | string | null;
};

type MovementRow = {
  consumable_id?: number | string | null;
  usage_out?: number | string | null;
  returned_quantity?: number | string | null;
};

type StockRow = {
  consumable_id?: number | string | null;
  current_stock?: number | string | null;
  qc_blocked_lots?: number | string | null;
};

type UnmappedRow = {
  test_id?: number | string | null;
  test_name?: string | null;
  completed_tests?: number | string | null;
};

function roundQuantity(value: unknown): number {
  return Math.round(Number(value ?? 0) * 10000) / 10000;
}

function wholeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function localDateSql(expression: string): string {
  const value = expression.includes(',') ? `COALESCE(${expression})` : expression;
  return `CASE
    WHEN ${value} IS NULL THEN NULL
    WHEN ${value} LIKE '%Z' OR ${value} LIKE '%+00:00' OR ${value} LIKE '%-00:00'
      THEN date(${value}, '+6 hours')
    ELSE date(${value})
  END`;
}

function expectedSql(): string {
  return `/* executive_reagent:expected */
    SELECT
      c.id AS consumable_id,
      NULLIF(TRIM(c.code), '') AS reagent_code,
      COALESCE(NULLIF(TRIM(c.name), ''), 'Consumable #' || c.id) AS reagent_name,
      COALESCE(NULLIF(TRIM(c.unit), ''), 'unit') AS unit,
      COUNT(DISTINCT loi.id) AS completed_tests,
      ROUND(SUM(COALESCE(m.qty_per_test, 0)), 4) AS expected_usage,
      COALESCE(c.reorder_level, 0) AS reorder_level
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
    JOIN lab_test_consumable_map m
      ON m.lab_test_id = loi.lab_test_id
      AND m.tenant_id = loi.tenant_id
      AND COALESCE(m.is_active, 1) = 1
      AND m.deleted_at IS NULL
      AND (m.effective_from IS NULL OR date(m.effective_from) <= date(COALESCE(loi.verified_at, loi.completed_at, loi.updated_at)))
      AND (m.effective_to IS NULL OR date(m.effective_to) >= date(COALESCE(loi.verified_at, loi.completed_at, loi.updated_at)))
    JOIN lab_consumables c ON c.id = m.consumable_id AND c.tenant_id = m.tenant_id
    WHERE loi.tenant_id = ?
      AND LOWER(TRIM(COALESCE(loi.result_status, loi.status, ''))) IN ('completed', 'resulted', 'verified', 'final')
      AND ${localDateSql('loi.verified_at, loi.completed_at, loi.updated_at')} >= date(?)
      AND ${localDateSql('loi.verified_at, loi.completed_at, loi.updated_at')} <= date(?)
      AND COALESCE(c.is_active, 1) = 1
    GROUP BY c.id, c.code, c.name, c.unit, c.reorder_level
    ORDER BY reagent_name ASC
  `;
}

function movementsSql(): string {
  return `/* executive_reagent:movements */
    SELECT
      consumable_id,
      ROUND(SUM(CASE WHEN movement_type = 'usage_out' THEN ABS(quantity) ELSE 0 END), 4) AS usage_out,
      ROUND(SUM(CASE WHEN movement_type = 'return' THEN ABS(quantity) ELSE 0 END), 4) AS returned_quantity
    FROM lab_consumable_movements
    WHERE tenant_id = ?
      AND ${localDateSql('created_at')} >= date(?)
      AND ${localDateSql('created_at')} <= date(?)
      AND movement_type IN ('usage_out', 'return')
    GROUP BY consumable_id
  `;
}

function stockSql(): string {
  return `/* executive_reagent:stock */
    SELECT
      consumable_id,
      ROUND(SUM(CASE
        WHEN LOWER(TRIM(COALESCE(qc_status, 'not_required'))) IN ('failed', 'quarantined', 'rejected') THEN 0
        WHEN expiry_date IS NOT NULL AND date(expiry_date) < date(?) THEN 0
        ELSE MAX(0, COALESCE(quantity_available, 0))
      END), 4) AS current_stock,
      SUM(CASE
        WHEN LOWER(TRIM(COALESCE(qc_status, 'not_required'))) IN ('failed', 'quarantined', 'rejected') THEN 1
        ELSE 0
      END) AS qc_blocked_lots
    FROM lab_consumable_stock
    WHERE tenant_id = ?
    GROUP BY consumable_id
  `;
}

function unmappedSql(): string {
  return `/* executive_reagent:unmapped */
    SELECT
      loi.lab_test_id AS test_id,
      COALESCE(NULLIF(TRIM(loi.test_name), ''), NULLIF(TRIM(lt.name), ''), 'Test #' || loi.lab_test_id) AS test_name,
      COUNT(*) AS completed_tests
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
    LEFT JOIN lab_test_catalog lt ON lt.id = loi.lab_test_id AND lt.tenant_id = loi.tenant_id
    WHERE loi.tenant_id = ?
      AND LOWER(TRIM(COALESCE(loi.result_status, loi.status, ''))) IN ('completed', 'resulted', 'verified', 'final')
      AND ${localDateSql('loi.verified_at, loi.completed_at, loi.updated_at')} >= date(?)
      AND ${localDateSql('loi.verified_at, loi.completed_at, loi.updated_at')} <= date(?)
      AND NOT EXISTS (
        SELECT 1
        FROM lab_test_consumable_map m
        WHERE m.tenant_id = loi.tenant_id
          AND m.lab_test_id = loi.lab_test_id
          AND COALESCE(m.is_active, 1) = 1
          AND m.deleted_at IS NULL
      )
    GROUP BY loi.lab_test_id, test_name
    ORDER BY completed_tests DESC, test_name ASC
  `;
}

function isMissingOptionalTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('no such table') || message.includes('no such column');
}

async function optionalQuery<T>(
  query: () => Promise<{ results?: T[] }>,
): Promise<{ available: boolean; rows: T[] }> {
  try {
    const result = await query();
    return { available: true, rows: result.results || [] };
  } catch (error) {
    if (!isMissingOptionalTable(error)) throw error;
    return { available: false, rows: [] };
  }
}

function reconciliationStatus(args: {
  expected: number;
  actual: number;
  stock: number;
  reorderLevel: number;
  qcBlockedLots: number;
}): ReagentReconciliationStatus {
  if (args.qcBlockedLots > 0) return 'qc_blocked';
  if (args.stock <= 0) return 'out_of_stock';
  if (args.expected > 0 && args.actual <= 0) return 'missing_consumption';
  if (args.actual > args.expected + 0.0001) return 'over_consumption';
  if (args.stock <= args.reorderLevel) return 'low_stock';
  return 'ok';
}

export async function getReagentReconciliation(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  page?: number;
  pageSize?: number;
}): Promise<ReagentReconciliationResponse> {
  const db = getDb(args.dbBinding);
  const page = Math.max(1, Math.trunc(Number(args.page ?? 1)) || 1);
  const requestedPageSize = Math.trunc(Number(args.pageSize ?? 25)) || 25;
  const pageSize = [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 25;
  const bindPeriod = [args.tenantId, args.period.startDate, args.period.endDate] as const;

  const [expected, movements, stock, unmapped] = await Promise.all([
    optionalQuery<ExpectedRow>(() => db.$client.prepare(expectedSql()).bind(...bindPeriod).all<ExpectedRow>()),
    optionalQuery<MovementRow>(() => db.$client.prepare(movementsSql()).bind(...bindPeriod).all<MovementRow>()),
    optionalQuery<StockRow>(() => db.$client.prepare(stockSql()).bind(args.period.endDate, args.tenantId).all<StockRow>()),
    optionalQuery<UnmappedRow>(() => db.$client.prepare(unmappedSql()).bind(...bindPeriod).all<UnmappedRow>()),
  ]);

  const movementByConsumable = new Map(movements.rows.map((row) => [Number(row.consumable_id), row]));
  const stockByConsumable = new Map(stock.rows.map((row) => [Number(row.consumable_id), row]));
  const rows = expected.rows.map((row): ReagentReconciliationRow => {
    const consumableId = Number(row.consumable_id);
    const movement = movementByConsumable.get(consumableId);
    const stockRow = stockByConsumable.get(consumableId);
    const usageOut = roundQuantity(movement?.usage_out);
    const returnedQuantity = roundQuantity(movement?.returned_quantity);
    const actualUsage = roundQuantity(Math.max(0, usageOut - returnedQuantity));
    const expectedUsage = roundQuantity(row.expected_usage);
    const currentStock = roundQuantity(stockRow?.current_stock);
    const reorderLevel = roundQuantity(row.reorder_level);
    const qcBlockedLots = wholeNumber(stockRow?.qc_blocked_lots);
    return {
      consumableId,
      reagentCode: row.reagent_code ?? null,
      reagentName: String(row.reagent_name || `Consumable #${consumableId}`),
      unit: String(row.unit || 'unit'),
      completedTests: wholeNumber(row.completed_tests),
      expectedUsage,
      actualUsage,
      returnedQuantity,
      variance: roundQuantity(actualUsage - expectedUsage),
      currentStock,
      reorderLevel,
      status: reconciliationStatus({ expected: expectedUsage, actual: actualUsage, stock: currentStock, reorderLevel, qcBlockedLots }),
    };
  });

  const unmappedTests = unmapped.rows.map((row) => ({
    testId: Number(row.test_id),
    testName: String(row.test_name || `Test #${row.test_id}`),
    completedTests: wholeNumber(row.completed_tests),
  }));
  const quantityByUnit = new Map<string, number>();
  for (const row of rows) {
    quantityByUnit.set(row.unit, roundQuantity((quantityByUnit.get(row.unit) || 0) + row.actualUsage));
  }

  const totalRows = rows.length;
  const offset = (page - 1) * pageSize;

  return {
    period: args.period,
    rows: rows.slice(offset, offset + pageSize),
    exceptions: {
      unmappedCompletedTests: unmappedTests.reduce((sum, row) => sum + row.completedTests, 0),
      consumptionExceptions: rows.filter((row) => row.status !== 'ok').length,
      unmappedTests,
    },
    quantityTotals: Array.from(quantityByUnit.entries()).map(([unit, quantity]) => ({ unit, quantity })),
    availability: {
      mapping: expected.available && unmapped.available,
      movements: movements.available,
      stock: stock.available,
    },
    page,
    pageSize,
    totalRows,
    hasNextPage: offset + pageSize < totalRows,
  };
}
