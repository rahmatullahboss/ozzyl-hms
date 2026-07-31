import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from '@cloudflare/workers-types';
import { upsertSourceTask } from '../tasks/service';
import { getLiveReceivable } from './liveSource';
import type {
  CollectionStatus,
  ReceivableRecord,
  ReceivableSourceRef,
} from './types';

export type CollectionAction =
  | {
      action: 'contact';
      channel: 'phone' | 'sms' | 'whatsapp' | 'in_person' | 'other';
      outcome: string;
      note: string;
      nextFollowupAtUtc?: string;
    }
  | {
      action: 'follow_up';
      nextFollowupAtUtc: string;
      note?: string;
    }
  | {
      action: 'promise';
      promiseDate: string;
      promiseAmountMinor: number;
      currencyCode: string;
      note: string;
    }
  | {
      action: 'dispute';
      reason: string;
      note: string;
    }
  | {
      action: 'escalate';
      reason: string;
      note: string;
      assignedTo?: number;
    };

interface CollectionCaseStateRow {
  id: number;
  status: string;
  canonicalInvoicePublicId: string | null;
  legacyBillId: number | null;
  assignedTo: number | null;
  nextFollowupAtUtc: string | null;
  promiseDate: string | null;
  promiseAmountMinor: number | null;
  currencyCode: string | null;
  latestNote: string | null;
  lastContactedAtUtc: string | null;
  updatedAtUtc: string;
}

interface DesiredCaseState {
  status: CollectionStatus;
  assignedTo: number | null;
  nextFollowupAtUtc: string | null;
  promiseDate: string | null;
  promiseAmountMinor: number | null;
  currencyCode: string | null;
  latestNote: string | null;
  lastContactedAtUtc: string | null;
  eventType: string;
  eventNote: string | null;
  eventMetadata: Record<string, unknown>;
}

interface IdRow {
  id: number;
}

const MUTABLE_STATUSES = new Set<CollectionStatus>([
  'new',
  'contact_due',
  'contacted',
  'promised',
  'disputed',
  'escalated',
]);

export class CollectionTransitionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollectionTransitionValidationError';
  }
}

function requiredText(value: string | undefined, label: string): string {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new CollectionTransitionValidationError(`${label} is required.`);
  }
  return text;
}

function optionalText(value: string | undefined): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function validatePositiveId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CollectionTransitionValidationError(`${label} must be a positive integer.`);
  }
}

