export type InventoryIssueOperationStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'recovered';

export type InventoryIssueOperationListItem = {
  operationId: number;
  idempotencyKey: string;
  requestHash: string;
  status: InventoryIssueOperationStatus;
  consumptionId: number | null;
  issueNo: string | null;
  lastError: string | null;
  attemptNo: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InventoryIssueDiagnosticCode =
  | 'header_without_lines'
  | 'header_total_mismatch'
  | 'missing_stock_transaction'
  | 'missing_provisional_billing'
  | 'stale_processing_operation';

export type InventoryIssueDiagnosticItem = {
  issueCode: InventoryIssueDiagnosticCode;
  operationId: number | null;
  consumptionId: number | null;
  issueNo: string | null;
  detail: string;
  detectedAt: string;
};

type OperationRow = {
  operation_id: number;
  idempotency_key: string;
  request_hash: string;
  status: InventoryIssueOperationStatus;
  consumption_id: number | null;
  issue_no: string | null;
  last_error: string | null;
  attempt_no: number | string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type DiagnosticRow = {
  issue_code: InventoryIssueDiagnosticCode;
  operation_id: number | null;
  consumption_id: number | null;
  issue_no: string | null;
  detail: string;
  detected_at: string;
};

export async function listInventoryIssueOperations(
  db: D1Database,
  input: {
    tenantId: string;
    status: InventoryIssueOperationStatus | 'all';
    limit: number;
  },
): Promise<InventoryIssueOperationListItem[]> {
  const statusClause = input.status === 'all' ? '' : 'AND status = ?';
  const params = input.status === 'all'
    ? [input.tenantId, input.limit]
    : [input.tenantId, input.status, input.limit];
  const { results } = await db.prepare(`
    SELECT
      operation_id,
      idempotency_key,
      request_hash,
      status,
      consumption_id,
      issue_no,
      last_error,
      attempt_no,
      created_by,
      created_at,
      updated_at
    FROM inventory_issue_operation
    WHERE tenant_id = ?
      ${statusClause}
    ORDER BY updated_at DESC, operation_id DESC
    LIMIT ?
  `).bind(...params).all<OperationRow>();

  return (results ?? []).map((row) => ({
    operationId: Number(row.operation_id),
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    status: row.status,
    consumptionId: row.consumption_id == null ? null : Number(row.consumption_id),
    issueNo: row.issue_no ?? null,
    lastError: row.last_error ?? null,
    attemptNo: Number(row.attempt_no ?? 0),
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function listInventoryIssueDiagnostics(
  db: D1Database,
  input: { tenantId: string; limit: number },
): Promise<InventoryIssueDiagnosticItem[]> {
  const { results } = await db.prepare(`
    SELECT * FROM (
      SELECT
        'header_without_lines' AS issue_code,
        IO.operation_id AS operation_id,
        IC.ConsumptionId AS consumption_id,
        IC.ConsumptionNo AS issue_no,
        'Inventory issue header has no consumption lines' AS detail,
        CURRENT_TIMESTAMP AS detected_at
      FROM InventoryConsumption IC
      LEFT JOIN inventory_issue_operation IO
        ON IO.tenant_id = IC.tenant_id AND IO.consumption_id = IC.ConsumptionId
      WHERE IC.tenant_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM InventoryConsumptionItem ICI
          WHERE ICI.ConsumptionId = IC.ConsumptionId
        )

      UNION ALL

      SELECT
        'header_total_mismatch' AS issue_code,
        IO.operation_id AS operation_id,
        IC.ConsumptionId AS consumption_id,
        IC.ConsumptionNo AS issue_no,
        'Inventory issue header cost or charge total differs from its lines' AS detail,
        CURRENT_TIMESTAMP AS detected_at
      FROM InventoryConsumption IC
      LEFT JOIN inventory_issue_operation IO
        ON IO.tenant_id = IC.tenant_id AND IO.consumption_id = IC.ConsumptionId
      WHERE IC.tenant_id = ?
        AND EXISTS (SELECT 1 FROM InventoryConsumptionItem ICI WHERE ICI.ConsumptionId = IC.ConsumptionId)
        AND (
          ABS(COALESCE(IC.TotalCost, 0) - COALESCE((
            SELECT SUM(COALESCE(ICI.CostPrice, 0) * COALESCE(ICI.Quantity, 0))
            FROM InventoryConsumptionItem ICI
            WHERE ICI.ConsumptionId = IC.ConsumptionId
          ), 0)) > 0.000001
          OR ABS(COALESCE(IC.TotalCharge, 0) - COALESCE((
            SELECT SUM(COALESCE(ICI.ChargeAmount, 0))
            FROM InventoryConsumptionItem ICI
            WHERE ICI.ConsumptionId = IC.ConsumptionId
          ), 0)) > 0.000001
        )

      UNION ALL

      SELECT
        'missing_stock_transaction' AS issue_code,
        IO.operation_id AS operation_id,
        IC.ConsumptionId AS consumption_id,
        IC.ConsumptionNo AS issue_no,
        'Inventory issue line has no matching stock transaction' AS detail,
        CURRENT_TIMESTAMP AS detected_at
      FROM InventoryConsumptionItem ICI
      JOIN InventoryConsumption IC ON IC.ConsumptionId = ICI.ConsumptionId
      LEFT JOIN inventory_issue_operation IO
        ON IO.tenant_id = IC.tenant_id AND IO.consumption_id = IC.ConsumptionId
      WHERE IC.tenant_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM InventoryStockTransaction IST
          WHERE IST.tenant_id = IC.tenant_id
            AND IST.ReferenceId = IC.ConsumptionId
            AND IST.StockId = ICI.StockId
            AND IST.ItemId = ICI.ItemId
            AND COALESCE(IST.OutQuantity, 0) >= COALESCE(ICI.Quantity, 0)
        )

      UNION ALL

      SELECT
        'missing_provisional_billing' AS issue_code,
        IO.operation_id AS operation_id,
        IC.ConsumptionId AS consumption_id,
        IC.ConsumptionNo AS issue_no,
        'Chargeable inventory issue line has no provisional billing reference' AS detail,
        CURRENT_TIMESTAMP AS detected_at
      FROM InventoryConsumptionItem ICI
      JOIN InventoryConsumption IC ON IC.ConsumptionId = ICI.ConsumptionId
      LEFT JOIN inventory_issue_operation IO
        ON IO.tenant_id = IC.tenant_id AND IO.consumption_id = IC.ConsumptionId
      WHERE IC.tenant_id = ?
        AND COALESCE(ICI.IsChargeable, 0) = 1
        AND COALESCE(ICI.ChargeAmount, 0) > 0
        AND ICI.BillingReferenceId IS NULL

      UNION ALL

      SELECT
        'stale_processing_operation' AS issue_code,
        IO.operation_id AS operation_id,
        IO.consumption_id AS consumption_id,
        IO.issue_no AS issue_no,
        'Inventory issue operation has remained processing for more than 15 minutes' AS detail,
        CURRENT_TIMESTAMP AS detected_at
      FROM inventory_issue_operation IO
      WHERE IO.tenant_id = ?
        AND IO.status = 'processing'
        AND datetime(IO.updated_at) <= datetime('now', '-15 minutes')
    ) diagnostics
    ORDER BY detected_at DESC, operation_id DESC, consumption_id DESC
    LIMIT ?
  `).bind(
    input.tenantId,
    input.tenantId,
    input.tenantId,
    input.tenantId,
    input.tenantId,
    input.limit,
  ).all<DiagnosticRow>();

  return (results ?? []).map((row) => ({
    issueCode: row.issue_code,
    operationId: row.operation_id == null ? null : Number(row.operation_id),
    consumptionId: row.consumption_id == null ? null : Number(row.consumption_id),
    issueNo: row.issue_no ?? null,
    detail: row.detail,
    detectedAt: row.detected_at,
  }));
}
