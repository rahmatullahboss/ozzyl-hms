import type { CanonicalBatchDatabase } from './command-batch';
import { createRequestFingerprint } from './idempotency';
import type {
  CanonicalSyncDeliveryPort,
  CanonicalSyncDeliveryResult,
} from './local-sync-delivery';
import {
  CanonicalSyncOutboxStateError,
  claimNextCanonicalSyncOutboxEnvelope,
  completeCanonicalSyncOutboxPublication,
  deadLetterCanonicalSyncOutboxPublication,
  failCanonicalSyncOutboxPublication,
  type CanonicalSyncOutboxClaimReceipt,
} from './local-sync-outbox-lifecycle';

export interface CanonicalSyncOrchestrationTimeline {
  sourceClaimedAtUtc: string;
  sourceClaimExpiresAtUtc: string;
  targetReceivedAtUtc: string;
  targetClaimedAtUtc: string;
  targetClaimExpiresAtUtc: string;
  targetAppliedAtUtc: string;
  sourcePublishedAtUtc: string;
  sourceNextAttemptAtUtc: string;
  targetNextAttemptAtUtc: string;
}

export interface CanonicalSyncOrchestrationInput {
  tenantId: string;
  sourceNodePublicId: string;
  sourceClaimOwnerPublicId: string;
  targetClaimOwnerPublicId: string;
  sourceMaxAttempts: number;
  targetMaxAttempts: number;
  timeline: CanonicalSyncOrchestrationTimeline;
}

export type CanonicalSyncOrchestrationResult =
  | { status: 'idle' }
  | {
      status: 'published';
      eventPublicId: string;
      sourceAttemptCount: number;
      targetAttemptCount: number;
      targetReplayed: boolean;
    }
  | {
      status: 'retry';
      eventPublicId: string;
      sourceAttemptCount: number;
      retryAtUtc: string;
      errorCode: string;
      errorHash: string;
    }
  | {
      status: 'dead_letter';
      eventPublicId: string;
      sourceAttemptCount: number;
      errorCode: string;
      errorHash: string;
    }
  | {
      status: 'source_ack_pending';
      eventPublicId: string;
      sourceAttemptCount: number;
      targetAttemptCount: number;
      recoverAfterUtc: string;
      errorCode: 'CANONICAL_SYNC_SOURCE_ACK_PENDING';
      errorHash: string;
    };

interface StableErrorEvidence {
  errorCode: string;
  errorHash: string;
}

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,95}$/;

function assertExact(value: unknown, label: string, maxLength: number): asserts value is string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || value.length > maxLength
  ) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace and at most ${maxLength} characters`);
  }
}

function assertPublicId(value: unknown, label: string, maxLength: number): asserts value is string {
  assertExact(value, label, maxLength);
  if (/^\d+$/.test(value)) {
    throw new TypeError(`${label} must be a stable public identifier, not a raw numeric database ID`);
  }
}

function assertUtc(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid ISO-8601 UTC timestamp`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function assertTimeline(timeline: CanonicalSyncOrchestrationTimeline): void {
  for (const [label, value] of Object.entries(timeline)) assertUtc(value, label);
  const sourceClaimed = Date.parse(timeline.sourceClaimedAtUtc);
  const sourceExpires = Date.parse(timeline.sourceClaimExpiresAtUtc);
  const targetReceived = Date.parse(timeline.targetReceivedAtUtc);
  const targetClaimed = Date.parse(timeline.targetClaimedAtUtc);
  const targetExpires = Date.parse(timeline.targetClaimExpiresAtUtc);
  const targetApplied = Date.parse(timeline.targetAppliedAtUtc);
  const sourcePublished = Date.parse(timeline.sourcePublishedAtUtc);
  const sourceRetry = Date.parse(timeline.sourceNextAttemptAtUtc);
  const targetRetry = Date.parse(timeline.targetNextAttemptAtUtc);

  if (sourceExpires <= sourceClaimed) {
    throw new RangeError('sourceClaimExpiresAtUtc must be later than sourceClaimedAtUtc');
  }
  if (targetReceived < sourceClaimed) {
    throw new RangeError('targetReceivedAtUtc must not be earlier than sourceClaimedAtUtc');
  }
  if (targetClaimed < sourceClaimed || targetClaimed < targetReceived) {
    throw new RangeError('targetClaimedAtUtc must not be earlier than source claim or target receive');
  }
  if (targetExpires <= targetClaimed) {
    throw new RangeError('targetClaimExpiresAtUtc must be later than targetClaimedAtUtc');
  }
  if (targetApplied < targetClaimed || targetApplied >= targetExpires) {
    throw new RangeError('targetAppliedAtUtc must be within the active target claim');
  }
  if (sourcePublished < targetApplied || sourcePublished >= sourceExpires) {
    throw new RangeError('sourcePublishedAtUtc must follow target apply within the active source claim');
  }
  if (sourceRetry <= sourceClaimed) {
    throw new RangeError('sourceNextAttemptAtUtc must be later than sourceClaimedAtUtc');
  }
  if (targetRetry <= targetClaimed) {
    throw new RangeError('targetNextAttemptAtUtc must be later than targetClaimedAtUtc');
  }
}

