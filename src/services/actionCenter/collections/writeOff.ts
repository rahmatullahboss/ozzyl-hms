import type {
  D1Database,
  D1PreparedStatement,
} from '@cloudflare/workers-types';
import { assertReceivableAdjustmentAuthorityReady } from './authority';
import { getLiveReceivable } from './liveSource';
import type {
  CollectionStatus,
  ReceivableRecord,
  ReceivableSourceRef,
} from './types';

export const RECEIVABLE_WRITE_OFF_REASON_CODES = [
  'uncollectible',
  'financial_hardship',
  'billing_dispute',
  'deceased',
  'administrative_adjustment',
  'other',
] as const;

export type ReceivableWriteOffReasonCode = typeof RECEIVABLE_WRITE_OFF_REASON_CODES[number];

export interface WriteOffRequestInput {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
  requesterId: number;
  amountMinor: number;
  currencyCode: string;
  reasonCode: ReceivableWriteOffReasonCode;
  note: string;
  evidenceUrls?: string[];
}

interface CollectionCaseRow {
  id: number;
  status: CollectionStatus;
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

interface ApprovalIdRow {
  id: number;
  entityId: number;
}

interface CaseIdRow {
  id: number;
}

interface PreparedWriteOffRequest {
  tenantId: string;
  source: ReceivableSourceRef;
  requesterId: number;
  amountMinor: number;
  currencyCode: string;
  reasonCode: ReceivableWriteOffReasonCode;
  note: string;
  evidenceUrls: string[];
}

interface PreviousCollectionState {
  status: CollectionStatus;
  assignedTo: number | null;
  nextFollowupAtUtc: string | null;
  promiseDate: string | null;
  promiseAmountMinor: number | null;
  currencyCode: string | null;
  latestNote: string | null;
  lastContactedAtUtc: string | null;
  updatedAtUtc: string | null;
}

const MUTABLE_REQUEST_STATUSES = new Set<CollectionStatus>([
  'new',
  'contact_due',
  'contacted',
  'promised',
  'disputed',
  'escalated',
]);

export class ReceivableWriteOffRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceivableWriteOffRequestValidationError';
  }
}

export class ReceivableWriteOffRequestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceivableWriteOffRequestConflictError';
  }
}

