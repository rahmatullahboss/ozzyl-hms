import { getDb } from '../db';
import type { Env } from '../types';

export const EXECUTIVE_INVENTORY_METRICS = [
  'inventory_stock_skus',
  'inventory_low_stock',
  'inventory_out_of_stock',
  'inventory_expiring_soon',
  'inventory_expired',
  'inventory_pending_purchase',
  'lab_tests_completed',
  'lab_reagent_consumed',
  'lab_reagent_stock_skus',
  'lab_reagent_low_stock',
  'lab_reagent_out_of_stock',
  'lab_reagent_expiring_soon',
  'lab_reagent_qc_issues',
  'unmapped_lab_tests',
  'consumption_exceptions',
  'radiology_exams_completed',
  'radiology_stock_skus',
  'radiology_low_stock',
  'radiology_out_of_stock',
  'radiology_expiring_soon',
  'radiology_issue_lines',
] as const;

export type ExecutiveInventoryMetric = typeof EXECUTIVE_INVENTORY_METRICS[number];
export type ExecutiveInventoryPage = { page: number; pageSize: number; offset: number };

export type ExecutiveInventoryDetailRow = {
  id?: string | number | null;
  occurred_at?: string | null;
  source_type?: string | null;
  source_label?: string | null;
  reference_no?: string | null;
  counter_name?: string | null;
  user_name?: string | null;
  amount?: number | string | null;
  status?: string | null;
  item_name?: string | null;
  item_code?: string | null;
  unit_name?: string | null;
  available_quantity?: number | string | null;
  reorder_level?: number | string | null;
  store_name?: string | null;
  batch_no?: string | null;
  expiry_date?: string | null;
  qc_status?: string | null;
  consumed_quantity?: number | string | null;
  service_names?: string | null;
  item_count?: number | string | null;
};

type SummaryRow = { total?: number | string | null };

export type ExecutiveInventoryBreakdown = {
  total: number;
  totalRows: number;
  sources: Array<{ label: string; amount: number; count: number }>;
  rows: ExecutiveInventoryDetailRow[];
};

const INVENTORY_METRIC_LABELS: Record<ExecutiveInventoryMetric, string> = {
  inventory_stock_skus: 'Active stock SKUs',
  inventory_low_stock: 'Low-stock SKUs',
  inventory_out_of_stock: 'Out-of-stock SKUs',
  inventory_expiring_soon: 'Expiring-soon lots',
  inventory_expired: 'Expired lots',
  inventory_pending_purchase: 'Pending purchase requests',
  lab_tests_completed: 'Completed laboratory tests',
  lab_reagent_consumed: 'Reagent SKUs used',
  lab_reagent_stock_skus: 'Available reagent SKUs',
  lab_reagent_low_stock: 'Low-stock reagents',
  lab_reagent_out_of_stock: 'Out-of-stock reagents',
  lab_reagent_expiring_soon: 'Reagent lots near expiry',
  lab_reagent_qc_issues: 'Reagent QC exceptions',
  unmapped_lab_tests: 'Unmapped completed lab tests',
  consumption_exceptions: 'Reagent consumption exceptions',
  radiology_exams_completed: 'Completed imaging exams',
  radiology_stock_skus: 'Available radiology stock',
  radiology_low_stock: 'Low-stock radiology items',
  radiology_out_of_stock: 'Out-of-stock radiology items',
  radiology_expiring_soon: 'Radiology lots near expiry',
  radiology_issue_lines: 'Radiology issue transactions',
};

export function isExecutiveInventoryMetric(value: string): value is ExecutiveInventoryMetric {
  return (EXECUTIVE_INVENTORY_METRICS as readonly string[]).includes(value);
}

function radiologyItemPredicate(): string {
  return `(
    LOWER(TRIM(COALESCE(I.ItemType, ''))) = 'radiology_consumable'
    OR LOWER(COALESCE(C.CategoryName, '')) LIKE '%radiology%'
    OR LOWER(COALESCE(C.CategoryName, '')) LIKE '%imaging%'
    OR LOWER(REPLACE(COALESCE(C.CategoryName, ''), '-', '')) LIKE '%xray%'
    OR LOWER(COALESCE(SC.SubCategoryName, '')) LIKE '%radiology%'
    OR LOWER(COALESCE(SC.SubCategoryName, '')) LIKE '%imaging%'
    OR LOWER(REPLACE(COALESCE(SC.SubCategoryName, ''), '-', '')) LIKE '%xray%'
  )`;
}

function radiologyStorePredicate(): string {
  return `(
    LOWER(COALESCE(ST.StoreName, '')) LIKE '%radiology%'
    OR LOWER(COALESCE(ST.StoreName, '')) LIKE '%imaging%'
    OR LOWER(REPLACE(COALESCE(ST.StoreName, ''), '-', '')) LIKE '%xray%'
  )`;
}

function itemDomainPredicate(domain: 'all' | 'lab' | 'radiology'): string {
  if (domain === 'lab') {
    return `LOWER(TRIM(COALESCE(I.ItemType, ''))) = 'lab_reagent'`;
  }
  if (domain === 'radiology') {
    return `(${radiologyItemPredicate()} OR ${radiologyStorePredicate()})`;
  }
  return '1 = 1';
}

