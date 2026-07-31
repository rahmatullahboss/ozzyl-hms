import type { CanonicalBatchDatabase } from './command-batch';
import { createRequestFingerprint } from './idempotency';
import type { CanonicalSyncDeliveryPort } from './local-sync-delivery';
import {
  runCanonicalSyncOrchestrationOnce,
  validateCanonicalSyncOrchestrationInput,
  type CanonicalSyncOrchestrationInput,
  type CanonicalSyncOrchestrationResult,
} from './local-sync-orchestrator';

export interface CanonicalSyncOfflineRehearsalStep {
  stepPublicId: string;
  orchestration: CanonicalSyncOrchestrationInput;
}

export interface CanonicalSyncOfflineRehearsalInput {
  rehearsalPublicId: string;
  steps: readonly CanonicalSyncOfflineRehearsalStep[];
}

export type CanonicalSyncOfflineRehearsalStepReceipt = {
  stepPublicId: string;
  status: 'idle' | 'published' | 'retry' | 'dead_letter' | 'source_ack_pending';
  eventPublicId: string | null;
  sourceAttemptCount: number | null;
  targetAttemptCount: number | null;
  targetReplayed: boolean | null;
  retryAtUtc: string | null;
  recoverAfterUtc: string | null;
  errorCode: string | null;
  errorHash: string | null;
};

export interface CanonicalSyncOfflineRehearsalReceipt {
  rehearsalPublicId: string;
  tenantId: string;
  sourceNodePublicId: string;
  plannedStepCount: number;
  executedStepCount: number;
  drained: boolean;
  publishedCount: number;
  retryCount: number;
  deadLetterCount: number;
  sourceAckPendingCount: number;
  idleCount: number;
  uniqueEventCount: number;
  eventPublicIds: string[];
  stepReceipts: CanonicalSyncOfflineRehearsalStepReceipt[];
  transcriptSha256: string;
}

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

function validatePlan(input: CanonicalSyncOfflineRehearsalInput): void {
  if (!input || typeof input !== 'object') {
    throw new TypeError('rehearsal input is required');
  }
  assertPublicId(input.rehearsalPublicId, 'rehearsalPublicId', 160);
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 100) {
    throw new RangeError('steps must contain between 1 and 100 entries');
  }

  const seenStepIds = new Set<string>();
  const first = input.steps[0];
  if (!first || typeof first !== 'object') throw new TypeError('steps[0] is invalid');
  validateCanonicalSyncOrchestrationInput(first.orchestration);
  const tenantId = first.orchestration.tenantId;
  const sourceNodePublicId = first.orchestration.sourceNodePublicId;
  const sourceClaimOwnerPublicId = first.orchestration.sourceClaimOwnerPublicId;
  const targetClaimOwnerPublicId = first.orchestration.targetClaimOwnerPublicId;
  let previousClaimedAt = Number.NEGATIVE_INFINITY;

  for (const [index, item] of input.steps.entries()) {
    if (!item || typeof item !== 'object') {
      throw new TypeError(`steps[${index}] is invalid`);
    }
    assertPublicId(item.stepPublicId, `steps[${index}].stepPublicId`, 160);
    if (seenStepIds.has(item.stepPublicId)) {
      throw new TypeError(`duplicate stepPublicId: ${item.stepPublicId}`);
    }
    seenStepIds.add(item.stepPublicId);
    validateCanonicalSyncOrchestrationInput(item.orchestration);
    if (item.orchestration.tenantId !== tenantId) {
      throw new TypeError('all rehearsal steps must use the same tenant');
    }
    if (item.orchestration.sourceNodePublicId !== sourceNodePublicId) {
      throw new TypeError('all rehearsal steps must use the same source node');
    }
    if (item.orchestration.sourceClaimOwnerPublicId !== sourceClaimOwnerPublicId) {
      throw new TypeError('all rehearsal steps must use the same source claim owner');
    }
    if (item.orchestration.targetClaimOwnerPublicId !== targetClaimOwnerPublicId) {
      throw new TypeError('all rehearsal steps must use the same target claim owner');
    }
    const claimedAt = Date.parse(item.orchestration.timeline.sourceClaimedAtUtc);
    if (claimedAt <= previousClaimedAt) {
      throw new RangeError('sourceClaimedAtUtc must be strictly increasing between rehearsal steps');
    }
    previousClaimedAt = claimedAt;
  }
}

