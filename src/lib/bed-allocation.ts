/**
 * Bed allocation helpers for IPD.
 *
 * Provides atomic, conditional-update primitives for the bed lifecycle so
 * concurrent admission, reservation, transfer, discharge and undo flows
 * cannot double-allocate the same bed. Each helper returns a
 * `BedAllocationResult` indicating success, conflict, or a not-found error.
 *
 * Owned by `fix/ipd-ot-nursing` (P0-25).
 */
import { HTTPException } from 'hono/http-exception';

export type BedStatus = 'available' | 'occupied' | 'maintenance' | 'reserved' | 'cleaning';

export type BedAllocationResult =
  | { kind: 'ok'; changes: number }
  | { kind: 'conflict' }
  | { kind: 'not_found' }
  | { kind: 'invalid_status' };

export interface DbExecutor {
  prepare(sql: string): {
    bind(...args: (string | number | null)[]): {
      run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number; duration: number } }>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta: object }>;
    };
  };
}

function throwConflict(message: string): never {
  throw new HTTPException(409, { message });
}

/**
 * Lock a bed as `occupied` for an admission. The update is conditional on
 * the bed currently being `available` (or already reserved for the same
 * patient by the caller). If the row is not updated, we treat it as a
 * 409 conflict so the caller surfaces the race to the user.
 */
export async function lockBedForAdmission(
  db: DbExecutor,
  input: { tenantId: string; bedId: number; admissionId: number },
): Promise<BedAllocationResult> {
  const upd = await db.prepare(
    `UPDATE beds
        SET status = 'occupied', admission_id = ?
      WHERE id = ? AND tenant_id = ? AND status = 'available'`,
  ).bind(input.admissionId, input.bedId, input.tenantId).run();

  if (upd.meta.changes > 0) {
    return { kind: 'ok', changes: upd.meta.changes };
  }

  const row = await db.prepare(
    'SELECT status FROM beds WHERE id = ? AND tenant_id = ?',
  ).bind(input.bedId, input.tenantId).first<{ status: string } | null>();

  if (!row) return { kind: 'not_found' };
  if (row.status === 'occupied') return { kind: 'conflict' };
  return { kind: 'invalid_status' };
}

export async function lockBedForTransfer(
  db: DbExecutor,
  input: { tenantId: string; newBedId: number },
): Promise<BedAllocationResult> {
  const upd = await db.prepare(
    `UPDATE beds
        SET status = 'occupied'
      WHERE id = ? AND tenant_id = ? AND status = 'available'`,
  ).bind(input.newBedId, input.tenantId).run();

  if (upd.meta.changes > 0) {
    return { kind: 'ok', changes: upd.meta.changes };
  }

  const row = await db.prepare(
    'SELECT status FROM beds WHERE id = ? AND tenant_id = ?',
  ).bind(input.newBedId, input.tenantId).first<{ status: string } | null>();
  if (!row) return { kind: 'not_found' };
  if (row.status === 'occupied') return { kind: 'conflict' };
  return { kind: 'invalid_status' };
}

export async function reserveBed(
  db: DbExecutor,
  input: { tenantId: string; bedId: number },
): Promise<BedAllocationResult> {
  const upd = await db.prepare(
    `UPDATE beds
        SET status = 'reserved'
      WHERE id = ? AND tenant_id = ? AND status = 'available'`,
  ).bind(input.bedId, input.tenantId).run();

  if (upd.meta.changes > 0) {
    return { kind: 'ok', changes: upd.meta.changes };
  }

  const row = await db.prepare(
    'SELECT status FROM beds WHERE id = ? AND tenant_id = ?',
  ).bind(input.bedId, input.tenantId).first<{ status: string } | null>();
  if (!row) return { kind: 'not_found' };
  if (row.status === 'reserved' || row.status === 'occupied') return { kind: 'conflict' };
  return { kind: 'invalid_status' };
}

export async function releaseBedToAvailable(
  db: DbExecutor,
  input: { tenantId: string; bedId: number; previousStatus?: BedStatus },
): Promise<BedAllocationResult> {
  // Only release if the bed is not currently occupied by another admission.
  // We treat `reserved` and `cleaning` as releasable; `occupied` is not.
  const targetStatus = input.previousStatus ?? 'available';
  const upd = await db.prepare(
    `UPDATE beds
        SET status = ?
      WHERE id = ? AND tenant_id = ? AND status != 'occupied'`,
  ).bind(targetStatus, input.bedId, input.tenantId).run();

  if (upd.meta.changes > 0) {
    return { kind: 'ok', changes: upd.meta.changes };
  }
  return { kind: 'conflict' };
}

export function assertBedAllocationOk(
  result: BedAllocationResult,
  bedLabel: string,
  context: 'admission' | 'reservation' | 'transfer' = 'admission',
): void {
  if (result.kind === 'ok') return;
  if (result.kind === 'not_found') {
    throw new HTTPException(404, { message: `${bedLabel} not found` });
  }
  if (result.kind === 'conflict') {
    throwConflict(
      `${bedLabel} is no longer available — another user has just locked it. ` +
        `Please retry the ${context} with a different bed.`,
    );
  }
  throw new HTTPException(409, {
    message: `${bedLabel} is not in a state that can be ${context === 'admission' ? 'admitted' : context === 'transfer' ? 'transferred' : 'reserved'}.`,
  });
}