function itemStockCte(domain: 'all' | 'lab' | 'radiology'): string {
  const scopedStockPredicate = itemDomainPredicate(domain);
  return `
    WITH item_stock AS (
      SELECT
        I.ItemId AS item_id,
        I.ItemName AS item_name,
        I.ItemCode AS item_code,
        COALESCE(NULLIF(TRIM(I.IssueUnit), ''), NULLIF(TRIM(U.UOMName), ''), 'unit') AS unit_name,
        COALESCE(NULLIF(I.ReOrderLevel, 0), NULLIF(I.MinStockQuantity, 0), 0) AS reorder_level,
        COALESCE(SUM(CASE WHEN COALESCE(S.IsActive, 1) = 1 AND ${scopedStockPredicate} THEN COALESCE(S.AvailableQuantity, 0) ELSE 0 END), 0) AS available_quantity,
        GROUP_CONCAT(DISTINCT CASE WHEN ${scopedStockPredicate} THEN NULLIF(TRIM(ST.StoreName), '') END) AS store_name,
        GROUP_CONCAT(DISTINCT CASE WHEN ${scopedStockPredicate} THEN NULLIF(TRIM(S.BatchNo), '') END) AS batch_no,
        MIN(CASE WHEN COALESCE(S.IsActive, 1) = 1 AND COALESCE(S.AvailableQuantity, 0) > 0 AND ${scopedStockPredicate} THEN S.ExpiryDate END) AS expiry_date,
        MAX(CASE WHEN ${scopedStockPredicate} THEN 1 ELSE 0 END) AS domain_match
      FROM InventoryItem I
      LEFT JOIN InventoryStock S ON S.ItemId = I.ItemId AND S.tenant_id = I.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = I.tenant_id
      LEFT JOIN InventoryItemCategory C ON C.ItemCategoryId = I.ItemCategoryId AND C.tenant_id = I.tenant_id
      LEFT JOIN InventoryItemSubCategory SC ON SC.SubCategoryId = I.SubCategoryId AND SC.tenant_id = I.tenant_id
      LEFT JOIN InventoryUnitOfMeasurement U ON U.UOMId = I.UOMId AND U.tenant_id = I.tenant_id
      WHERE I.tenant_id = ? AND COALESCE(I.IsActive, 1) = 1
      GROUP BY I.ItemId, I.ItemName, I.ItemCode, unit_name, reorder_level
    )
  `;
}

function itemStockCondition(metric: ExecutiveInventoryMetric): string {
  if (metric.endsWith('_stock_skus')) return 'available_quantity > 0';
  if (metric.endsWith('_low_stock')) return 'available_quantity > 0 AND reorder_level > 0 AND available_quantity <= reorder_level';
  return 'available_quantity <= 0';
}

function itemStockSummarySql(metric: ExecutiveInventoryMetric, domain: 'all' | 'lab' | 'radiology'): string {
  return `/* executive_inventory:${metric}:summary */
    ${itemStockCte(domain)}
    SELECT COUNT(*) AS total
    FROM item_stock
    WHERE domain_match = 1 AND ${itemStockCondition(metric)}
  `;
}

function itemStockDetailsSql(metric: ExecutiveInventoryMetric, domain: 'all' | 'lab' | 'radiology'): string {
  return `/* executive_inventory:${metric}:details */
    ${itemStockCte(domain)}
    SELECT
      'inventory-item-' || item_id AS id,
      date(?) AS occurred_at,
      'inventory_stock' AS source_type,
      item_name AS source_label,
      COALESCE(NULLIF(item_code, ''), 'ITEM-' || item_id) AS reference_no,
      available_quantity AS amount,
      CASE
        WHEN available_quantity <= 0 THEN 'out_of_stock'
        WHEN reorder_level > 0 AND available_quantity <= reorder_level THEN 'low_stock'
        ELSE 'available'
      END AS status,
      item_name,
      item_code,
      unit_name,
      available_quantity,
      reorder_level,
      store_name,
      batch_no,
      expiry_date,
      available_quantity AS item_count
    FROM item_stock
    WHERE domain_match = 1 AND ${itemStockCondition(metric)}
    ORDER BY available_quantity ASC, item_name ASC
    LIMIT ? OFFSET ?
  `;
}

function expiryDomainPredicate(domain: 'all' | 'lab' | 'radiology'): string {
  return itemDomainPredicate(domain);
}

function expirySummarySql(metric: ExecutiveInventoryMetric, domain: 'all' | 'lab' | 'radiology', expired: boolean): string {
  const dateCondition = expired
    ? `date(S.ExpiryDate) <= date(?)`
    : `date(S.ExpiryDate) > date(?) AND date(S.ExpiryDate) <= date(?, '+30 days')`;
  return `/* executive_inventory:${metric}:summary */
    SELECT COUNT(DISTINCT S.StockId) AS total
    FROM InventoryStock S
    JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
    LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
    LEFT JOIN InventoryItemCategory C ON C.ItemCategoryId = I.ItemCategoryId AND C.tenant_id = I.tenant_id
    LEFT JOIN InventoryItemSubCategory SC ON SC.SubCategoryId = I.SubCategoryId AND SC.tenant_id = I.tenant_id
    WHERE S.tenant_id = ?
      AND COALESCE(S.IsActive, 1) = 1
      AND COALESCE(I.IsActive, 1) = 1
      AND COALESCE(S.AvailableQuantity, 0) > 0
      AND S.ExpiryDate IS NOT NULL
      AND ${expiryDomainPredicate(domain)}
      AND ${dateCondition}
  `;
}

