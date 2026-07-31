import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
} from '../../../lib/request-idempotency';
import { HTTPException } from 'hono/http-exception';
import { createRequestFingerprint } from '../../../lib/canonical/idempotency';
import { createDeterministicSourceId } from '../../../lib/canonical/source-mapping';
import {
  assertReceivableAdjustmentAuthorityReady,
  resolveReceivableAuthority,
} from '../../actionCenter/collections/authority';
import { getLiveReceivable } from '../../actionCenter/collections/liveSource';
import { applyPreparedCanonicalReceivableAdjustment } from './canonicalCreditNote';
import { applyPreparedLegacyReceivableAdjustment } from './legacyCreditNote';
import {
  prepareReceivableAdjustment,
  type PreparedReceivableAdjustment,
  type ReceivableAdjustmentInput,
  type ReceivableAdjustmentResult,
} from './types';

const MUTATION_TYPE = 'receivable_adjustment';
const SHADOW_ISSUE_CODE = 'RECEIVABLE_ADJUSTMENT_SHADOW_FAILED';

interface AdjustmentIdempotencyRow {
  request_hash: string;
  status: 'pending' | 'completed' | 'failed';
  response_json: string | null;
}

interface AdjustmentIdempotencyIdentity {
  tenantId: string;
  idempotencyKey: string;
  requestHash: string;
}

function idempotencyMismatch(): never {
  throw new HTTPException(409, {
    message: 'Idempotency key was already used for a different receivable adjustment',
  });
}

function idempotencyConflict(): never {
  throw new HTTPException(409, {
    message: 'Receivable adjustment is already being processed. Please retry shortly.',
  });
}

async function readIdempotencyRow(
  db: ReceivableAdjustmentInput['db'],
  identity: AdjustmentIdempotencyIdentity,
): Promise<AdjustmentIdempotencyRow | null> {
  return db.prepare(`
    SELECT request_hash, status, response_json
    FROM billing_mutation_idempotency_keys
    WHERE tenant_id = ? AND mutation_type = ? AND idempotency_key = ?
  `).bind(
    identity.tenantId,
    MUTATION_TYPE,
    identity.idempotencyKey,
  ).first<AdjustmentIdempotencyRow>();
}

function completedReplay(
  row: AdjustmentIdempotencyRow | null,
  identity: AdjustmentIdempotencyIdentity,
): ReceivableAdjustmentResult | null {
  if (!row) return null;
  if (row.request_hash !== identity.requestHash) idempotencyMismatch();
  if (row.status === 'completed' && row.response_json) {
    return replayResult(JSON.parse(row.response_json) as Record<string, unknown>);
  }
  if (row.status === 'pending') idempotencyConflict();
  return null;
}