export function validateCanonicalSyncOrchestrationInput(input: CanonicalSyncOrchestrationInput): void {
  assertExact(input.tenantId, 'tenantId', 128);
  assertPublicId(input.sourceNodePublicId, 'sourceNodePublicId', 192);
  assertPublicId(input.sourceClaimOwnerPublicId, 'sourceClaimOwnerPublicId', 192);
  assertPublicId(input.targetClaimOwnerPublicId, 'targetClaimOwnerPublicId', 192);
  assertPositiveInteger(input.sourceMaxAttempts, 'sourceMaxAttempts');
  assertPositiveInteger(input.targetMaxAttempts, 'targetMaxAttempts');
  if (!input.timeline || typeof input.timeline !== 'object') {
    throw new TypeError('timeline is required');
  }
  assertTimeline(input.timeline);
}

async function deterministicClaimPublicId(
  prefix: 'sync-source-claim' | 'sync-target-claim',
  evidence: Record<string, unknown>,
): Promise<string> {
  return `${prefix}-${(await createRequestFingerprint(evidence)).slice(0, 40)}`;
}

async function stableErrorEvidence(
  errorCode: string,
  phase: string,
  error: unknown,
): Promise<StableErrorEvidence> {
  const name = error instanceof Error ? error.name : typeof error;
  const stableCode = error && typeof error === 'object'
    && typeof (error as { code?: unknown }).code === 'string'
    ? String((error as { code: string }).code)
    : null;
  const messageHash = await createRequestFingerprint(error instanceof Error ? error.message : String(error));
  return {
    errorCode,
    errorHash: await createRequestFingerprint({ phase, name, stableCode, messageHash }),
  };
}

function assertDeliveryResult(
  result: CanonicalSyncDeliveryResult,
  receipt: CanonicalSyncOutboxClaimReceipt,
): void {
  if (!result || typeof result !== 'object') throw new TypeError('delivery result is required');
  if (result.eventPublicId !== receipt.eventPublicId) {
    throw new TypeError('delivery result eventPublicId does not match the source receipt');
  }
  assertPositiveInteger(result.targetAttemptCount, 'delivery result targetAttemptCount');
  if (result.status === 'retry' || result.status === 'busy') {
    assertUtc(result.retryAtUtc, 'delivery result retryAtUtc');
  }
  if (result.status === 'retry' || result.status === 'busy' || result.status === 'dead_letter') {
    if (!CODE_PATTERN.test(result.errorCode)) {
      throw new TypeError('delivery result errorCode is invalid');
    }
    if (!HASH_PATTERN.test(result.errorHash)) {
      throw new TypeError('delivery result errorHash is invalid');
    }
  }
}

function laterUtc(first: string, second: string): string {
  return Date.parse(first) >= Date.parse(second) ? first : second;
}

async function transitionSourceFailure(
  sourceDb: CanonicalBatchDatabase,
  receipt: CanonicalSyncOutboxClaimReceipt,
  input: CanonicalSyncOrchestrationInput,
  evidence: StableErrorEvidence,
  failedAtUtc: string,
  nextAttemptAtUtc: string,
): Promise<CanonicalSyncOrchestrationResult> {
  const terminal = receipt.attemptCount >= input.sourceMaxAttempts;
  if (terminal) {
    await deadLetterCanonicalSyncOutboxPublication(sourceDb, {
      receipt,
      failedAtUtc,
      errorCode: evidence.errorCode,
      errorSha256: evidence.errorHash,
    });
    return {
      status: 'dead_letter',
      eventPublicId: receipt.eventPublicId,
      sourceAttemptCount: receipt.attemptCount,
      errorCode: evidence.errorCode,
      errorHash: evidence.errorHash,
    };
  }
  await failCanonicalSyncOutboxPublication(sourceDb, {
    receipt,
    failedAtUtc,
    nextAttemptAtUtc,
    maxAttempts: input.sourceMaxAttempts,
    errorCode: evidence.errorCode,
    errorSha256: evidence.errorHash,
  });
  return {
    status: 'retry',
    eventPublicId: receipt.eventPublicId,
    sourceAttemptCount: receipt.attemptCount,
    retryAtUtc: nextAttemptAtUtc,
    errorCode: evidence.errorCode,
    errorHash: evidence.errorHash,
  };
}