function expiryDetailsSql(metric: ExecutiveInventoryMetric, domain: 'all' | 'lab' | 'radiology', expired: boolean): string {
  const dateCondition = expired
    ? `date(S.ExpiryDate) <= date(?)`
    : `date(S.ExpiryDate) > date(?) AND date(S.ExpiryDate) <= date(?, '+30 days')`;
  return `/* executive_inventory:${metric}:details */
    SELECT
      'inventory-stock-' || S.StockId AS id,
      S.ExpiryDate AS occurred_at,
      'inventory_lot' AS source_type,
      I.ItemName AS source_label,
      COALESCE(NULLIF(I.ItemCode, ''), 'STOCK-' || S.StockId) AS reference_no,
      COALESCE(S.AvailableQuantity, 0) AS amount,
      '${expired ? 'expired' : 'expiring_soon'}' AS status,
      I.ItemName AS item_name,
      I.ItemCode AS item_code,
      COALESCE(NULLIF(TRIM(I.IssueUnit), ''), NULLIF(TRIM(U.UOMName), ''), 'unit') AS unit_name,
      COALESCE(S.AvailableQuantity, 0) AS available_quantity,
      COALESCE(NULLIF(I.ReOrderLevel, 0), NULLIF(I.MinStockQuantity, 0), 0) AS reorder_level,
      ST.StoreName AS store_name,
      S.BatchNo AS batch_no,
      S.ExpiryDate AS expiry_date,
      COALESCE(S.QCStatus, 'accepted') AS qc_status,
      COALESCE(S.AvailableQuantity, 0) AS item_count
    FROM InventoryStock S
    JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
    LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
    LEFT JOIN InventoryItemCategory C ON C.ItemCategoryId = I.ItemCategoryId AND C.tenant_id = I.tenant_id
    LEFT JOIN InventoryItemSubCategory SC ON SC.SubCategoryId = I.SubCategoryId AND SC.tenant_id = I.tenant_id
    LEFT JOIN InventoryUnitOfMeasurement U ON U.UOMId = I.UOMId AND U.tenant_id = I.tenant_id
    WHERE S.tenant_id = ?
      AND COALESCE(S.IsActive, 1) = 1
      AND COALESCE(I.IsActive, 1) = 1
      AND COALESCE(S.AvailableQuantity, 0) > 0
      AND S.ExpiryDate IS NOT NULL
      AND ${expiryDomainPredicate(domain)}
      AND ${dateCondition}
    ORDER BY date(S.ExpiryDate) ASC, I.ItemName ASC
    LIMIT ? OFFSET ?
  `;
}