function exactText(value: string, label: string): string {
  if (!value.trim()) {
    throw new ReceivableWriteOffRequestValidationError(`${label} is required.`);
  }
  if (value.trim() !== value) {
    throw new ReceivableWriteOffRequestValidationError(`${label} cannot contain surrounding whitespace.`);
  }
  return value;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ReceivableWriteOffRequestValidationError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function validateEvidenceUrls(values: string[] | undefined): string[] {
  if (!values) return [];
  if (values.length > 10) {
    throw new ReceivableWriteOffRequestValidationError('No more than 10 evidence URLs are allowed.');
  }
  const normalized: string[] = [];
  for (const raw of values) {
    const value = exactText(raw, 'Evidence URL');
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new ReceivableWriteOffRequestValidationError('Evidence URLs must be valid URLs.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ReceivableWriteOffRequestValidationError('Evidence URLs must use HTTP or HTTPS.');
    }
    normalized.push(parsed.toString());
  }
  return Array.from(new Set(normalized));
}

function prepareRequest(input: WriteOffRequestInput): PreparedWriteOffRequest {
  const tenantId = exactText(input.tenantId, 'Tenant ID');
  const requesterId = positiveSafeInteger(input.requesterId, 'Requester ID');
  const amountMinor = positiveSafeInteger(input.amountMinor, 'Write-off amount');
  if (!/^[A-Z]{3}$/.test(input.currencyCode)) {
    throw new ReceivableWriteOffRequestValidationError('Currency must be a three-letter uppercase code.');
  }
  if (!RECEIVABLE_WRITE_OFF_REASON_CODES.includes(input.reasonCode)) {
    throw new ReceivableWriteOffRequestValidationError('Write-off reason is not supported.');
  }
  const note = exactText(input.note, 'Explanatory note');
  if (note.length < 10 || note.length > 2000) {
    throw new ReceivableWriteOffRequestValidationError('Explanatory note must contain 10 to 2000 characters.');
  }
  return {
    tenantId,
    source: input.source,
    requesterId,
    amountMinor,
    currencyCode: input.currencyCode,
    reasonCode: input.reasonCode,
    note,
    evidenceUrls: validateEvidenceUrls(input.evidenceUrls),
  };
}

function sourceSelector(source: ReceivableSourceRef, alias = ''): {
  sql: string;
  binds: Array<string | number | null>;
} {
  const prefix = alias ? `${alias}.` : '';
  return {
    sql: `${prefix}canonical_invoice_public_id IS ? AND ${prefix}legacy_bill_id IS ?`,
    binds: [
      source.canonicalInvoicePublicId ?? null,
      source.legacyBillId ?? null,
    ],
  };
}

async function findCollectionCase(input: {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
}): Promise<CollectionCaseRow | null> {
  const conditions: string[] = [];
  const binds: Array<string | number> = [input.tenantId];
  if (input.source.canonicalInvoicePublicId) {
    conditions.push('canonical_invoice_public_id = ?');
    binds.push(input.source.canonicalInvoicePublicId);
  }
  if (input.source.legacyBillId !== undefined) {
    conditions.push('legacy_bill_id = ?');
    binds.push(input.source.legacyBillId);
  }
  if (conditions.length === 0) return null;

  const rows = await input.db.prepare(`
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
    WHERE tenant_id = ? AND (${conditions.join(' OR ')})
    ORDER BY id ASC
    LIMIT 2
  `).bind(...binds).all<CollectionCaseRow>();

  if (rows.results.length > 1) {
    throw new ReceivableWriteOffRequestConflictError('Receivable source is linked to multiple collection cases.');
  }
  return rows.results[0] ?? null;
}

async function findPendingApproval(input: {
  db: D1Database;
  tenantId: string;
  collectionCaseId: number;
}): Promise<number | null> {
  const row = await input.db.prepare(`
    SELECT id
    FROM approval_requests
    WHERE tenant_id = ?
      AND type = 'receivable_write_off'
      AND entity_id = ?
      AND status = 'pending'
    ORDER BY id ASC
    LIMIT 1
  `).bind(input.tenantId, input.collectionCaseId).first<{ id: number }>();
  return row ? Number(row.id) : null;
}

function previousState(current: CollectionCaseRow | null): PreviousCollectionState {
  return {
    status: current?.status ?? 'new',
    assignedTo: current?.assignedTo ?? null,
    nextFollowupAtUtc: current?.nextFollowupAtUtc ?? null,
    promiseDate: current?.promiseDate ?? null,
    promiseAmountMinor: current?.promiseAmountMinor ?? null,
    currencyCode: current?.currencyCode ?? null,
    latestNote: current?.latestNote ?? null,
    lastContactedAtUtc: current?.lastContactedAtUtc ?? null,
    updatedAtUtc: current?.updatedAtUtc ?? null,
  };
}

function sourceEvidence(record: ReceivableRecord): Record<string, unknown> {
  return {
    sourceKey: record.source.canonicalInvoicePublicId
      ? `canonical-invoice:${record.source.canonicalInvoicePublicId}`
      : `legacy-bill:${record.source.legacyBillId}`,
    invoiceNumber: record.invoiceNumber,
    patientId: record.patientId,
    issuedAtUtc: record.issuedAtUtc,
    totalMinor: record.totalMinor,
    paidMinor: record.paidMinor,
    creditedMinor: record.creditedMinor,
    dueMinor: record.dueMinor,
    financialStatus: record.financialStatus,
  };
}

function approvalSelector(alias = 'ar'): string {
  return `${alias}.tenant_id = ?
    AND ${alias}.type = 'receivable_write_off'
    AND ${alias}.requested_by = ?
    AND ${alias}.request_data = ?
    AND ${alias}.status = 'pending'`;
}

function approvalEventStatement(input: {
  db: D1Database;
  tenantId: string;
  requesterId: number;
  requestDataJson: string;
  note: string;
  metadataJson: string;
}): D1PreparedStatement {
  return input.db.prepare(`
    INSERT INTO approval_events (
      tenant_id, approval_request_id, action, actor_id,
      old_status, new_status, notes, metadata
    )
    SELECT ?, ar.id, 'created', ?, NULL, 'pending', ?, ?
    FROM approval_requests ar
    WHERE ${approvalSelector('ar')}
      AND changes() = 1
    ORDER BY ar.id DESC
    LIMIT 1
  `).bind(
    input.tenantId,
    input.requesterId,
    input.note,
    input.metadataJson,
    input.tenantId,
    input.requesterId,
    input.requestDataJson,
  );
}

function collectionEventStatement(input: {
  db: D1Database;
  tenantId: string;
  requesterId: number;
  requestDataJson: string;
  note: string;
  amountMinor: number;
  currencyCode: string;
  reasonCode: ReceivableWriteOffReasonCode;
  caseSelectorSql: string;
  caseSelectorBinds: Array<string | number | null>;
  previousStatus: CollectionStatus;
  nowUtc: string;
}): D1PreparedStatement {
  return input.db.prepare(`
    INSERT INTO collection_case_events (
      tenant_id, case_id, event_type, actor_id,
      old_status, new_status, note, metadata_json, created_at_utc
    ) VALUES (
      CASE WHEN changes() = 1 THEN ? ELSE NULL END,
      (SELECT id FROM collection_cases WHERE tenant_id = ? AND ${input.caseSelectorSql} LIMIT 1),
      'write_off_requested', ?, ?, 'write_off_requested', ?,
      json_object(
        'approvalId', (
          SELECT ar.id FROM approval_requests ar
          WHERE ${approvalSelector('ar')}
          ORDER BY ar.id DESC LIMIT 1
        ),
        'amountMinor', ?,
        'currencyCode', ?,
        'reasonCode', ?
      ),
      ?
    )
  `).bind(
    input.tenantId,
    input.tenantId,
    ...input.caseSelectorBinds,
    input.requesterId,
    input.previousStatus,
    input.note,
    input.tenantId,
    input.requesterId,
    input.requestDataJson,
    input.amountMinor,
    input.currencyCode,
    input.reasonCode,
    input.nowUtc,
  );
}

export async function createReceivableWriteOffRequest(
  rawInput: WriteOffRequestInput,
): Promise<{ approvalId: number; collectionCaseId: number }> {
  const input = prepareRequest(rawInput);
  const live = await getLiveReceivable({
    db: rawInput.db,
    tenantId: input.tenantId,
    source: input.source,
  });
  if (!live) {
    throw new ReceivableWriteOffRequestValidationError('Receivable source was not found for this tenant.');
  }
  await assertReceivableAdjustmentAuthorityReady({
    db: rawInput.db,
    authorityMode: live.authorityMode,
  });
  if (live.record.financialStatus !== 'open' || live.record.dueMinor <= 0) {
    throw new ReceivableWriteOffRequestConflictError('Write-off requires an active outstanding receivable.');
  }
  if (input.currencyCode !== live.record.currencyCode) {
    throw new ReceivableWriteOffRequestValidationError('Write-off currency must match the live receivable currency.');
  }
  if (input.amountMinor > live.record.dueMinor) {
    throw new ReceivableWriteOffRequestValidationError('Write-off amount cannot exceed the live due.');
  }

  const source = live.record.source;
  const current = await findCollectionCase({
    db: rawInput.db,
    tenantId: input.tenantId,
    source,
  });
  if (current) {
    const pendingApprovalId = await findPendingApproval({
      db: rawInput.db,
      tenantId: input.tenantId,
      collectionCaseId: current.id,
    });
    if (pendingApprovalId !== null || current.status === 'write_off_requested') {
      throw new ReceivableWriteOffRequestConflictError('A pending write-off request already exists for this receivable.');
    }
    if (!MUTABLE_REQUEST_STATUSES.has(current.status)) {
      throw new ReceivableWriteOffRequestConflictError(`Collection case cannot request write-off from status ${current.status}.`);
    }
  }

  const nowUtc = new Date().toISOString();
  const previous = previousState(current);
  const requestDataJson = JSON.stringify({
    schemaVersion: 1,
    source,
    amountMinor: input.amountMinor,
    currencyCode: input.currencyCode,
    liveDueMinorAtRequest: live.record.dueMinor,
    authorityModeAtRequest: live.authorityMode,
    reasonCode: input.reasonCode,
    note: input.note,
    evidenceUrls: input.evidenceUrls,
    requestedAtUtc: nowUtc,
    previousCollectionState: previous,
    sourceEvidence: sourceEvidence(live.record),
  });
  const approvalMetadataJson = JSON.stringify({
    schemaVersion: 1,
    type: 'receivable_write_off',
    amountMinor: input.amountMinor,
    currencyCode: input.currencyCode,
    authorityModeAtRequest: live.authorityMode,
  });

  const canonicalInvoicePublicId = source.canonicalInvoicePublicId ?? null;
  const legacyBillId = source.legacyBillId ?? null;
  const exactSource = sourceSelector(source, 'cc');
  const caseSelectorSql = current ? 'id = ?' : exactSource.sql.replaceAll('cc.', '');
  const caseSelectorBinds: Array<string | number | null> = current
    ? [current.id]
    : exactSource.binds;
  const expectedStatus = current?.status ?? 'new';
  const expectedUpdatedAtUtc = current?.updatedAtUtc ?? nowUtc;

  const statements: D1PreparedStatement[] = [
    rawInput.db.prepare(`
      INSERT OR IGNORE INTO collection_cases (
        tenant_id, source_type, canonical_invoice_public_id, legacy_bill_id,
        status, created_at_utc, updated_at_utc
      ) VALUES (?, 'invoice', ?, ?, 'new', ?, ?)
    `).bind(
      input.tenantId,
      canonicalInvoicePublicId,
      legacyBillId,
      nowUtc,
      nowUtc,
    ),
    rawInput.db.prepare(`
      INSERT INTO approval_requests (
        tenant_id, type, entity_id, entity_no, requested_by, request_data,
        status, execution_status, execution_attempts,
        required_approvals, approval_count
      )
      SELECT ?, 'receivable_write_off', cc.id, ?, ?, ?,
             'pending', 'pending', 0, 2, 0
      FROM collection_cases cc
      WHERE cc.tenant_id = ?
        AND ${current ? 'cc.id = ?' : exactSource.sql}
        AND cc.status = ?
        AND cc.updated_at_utc = ?
        AND NOT EXISTS (
          SELECT 1 FROM approval_requests pending
          WHERE pending.tenant_id = ?
            AND pending.type = 'receivable_write_off'
            AND pending.entity_id = cc.id
            AND pending.status = 'pending'
        )
    `).bind(
      input.tenantId,
      live.record.invoiceNumber,
      input.requesterId,
      requestDataJson,
      input.tenantId,
      ...(current ? [current.id] : exactSource.binds),
      expectedStatus,
      expectedUpdatedAtUtc,
      input.tenantId,
    ),
    approvalEventStatement({
      db: rawInput.db,
      tenantId: input.tenantId,
      requesterId: input.requesterId,
      requestDataJson,
      note: input.note,
      metadataJson: approvalMetadataJson,
    }),
    rawInput.db.prepare(`
      UPDATE collection_cases
      SET canonical_invoice_public_id = COALESCE(canonical_invoice_public_id, ?),
          status = 'write_off_requested',
          updated_at_utc = ?
      WHERE tenant_id = ?
        AND ${caseSelectorSql}
        AND status = ?
        AND updated_at_utc = ?
        AND changes() = 1
    `).bind(
      canonicalInvoicePublicId,
      nowUtc,
      input.tenantId,
      ...caseSelectorBinds,
      expectedStatus,
      expectedUpdatedAtUtc,
    ),
    collectionEventStatement({
      db: rawInput.db,
      tenantId: input.tenantId,
      requesterId: input.requesterId,
      requestDataJson,
      note: input.note,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      reasonCode: input.reasonCode,
      caseSelectorSql,
      caseSelectorBinds,
      previousStatus: expectedStatus,
      nowUtc,
    }),
  ];

  try {
    await rawInput.db.batch(statements);
  } catch (error) {
    const refreshedCase = await findCollectionCase({
      db: rawInput.db,
      tenantId: input.tenantId,
      source,
    }).catch(() => null);
    if (refreshedCase) {
      const pending = await findPendingApproval({
        db: rawInput.db,
        tenantId: input.tenantId,
        collectionCaseId: refreshedCase.id,
      }).catch(() => null);
      if (pending !== null) {
        throw new ReceivableWriteOffRequestConflictError('A pending write-off request already exists for this receivable.');
      }
    }
    throw error;
  }

  const approval = await rawInput.db.prepare(`
    SELECT id, entity_id AS "entityId"
    FROM approval_requests ar
    WHERE ${approvalSelector('ar')}
    ORDER BY ar.id DESC
    LIMIT 1
  `).bind(
    input.tenantId,
    input.requesterId,
    requestDataJson,
  ).first<ApprovalIdRow>();
  if (!approval) {
    const caseRow = await findCollectionCase({
      db: rawInput.db,
      tenantId: input.tenantId,
      source,
    });
    if (caseRow && await findPendingApproval({
      db: rawInput.db,
      tenantId: input.tenantId,
      collectionCaseId: caseRow.id,
    }) !== null) {
      throw new ReceivableWriteOffRequestConflictError('A pending write-off request already exists for this receivable.');
    }
    throw new ReceivableWriteOffRequestConflictError('Write-off request could not be created because the collection state changed.');
  }

  const collectionCase = await rawInput.db.prepare(`
    SELECT id
    FROM collection_cases
    WHERE tenant_id = ? AND id = ? AND status = 'write_off_requested'
    LIMIT 1
  `).bind(input.tenantId, approval.entityId).first<CaseIdRow>();
  if (!collectionCase) {
    throw new ReceivableWriteOffRequestConflictError('Write-off request did not produce a linked collection transition.');
  }

  return {
    approvalId: Number(approval.id),
    collectionCaseId: Number(collectionCase.id),
  };
}