function sanitizeResult(
  stepPublicId: string,
  result: CanonicalSyncOrchestrationResult,
): CanonicalSyncOfflineRehearsalStepReceipt {
  if (result.status === 'idle') {
    return {
      stepPublicId,
      status: 'idle',
      eventPublicId: null,
      sourceAttemptCount: null,
      targetAttemptCount: null,
      targetReplayed: null,
      retryAtUtc: null,
      recoverAfterUtc: null,
      errorCode: null,
      errorHash: null,
    };
  }
  if (result.status === 'published') {
    return {
      stepPublicId,
      status: 'published',
      eventPublicId: result.eventPublicId,
      sourceAttemptCount: result.sourceAttemptCount,
      targetAttemptCount: result.targetAttemptCount,
      targetReplayed: result.targetReplayed,
      retryAtUtc: null,
      recoverAfterUtc: null,
      errorCode: null,
      errorHash: null,
    };
  }
  if (result.status === 'retry') {
    return {
      stepPublicId,
      status: 'retry',
      eventPublicId: result.eventPublicId,
      sourceAttemptCount: result.sourceAttemptCount,
      targetAttemptCount: null,
      targetReplayed: null,
      retryAtUtc: result.retryAtUtc,
      recoverAfterUtc: null,
      errorCode: result.errorCode,
      errorHash: result.errorHash,
    };
  }
  if (result.status === 'dead_letter') {
    return {
      stepPublicId,
      status: 'dead_letter',
      eventPublicId: result.eventPublicId,
      sourceAttemptCount: result.sourceAttemptCount,
      targetAttemptCount: null,
      targetReplayed: null,
      retryAtUtc: null,
      recoverAfterUtc: null,
      errorCode: result.errorCode,
      errorHash: result.errorHash,
    };
  }
  return {
    stepPublicId,
    status: 'source_ack_pending',
    eventPublicId: result.eventPublicId,
    sourceAttemptCount: result.sourceAttemptCount,
    targetAttemptCount: result.targetAttemptCount,
    targetReplayed: null,
    retryAtUtc: null,
    recoverAfterUtc: result.recoverAfterUtc,
    errorCode: result.errorCode,
    errorHash: result.errorHash,
  };
}

export async function runCanonicalSyncOfflineRehearsal(
  sourceDb: CanonicalBatchDatabase,
  deliveryPort: CanonicalSyncDeliveryPort,
  input: CanonicalSyncOfflineRehearsalInput,
): Promise<CanonicalSyncOfflineRehearsalReceipt> {
  validatePlan(input);
  if (!deliveryPort || typeof deliveryPort.deliver !== 'function') {
    throw new TypeError('deliveryPort.deliver is required');
  }

  const stepReceipts: CanonicalSyncOfflineRehearsalStepReceipt[] = [];
  for (const step of input.steps) {
    const result = await runCanonicalSyncOrchestrationOnce(sourceDb, deliveryPort, step.orchestration);
    stepReceipts.push(sanitizeResult(step.stepPublicId, result));
    if (result.status === 'idle') break;
  }

  const eventPublicIds = [...new Set(
    stepReceipts
      .map((receipt) => receipt.eventPublicId)
      .filter((eventPublicId): eventPublicId is string => eventPublicId !== null),
  )].sort();
  const plannedStepCount = input.steps.length;
  const executedStepCount = stepReceipts.length;
  const drained = stepReceipts.at(-1)?.status === 'idle';
  const publishedCount = stepReceipts.filter((receipt) => receipt.status === 'published').length;
  const retryCount = stepReceipts.filter((receipt) => receipt.status === 'retry').length;
  const deadLetterCount = stepReceipts.filter((receipt) => receipt.status === 'dead_letter').length;
  const sourceAckPendingCount = stepReceipts.filter((receipt) => receipt.status === 'source_ack_pending').length;
  const idleCount = stepReceipts.filter((receipt) => receipt.status === 'idle').length;
  const tenantId = input.steps[0].orchestration.tenantId;
  const sourceNodePublicId = input.steps[0].orchestration.sourceNodePublicId;
  const digestInput = {
    rehearsalPublicId: input.rehearsalPublicId,
    tenantId,
    sourceNodePublicId,
    plannedStepCount,
    executedStepCount,
    drained,
    publishedCount,
    retryCount,
    deadLetterCount,
    sourceAckPendingCount,
    idleCount,
    uniqueEventCount: eventPublicIds.length,
    eventPublicIds,
    stepReceipts,
  };

  return {
    ...digestInput,
    transcriptSha256: await createRequestFingerprint(digestInput),
  };
}