function summarySpec(metric: ExecutiveInventoryMetric, startDate: string, endDate: string): { sql: string; params: unknown[] } {
  switch (metric) {
    case 'inventory_stock_skus':
    case 'inventory_low_stock':
    case 'inventory_out_of_stock':
      return { sql: itemStockSummarySql(metric, 'all'), params: [] };
    case 'lab_reagent_stock_skus':
    case 'lab_reagent_low_stock':
    case 'lab_reagent_out_of_stock':
      return { sql: itemStockSummarySql(metric, 'lab'), params: [] };
    case 'radiology_stock_skus':
    case 'radiology_low_stock':
    case 'radiology_out_of_stock':
      return { sql: itemStockSummarySql(metric, 'radiology'), params: [] };
    case 'inventory_expiring_soon':
      return { sql: expirySummarySql(metric, 'all', false), params: [endDate, endDate] };
    case 'inventory_expired':
      return { sql: expirySummarySql(metric, 'all', true), params: [endDate] };
    case 'lab_reagent_expiring_soon':
      return { sql: expirySummarySql(metric, 'lab', false), params: [endDate, endDate] };
    case 'radiology_expiring_soon':
      return { sql: expirySummarySql(metric, 'radiology', false), params: [endDate, endDate] };
    case 'inventory_pending_purchase':
      return {
        sql: `/* executive_inventory:${metric}:summary */
          SELECT COUNT(*) AS total FROM InventoryPurchaseRequest
          WHERE tenant_id = ? AND Status IN ('draft', 'submitted', 'approved')`,
        params: [],
      };
    case 'lab_tests_completed':
      return {
        sql: `/* executive_inventory:${metric}:summary */
          SELECT COUNT(*) AS total FROM lab_order_items
          WHERE tenant_id = ?
            AND (LOWER(COALESCE(status, '')) IN ('completed', 'resulted', 'verified')
              OR LOWER(COALESCE(result_status, '')) IN ('completed', 'resulted', 'verified', 'final'))
            AND date(COALESCE(verified_at, completed_at, updated_at)) >= date(?)
            AND date(COALESCE(verified_at, completed_at, updated_at)) <= date(?)`,
        params: [startDate, endDate],
      };
    case 'lab_reagent_consumed':
      return {
        sql: `/* executive_inventory:${metric}:summary */
          SELECT COUNT(*) AS total
          FROM (
            SELECT m.consumable_id
            FROM lab_consumable_movements m
            JOIN lab_consumables c ON c.id = m.consumable_id AND c.tenant_id = m.tenant_id
            WHERE m.tenant_id = ? AND COALESCE(c.is_active, 1) = 1
              AND date(m.created_at) >= date(?) AND date(m.created_at) <= date(?)
            GROUP BY m.consumable_id
            HAVING SUM(CASE
              WHEN LOWER(m.movement_type) = 'usage_out' THEN ABS(m.quantity)
              WHEN LOWER(m.movement_type) = 'return' THEN -ABS(m.quantity)
              ELSE 0 END) != 0
          ) consumed_reagents`,
        params: [startDate, endDate],
      };
    case 'unmapped_lab_tests':
      return {
        sql: `/* executive_inventory:${metric}:summary */
          SELECT COUNT(*) AS total
          FROM lab_order_items loi
          WHERE loi.tenant_id = ?
            AND LOWER(TRIM(COALESCE(loi.result_status, loi.status, ''))) IN ('completed', 'resulted', 'verified', 'final')
            AND date(COALESCE(loi.verified_at, loi.completed_at, loi.updated_at)) >= date(?)
            AND date(COALESCE(loi.verified_at, loi.completed_at, loi.updated_at)) <= date(?)
            AND NOT EXISTS (
              SELECT 1 FROM lab_test_consumable_map m
              WHERE m.tenant_id = loi.tenant_id AND m.lab_test_id = loi.lab_test_id
                AND COALESCE(m.is_active, 1) = 1 AND m.deleted_at IS NULL
            )`,
        params: [startDate, endDate],
      };
    case 'consumption_exceptions':
      return {
        sql: `/* executive_inventory:${metric}:summary */
          WITH scope AS (SELECT ? AS tenant_id),
          completed AS (
            SELECT loi.lab_test_id, COUNT(*) AS completed_count
            FROM lab_order_items loi
            WHERE loi.tenant_id = (SELECT tenant_id FROM scope)
              AND LOWER(TRIM(COALESCE(loi.result_status, loi.status, ''))) IN ('completed', 'resulted', 'verified', 'final')
              AND date(COALESCE(loi.verified_at, loi.completed_at, loi.updated_at)) >= date(?)
              AND date(COALESCE(loi.verified_at, loi.completed_at, loi.updated_at)) <= date(?)
            GROUP BY loi.lab_test_id
          ), expected AS (
            SELECT m.consumable_id, SUM(c.completed_count * COALESCE(m.qty_per_test, 0)) AS expected_usage
            FROM completed c
            JOIN lab_test_consumable_map m ON m.lab_test_id = c.lab_test_id
              AND m.tenant_id = (SELECT tenant_id FROM scope)
              AND COALESCE(m.is_active, 1) = 1 AND m.deleted_at IS NULL
            GROUP BY m.consumable_id
          ), actual AS (
            SELECT consumable_id,
              SUM(CASE WHEN movement_type = 'usage_out' THEN ABS(quantity)
                WHEN movement_type = 'return' THEN -ABS(quantity) ELSE 0 END) AS actual_usage
            FROM lab_consumable_movements
            WHERE tenant_id = (SELECT tenant_id FROM scope)
              AND date(created_at) >= date(?) AND date(created_at) <= date(?)
            GROUP BY consumable_id
          )
          SELECT COUNT(*) AS total
          FROM expected e
          LEFT JOIN actual a ON a.consumable_id = e.consumable_id
          WHERE e.expected_usage > 0
            AND (COALESCE(a.actual_usage, 0) <= 0 OR COALESCE(a.actual_usage, 0) > e.expected_usage + 0.0001)`,
        params: [startDate, endDate, startDate, endDate],
      };
    case 'lab_reagent_qc_issues':
      return {
        sql: `/* executive_inventory:${metric}:summary */
          SELECT COUNT(DISTINCT s.id) AS total
          FROM lab_consumable_stock s
          JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id
          WHERE s.tenant_id = ? AND COALESCE(c.is_active, 1) = 1
            AND COALESCE(s.quantity_available, 0) > 0
            AND LOWER(COALESCE(s.qc_status, 'not_required')) IN ('pending', 'failed', 'rejected', 'quarantined')`,
        params: [],
      };
    case 'radiology_exams_completed':
      return {
        sql: `/* executive_inventory:${metric}:summary */
          SELECT COUNT(*) AS total FROM radiology_requisitions
          WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1
            AND LOWER(COALESCE(order_status, '')) IN ('reported', 'completed')
            AND date(COALESCE(updated_at, imaging_date, created_at)) >= date(?)
            AND date(COALESCE(updated_at, imaging_date, created_at)) <= date(?)`,
        params: [startDate, endDate],
      };
    case 'radiology_issue_lines':
      return {
        sql: `/* executive_inventory:${metric}:summary */
          SELECT COUNT(*) AS total
          FROM InventoryStockTransaction T
          JOIN InventoryItem I ON I.ItemId = T.ItemId AND I.tenant_id = T.tenant_id
          LEFT JOIN InventoryStock S ON S.StockId = T.StockId AND S.tenant_id = T.tenant_id
          LEFT JOIN InventoryStore ST ON ST.StoreId = COALESCE(T.StoreId, S.StoreId) AND ST.tenant_id = T.tenant_id
          LEFT JOIN InventoryItemCategory C ON C.ItemCategoryId = I.ItemCategoryId AND C.tenant_id = I.tenant_id
          LEFT JOIN InventoryItemSubCategory SC ON SC.SubCategoryId = I.SubCategoryId AND SC.tenant_id = I.tenant_id
          WHERE T.tenant_id = ? AND COALESCE(T.OutQuantity, 0) > 0
            AND ${itemDomainPredicate('radiology')}
            AND date(COALESCE(T.TransactionDate, T.CreatedOn)) >= date(?)
            AND date(COALESCE(T.TransactionDate, T.CreatedOn)) <= date(?)`,
        params: [startDate, endDate],
      };
  }
}

