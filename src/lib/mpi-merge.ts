// ═══════════════════════════════════════════════════════════════════════════════
// Patient Merge Registry & Transactional Apply (P0-10)
// fix/portal-consent
//
// Provides:
//   - PATIENT_REFERENCE_REGISTRY: every tenant table that references patient_id
//   - previewMerge(): GET-side, returns a frozen diff + confirmation token
//   - applyMerge():  POST-side, runs all UPDATEs in a single Drizzle transaction
//                    gated by a confirmation token; idempotent by request_hash
//   - auditMerge():  append-only audit log row for every preview/apply/unmerge
//   - rollbackMerge(): reverses using patient_merge_map (record-level FK tracker)
// ═══════════════════════════════════════════════════════════════════════════════

import type { D1Database } from '@cloudflare/workers-types';
import {
  PATIENT_REFERENCE_REGISTRY,
  type PatientReferenceDefinition,
} from './patient-reference-registry';

export { PATIENT_REFERENCE_REGISTRY } from './patient-reference-registry';

export interface MergePreview {
  primary_patient_id: number;
  secondary_patient_id: number;
  rows_to_move: Array<{ table: string; column: string; count: number }>;
  total_rows_to_move: number;
  rows_retained: Array<{ table: string; column: string; count: number; reason: string }>;
  total_rows_retained: number;
  primary_snapshot: Record<string, unknown>;
  secondary_snapshot: Record<string, unknown>;
  /** SHA-256 of the canonical request body — idempotency key. */
  request_hash: string;
  /** Plaintext confirmation token; the SHA-256 of this is stored in DB. */
  confirmation_token: string;
  /** UTC ISO; reject after this. */
  expires_at: string;
}

export interface MergeApplyResult {
  merge_log_id: number;
  confirmation_id: number;
  request_hash: string;
  applied: true;
  rows_moved: Array<{ table: string; column: string; count: number }>;
  total_rows_moved: number;
  /** 'new' = freshly applied; 'replay' = returned existing applied merge. */
  outcome: 'new' | 'replay';
}

const PREVIEW_TTL_SECONDS = 600; // 10 minutes to confirm

/**
 * Compute SHA-256 hex of a string using Web Crypto.
 */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build a canonical, stable hash of a string using normalized merge input.
 */
export async function buildRequestHash(input: {
  tenant_id: string;
  primary_patient_id: number;
  secondary_patient_id: number;
  merge_reason: string;
}): Promise<string> {
  const canonical = JSON.stringify({
    t: input.tenant_id,
    p: input.primary_patient_id,
    s: input.secondary_patient_id,
    r: input.merge_reason.trim().toLowerCase(),
  });
  return sha256Hex(canonical);
}

