import { HTTPException } from 'hono/http-exception';

export type InventoryIssueOperationReservation =
  | { state: 'reserved'; attemptNo: number }
  | { state: 'replay'; responseBody: Record<string, unknown> };

type InventoryIssueOperationRow = {
  request_hash: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'recovered';
  response_json: string | null;
  attempt_no: number | string | null;
};

type ReconstructedIssueRow = {
  ConsumptionId: number;
  ConsumptionNo: string;
  TotalCost: number | string | null;
  TotalCharge: number | string | null;
  OperationKey: string | null;
  billed_lines: number | string | null;
};

function replayBody(body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, replayed: true };
}

async function reconstructCompletedResponse(
  db: D1Database,
  input: { tenantId: string; idempotencyKey: string },
): Promise<Record<string, unknown> | null> {
  const row = await db.prepare(`
    SELECT
      IC.ConsumptionId,
      IC.ConsumptionNo,
      IC.TotalCost,
      IC.TotalCharge,
      IC.OperationKey,
      (
        SELECT COUNT(*)
        FROM InventoryConsumptionItem ICI
        WHERE ICI.ConsumptionId = IC.ConsumptionId
          AND ICI.BillingReferenceId IS NOT NULL
      ) AS billed_lines
    FROM InventoryConsumption IC
    WHERE IC.tenant_id = ? AND IC.OperationKey = ?
    LIMIT 1
  `).bind(input.tenantId, input.idempotencyKey).first<ReconstructedIssueRow>();

  if (!row) return null;
  return {
    message: 'Inventory issue recorded',
    ConsumptionId: Number(row.ConsumptionId),
    IssueNo: row.ConsumptionNo,
    OperationKey: row.OperationKey ?? input.idempotencyKey,
    totalCost: Number(row.TotalCost ?? 0),
    totalCharge: Number(row.TotalCharge ?? 0),
    billedLines: Number(row.billed_lines ?? 0),
  };
}

async function loadOperation(
  db: D1Database,
  input: { tenantId: string; idempotencyKey: string },
): Promise<InventoryIssueOperationRow | null> {
  return db.prepare(`
    SELECT request_hash, status, response_json, attempt_no
    FROM inventory_issue_operation
    WHERE tenant_id = ? AND idempotency_key = ?
    LIMIT 1
  `).bind(input.tenantId, input.idempotencyKey).first<InventoryIssueOperationRow>();
}

export async function reserveInventoryIssueOperation(
  db: D1Database,
  input: { tenantId: string; idempotencyKey: string; requestHash: string; createdBy: string },
): Promise<InventoryIssueOperationReservation> {
  const inserted = await db.prepare(`
    INSERT OR IGNORE INTO inventory_issue_operation
      (tenant_id, idempotency_key, request_hash, status, attempt_no, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    input.tenantId,
    input.idempotencyKey,
    input.requestHash,
    input.createdBy,
  ).run();

  if (Number(inserted.meta?.changes ?? 0) > 0) {
    return { state: 'reserved', attemptNo: 1 };
  }

  const existing = await loadOperation(db, input);
  if (!existing) {
    throw new HTTPException(409, { message: 'Inventory issue operation could not be reserved. Please retry.' });
  }
  if (existing.request_hash !== input.requestHash) {
    throw new HTTPException(409, {
      message: 'This inventory issue idempotency key was already used with a different request.',
    });
  }

  if (existing.status === 'completed' || existing.status === 'recovered') {
    const stored = existing.response_json
      ? JSON.parse(existing.response_json) as Record<string, unknown>
      : await reconstructCompletedResponse(db, input);
    if (!stored) {
      throw new HTTPException(409, {
        message: 'The inventory issue operation is completed but its response could not be reconstructed.',
      });
    }
    return { state: 'replay', responseBody: replayBody(stored) };
  }

  if (existing.status === 'pending' || existing.status === 'processing') {
    const recovered = await reconstructCompletedResponse(db, input);
    if (recovered) {
      await db.prepare(`
        UPDATE inventory_issue_operation
        SET status = 'recovered',
            consumption_id = ?,
            issue_no = ?,
            response_json = ?,
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND idempotency_key = ?
          AND request_hash = ?
          AND status IN ('pending','processing')
      `).bind(
        Number(recovered.ConsumptionId),
        String(recovered.IssueNo),
        JSON.stringify(recovered),
        input.tenantId,
        input.idempotencyKey,
        input.requestHash,
      ).run();
      return { state: 'replay', responseBody: replayBody(recovered) };
    }
  }

  if (existing.status === 'failed') {
    const reopened = await db.prepare(`
      UPDATE inventory_issue_operation
      SET status = 'pending',
          attempt_no = attempt_no + 1,
          last_error = NULL,
          response_json = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND idempotency_key = ?
        AND request_hash = ?
        AND status = 'failed'
    `).bind(input.tenantId, input.idempotencyKey, input.requestHash).run();

    if (Number(reopened.meta?.changes ?? 0) === 1) {
      return { state: 'reserved', attemptNo: Number(existing.attempt_no ?? 1) + 1 };
    }
  }

  throw new HTTPException(409, {
    message: 'An inventory issue with this idempotency key is already being processed.',
  });
}

export async function markInventoryIssueOperationProcessing(
  db: D1Database,
  input: { tenantId: string; idempotencyKey: string; requestHash: string },
): Promise<void> {
  const result = await db.prepare(`
    UPDATE inventory_issue_operation
    SET status = 'processing', updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ?
      AND idempotency_key = ?
      AND request_hash = ?
      AND status = 'pending'
  `).bind(input.tenantId, input.idempotencyKey, input.requestHash).run();

  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new HTTPException(409, { message: 'Inventory issue operation is no longer available for processing.' });
  }
}

export async function completeInventoryIssueOperation(
  db: D1Database,
  input: {
    tenantId: string;
    idempotencyKey: string;
    requestHash: string;
    consumptionId: number;
    issueNo: string;
    responseBody: Record<string, unknown>;
  },
): Promise<void> {
  await db.prepare(`
    UPDATE inventory_issue_operation
    SET status = 'completed',
        consumption_id = ?,
        issue_no = ?,
        response_json = ?,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ?
      AND idempotency_key = ?
      AND request_hash = ?
  `).bind(
    input.consumptionId,
    input.issueNo,
    JSON.stringify(input.responseBody),
    input.tenantId,
    input.idempotencyKey,
    input.requestHash,
  ).run();
}

export async function failInventoryIssueOperation(
  db: D1Database,
  input: { tenantId: string; idempotencyKey: string; requestHash: string; error: string },
): Promise<void> {
  await db.prepare(`
    UPDATE inventory_issue_operation
    SET status = 'failed',
        last_error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ?
      AND idempotency_key = ?
      AND request_hash = ?
      AND status IN ('pending','processing')
  `).bind(
    input.error.slice(0, 1000),
    input.tenantId,
    input.idempotencyKey,
    input.requestHash,
  ).run();
}
