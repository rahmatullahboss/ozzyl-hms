export type LabReagentReconciliationStatus = 'complete' | 'partial' | 'projection_missing' | 'mismatch';
export type LabReagentReconciliationSeverity = 'ok' | 'warning' | 'error';

export function classifyLabReagentReconciliation(input: {
  expectedQuantity: number;
  committedQuantity: number;
  projectedQuantity: number;
}): {
  status: LabReagentReconciliationStatus;
  severity: LabReagentReconciliationSeverity;
  issues: string[];
} {
  const expected = Number(input.expectedQuantity || 0);
  const committed = Number(input.committedQuantity || 0);
  const projected = Number(input.projectedQuantity || 0);
  const epsilon = 0.000001;
  const issues: string[] = [];

  if (committed > expected + epsilon) issues.push(`Canonical committed quantity ${committed} exceeds expected quantity ${expected}`);
  if (projected > committed + epsilon) issues.push(`Projected lab movement quantity ${projected} exceeds canonical committed quantity ${committed}`);
  if (issues.length > 0) return { status: 'mismatch', severity: 'error', issues };

  if (committed + epsilon < expected) {
    issues.push(`Expected quantity ${expected} but only ${committed} is canonically committed`);
    return { status: 'partial', severity: 'error', issues };
  }

  if (projected + epsilon < committed) {
    issues.push(`Canonical quantity ${committed} is committed but only ${projected} is projected to lab movements`);
    return { status: 'projection_missing', severity: 'warning', issues };
  }

  return { status: 'complete', severity: 'ok', issues: [] };
}

export interface LabReagentReconciliationRow {
  id: number;
  tenant_id: string;
  lab_order_id: number | null;
  lab_order_item_id: number;
  lab_test_id: number;
  consumable_id: number;
  inventory_item_id: number | null;
  consumable_name?: string | null;
  expected_quantity: number;
  committed_quantity: number;
  projected_quantity: number;
  progress_status: string;
  last_error?: string | null;
  updated_at?: string | null;
}

export async function listLabReagentReconciliation(
  db: D1Database,
  input: {
    tenantId: string;
    labOrderItemId?: number | null;
    status?: LabReagentReconciliationStatus | 'all';
    limit?: number;
  },
): Promise<Array<LabReagentReconciliationRow & ReturnType<typeof classifyLabReagentReconciliation>>> {
  const conditions = ['P.tenant_id = ?'];
  const params: unknown[] = [input.tenantId];
  if (input.labOrderItemId) {
    conditions.push('P.lab_order_item_id = ?');
    params.push(input.labOrderItemId);
  }
  const limit = Math.min(Math.max(Number(input.limit || 100), 1), 500);

  const rows = await db.prepare(`
    SELECT
      P.id, P.tenant_id, P.lab_order_id, P.lab_order_item_id, P.lab_test_id,
      P.consumable_id, P.inventory_item_id, C.name AS consumable_name,
      P.expected_quantity, P.committed_quantity, P.projected_quantity,
      P.status AS progress_status, P.last_error, P.updated_at
    FROM lab_consumable_mapping_progress P
    LEFT JOIN lab_consumables C ON C.id = P.consumable_id AND C.tenant_id = P.tenant_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY P.updated_at DESC, P.id DESC
    LIMIT ?
  `).bind(...params, limit).all<LabReagentReconciliationRow>();

  return (rows.results ?? [])
    .map((row) => ({
      ...row,
      ...classifyLabReagentReconciliation({
        expectedQuantity: Number(row.expected_quantity || 0),
        committedQuantity: Number(row.committed_quantity || 0),
        projectedQuantity: Number(row.projected_quantity || 0),
      }),
    }))
    .filter((row) => !input.status || input.status === 'all' || row.status === input.status);
}