async function generateOpaqueToken(): Promise<string> {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function tableHasColumn(
  db: D1Database,
  table: string,
  column: string,
): Promise<boolean> {
  try {
    const { results } = await db
      .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all<{ name: string }>();
    return (results ?? []).some((row) => row.name === column);
  } catch {
    return false;
  }
}

export interface RowCountEntry {
  table: string;
  column: string;
  tenant_column: string;
  count: number;
  row_ids: number[];
}

export interface RetainedReferenceCount {
  table: string;
  column: string;
  count: number;
  reason: string;
}

function accountingPredicate(
  reference: PatientReferenceDefinition,
  retainVerified: boolean,
): string {
  if (reference.policy !== 'retain_verified_accounting') return '';
  const table = quoteIdentifier(reference.table);
  return ` AND ${retainVerified ? '' : 'NOT '}EXISTS (
    SELECT 1 FROM accounting_vouchers voucher
    WHERE voucher.id = ${table}.voucher_id
      AND voucher.tenant_id = ${table}.${quoteIdentifier(reference.tenantColumn)}
      AND voucher.status = 'verified'
  )`;
}

async function selectReferenceIds(
  db: D1Database,
  reference: PatientReferenceDefinition,
  tenantId: string,
  patientId: number,
): Promise<number[]> {
  const table = quoteIdentifier(reference.table);
  const column = quoteIdentifier(reference.column);
  const tenantColumn = quoteIdentifier(reference.tenantColumn);
  const filter = accountingPredicate(reference, false);
  const { results } = await db.prepare(`
    SELECT id FROM ${table}
    WHERE ${column} = ? AND ${tenantColumn} = ?${filter}
  `).bind(patientId, tenantId).all<{ id: number }>();
  return (results ?? []).map((row) => Number(row.id)).filter(Number.isFinite);
}

/** Count exact rows that are eligible to move. */
export async function countReferenceRows(
  db: D1Database,
  tenantId: string,
  secondaryPatientId: number,
): Promise<RowCountEntry[]> {
  const result: RowCountEntry[] = [];
  for (const reference of PATIENT_REFERENCE_REGISTRY) {
    if (reference.policy === 'retain_immutable') continue;
    try {
      const rowIds = await selectReferenceIds(db, reference, tenantId, secondaryPatientId);
      if (rowIds.length === 0) continue;
      result.push({
        table: reference.table,
        column: reference.column,
        tenant_column: reference.tenantColumn,
        count: rowIds.length,
        row_ids: rowIds,
      });
    } catch {
      // A tenant may be behind the current schema; absent tables are ignored.
    }
  }
  return result;
}

/** Count immutable or policy-retained rows that remain attached to the historical alias. */
export async function countRetainedReferenceRows(
  db: D1Database,
  tenantId: string,
  secondaryPatientId: number,
): Promise<RetainedReferenceCount[]> {
  const result: RetainedReferenceCount[] = [];
  for (const reference of PATIENT_REFERENCE_REGISTRY) {
    if (reference.policy === 'move') continue;
    const table = quoteIdentifier(reference.table);
    const column = quoteIdentifier(reference.column);
    const tenantColumn = quoteIdentifier(reference.tenantColumn);
    const filter = reference.policy === 'retain_verified_accounting'
      ? accountingPredicate(reference, true)
      : '';
    try {
      const row = await db.prepare(`
        SELECT COUNT(*) AS count FROM ${table}
        WHERE ${column} = ? AND ${tenantColumn} = ?${filter}
      `).bind(secondaryPatientId, tenantId).first<{ count: number }>();
      const count = Number(row?.count ?? 0);
      if (count === 0) continue;
      result.push({
        table: reference.table,
        column: reference.column,
        count,
        reason: reference.note ?? 'Retained by patient merge safety policy.',
      });
    } catch {
      // A tenant may be behind the current schema; absent tables are ignored.
    }
  }
  return result;
}

function assertMergeEligible(
  patient: Record<string, unknown>,
  label: 'Primary' | 'Secondary',
): void {
  const isInactive = patient.is_active != null && Number(patient.is_active) !== 1;
  const name = String(patient.name ?? '');
  const mobile = String(patient.mobile ?? '');
  if (isInactive || name.includes('[MERGED→') || mobile.startsWith('MERGED-')) {
    throw new Error(`${label} patient is already inactive or merged`);
  }
}

export interface PreviewInput {
  tenantId: string;
  userId: number;
  primaryPatientId: number;
  secondaryPatientId: number;
  mergeReason: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 1: build a preview snapshot and persist a confirmation token.
 * The token must be supplied to applyMerge() to actually move rows.
 */
export async function previewMerge(
  db: D1Database,
  input: PreviewInput,
): Promise<MergePreview> {
  if (input.primaryPatientId === input.secondaryPatientId) {
    throw new Error('Cannot merge patient with itself');
  }
  const [primary, secondary] = await Promise.all([
    db.prepare('SELECT * FROM patients WHERE id = ? AND tenant_id = ?')
      .bind(input.primaryPatientId, input.tenantId).first(),
    db.prepare('SELECT * FROM patients WHERE id = ? AND tenant_id = ?')
      .bind(input.secondaryPatientId, input.tenantId).first(),
  ]);
  if (!primary) throw new Error(`Primary patient ${input.primaryPatientId} not found`);
  if (!secondary) throw new Error(`Secondary patient ${input.secondaryPatientId} not found`);
  assertMergeEligible(primary as Record<string, unknown>, 'Primary');
  assertMergeEligible(secondary as Record<string, unknown>, 'Secondary');

  const [counts, retainedRows] = await Promise.all([
    countReferenceRows(db, input.tenantId, input.secondaryPatientId),
    countRetainedReferenceRows(db, input.tenantId, input.secondaryPatientId),
  ]);
  const totalRows = counts.reduce((sum, row) => sum + row.count, 0);
  const totalRetainedRows = retainedRows.reduce((sum, row) => sum + row.count, 0);

  const requestHash = await buildRequestHash({
    tenant_id: input.tenantId,
    primary_patient_id: input.primaryPatientId,
    secondary_patient_id: input.secondaryPatientId,
    merge_reason: input.mergeReason,
  });

  const token = await generateOpaqueToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000).toISOString();

  // Persist a pending confirmation; UNIQUE(tenant_id, request_hash) gives
  // idempotency — re-running the same preview returns the existing row.
  await db.prepare(`
    INSERT INTO patient_merge_confirmation
      (tenant_id, confirmation_token_hash, request_hash, primary_patient_id,
       secondary_patient_id, payload_json, status, created_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(tenant_id, request_hash) DO UPDATE SET
      confirmation_token_hash = excluded.confirmation_token_hash,
      payload_json = excluded.payload_json,
      expires_at = excluded.expires_at
  `).bind(
    input.tenantId,
    tokenHash,
    requestHash,
    input.primaryPatientId,
    input.secondaryPatientId,
    JSON.stringify({
      primary: primary as Record<string, unknown>,
      secondary: secondary as Record<string, unknown>,
      rows_to_move: counts.map(({ table, column, count }) => ({ table, column, count })),
      rows_retained: retainedRows,
    }),
    input.userId,
    expiresAt,
  ).run();

  await auditMerge(db, {
    tenantId: input.tenantId,
    action: 'preview',
    primaryPatientId: input.primaryPatientId,
    secondaryPatientId: input.secondaryPatientId,
    confirmationTokenHash: tokenHash,
    payload: {
      rows_to_move: counts,
      total_rows_to_move: totalRows,
      rows_retained: retainedRows,
      total_rows_retained: totalRetainedRows,
      request_hash: requestHash,
    },
    actorUserId: input.userId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    primary_patient_id: input.primaryPatientId,
    secondary_patient_id: input.secondaryPatientId,
    rows_to_move: counts.map(({ table, column, count }) => ({ table, column, count })),
    total_rows_to_move: totalRows,
    rows_retained: retainedRows,
    total_rows_retained: totalRetainedRows,
    primary_snapshot: primary as Record<string, unknown>,
    secondary_snapshot: secondary as Record<string, unknown>,
    request_hash: requestHash,
    confirmation_token: token,
    expires_at: expiresAt,
  };
}

export interface ApplyInput {
  tenantId: string;
  userId: number;
  confirmationToken: string;
  ipAddress?: string;
  userAgent?: string;
}

function parseMovedRows(
  rowsMovedJson: string | null | undefined,
  tablesUpdated: string | null | undefined,
): MergeApplyResult['rows_moved'] {
  for (const raw of [rowsMovedJson, tablesUpdated]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((row): row is { table: string; column: string; count: number } =>
            Boolean(
              row
              && typeof row === 'object'
              && typeof (row as Record<string, unknown>).table === 'string'
              && typeof (row as Record<string, unknown>).column === 'string'
              && Number.isFinite(Number((row as Record<string, unknown>).count)),
            ),
          )
          .map((row) => ({ ...row, count: Number(row.count) }));
      }
      if (parsed && typeof parsed === 'object') {
        return Object.entries(parsed as Record<string, unknown>).map(([table, count]) => ({
          table,
          column: 'patient_id',
          count: Number(count ?? 0),
        }));
      }
    } catch {
      // Try the next legacy representation.
    }
  }
  return [];
}