export async function runCanonicalSyncOrchestrationOnce(
  sourceDb: CanonicalBatchDatabase,
  deliveryPort: CanonicalSyncDeliveryPort,
  input: CanonicalSyncOrchestrationInput,
): Promise<CanonicalSyncOrchestrationResult> {
  validateCanonicalSyncOrchestrationInput(input);
  if (!deliveryPort || typeof deliveryPort.deliver !== 'function') {
    throw new TypeError('deliveryPort.deliver is required');
  }

  const sourceClaimPublicId = await deterministicClaimPublicId('sync-source-claim', {
    tenantId: input.tenantId,
    sourceNodePublicId: input.sourceNodePublicId,
    sourceClaimOwnerPublicId: input.sourceClaimOwnerPublicId,
    sourceClaimedAtUtc: input.timeline.sourceClaimedAtUtc,
    sourceClaimExpiresAtUtc: input.timeline.sourceClaimExpiresAtUtc,
  });

  let receipt: CanonicalSyncOutboxClaimReceipt;
  try {
    receipt = await claimNextCanonicalSyncOutboxEnvelope(sourceDb, {
      tenantId: input.tenantId,
      sourceNodePublicId: input.sourceNodePublicId,
      claimPublicId: sourceClaimPublicId,
      claimOwnerPublicId: input.sourceClaimOwnerPublicId,
      claimedAtUtc: input.timeline.sourceClaimedAtUtc,
      claimExpiresAtUtc: input.timeline.sourceClaimExpiresAtUtc,
      maxAttempts: input.sourceMaxAttempts,
    });
  } catch (error) {
    if (error instanceof CanonicalSyncOutboxStateError) return { status: 'idle' };
    throw error;
  }

  const targetClaimPublicId = await deterministicClaimPublicId('sync-target-claim', {
    tenantId: input.tenantId,
    eventPublicId: receipt.eventPublicId,
    envelopeSha256: receipt.envelopeSha256,
    targetClaimOwnerPublicId: input.targetClaimOwnerPublicId,
    targetClaimedAtUtc: input.timeline.targetClaimedAtUtc,
    targetClaimExpiresAtUtc: input.timeline.targetClaimExpiresAtUtc,
  });

  let targetResult: CanonicalSyncDeliveryResult;
  try {
    targetResult = await deliveryPort.deliver({
      envelope: receipt.envelope,
      receivedAtUtc: input.timeline.targetReceivedAtUtc,
      targetClaimPublicId,
      targetClaimOwnerPublicId: input.targetClaimOwnerPublicId,
      targetClaimedAtUtc: input.timeline.targetClaimedAtUtc,
      targetClaimExpiresAtUtc: input.timeline.targetClaimExpiresAtUtc,
      targetAppliedAtUtc: input.timeline.targetAppliedAtUtc,
      targetNextAttemptAtUtc: input.timeline.targetNextAttemptAtUtc,
      targetMaxAttempts: input.targetMaxAttempts,
    });
    assertDeliveryResult(targetResult, receipt);
  } catch (error) {
    const evidence = await stableErrorEvidence(
      'CANONICAL_SYNC_TRANSPORT_FAILURE',
      'delivery-port',
      error,
    );
    return transitionSourceFailure(
      sourceDb,
      receipt,
      input,
      evidence,
      input.timeline.targetAppliedAtUtc,
      input.timeline.sourceNextAttemptAtUtc,
    );
  }

  if (targetResult.status === 'applied') {
    try {
      await completeCanonicalSyncOutboxPublication(sourceDb, {
        receipt,
        sourceNodePublicId: input.sourceNodePublicId,
        envelope: receipt.envelope,
        publishedAtUtc: input.timeline.sourcePublishedAtUtc,
      });
      return {
        status: 'published',
        eventPublicId: receipt.eventPublicId,
        sourceAttemptCount: receipt.attemptCount,
        targetAttemptCount: targetResult.targetAttemptCount,
        targetReplayed: targetResult.replayed,
      };
    } catch (error) {
      if (!(error instanceof CanonicalSyncOutboxStateError)) throw error;
      const evidence = await stableErrorEvidence(
        'CANONICAL_SYNC_SOURCE_ACK_PENDING',
        'source-publication-ack',
        error,
      );
      return {
        status: 'source_ack_pending',
        eventPublicId: receipt.eventPublicId,
        sourceAttemptCount: receipt.attemptCount,
        targetAttemptCount: targetResult.targetAttemptCount,
        recoverAfterUtc: receipt.claimExpiresAtUtc,
        errorCode: 'CANONICAL_SYNC_SOURCE_ACK_PENDING',
        errorHash: evidence.errorHash,
      };
    }
  }

  if (targetResult.status === 'dead_letter') {
    await deadLetterCanonicalSyncOutboxPublication(sourceDb, {
      receipt,
      failedAtUtc: input.timeline.targetAppliedAtUtc,
      errorCode: targetResult.errorCode,
      errorSha256: targetResult.errorHash,
    });
    return {
      status: 'dead_letter',
      eventPublicId: receipt.eventPublicId,
      sourceAttemptCount: receipt.attemptCount,
      errorCode: targetResult.errorCode,
      errorHash: targetResult.errorHash,
    };
  }

  const retryAtUtc = laterUtc(input.timeline.sourceNextAttemptAtUtc, targetResult.retryAtUtc);
  return transitionSourceFailure(
    sourceDb,
    receipt,
    input,
    { errorCode: targetResult.errorCode, errorHash: targetResult.errorHash },
    input.timeline.targetAppliedAtUtc,
    retryAtUtc,
  );
}