function detailSpec(metric: ExecutiveInventoryMetric, startDate: string, endDate: string, page: ExecutiveInventoryPage): { sql: string; params: unknown[] } {
  switch (metric) {
    case 'inventory_stock_skus':
    case 'inventory_low_stock':
    case 'inventory_out_of_stock':
      return { sql: itemStockDetailsSql(metric, 'all'), params: [endDate, page.pageSize, page.offset] };
    case 'lab_reagent_stock_skus':
    case 'lab_reagent_low_stock':
    case 'lab_reagent_out_of_stock':
      return { sql: itemStockDetailsSql(metric, 'lab'), params: [endDate, page.pageSize, page.offset] };
    case 'radiology_stock_skus':
    case 'radiology_low_stock':
    case 'radiology_out_of_stock':
      return { sql: itemStockDetailsSql(metric, 'radiology'), params: [endDate, page.pageSize, page.offset] };
    case 'inventory_expiring_soon':
      return { sql: expiryDetailsSql(metric, 'all', false), params: [endDate, endDate, page.pageSize, page.offset] };
    case 'inventory_expired':
      return { sql: expiryDetailsSql(metric, 'all', true), params: [endDate, page.pageSize, page.offset] };
    case 'lab_reagent_expiring_soon':
      return { sql: expiryDetailsSql(metric, 'lab', false), params: [endDate, endDate, page.pageSize, page.offset] };
    case 'radiology_expiring_soon':
      return { sql: expiryDetailsSql(metric, 'radiology', false), params: [endDate, endDate, page.pageSize, page.offset] };
    case 'inventory_pending_purchase':
      return {
        sql: `/* executive_inventory:${metric}:details */
          SELECT 'purchase-request-' || PurchaseRequestId AS id, PRDate AS occurred_at,
            'purchase_request' AS source_type, COALESCE(NULLIF(Department, ''), 'Purchase request') AS source_label,
            PRNumber AS reference_no, 1 AS amount, Status AS status, 1 AS item_count
          FROM InventoryPurchaseRequest
          WHERE tenant_id = ? AND Status IN ('draft', 'submitted', 'approved')
          ORDER BY PRDate DESC, PurchaseRequestId DESC LIMIT ? OFFSET ?`,
        params: [page.pageSize, page.offset],
      };
    case 'lab_tests_completed':
      return {
        sql: `/* executive_inventory:${metric}:details */
          SELECT 'lab-test-' || i.id AS id, COALESCE(i.verified_at, i.completed_at, i.updated_at) AS occurred_at,
            'lab_test' AS source_type, COALESCE(NULLIF(i.test_name, ''), t.name, 'Lab test') AS source_label,
            COALESCE(NULLIF(i.accession_no, ''), 'LAB-' || i.id) AS reference_no,
            1 AS amount, COALESCE(NULLIF(i.result_status, ''), i.status) AS status,
            COALESCE(NULLIF(i.test_name, ''), t.name, 'Lab test') AS service_names, 1 AS item_count
          FROM lab_order_items i
          LEFT JOIN lab_test_catalog t ON t.id = i.lab_test_id AND t.tenant_id = i.tenant_id
          WHERE i.tenant_id = ?
            AND (LOWER(COALESCE(i.status, '')) IN ('completed', 'resulted', 'verified')
              OR LOWER(COALESCE(i.result_status, '')) IN ('completed', 'resulted', 'verified', 'final'))
            AND date(COALESCE(i.verified_at, i.completed_at, i.updated_at)) >= date(?)
            AND date(COALESCE(i.verified_at, i.completed_at, i.updated_at)) <= date(?)
          ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
        params: [startDate, endDate, page.pageSize, page.offset],
      };
    case 'lab_reagent_consumed':
      return {
        sql: `/* executive_inventory:${metric}:details */
          SELECT 'reagent-consumption-' || c.id AS id, MAX(m.created_at) AS occurred_at,
            'lab_reagent_consumption' AS source_type, c.name AS source_label,
            COALESCE(NULLIF(c.code, ''), 'REAGENT-' || c.id) AS reference_no,
            COALESCE(SUM(CASE WHEN LOWER(m.movement_type) = 'usage_out' THEN ABS(m.quantity)
              WHEN LOWER(m.movement_type) = 'return' THEN -ABS(m.quantity) ELSE 0 END), 0) AS amount,
            'consumed' AS status, c.name AS item_name, c.code AS item_code, c.unit AS unit_name,
            COALESCE(SUM(CASE WHEN LOWER(m.movement_type) = 'usage_out' THEN ABS(m.quantity)
              WHEN LOWER(m.movement_type) = 'return' THEN -ABS(m.quantity) ELSE 0 END), 0) AS consumed_quantity,
            COALESCE(SUM(CASE WHEN LOWER(m.movement_type) = 'usage_out' THEN ABS(m.quantity)
              WHEN LOWER(m.movement_type) = 'return' THEN -ABS(m.quantity) ELSE 0 END), 0) AS item_count
          FROM lab_consumable_movements m
          JOIN lab_consumables c ON c.id = m.consumable_id AND c.tenant_id = m.tenant_id
          WHERE m.tenant_id = ? AND COALESCE(c.is_active, 1) = 1
            AND date(m.created_at) >= date(?) AND date(m.created_at) <= date(?)
          GROUP BY c.id, c.name, c.code, c.unit
          HAVING amount != 0
          ORDER BY amount DESC, c.name ASC LIMIT ? OFFSET ?`,
        params: [startDate, endDate, page.pageSize, page.offset],
      };
    case 'unmapped_lab_tests':
      return {
        sql: `/* executive_inventory:${metric}:details */
          SELECT 'unmapped-test-' || loi.id AS id,
            COALESCE(loi.verified_at, loi.completed_at, loi.updated_at) AS occurred_at,
            'unmapped_lab_test' AS source_type,
            COALESCE(NULLIF(TRIM(loi.test_name), ''), NULLIF(TRIM(lt.name), ''), 'Test #' || loi.lab_test_id) AS source_label,
            COALESCE(NULLIF(TRIM(loi.accession_no), ''), 'LAB-ITEM-' || loi.id) AS reference_no,
            1 AS amount, 'unmapped' AS status,
            COALESCE(NULLIF(TRIM(loi.test_name), ''), NULLIF(TRIM(lt.name), ''), 'Test #' || loi.lab_test_id) AS service_names,
            1 AS item_count
          FROM lab_order_items loi
          LEFT JOIN lab_test_catalog lt ON lt.id = loi.lab_test_id AND lt.tenant_id = loi.tenant_id
          WHERE loi.tenant_id = ?
            AND LOWER(TRIM(COALESCE(loi.result_status, loi.status, ''))) IN ('completed', 'resulted', 'verified', 'final')
            AND date(COALESCE(loi.verified_at, loi.completed_at, loi.updated_at)) >= date(?)
            AND date(COALESCE(loi.verified_at, loi.completed_at, loi.updated_at)) <= date(?)
            AND NOT EXISTS (
              SELECT 1 FROM lab_test_consumable_map m
              WHERE m.tenant_id = loi.tenant_id AND m.lab_test_id = loi.lab_test_id
                AND COALESCE(m.is_active, 1) = 1 AND m.deleted_at IS NULL
            )
          ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
        params: [startDate, endDate, page.pageSize, page.offset],
      };
    case 'consumption_exceptions':
      return {
        sql: `/* executive_inventory:${metric}:details */
          WITH scope AS (SELECT ? AS tenant_id),
          completed AS (
            SELECT loi.lab_test_id, COUNT(*) AS completed_count
            FROM lab_order_items loi
            WHERE loi.tenant_id = (SELECT tenant_id FROM scope)
              AND LOWER(TRIM(COALESCE(loi.result_status, loi.status, ''))) IN ('completed', 'resulted', 'verified', 'final')
              AND date(COALESCE(loi.verified_at, loi.completed_at, loi.updated_at)) >= date(?)
              AND date(COALESCE(loi.verified_at, loi.completed_at, loi.updated_at)) <= date(?)
            GROUP BY loi.lab_test_id
          ), expected AS (
            SELECT m.consumable_id, SUM(c.completed_count * COALESCE(m.qty_per_test, 0)) AS expected_usage
            FROM completed c JOIN lab_test_consumable_map m ON m.lab_test_id = c.lab_test_id
              AND m.tenant_id = (SELECT tenant_id FROM scope)
              AND COALESCE(m.is_active, 1) = 1 AND m.deleted_at IS NULL
            GROUP BY m.consumable_id
          ), actual AS (
            SELECT consumable_id,
              SUM(CASE WHEN movement_type = 'usage_out' THEN ABS(quantity)
                WHEN movement_type = 'return' THEN -ABS(quantity) ELSE 0 END) AS actual_usage
            FROM lab_consumable_movements
            WHERE tenant_id = (SELECT tenant_id FROM scope)
              AND date(created_at) >= date(?) AND date(created_at) <= date(?)
            GROUP BY consumable_id
          )
          SELECT 'consumption-exception-' || e.consumable_id AS id, date(?) AS occurred_at,
            'reagent_consumption_exception' AS source_type, c.name AS source_label,
            COALESCE(NULLIF(c.code, ''), 'REAGENT-' || c.id) AS reference_no,
            COALESCE(a.actual_usage, 0) - e.expected_usage AS amount,
            CASE WHEN COALESCE(a.actual_usage, 0) <= 0 THEN 'missing_consumption' ELSE 'over_consumption' END AS status,
            c.name AS item_name, c.code AS item_code, c.unit AS unit_name,
            e.expected_usage AS reorder_level, COALESCE(a.actual_usage, 0) AS consumed_quantity,
            1 AS item_count
          FROM expected e
          JOIN lab_consumables c ON c.id = e.consumable_id AND c.tenant_id = (SELECT tenant_id FROM scope)
          LEFT JOIN actual a ON a.consumable_id = e.consumable_id
          WHERE e.expected_usage > 0
            AND (COALESCE(a.actual_usage, 0) <= 0 OR COALESCE(a.actual_usage, 0) > e.expected_usage + 0.0001)
          ORDER BY ABS(amount) DESC, c.name ASC LIMIT ? OFFSET ?`,
        params: [startDate, endDate, startDate, endDate, endDate, page.pageSize, page.offset],
      };
    case 'lab_reagent_qc_issues':
      return {
        sql: `/* executive_inventory:${metric}:details */
          SELECT 'lab-qc-' || s.id AS id, COALESCE(s.received_date, s.created_at) AS occurred_at,
            'lab_reagent_qc' AS source_type, c.name AS source_label,
            COALESCE(NULLIF(s.lot_number, ''), NULLIF(c.code, ''), 'LAB-STOCK-' || s.id) AS reference_no,
            COALESCE(s.quantity_available, 0) AS amount, s.qc_status AS status,
            c.name AS item_name, c.code AS item_code, c.unit AS unit_name,
            COALESCE(s.quantity_available, 0) AS available_quantity, c.reorder_level AS reorder_level,
            s.lot_number AS batch_no, s.expiry_date AS expiry_date, s.qc_status AS qc_status,
            COALESCE(s.quantity_available, 0) AS item_count
          FROM lab_consumable_stock s
          JOIN lab_consumables c ON c.id = s.consumable_id AND c.tenant_id = s.tenant_id
          WHERE s.tenant_id = ? AND COALESCE(c.is_active, 1) = 1
            AND COALESCE(s.quantity_available, 0) > 0
            AND LOWER(COALESCE(s.qc_status, 'not_required')) IN ('pending', 'failed', 'rejected', 'quarantined')
          ORDER BY s.expiry_date ASC, c.name ASC LIMIT ? OFFSET ?`,
        params: [page.pageSize, page.offset],
      };
    case 'radiology_exams_completed':
      return {
        sql: `/* executive_inventory:${metric}:details */
          SELECT 'radiology-exam-' || r.id AS id, COALESCE(r.updated_at, r.imaging_date, r.created_at) AS occurred_at,
            'radiology_exam' AS source_type, COALESCE(NULLIF(r.imaging_item_name, ''), NULLIF(r.imaging_type_name, ''), 'Imaging exam') AS source_label,
            COALESCE(NULLIF(r.procedure_code, ''), 'RAD-' || r.id) AS reference_no,
            1 AS amount, r.order_status AS status,
            COALESCE(NULLIF(r.imaging_item_name, ''), NULLIF(r.imaging_type_name, ''), 'Imaging exam') AS service_names, 1 AS item_count
          FROM radiology_requisitions r
          WHERE r.tenant_id = ? AND COALESCE(r.is_active, 1) = 1
            AND LOWER(COALESCE(r.order_status, '')) IN ('reported', 'completed')
            AND date(COALESCE(r.updated_at, r.imaging_date, r.created_at)) >= date(?)
            AND date(COALESCE(r.updated_at, r.imaging_date, r.created_at)) <= date(?)
          ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
        params: [startDate, endDate, page.pageSize, page.offset],
      };
    case 'radiology_issue_lines':
      return {
        sql: `/* executive_inventory:${metric}:details */
          SELECT 'radiology-issue-' || T.TransactionId AS id, COALESCE(T.TransactionDate, T.CreatedOn) AS occurred_at,
            'radiology_stock_issue' AS source_type, I.ItemName AS source_label,
            COALESCE(NULLIF(T.ReferenceNo, ''), 'ISSUE-' || T.TransactionId) AS reference_no,
            COALESCE(T.OutQuantity, 0) AS amount, T.TransactionType AS status,
            I.ItemName AS item_name, I.ItemCode AS item_code,
            COALESCE(NULLIF(TRIM(I.IssueUnit), ''), NULLIF(TRIM(U.UOMName), ''), 'unit') AS unit_name,
            ST.StoreName AS store_name, S.BatchNo AS batch_no, S.ExpiryDate AS expiry_date,
            COALESCE(T.OutQuantity, 0) AS consumed_quantity, COALESCE(T.OutQuantity, 0) AS item_count
          FROM InventoryStockTransaction T
          JOIN InventoryItem I ON I.ItemId = T.ItemId AND I.tenant_id = T.tenant_id
          LEFT JOIN InventoryStock S ON S.StockId = T.StockId AND S.tenant_id = T.tenant_id
          LEFT JOIN InventoryStore ST ON ST.StoreId = COALESCE(T.StoreId, S.StoreId) AND ST.tenant_id = T.tenant_id
          LEFT JOIN InventoryItemCategory C ON C.ItemCategoryId = I.ItemCategoryId AND C.tenant_id = I.tenant_id
          LEFT JOIN InventoryItemSubCategory SC ON SC.SubCategoryId = I.SubCategoryId AND SC.tenant_id = I.tenant_id
          LEFT JOIN InventoryUnitOfMeasurement U ON U.UOMId = I.UOMId AND U.tenant_id = I.tenant_id
          WHERE T.tenant_id = ? AND COALESCE(T.OutQuantity, 0) > 0
            AND ${itemDomainPredicate('radiology')}
            AND date(COALESCE(T.TransactionDate, T.CreatedOn)) >= date(?)
            AND date(COALESCE(T.TransactionDate, T.CreatedOn)) <= date(?)
          ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
        params: [startDate, endDate, page.pageSize, page.offset],
      };
  }
}