/**
 * Phase 2: atomically record the merge, capture exact secondary-owned rows,
 * reassign movable references, mark the secondary patient, and apply the
 * confirmation. Replaying an applied confirmation returns the original result.
 */
export async function applyMerge(
  db: D1Database,
  input: ApplyInput,
): Promise<MergeApplyResult> {
  const tokenHash = await sha256Hex(input.confirmationToken);

  const confirmation = await db.prepare(`
    SELECT * FROM patient_merge_confirmation
    WHERE tenant_id = ? AND confirmation_token_hash = ?
  `).bind(input.tenantId, tokenHash).first<{
    id: number;
    request_hash: string;
    primary_patient_id: number;
    secondary_patient_id: number;
    status: string;
    applied_at: string | null;
    applied_merge_log_id: number | null;
    expires_at: string;
  }>();

  if (!confirmation) {
    await auditMerge(db, {
      tenantId: input.tenantId,
      action: 'apply_failed',
      confirmationTokenHash: tokenHash,
      actorUserId: input.userId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      payload: { error: 'invalid_confirmation_token' },
    });
    throw new Error('Invalid confirmation token');
  }

  if (confirmation.status === 'applied' && confirmation.applied_merge_log_id) {
    const replay = await db.prepare(
      'SELECT * FROM patient_merge_log WHERE id = ? AND tenant_id = ?',
    ).bind(confirmation.applied_merge_log_id, input.tenantId).first<{
      id: number;
      tables_updated: string | null;
      rows_moved_json: string | null;
    }>();
    const rowsMoved = parseMovedRows(replay?.rows_moved_json, replay?.tables_updated);
    await auditMerge(db, {
      tenantId: input.tenantId,
      action: 'idempotent_replay',
      mergeLogId: confirmation.applied_merge_log_id,
      primaryPatientId: confirmation.primary_patient_id,
      secondaryPatientId: confirmation.secondary_patient_id,
      confirmationTokenHash: tokenHash,
      actorUserId: input.userId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return {
      merge_log_id: confirmation.applied_merge_log_id,
      confirmation_id: confirmation.id,
      request_hash: confirmation.request_hash,
      applied: true,
      rows_moved: rowsMoved,
      total_rows_moved: rowsMoved.reduce((sum, row) => sum + row.count, 0),
      outcome: 'replay',
    };
  }

  if (confirmation.status !== 'pending') {
    throw new Error(`Confirmation status is ${confirmation.status}; cannot apply`);
  }
  if (new Date(confirmation.expires_at).getTime() < Date.now()) {
    await db.prepare(
      "UPDATE patient_merge_confirmation SET status='expired' WHERE id = ? AND status = 'pending'",
    ).bind(confirmation.id).run();
    throw new Error('Confirmation token expired; please re-run preview');
  }

  const activeAdmission = await db.prepare(`
    SELECT patient_id FROM admissions
    WHERE tenant_id = ? AND patient_id IN (?, ?)
      AND status = 'admitted' LIMIT 1
  `).bind(
    input.tenantId,
    confirmation.primary_patient_id,
    confirmation.secondary_patient_id,
  ).first<{ patient_id: number }>();
  if (activeAdmission) {
    throw new Error(
      `Patient #${activeAdmission.patient_id} has an active admission. Discharge first.`,
    );
  }

  const [primary, secondary] = await Promise.all([
    db.prepare('SELECT * FROM patients WHERE id = ? AND tenant_id = ?')
      .bind(confirmation.primary_patient_id, input.tenantId).first(),
    db.prepare('SELECT * FROM patients WHERE id = ? AND tenant_id = ?')
      .bind(confirmation.secondary_patient_id, input.tenantId).first(),
  ]);
  if (!primary) throw new Error(`Primary patient ${confirmation.primary_patient_id} not found`);
  if (!secondary) throw new Error(`Secondary patient ${confirmation.secondary_patient_id} not found`);
  assertMergeEligible(primary as Record<string, unknown>, 'Primary');
  assertMergeEligible(secondary as Record<string, unknown>, 'Secondary');

  const [counts, retainedRows] = await Promise.all([
    countReferenceRows(db, input.tenantId, confirmation.secondary_patient_id),
    countRetainedReferenceRows(db, input.tenantId, confirmation.secondary_patient_id),
  ]);
  const rowsMoved: MergeApplyResult['rows_moved'] = counts.map(
    ({ table, column, count }) => ({ table, column, count }),
  );
  const rowsMovedJson = JSON.stringify(rowsMoved);
  const statements: D1PreparedStatement[] = [];

  statements.push(
    db.prepare(`
      INSERT INTO patient_merge_log
        (tenant_id, primary_patient_id, merged_patient_id, merged_data,
         tables_updated, merge_reason, merged_by, confirmation_token_hash,
         request_hash, rows_moved_json, applied_by, applied_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
      WHERE EXISTS (
        SELECT 1 FROM patients
        WHERE tenant_id = ? AND id = ?
          AND COALESCE(is_active, 1) = 1
          AND name NOT LIKE '% [MERGED→%'
          AND COALESCE(mobile, '') NOT LIKE 'MERGED-%'
      )
        AND EXISTS (
          SELECT 1 FROM patients
          WHERE tenant_id = ? AND id = ?
            AND COALESCE(is_active, 1) = 1
            AND name NOT LIKE '% [MERGED→%'
            AND COALESCE(mobile, '') NOT LIKE 'MERGED-%'
        )
        AND NOT EXISTS (
        SELECT 1 FROM patient_merge_log
        WHERE tenant_id = ? AND request_hash = ?
      )
    `).bind(
      input.tenantId,
      confirmation.primary_patient_id,
      confirmation.secondary_patient_id,
      JSON.stringify(secondary),
      rowsMovedJson,
      'Confirmed duplicate patient merge',
      input.userId,
      tokenHash,
      confirmation.request_hash,
      rowsMovedJson,
      input.userId,
      input.tenantId,
      confirmation.primary_patient_id,
      input.tenantId,
      confirmation.secondary_patient_id,
      input.tenantId,
      confirmation.request_hash,
    ),
  );

  for (const entry of counts) {
    if (entry.count === 0) continue;
    const reference = PATIENT_REFERENCE_REGISTRY.find(
      (candidate) => candidate.table === entry.table && candidate.column === entry.column,
    );
    if (!reference || reference.policy === 'retain_immutable') continue;

    const table = quoteIdentifier(reference.table);
    const column = quoteIdentifier(reference.column);
    const tenantColumn = quoteIdentifier(reference.tenantColumn);
    const filter = accountingPredicate(reference, false);

    statements.push(
      db.prepare(`
        INSERT INTO patient_merge_record_map
          (merge_log_id, tenant_id, table_name, column_name, record_id,
           original_patient_id, target_patient_id)
        SELECT
          (SELECT id FROM patient_merge_log
           WHERE tenant_id = ? AND request_hash = ?
           ORDER BY id DESC LIMIT 1),
          ?, ?, ?, id, ?, ?
        FROM ${table}
        WHERE ${tenantColumn} = ? AND ${column} = ?${filter}
          AND EXISTS (
            SELECT 1 FROM patient_merge_log
            WHERE tenant_id = ? AND request_hash = ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM patient_merge_record_map existing
            WHERE existing.merge_log_id = (
              SELECT id FROM patient_merge_log
              WHERE tenant_id = ? AND request_hash = ?
              ORDER BY id DESC LIMIT 1
            )
              AND existing.table_name = ?
              AND COALESCE(existing.column_name, 'patient_id') = ?
              AND existing.record_id = ${table}.id
          )
      `).bind(
        input.tenantId,
        confirmation.request_hash,
        input.tenantId,
        reference.table,
        reference.column,
        confirmation.secondary_patient_id,
        confirmation.primary_patient_id,
        input.tenantId,
        confirmation.secondary_patient_id,
        input.tenantId,
        confirmation.request_hash,
        input.tenantId,
        confirmation.request_hash,
        reference.table,
        reference.column,
      ),
    );

    statements.push(
      db.prepare(`
        UPDATE ${table}
        SET ${column} = ?
        WHERE ${tenantColumn} = ? AND ${column} = ?${filter}
          AND EXISTS (
            SELECT 1 FROM patient_merge_log
            WHERE tenant_id = ? AND request_hash = ?
          )
      `).bind(
        confirmation.primary_patient_id,
        input.tenantId,
        confirmation.secondary_patient_id,
        input.tenantId,
        confirmation.request_hash,
      ),
    );
  }

  statements.push(
    db.prepare(`
      UPDATE patients
      SET name = CASE
            WHEN name LIKE '% [MERGED→%' THEN name
            ELSE name || ' [MERGED→' || ? || ']'
          END,
          mobile = CASE
            WHEN mobile LIKE 'MERGED-%' THEN mobile
            ELSE 'MERGED-' || COALESCE(mobile, '')
          END,
          is_active = 0,
          is_duplicate = 1,
          duplicate_of_patient_id = ?,
          global_identity_id = (
            SELECT global_identity_id FROM patients
            WHERE tenant_id = ? AND id = ?
          ),
          updated_at = datetime('now')
      WHERE tenant_id = ? AND id = ?
        AND EXISTS (
          SELECT 1 FROM patient_merge_log
          WHERE tenant_id = ? AND request_hash = ?
        )
    `).bind(
      confirmation.primary_patient_id,
      confirmation.primary_patient_id,
      input.tenantId,
      confirmation.primary_patient_id,
      input.tenantId,
      confirmation.secondary_patient_id,
      input.tenantId,
      confirmation.request_hash,
    ),
  );

  statements.push(
    db.prepare(`
      UPDATE patient_merge_log
      SET tables_updated = ?, rows_moved_json = ?
      WHERE tenant_id = ? AND request_hash = ?
    `).bind(
      rowsMovedJson,
      rowsMovedJson,
      input.tenantId,
      confirmation.request_hash,
    ),
  );

  statements.push(
    db.prepare(`
      UPDATE patient_merge_confirmation
      SET status = 'applied',
          applied_at = datetime('now'),
          applied_merge_log_id = (
            SELECT id FROM patient_merge_log
            WHERE tenant_id = ? AND request_hash = ?
            ORDER BY id DESC LIMIT 1
          )
      WHERE id = ? AND tenant_id = ? AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM patient_merge_log
          WHERE tenant_id = ? AND request_hash = ?
        )
    `).bind(
      input.tenantId,
      confirmation.request_hash,
      confirmation.id,
      input.tenantId,
      input.tenantId,
      confirmation.request_hash,
    ),
  );

  await db.batch(statements);

  const mergeLogRow = await db.prepare(`
    SELECT id FROM patient_merge_log
    WHERE tenant_id = ? AND request_hash = ?
    ORDER BY id DESC LIMIT 1
  `).bind(input.tenantId, confirmation.request_hash).first<{ id: number }>();
  const mergeLogId = Number(mergeLogRow?.id ?? 0);
  if (!mergeLogId) throw new Error('Merge log was not persisted');

  await auditMerge(db, {
    tenantId: input.tenantId,
    action: 'apply',
    mergeLogId,
    primaryPatientId: confirmation.primary_patient_id,
    secondaryPatientId: confirmation.secondary_patient_id,
    confirmationTokenHash: tokenHash,
    payload: {
      rows_moved: rowsMoved,
      total: rowsMoved.reduce((sum, row) => sum + row.count, 0),
      rows_retained: retainedRows,
      total_retained: retainedRows.reduce((sum, row) => sum + row.count, 0),
    },
    actorUserId: input.userId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    merge_log_id: mergeLogId,
    confirmation_id: confirmation.id,
    request_hash: confirmation.request_hash,
    applied: true,
    rows_moved: rowsMoved,
    total_rows_moved: rowsMoved.reduce((sum, row) => sum + row.count, 0),
    outcome: 'new',
  };
}

/**
 * Reverse a merge using the precise patient_merge_map records.
 * Falls back to timestamp-based rollback if the map is missing.
 */
export async function rollbackMerge(
  db: D1Database,
  tenantId: string,
  mergeLogId: number,
  userId: number,
  reason: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<{ tables_reverted: Record<string, number> }> {
  const mergeLog = await db.prepare(`
    SELECT * FROM patient_merge_log WHERE id = ? AND tenant_id = ?
  `).bind(mergeLogId, tenantId).first<{
    id: number;
    primary_patient_id: number;
    merged_patient_id: number;
    merged_data: string | null;
    tables_updated: string | null;
    merged_at: string | null;
    is_unmerged?: number | null;
  }>();
  if (!mergeLog) throw new Error('Merge log not found');

  const priorRollback = await db.prepare(`
    SELECT 1 FROM patient_merge_audit
    WHERE tenant_id = ? AND merge_log_id = ? AND action = 'rollback'
    LIMIT 1
  `).bind(tenantId, mergeLogId).first();
  if (mergeLog.is_unmerged === 1 || priorRollback) {
    throw new Error('Merge has already been reversed');
  }

  const snapshot = mergeLog.merged_data
    ? (JSON.parse(mergeLog.merged_data) as Record<string, unknown>)
    : {};
  const tablesReverted: Record<string, number> = {};

  type MergeMapRow = {
    table_name: string;
    column_name: string | null;
    record_id: number;
    original_patient_id: number;
    target_patient_id: number;
  };
  let mapRows: MergeMapRow[] = [];
  try {
    const mapped = await db.prepare(`
      SELECT table_name, column_name, record_id, original_patient_id, target_patient_id
      FROM patient_merge_record_map
      WHERE merge_log_id = ? AND tenant_id = ?
      ORDER BY id ASC
    `).bind(mergeLogId, tenantId).all<MergeMapRow>();
    mapRows = mapped.results ?? [];
  } catch {
    // Environments awaiting migration 0434 fall through to the legacy map.
  }
  if (mapRows.length === 0) {
    try {
      const legacy = await db.prepare(`
        SELECT table_name, 'patient_id' AS column_name, record_id,
               original_patient_id, target_patient_id
        FROM patient_merge_map
        WHERE merge_log_id = ? AND tenant_id = ?
        ORDER BY id ASC
      `).bind(mergeLogId, tenantId).all<MergeMapRow>();
      mapRows = legacy.results ?? [];
    } catch {
      // Very old environments may not have either record-map table.
    }
  }

  if (mapRows.length > 0) {
    for (const row of mapRows) {
      const columnName = row.column_name || 'patient_id';
      const reference = PATIENT_REFERENCE_REGISTRY.find(
        (candidate) => candidate.table === row.table_name && candidate.column === columnName,
      );
      if (!reference || reference.policy === 'retain_immutable') continue;
      const result = await db.prepare(`
        UPDATE ${quoteIdentifier(reference.table)}
        SET ${quoteIdentifier(reference.column)} = ?
        WHERE id = ? AND ${quoteIdentifier(reference.tenantColumn)} = ?
          AND ${quoteIdentifier(reference.column)} = ?
      `).bind(row.original_patient_id, row.record_id, tenantId, row.target_patient_id).run();
      if (Number(result.meta?.changes ?? 0) > 0) {
        tablesReverted[row.table_name] = (tablesReverted[row.table_name] ?? 0) + 1;
      }
    }
  } else {
    // Legacy best-effort fallback. Conditional/immutable policies are skipped because
    // they cannot be reconstructed safely without record-level map rows.
    const movedRows = parseMovedRows(mergeLog.tables_updated, mergeLog.tables_updated);
    const mergeCutoff = mergeLog.merged_at ?? new Date().toISOString();
    for (const moved of movedRows) {
      const reference = PATIENT_REFERENCE_REGISTRY.find(
        (candidate) => candidate.table === moved.table && candidate.column === moved.column,
      );
      if (!reference || reference.policy !== 'move') continue;
      if (!(await tableHasColumn(db, reference.table, 'created_at'))) continue;
      try {
        const result = await db.prepare(`
          UPDATE ${quoteIdentifier(reference.table)}
          SET ${quoteIdentifier(reference.column)} = ?
          WHERE ${quoteIdentifier(reference.column)} = ?
            AND ${quoteIdentifier(reference.tenantColumn)} = ?
            AND created_at < ?
        `).bind(
          mergeLog.merged_patient_id,
          mergeLog.primary_patient_id,
          tenantId,
          mergeCutoff,
        ).run();
        if (Number(result.meta?.changes ?? 0) > 0) {
          tablesReverted[reference.table] = Number(result.meta?.changes ?? 0);
        }
      } catch {
        // Legacy fallback is intentionally best-effort only.
      }
    }
  }

  await db.prepare(`
    UPDATE patients
    SET name = ?, mobile = ?, is_active = ?, is_duplicate = ?,
        duplicate_of_patient_id = ?, global_identity_id = ?,
        updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).bind(
    (snapshot.name as string | null | undefined) ?? 'Restored Patient',
    (snapshot.mobile as string | null | undefined) ?? null,
    Number(snapshot.is_active ?? 1),
    Number(snapshot.is_duplicate ?? 0),
    snapshot.duplicate_of_patient_id == null ? null : Number(snapshot.duplicate_of_patient_id),
    snapshot.global_identity_id == null ? null : Number(snapshot.global_identity_id),
    mergeLog.merged_patient_id,
    tenantId,
  ).run();

  if (await tableHasColumn(db, 'patient_merge_log', 'is_unmerged')) {
    await db.prepare(`
      UPDATE patient_merge_log
      SET is_unmerged = 1, unmerged_by = ?, unmerged_at = datetime('now'),
          unmerge_reason = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(userId, reason, mergeLogId, tenantId).run();
  }

  await auditMerge(db, {
    tenantId,
    action: 'rollback',
    mergeLogId,
    primaryPatientId: mergeLog.primary_patient_id,
    secondaryPatientId: mergeLog.merged_patient_id,
    payload: { tables_reverted: tablesReverted, reason },
    actorUserId: userId,
    ipAddress,
    userAgent,
  });

  return { tables_reverted: tablesReverted };
}

export interface MergeAuditInput {
  tenantId: string;
  action:
    | 'preview'
    | 'confirm'
    | 'apply'
    | 'apply_failed'
    | 'unmerge'
    | 'unmerge_failed'
    | 'rollback'
    | 'idempotent_replay';
  mergeLogId?: number;
  primaryPatientId?: number;
  secondaryPatientId?: number;
  confirmationTokenHash?: string;
  payload?: Record<string, unknown>;
  actorUserId?: number;
  ipAddress?: string;
  userAgent?: string;
}

export async function auditMerge(
  db: D1Database,
  input: MergeAuditInput,
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO patient_merge_audit
        (tenant_id, merge_log_id, action, primary_patient_id, secondary_patient_id,
         confirmation_token_hash, payload_json, result_json, actor_user_id,
         ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.mergeLogId ?? null,
      input.action,
      input.primaryPatientId ?? null,
      input.secondaryPatientId ?? null,
      input.confirmationTokenHash ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      null,
      input.actorUserId ?? null,
      input.ipAddress ?? null,
      (input.userAgent ?? null)?.slice(0, 256),
    ).run();
  } catch (err) {
    // Non-critical: log to console and continue.
    console.error('[mpi-merge] audit write failed:', err);
  }
}