function parseUtc(value: string, label: string): number {
  if (!value.endsWith('Z')) {
    throw new CollectionTransitionValidationError(`${label} must be a UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new CollectionTransitionValidationError(`${label} must be a valid UTC timestamp.`);
  }
  return parsed;
}

function validateFutureUtc(value: string, nowUtc: string, label: string): void {
  if (parseUtc(value, label) <= parseUtc(nowUtc, 'Current time')) {
    throw new CollectionTransitionValidationError(`${label} must be in the future.`);
  }
}

function validatePromiseDate(value: string, nowUtc: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CollectionTransitionValidationError('Promise date must use YYYY-MM-DD.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new CollectionTransitionValidationError('Promise date is invalid.');
  }
  if (value < nowUtc.slice(0, 10)) {
    throw new CollectionTransitionValidationError('Promise date cannot be in the past.');
  }
}

function validateAction(action: CollectionAction, nowUtc: string): void {
  parseUtc(nowUtc, 'Current time');

  switch (action.action) {
    case 'contact':
      requiredText(action.outcome, 'Contact outcome');
      requiredText(action.note, 'Contact note');
      if (action.nextFollowupAtUtc) {
        validateFutureUtc(action.nextFollowupAtUtc, nowUtc, 'Next follow-up');
      }
      break;
    case 'follow_up':
      validateFutureUtc(action.nextFollowupAtUtc, nowUtc, 'Next follow-up');
      break;
    case 'promise':
      validatePromiseDate(action.promiseDate, nowUtc);
      if (!Number.isSafeInteger(action.promiseAmountMinor) || action.promiseAmountMinor <= 0) {
        throw new CollectionTransitionValidationError('Promise amount must be a positive safe integer.');
      }
      if (!/^[A-Z]{3}$/.test(action.currencyCode)) {
        throw new CollectionTransitionValidationError('Promise currency must be a three-letter uppercase code.');
      }
      requiredText(action.note, 'Promise note');
      break;
    case 'dispute':
      requiredText(action.reason, 'Dispute reason');
      requiredText(action.note, 'Dispute note');
      break;
    case 'escalate':
      requiredText(action.reason, 'Escalation reason');
      requiredText(action.note, 'Escalation note');
      if (action.assignedTo !== undefined) {
        validatePositiveId(action.assignedTo, 'Assignee');
      }
      break;
  }
}

async function validateAssignee(input: {
  db: D1Database;
  tenantId: string;
  assignedTo: number | undefined;
}): Promise<void> {
  if (input.assignedTo === undefined) return;

  const row = await input.db.prepare(`
    SELECT id
    FROM users
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(input.assignedTo, input.tenantId).first<IdRow>();
  if (!row) {
    throw new CollectionTransitionValidationError('A valid assignee from this tenant is required.');
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
}): Promise<CollectionCaseStateRow | null> {
  const where = sourceWhere(input.source);
  const canonicalId = input.source.canonicalInvoicePublicId ?? null;

  return input.db.prepare(`
    SELECT
      id,
      status,
      canonical_invoice_public_id AS "canonicalInvoicePublicId",
      legacy_bill_id AS "legacyBillId",
      assigned_to AS "assignedTo",
      next_followup_at_utc AS "nextFollowupAtUtc",
      promise_date AS "promiseDate",
      promise_amount_minor AS "promiseAmountMinor",
      currency_code AS "currencyCode",
      latest_note AS "latestNote",
      last_contacted_at_utc AS "lastContactedAtUtc",
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
  ).first<CollectionCaseStateRow>();
}

function desiredState(input: {
  current: CollectionCaseStateRow | null;
  action: CollectionAction;
  nowUtc: string;
}): DesiredCaseState {
  const current = input.current;
  const base = {
    assignedTo: current?.assignedTo ?? null,
    nextFollowupAtUtc: current?.nextFollowupAtUtc ?? null,
    promiseDate: current?.promiseDate ?? null,
    promiseAmountMinor: current?.promiseAmountMinor ?? null,
    currencyCode: current?.currencyCode ?? null,
    latestNote: current?.latestNote ?? null,
    lastContactedAtUtc: current?.lastContactedAtUtc ?? null,
  };

  switch (input.action.action) {
    case 'contact': {
      const note = requiredText(input.action.note, 'Contact note');
      return {
        ...base,
        status: 'contacted',
        nextFollowupAtUtc: input.action.nextFollowupAtUtc ?? null,
        latestNote: note,
        lastContactedAtUtc: input.nowUtc,
        eventType: 'contacted',
        eventNote: note,
        eventMetadata: {
          channel: input.action.channel,
          outcome: requiredText(input.action.outcome, 'Contact outcome'),
          ...(input.action.nextFollowupAtUtc
            ? { nextFollowupAtUtc: input.action.nextFollowupAtUtc }
            : {}),
        },
      };
    }
    case 'follow_up': {
      const note = optionalText(input.action.note);
      return {
        ...base,
        status: 'contact_due',
        nextFollowupAtUtc: input.action.nextFollowupAtUtc,
        latestNote: note ?? base.latestNote,
        eventType: 'follow_up_scheduled',
        eventNote: note,
        eventMetadata: { nextFollowupAtUtc: input.action.nextFollowupAtUtc },
      };
    }
    case 'promise': {
      const note = requiredText(input.action.note, 'Promise note');
      return {
        ...base,
        status: 'promised',
        promiseDate: input.action.promiseDate,
        promiseAmountMinor: input.action.promiseAmountMinor,
        currencyCode: input.action.currencyCode,
        latestNote: note,
        eventType: 'promise_recorded',
        eventNote: note,
        eventMetadata: {
          promiseDate: input.action.promiseDate,
          promiseAmountMinor: input.action.promiseAmountMinor,
          currencyCode: input.action.currencyCode,
        },
      };
    }
    case 'dispute': {
      const reason = requiredText(input.action.reason, 'Dispute reason');
      const note = requiredText(input.action.note, 'Dispute note');
      return {
        ...base,
        status: 'disputed',
        latestNote: note,
        eventType: 'disputed',
        eventNote: note,
        eventMetadata: { reason },
      };
    }
    case 'escalate': {
      const reason = requiredText(input.action.reason, 'Escalation reason');
      const note = requiredText(input.action.note, 'Escalation note');
      return {
        ...base,
        status: 'escalated',
        assignedTo: input.action.assignedTo ?? base.assignedTo,
        latestNote: note,
        eventType: 'escalated',
        eventNote: note,
        eventMetadata: {
          reason,
          ...(input.action.assignedTo !== undefined
            ? { assignedTo: input.action.assignedTo }
            : {}),
        },
      };
    }
  }
}

function eventStatement(input: {
  db: D1Database;
  tenantId: string;
  caseSelectorSql: string;
  caseSelectorBinds: unknown[];
  actorId: number;
  oldStatus: CollectionStatus;
  desired: DesiredCaseState;
  nowUtc: string;
}): D1PreparedStatement {
  return input.db.prepare(`
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
    SELECT ?, id, ?, ?, ?, ?, ?, ?, ?
    FROM collection_cases
    WHERE tenant_id = ?
      AND ${input.caseSelectorSql}
      AND status = ?
      AND updated_at_utc = ?
      AND changes() = 1
  `).bind(
    input.tenantId,
    input.desired.eventType,
    input.actorId,
    input.oldStatus,
    input.desired.status,
    input.desired.eventNote,
    JSON.stringify(input.desired.eventMetadata),
    input.nowUtc,
    input.tenantId,
    ...input.caseSelectorBinds,
    input.desired.status,
    input.nowUtc,
  );
}

function changes(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

async function synchronizeFollowupTask(input: {
  db: D1Database;
  tenantId: string;
  actorId: number;
  caseId: number;
  record: ReceivableRecord;
  assignedTo: number | null;
  nextFollowupAtUtc: string | null;
  nowUtc: string;
}): Promise<void> {
  if (!input.nextFollowupAtUtc) return;

  await upsertSourceTask({
    db: input.db,
    tenantId: input.tenantId,
    sourceType: 'collection',
    sourcePublicId: `collection-case:${input.caseId}`,
    sourceHref: `/action/collections?case=${input.caseId}`,
    sourceMetadata: {
      legacyBillId: input.record.source.legacyBillId,
      canonicalInvoicePublicId: input.record.source.canonicalInvoicePublicId,
      collectionCaseId: input.caseId,
    },
    title: `Follow up collection ${input.record.invoiceNumber}`,
    description: `Follow up ${input.record.patientName} for outstanding invoice ${input.record.invoiceNumber}.`,
    priority: 'medium',
    assignedTo: input.assignedTo ?? undefined,
    dueAtUtc: input.nextFollowupAtUtc,
    actorId: input.actorId,
    reopenCompleted: true,
    nowUtc: input.nowUtc,
  });
}

export async function transitionCollectionCase(input: {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
  actorId: number;
  expectedUpdatedAtUtc?: string;
  action: CollectionAction;
  nowUtc?: string;
}): Promise<{ caseId: number; status: CollectionStatus } | 'not_found' | 'conflict'> {
  validatePositiveId(input.actorId, 'Actor');
  const nowUtc = input.nowUtc ?? new Date().toISOString();
  validateAction(input.action, nowUtc);
  await validateAssignee({
    db: input.db,
    tenantId: input.tenantId,
    assignedTo: input.action.action === 'escalate' ? input.action.assignedTo : undefined,
  });

  const live = await getLiveReceivable({
    db: input.db,
    tenantId: input.tenantId,
    source: input.source,
  });
  if (!live) return 'not_found';
  if (live.record.financialStatus !== 'open' || live.record.dueMinor <= 0) {
    return 'conflict';
  }

  if (input.action.action === 'promise') {
    if (input.action.currencyCode !== live.record.currencyCode) {
      throw new CollectionTransitionValidationError('Promise currency must match the live invoice currency.');
    }
    if (input.action.promiseAmountMinor > live.record.dueMinor) {
      throw new CollectionTransitionValidationError('Promise amount cannot exceed the live due.');
    }
  }

  const current = await findCase({
    db: input.db,
    tenantId: input.tenantId,
    source: live.record.source,
  });
  if (current && !MUTABLE_STATUSES.has(current.status as CollectionStatus)) {
    return 'conflict';
  }
  if (
    current
    && input.expectedUpdatedAtUtc !== undefined
    && current.updatedAtUtc !== input.expectedUpdatedAtUtc
  ) {
    return 'conflict';
  }

  const desired = desiredState({ current, action: input.action, nowUtc });

  if (!current) {
    const canonicalId = live.record.source.canonicalInvoicePublicId ?? null;
    const legacyBillId = live.record.source.legacyBillId ?? null;
    const insert = input.db.prepare(`
      INSERT OR IGNORE INTO collection_cases (
        tenant_id,
        source_type,
        canonical_invoice_public_id,
        legacy_bill_id,
        status,
        assigned_to,
        next_followup_at_utc,
        promise_date,
        promise_amount_minor,
        currency_code,
        latest_note,
        last_contacted_at_utc,
        created_at_utc,
        updated_at_utc
      ) VALUES (?, 'invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      canonicalId,
      legacyBillId,
      desired.status,
      desired.assignedTo,
      desired.nextFollowupAtUtc,
      desired.promiseDate,
      desired.promiseAmountMinor,
      desired.currencyCode,
      desired.latestNote,
      desired.lastContactedAtUtc,
      nowUtc,
      nowUtc,
    );
    const selectorSql = 'canonical_invoice_public_id IS ? AND legacy_bill_id IS ?';
    const selectorBinds = [canonicalId, legacyBillId];
    const results = await input.db.batch([
      insert,
      eventStatement({
        db: input.db,
        tenantId: input.tenantId,
        caseSelectorSql: selectorSql,
        caseSelectorBinds: selectorBinds,
        actorId: input.actorId,
        oldStatus: 'new',
        desired,
        nowUtc,
      }),
    ]);

    if (changes(results[0]) !== 1) return 'conflict';
    const created = await input.db.prepare(`
      SELECT id
      FROM collection_cases
      WHERE tenant_id = ?
        AND canonical_invoice_public_id IS ?
        AND legacy_bill_id IS ?
      LIMIT 1
    `).bind(input.tenantId, canonicalId, legacyBillId).first<IdRow>();
    if (!created) return 'conflict';
    const caseId = Number(created.id);
    await synchronizeFollowupTask({
      db: input.db,
      tenantId: input.tenantId,
      actorId: input.actorId,
      caseId,
      record: live.record,
      assignedTo: desired.assignedTo,
      nextFollowupAtUtc: desired.nextFollowupAtUtc,
      nowUtc,
    });
    return { caseId, status: desired.status };
  }

  const update = input.db.prepare(`
    UPDATE collection_cases
    SET canonical_invoice_public_id = COALESCE(canonical_invoice_public_id, ?),
        status = ?,
        assigned_to = ?,
        next_followup_at_utc = ?,
        promise_date = ?,
        promise_amount_minor = ?,
        currency_code = ?,
        latest_note = ?,
        last_contacted_at_utc = ?,
        updated_at_utc = ?
    WHERE id = ?
      AND tenant_id = ?
      AND status = ?
      AND updated_at_utc = ?
  `).bind(
    live.record.source.canonicalInvoicePublicId ?? null,
    desired.status,
    desired.assignedTo,
    desired.nextFollowupAtUtc,
    desired.promiseDate,
    desired.promiseAmountMinor,
    desired.currencyCode,
    desired.latestNote,
    desired.lastContactedAtUtc,
    nowUtc,
    current.id,
    input.tenantId,
    current.status,
    current.updatedAtUtc,
  );

  const results = await input.db.batch([
    update,
    eventStatement({
      db: input.db,
      tenantId: input.tenantId,
      caseSelectorSql: 'id = ?',
      caseSelectorBinds: [current.id],
      actorId: input.actorId,
      oldStatus: current.status as CollectionStatus,
      desired,
      nowUtc,
    }),
  ]);

  if (changes(results[0]) !== 1) return 'conflict';

  const caseId = Number(current.id);
  await synchronizeFollowupTask({
    db: input.db,
    tenantId: input.tenantId,
    actorId: input.actorId,
    caseId,
    record: live.record,
    assignedTo: desired.assignedTo,
    nextFollowupAtUtc: desired.nextFollowupAtUtc,
    nowUtc,
  });
  return { caseId, status: desired.status };
}