function numericTotal(result: { results?: unknown[] } | undefined): number {
  const row = result?.results?.[0] as SummaryRow | undefined;
  const value = Number(row?.total ?? 0);
  return Number.isFinite(value) ? value : 0;
}

const INVENTORY_CORE_METRICS: ExecutiveInventoryMetric[] = [
  'inventory_stock_skus',
  'inventory_low_stock',
  'inventory_out_of_stock',
  'inventory_expiring_soon',
  'inventory_expired',
  'lab_reagent_stock_skus',
  'lab_reagent_low_stock',
  'lab_reagent_out_of_stock',
  'lab_reagent_expiring_soon',
  'radiology_stock_skus',
  'radiology_low_stock',
  'radiology_out_of_stock',
  'radiology_expiring_soon',
  'radiology_issue_lines',
];

const PURCHASE_WORKFLOW_METRICS: ExecutiveInventoryMetric[] = ['inventory_pending_purchase'];

const LAB_WORKFLOW_METRICS: ExecutiveInventoryMetric[] = [
  'lab_tests_completed',
  'lab_reagent_consumed',
  'lab_reagent_qc_issues',
  'unmapped_lab_tests',
  'consumption_exceptions',
];

const RADIOLOGY_WORKFLOW_METRICS: ExecutiveInventoryMetric[] = ['radiology_exams_completed'];