async function acquireIdempotency(
  input: PreparedReceivableAdjustment,
  identity: AdjustmentIdempotencyIdentity,
  initial: AdjustmentIdempotencyRow | null,
): Promise<ReceivableAdjustmentResult | null> {
  if (initial?.status === 'failed') {
    const recovered = await input.db.prepare(`
      UPDATE billing_mutation_idempotency_keys
      SET status = 'pending', source_id = NULL, response_json = NULL,
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND mutation_type = ? AND idempotency_key = ?
        AND request_hash = ? AND status = 'failed'
    `).bind(
      identity.tenantId,
      MUTATION_TYPE,
      identity.idempotencyKey,
      identity.requestHash,
    ).run();
    if (Number(recovered.meta?.changes ?? 0) > 0) return null;
  } else if (!initial) {
    const inserted = await input.db.prepare(`
      INSERT OR IGNORE INTO billing_mutation_idempotency_keys
        (tenant_id, mutation_type, idempotency_key, request_hash, status, created_by)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).bind(
      identity.tenantId,
      MUTATION_TYPE,
      identity.idempotencyKey,
      identity.requestHash,
      String(input.actorId),
    ).run();
    if (Number(inserted.meta?.changes ?? 0) > 0) return null;
  }

  const current = await readIdempotencyRow(input.db, identity);
  const replay = completedReplay(current, identity);
  if (replay) return replay;
  idempotencyConflict();
}

function replayResult(responseBody: Record<string, unknown>): ReceivableAdjustmentResult {
  const result = responseBody as unknown as ReceivableAdjustmentResult;
  if (
    (result.authorityMode !== 'legacy' && result.authorityMode !== 'shadow' && result.authorityMode !== 'canonical')
    || typeof result.adjustmentPublicId !== 'string'
    || !Number.isSafeInteger(result.previousDueMinor)
    || !Number.isSafeInteger(result.newDueMinor)
    || !Number.isSafeInteger(result.appliedAmountMinor)
    || typeof result.currencyCode !== 'string'
  ) {
    throw new Error('Stored receivable adjustment replay is invalid');
  }
  return result;
}

async function recordShadowFailure(
  input: PreparedReceivableAdjustment,
  cause: unknown,
): Promise<void> {
  const causeName = cause instanceof Error && cause.name.trim() ? cause.name.trim() : typeof cause;
  const causeCode = cause && typeof cause === 'object' && 'code' in cause
    ? String((cause as { code?: unknown }).code ?? '').trim() || null
    : null;
  const fingerprint = await createRequestFingerprint({
    schemaVersion: 1,
    issueCode: SHADOW_ISSUE_CODE,
    adjustmentPublicId: input.adjustmentPublicId,
    canonicalCreditNotePublicId: input.canonicalCreditNotePublicId,
    sourceType: input.sourceType,
    sourceRequestId: input.sourceRequestId,
    causeName,
    causeCode,
  });
  const issuePublicId = await createDeterministicSourceId(
    'canissue',
    input.tenantId,
    'receivable_adjustment_shadow',
    `${input.adjustmentPublicId}:${fingerprint}`,
  );
  const nowUtc = new Date().toISOString();
  const detailsJson = JSON.stringify({
    schemaVersion: 1,
    adjustmentPublicId: input.adjustmentPublicId,
    canonicalCreditNotePublicId: input.canonicalCreditNotePublicId,
    sourceType: input.sourceType,
    sourceRequestId: input.sourceRequestId,
    causeName,
    causeCode,
    legacyAuthorityCommitted: true,
  });

  try {
    await input.db.prepare(`
      INSERT INTO canonical_processing_issues (
        tenant_id, issue_public_id, issue_type, issue_code, entity_type, entity_public_id,
        source_type, source_public_id, fingerprint, severity, status, occurrence_count,
        summary, details_json, first_seen_at_utc, last_seen_at_utc, created_at_utc, updated_at_utc
      ) VALUES (
        ?, ?, 'financial_shadow_write', ?, 'receivable_adjustment', ?,
        ?, ?, ?, 'error', 'open', 1,
        'Canonical receivable adjustment evidence failed after legacy authority committed.',
        ?, ?, ?, ?, ?
      )
      ON CONFLICT(tenant_id, issue_type, fingerprint) DO UPDATE SET
        occurrence_count = canonical_processing_issues.occurrence_count + 1,
        last_seen_at_utc = excluded.last_seen_at_utc,
        updated_at_utc = excluded.updated_at_utc,
        summary = excluded.summary,
        details_json = excluded.details_json,
        status = CASE
          WHEN canonical_processing_issues.status IN ('resolved', 'waived') THEN 'open'
          ELSE canonical_processing_issues.status
        END,
        resolved_at_utc = CASE
          WHEN canonical_processing_issues.status IN ('resolved', 'waived') THEN NULL
          ELSE canonical_processing_issues.resolved_at_utc
        END,
        resolved_by_public_id = CASE
          WHEN canonical_processing_issues.status IN ('resolved', 'waived') THEN NULL
          ELSE canonical_processing_issues.resolved_by_public_id
        END,
        resolution_code = CASE
          WHEN canonical_processing_issues.status IN ('resolved', 'waived') THEN NULL
          ELSE canonical_processing_issues.resolution_code
        END
    `).bind(
      input.tenantId,
      issuePublicId,
      SHADOW_ISSUE_CODE,
      input.adjustmentPublicId,
      input.sourceType,
      String(input.sourceRequestId),
      fingerprint,
      detailsJson,
      nowUtc,
      nowUtc,
      nowUtc,
      nowUtc,
    ).run();
  } catch (recordingCause) {
    console.error('Receivable adjustment shadow issue recording failed', {
      tenantId: input.tenantId,
      adjustmentPublicId: input.adjustmentPublicId,
      causeName: recordingCause instanceof Error ? recordingCause.name : typeof recordingCause,
    });
  }
}

export async function applyReceivableAdjustment(
  input: ReceivableAdjustmentInput,
): Promise<ReceivableAdjustmentResult> {
  const prepared = await prepareReceivableAdjustment(input);
  const requestHash = await createIdempotencyRequestHash({
    tenantId: prepared.tenantId,
    source: prepared.source,
    amountMinor: prepared.amountMinor,
    currencyCode: prepared.currencyCode,
    reasonCode: prepared.reasonCode,
    note: prepared.note,
    sourceType: prepared.sourceType,
    sourceRequestId: prepared.sourceRequestId,
  });
  const idempotency: AdjustmentIdempotencyIdentity = {
    tenantId: prepared.tenantId,
    idempotencyKey: prepared.idempotencyKey,
    requestHash,
  };
  const initialIdempotency = await readIdempotencyRow(prepared.db, idempotency);
  const replay = completedReplay(initialIdempotency, idempotency);
  if (replay) return replay;

  const authority = await resolveReceivableAuthority({
    db: prepared.db,
    tenantId: prepared.tenantId,
  });
  await assertReceivableAdjustmentAuthorityReady({
    db: prepared.db,
    authorityMode: authority.mode,
  });
  const liveSource = await getLiveReceivable({
    db: prepared.db,
    tenantId: prepared.tenantId,
    source: prepared.source,
  });
  if (!liveSource || liveSource.authorityMode !== authority.mode) {
    throw new Error('Receivable source was not found for the active authority');
  }
  const acquiredReplay = await acquireIdempotency(prepared, idempotency, initialIdempotency);
  if (acquiredReplay) return acquiredReplay;

  try {
    let result: ReceivableAdjustmentResult;
    if (authority.mode === 'canonical') {
      result = await applyPreparedCanonicalReceivableAdjustment(prepared);
    } else if (authority.mode === 'shadow') {
      const legacy = await applyPreparedLegacyReceivableAdjustment(prepared);
      let canonicalCreditNotePublicId: string | undefined;
      try {
        const canonical = await applyPreparedCanonicalReceivableAdjustment(prepared);
        canonicalCreditNotePublicId = canonical.canonicalCreditNotePublicId;
      } catch (cause) {
        await recordShadowFailure(prepared, cause);
      }
      result = {
        ...legacy,
        authorityMode: 'shadow',
        canonicalCreditNotePublicId,
      };
    } else {
      result = await applyPreparedLegacyReceivableAdjustment(prepared);
    }

    await completeMutationIdempotencyKey(prepared.db, {
      tenantId: prepared.tenantId,
      mutationType: MUTATION_TYPE,
      idempotencyKey: prepared.idempotencyKey,
      sourceId: result.adjustmentPublicId,
      responseBody: result as unknown as Record<string, unknown>,
    });
    return result;
  } catch (error) {
    await markMutationIdempotencyKeyFailed(prepared.db, {
      tenantId: prepared.tenantId,
      mutationType: MUTATION_TYPE,
      idempotencyKey: prepared.idempotencyKey,
    }).catch(() => undefined);
    throw error;
  }
}

export type {
  ReceivableAdjustmentInput,
  ReceivableAdjustmentResult,
} from './types';
