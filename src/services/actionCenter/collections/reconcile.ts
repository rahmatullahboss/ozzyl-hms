import type { D1Database, D1Result } from '@cloudflare/workers-types';
import { settleSourceTask } from '../tasks/service';
import { getLiveReceivable } from './liveSource';
import type {
  CollectionStatus,
  ReceivableFinancialStatus,
  ReceivableSourceRef,
} from './types';

interface CollectionCaseRow {
  id: number;
  status: string;
  updatedAtUtc: string;
}

function parseUtc(value: string): void {
  if (!value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new Error('Reconciliation time must be a valid UTC timestamp.');
  }
}

function sourceWhere(source: ReceivableSourceRef): {
  sql: string;
  binds: unknown[];
} {
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (source.canonicalInvoicePublicId) {
    conditions.push('canonical_invoice_public_id = ?');
    binds.push(source.canonicalInvoicePublicId);
  }
  if (source.legacyBillId !== undefined) {
    conditions.push('legacy_bill_id = ?');
    binds.push(source.legacyBillId);
  }

  return {
    sql: conditions.length === 2
      ? `(${conditions[0]} OR ${conditions[1]})`
      : conditions[0] ?? '0 = 1',
    binds,
  };
}

async function findCase(input: {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
}): Promise<CollectionCaseRow | null> {
  const where = sourceWhere(input.source);
  const canonicalId = input.source.canonicalInvoicePublicId ?? null;

  return input.db.prepare(`
    SELECT
      id,
      status,
      updated_at_utc AS "updatedAtUtc"
    FROM collection_cases
    WHERE tenant_id = ?
      AND ${where.sql}
    ORDER BY
      CASE
        WHEN ? IS NOT NULL AND canonical_invoice_public_id = ? THEN 0
        ELSE 1
      END,
      id ASC
    LIMIT 1
  `).bind(
    input.tenantId,
    ...where.binds,
    canonicalId,
    canonicalId,
  ).first<CollectionCaseRow>();
}

function closeEventType(status: ReceivableFinancialStatus):
  | 'auto_closed_paid'
  | 'auto_closed_cancelled'
  | 'auto_closed_reversed'
  | null {
  if (status === 'paid') return 'auto_closed_paid';
  if (status === 'cancelled') return 'auto_closed_cancelled';
  if (status === 'reversed') return 'auto_closed_reversed';
  return null;
}

function changes(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

async function synchronizeClosedTask(input: {
  db: D1Database;
  tenantId: string;
  caseId: number;
  financialStatus: ReceivableFinancialStatus;
  actorId?: number;
  nowUtc: string;
}): Promise<void> {
  if (input.actorId === undefined) return;

  const isPaid = input.financialStatus === 'paid';
  await settleSourceTask({
    db: input.db,
    tenantId: input.tenantId,
    sourceType: 'collection',
    sourcePublicId: `collection-case:${input.caseId}`,
    actorId: input.actorId,
    outcome: isPaid ? 'completed' : 'cancelled',
    note: isPaid
      ? 'Collection source paid.'
      : `Collection source ${input.financialStatus}.`,
    nowUtc: input.nowUtc,
  });
}

export async function reconcileCollectionCase(input: {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
  actorId?: number;
  nowUtc?: string;
}): Promise<'closed' | 'unchanged' | 'not_found'> {
  const nowUtc = input.nowUtc ?? new Date().toISOString();
  parseUtc(nowUtc);
  if (
    input.actorId !== undefined
    && (!Number.isSafeInteger(input.actorId) || input.actorId <= 0)
  ) {
    throw new Error('Reconciliation actor must be a positive integer.');
  }

  const live = await getLiveReceivable({
    db: input.db,
    tenantId: input.tenantId,
    source: input.source,
  });
  if (!live) return 'not_found';

  const current = await findCase({
    db: input.db,
    tenantId: input.tenantId,
    source: live.record.source,
  });
  if (!current) return 'unchanged';

  const eventType = closeEventType(live.record.financialStatus);
  if (!eventType && live.record.dueMinor > 0) return 'unchanged';
  const resolvedEventType = eventType ?? 'auto_closed_paid';
  const terminalStatus: ReceivableFinancialStatus = eventType
    ? live.record.financialStatus
    : 'paid';
  if (current.status === 'closed') {
    await synchronizeClosedTask({
      db: input.db,
      tenantId: input.tenantId,
      caseId: current.id,
      financialStatus: terminalStatus,
      actorId: input.actorId,
      nowUtc,
    });
    return 'unchanged';
  }
  const metadata = JSON.stringify({
    financialStatus: live.record.financialStatus,
    authorityMode: live.authorityMode,
    dueMinor: live.record.dueMinor,
    currencyCode: live.record.currencyCode,
  });

  const results = await input.db.batch([
    input.db.prepare(`
      UPDATE collection_cases
      SET canonical_invoice_public_id = COALESCE(canonical_invoice_public_id, ?),
          status = 'closed',
          next_followup_at_utc = NULL,
          closed_at_utc = ?,
          updated_at_utc = ?
      WHERE id = ?
        AND tenant_id = ?
        AND status = ?
        AND updated_at_utc = ?
    `).bind(
      live.record.source.canonicalInvoicePublicId ?? null,
      nowUtc,
      nowUtc,
      current.id,
      input.tenantId,
      current.status,
      current.updatedAtUtc,
    ),
    input.db.prepare(`
      INSERT INTO collection_case_events (
        tenant_id,
        case_id,
        event_type,
        actor_id,
        old_status,
        new_status,
        note,
        metadata_json,
        created_at_utc
      )
      SELECT ?, id, ?, ?, ?, 'closed', NULL, ?, ?
      FROM collection_cases
      WHERE id = ?
        AND tenant_id = ?
        AND status = 'closed'
        AND updated_at_utc = ?
        AND changes() = 1
    `).bind(
      input.tenantId,
      resolvedEventType,
      input.actorId ?? null,
      current.status as CollectionStatus,
      metadata,
      nowUtc,
      current.id,
      input.tenantId,
      nowUtc,
    ),
  ]);

  if (changes(results[0]) !== 1) return 'unchanged';

  await synchronizeClosedTask({
    db: input.db,
    tenantId: input.tenantId,
    caseId: current.id,
    financialStatus: terminalStatus,
    actorId: input.actorId,
    nowUtc,
  });
  return 'closed';
}