export async function getExecutiveInventoryKpiSummary(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  requestedMetrics: readonly ExecutiveInventoryMetric[] = EXECUTIVE_INVENTORY_METRICS,
): Promise<Record<ExecutiveInventoryMetric, number>> {
  const db = getDb(dbBinding);
  const values = Object.fromEntries(EXECUTIVE_INVENTORY_METRICS.map((metric) => [metric, 0])) as Record<ExecutiveInventoryMetric, number>;
  const requested = new Set(requestedMetrics);

  const runGroup = async (groupMetrics: ExecutiveInventoryMetric[], groupName: string) => {
    const metrics = groupMetrics.filter((metric) => requested.has(metric));
    if (metrics.length === 0) return;
    const statements = metrics.map((metric) => {
      const spec = summarySpec(metric, startDate, endDate);
      return db.$client.prepare(spec.sql).bind(tenantId, ...spec.params);
    });
    try {
      const results = await db.$client.batch(statements);
      metrics.forEach((metric, index) => {
        values[metric] = numericTotal(results[index]);
      });
    } catch (error) {
      console.error(`Executive ${groupName} KPI summary failed:`, error);
    }
  };

  await Promise.all([
    runGroup(INVENTORY_CORE_METRICS, 'inventory'),
    runGroup(PURCHASE_WORKFLOW_METRICS, 'purchase request'),
    runGroup(LAB_WORKFLOW_METRICS, 'laboratory'),
    runGroup(RADIOLOGY_WORKFLOW_METRICS, 'radiology'),
  ]);
  return values;
}

export async function getExecutiveInventoryKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  metric: ExecutiveInventoryMetric,
  startDate: string,
  endDate: string,
  page: ExecutiveInventoryPage,
  includeDetails = true,
): Promise<ExecutiveInventoryBreakdown> {
  const db = getDb(dbBinding);
  const summary = summarySpec(metric, startDate, endDate);
  const detail = includeDetails ? detailSpec(metric, startDate, endDate, page) : null;

  try {
    const results = await db.$client.batch([
      db.$client.prepare(summary.sql).bind(tenantId, ...summary.params),
      ...(detail ? [db.$client.prepare(detail.sql).bind(tenantId, ...detail.params)] : []),
    ]);
    const total = numericTotal(results[0]);
    const rows = (detail ? results[1]?.results : []) as ExecutiveInventoryDetailRow[] | undefined;
    return {
      total,
      totalRows: total,
      sources: total === 0 ? [] : [{ label: INVENTORY_METRIC_LABELS[metric], amount: total, count: total }],
      rows: rows ?? [],
    };
  } catch (error) {
    console.error(`Executive inventory KPI breakdown failed for ${metric}:`, error);
    return { total: 0, totalRows: 0, sources: [], rows: [] };
  }
}
