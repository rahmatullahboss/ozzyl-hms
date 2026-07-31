import type { CanonicalBatchDatabase } from './command-batch';
import { createRequestFingerprint } from './idempotency';
import {
  CanonicalSyncBusinessApplyError,
  completeCanonicalSyncBusinessEvent,
} from './local-sync-business-apply';
import { CanonicalSyncBusinessPayloadError } from './local-sync-business-payload';
import {
  CanonicalSyncInboxConflictError,
  CanonicalSyncInboxStateError,
  claimCanonicalSyncInboxEvent,
  deadLetterCanonicalSyncInboxEvent,
  inspectCanonicalSyncInboxEnvelope,
  receiveCanonicalSyncEnvelope,
  scheduleCanonicalSyncRetry,
  type CanonicalSyncInboxLifecycleReceipt,
} from './local-sync-inbox';
import {
  CanonicalSyncConflictError,
  validateCanonicalSyncEnvelope,
  type CanonicalSyncEnvelope,
} from './local-sync-protocol';

export interface CanonicalSyncDeliveryRequest {
  envelope: CanonicalSyncEnvelope;
  receivedAtUtc: string;
  targetClaimPublicId: string;
  targetClaimOwnerPublicId: string;
  targetClaimedAtUtc: string;
  targetClaimExpiresAtUtc: string;
  targetAppliedAtUtc: string;
  targetNextAttemptAtUtc: string;
  targetMaxAttempts: number;
}

export type CanonicalSyncDeliveryResult =
  | {
      status: 'applied';
      eventPublicId: string;
      targetAttemptCount: number;
      replayed: boolean;
    }
  | {
      status: 'retry';
      eventPublicId: string;
      targetAttemptCount: number;
      retryAtUtc: string;
      errorCode: string;
      errorHash: string;
    }
  | {
      status: 'dead_letter';
      eventPublicId: string;
      targetAttemptCount: number;
      errorCode: string;
      errorHash: string;
    }
  | {
      status: 'busy';
      eventPublicId: string;
      targetAttemptCount: number;
      retryAtUtc: string;
      errorCode: 'CANONICAL_SYNC_TARGET_BUSY';
      errorHash: string;
    };

export interface CanonicalSyncDeliveryPort {
  deliver(request: CanonicalSyncDeliveryRequest): Promise<CanonicalSyncDeliveryResult>;
}

interface ErrorEvidence {
  errorCode: string;
  errorHash: string;
  permanent: boolean;
}

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
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

export function validateCanonicalSyncDeliveryRequest(request: CanonicalSyncDeliveryRequest): void {
  assertUtc(request.receivedAtUtc, 'receivedAtUtc');
  assertPublicId(request.targetClaimPublicId, 'targetClaimPublicId', 160);
  assertPublicId(request.targetClaimOwnerPublicId, 'targetClaimOwnerPublicId', 192);
  assertUtc(request.targetClaimedAtUtc, 'targetClaimedAtUtc');
  assertUtc(request.targetClaimExpiresAtUtc, 'targetClaimExpiresAtUtc');
  assertUtc(request.targetAppliedAtUtc, 'targetAppliedAtUtc');
  assertUtc(request.targetNextAttemptAtUtc, 'targetNextAttemptAtUtc');
  assertPositiveInteger(request.targetMaxAttempts, 'targetMaxAttempts');
  if (Date.parse(request.receivedAtUtc) > Date.parse(request.targetClaimedAtUtc)) {
    throw new RangeError('receivedAtUtc must not be later than targetClaimedAtUtc');
  }
  if (Date.parse(request.targetClaimExpiresAtUtc) <= Date.parse(request.targetClaimedAtUtc)) {
    throw new RangeError('targetClaimExpiresAtUtc must be later than targetClaimedAtUtc');
  }
  if (Date.parse(request.targetAppliedAtUtc) < Date.parse(request.targetClaimedAtUtc)) {
    throw new RangeError('targetAppliedAtUtc must not be earlier than targetClaimedAtUtc');
  }
  if (Date.parse(request.targetAppliedAtUtc) >= Date.parse(request.targetClaimExpiresAtUtc)) {
    throw new RangeError('targetAppliedAtUtc must be earlier than targetClaimExpiresAtUtc');
  }
  if (Date.parse(request.targetNextAttemptAtUtc) <= Date.parse(request.targetAppliedAtUtc)) {
    throw new RangeError('targetNextAttemptAtUtc must be later than targetAppliedAtUtc');
  }
}

function stableCode(error: unknown, permanent: boolean): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && CODE_PATTERN.test(code)) return code;
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return 'CANONICAL_SYNC_TARGET_INVALID';
  }
  return permanent ? 'CANONICAL_SYNC_TARGET_PERMANENT' : 'CANONICAL_SYNC_TARGET_RETRY';
}

function isPermanent(error: unknown): boolean {
  return error instanceof CanonicalSyncConflictError
    || error instanceof CanonicalSyncInboxConflictError
    || error instanceof CanonicalSyncBusinessPayloadError
    || error instanceof TypeError
    || error instanceof RangeError;
}

async function errorEvidence(phase: string, error: unknown): Promise<ErrorEvidence> {
  const permanent = isPermanent(error);
  const errorCode = stableCode(error, permanent);
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const messageHash = await createRequestFingerprint(message);
  const errorHash = await createRequestFingerprint({
    phase,
    name,
    errorCode,
    messageHash,
  });
  return { errorCode, errorHash, permanent };
}

async function busyResult(
  state: CanonicalSyncInboxLifecycleReceipt,
): Promise<CanonicalSyncDeliveryResult> {
  if (state.claimExpiresAtUtc == null) {
    throw new CanonicalSyncInboxStateError(
      `Canonical sync target busy evidence is incomplete for ${state.eventPublicId}`,
    );
  }
  return {
    status: 'busy',
    eventPublicId: state.eventPublicId,
    targetAttemptCount: state.attemptCount,
    retryAtUtc: state.claimExpiresAtUtc,
    errorCode: 'CANONICAL_SYNC_TARGET_BUSY',
    errorHash: await createRequestFingerprint({
      phase: 'target-busy',
      eventPublicId: state.eventPublicId,
      targetAttemptCount: state.attemptCount,
      retryAtUtc: state.claimExpiresAtUtc,
    }),
  };
}

function storedFailureResult(
  state: CanonicalSyncInboxLifecycleReceipt,
): CanonicalSyncDeliveryResult {
  if (state.errorCode == null || state.errorHash == null) {
    throw new CanonicalSyncInboxStateError(
      `Canonical sync target failure evidence is incomplete for ${state.eventPublicId}`,
    );
  }
  if (state.status === 'dead_letter') {
    return {
      status: 'dead_letter',
      eventPublicId: state.eventPublicId,
      targetAttemptCount: state.attemptCount,
      errorCode: state.errorCode,
      errorHash: state.errorHash,
    };
  }
  if (state.status === 'retry' && state.nextAttemptAtUtc != null) {
    return {
      status: 'retry',
      eventPublicId: state.eventPublicId,
      targetAttemptCount: state.attemptCount,
      retryAtUtc: state.nextAttemptAtUtc,
      errorCode: state.errorCode,
      errorHash: state.errorHash,
    };
  }
  throw new CanonicalSyncInboxStateError(
    `Canonical sync target failure status is invalid for ${state.eventPublicId}`,
  );
}

async function inspectAfterClaimRace(
  targetDb: CanonicalBatchDatabase,
  request: CanonicalSyncDeliveryRequest,
): Promise<CanonicalSyncDeliveryResult> {
  const state = await inspectCanonicalSyncInboxEnvelope(targetDb, request.envelope);
  if (!state) {
    throw new CanonicalSyncInboxStateError(
      `Canonical sync target evidence disappeared for ${request.envelope.eventPublicId}`,
    );
  }
  if (state.status === 'applied') {
    return {
      status: 'applied',
      eventPublicId: state.eventPublicId,
      targetAttemptCount: state.attemptCount,
      replayed: true,
    };
  }
  if (state.status === 'dead_letter' || state.status === 'retry') return storedFailureResult(state);
  if (state.status === 'applying') return busyResult(state);
  const evidence = await errorEvidence(
    'target-claim-race',
    new CanonicalSyncInboxStateError(`Canonical sync target claim raced for ${state.eventPublicId}`),
  );
  return {
    status: 'retry',
    eventPublicId: state.eventPublicId,
    targetAttemptCount: state.attemptCount,
    retryAtUtc: request.targetNextAttemptAtUtc,
    errorCode: evidence.errorCode,
    errorHash: evidence.errorHash,
  };
}

export function createCanonicalSyncDatabaseDeliveryPort(
  targetDb: CanonicalBatchDatabase,
): CanonicalSyncDeliveryPort {
  return {
    async deliver(request: CanonicalSyncDeliveryRequest): Promise<CanonicalSyncDeliveryResult> {
      validateCanonicalSyncDeliveryRequest(request);
      await validateCanonicalSyncEnvelope(request.envelope);
      const receiveResult = await receiveCanonicalSyncEnvelope(
        targetDb,
        request.envelope,
        request.receivedAtUtc,
      );
      let state = await inspectCanonicalSyncInboxEnvelope(targetDb, request.envelope);
      if (!state) {
        throw new CanonicalSyncInboxStateError(
          `Canonical sync target receive receipt is missing for ${request.envelope.eventPublicId}`,
        );
      }

      if (state.status === 'applied') {
        return {
          status: 'applied',
          eventPublicId: state.eventPublicId,
          targetAttemptCount: state.attemptCount,
          replayed: true,
        };
      }
      if (state.status === 'dead_letter') return storedFailureResult(state);
      if (
        state.status === 'applying'
        && state.claimExpiresAtUtc != null
        && Date.parse(state.claimExpiresAtUtc) > Date.parse(request.targetClaimedAtUtc)
      ) {
        return busyResult(state);
      }
      if (
        state.status === 'retry'
        && state.nextAttemptAtUtc != null
        && Date.parse(state.nextAttemptAtUtc) > Date.parse(request.targetClaimedAtUtc)
      ) {
        return storedFailureResult(state);
      }

      let claim;
      try {
        claim = await claimCanonicalSyncInboxEvent(targetDb, {
          tenantId: request.envelope.tenantId,
          eventPublicId: request.envelope.eventPublicId,
          claimPublicId: request.targetClaimPublicId,
          claimOwnerPublicId: request.targetClaimOwnerPublicId,
          claimedAtUtc: request.targetClaimedAtUtc,
          claimExpiresAtUtc: request.targetClaimExpiresAtUtc,
        });
      } catch (error) {
        if (error instanceof CanonicalSyncInboxStateError) {
          return inspectAfterClaimRace(targetDb, request);
        }
        throw error;
      }

      try {
        await completeCanonicalSyncBusinessEvent(targetDb, {
          envelope: request.envelope,
          claimPublicId: claim.claimPublicId,
          appliedAtUtc: request.targetAppliedAtUtc,
        });
        return {
          status: 'applied',
          eventPublicId: request.envelope.eventPublicId,
          targetAttemptCount: claim.attemptCount,
          replayed: receiveResult.status === 'replayed',
        };
      } catch (error) {
        const evidence = await errorEvidence('target-apply', error);
        const terminal = evidence.permanent || claim.attemptCount >= request.targetMaxAttempts;
        if (terminal) {
          await deadLetterCanonicalSyncInboxEvent(targetDb, {
            tenantId: request.envelope.tenantId,
            eventPublicId: request.envelope.eventPublicId,
            claimPublicId: claim.claimPublicId,
            updatedAtUtc: request.targetAppliedAtUtc,
            errorCode: evidence.errorCode,
            errorHash: evidence.errorHash,
          });
          return {
            status: 'dead_letter',
            eventPublicId: request.envelope.eventPublicId,
            targetAttemptCount: claim.attemptCount,
            errorCode: evidence.errorCode,
            errorHash: evidence.errorHash,
          };
        }
        await scheduleCanonicalSyncRetry(targetDb, {
          tenantId: request.envelope.tenantId,
          eventPublicId: request.envelope.eventPublicId,
          claimPublicId: claim.claimPublicId,
          updatedAtUtc: request.targetAppliedAtUtc,
          nextAttemptAtUtc: request.targetNextAttemptAtUtc,
          errorCode: evidence.errorCode,
          errorHash: evidence.errorHash,
        });
        return {
          status: 'retry',
          eventPublicId: request.envelope.eventPublicId,
          targetAttemptCount: claim.attemptCount,
          retryAtUtc: request.targetNextAttemptAtUtc,
          errorCode: evidence.errorCode,
          errorHash: evidence.errorHash,
        };
      } finally {
        state = await inspectCanonicalSyncInboxEnvelope(targetDb, request.envelope);
        if (!state) {
          throw new CanonicalSyncInboxStateError(
            `Canonical sync target lifecycle receipt disappeared for ${request.envelope.eventPublicId}`,
          );
        }
      }
    },
  };
}

export const CANONICAL_SYNC_DELIVERY_RETRYABLE_ERROR_CLASSES = Object.freeze([
  CanonicalSyncBusinessApplyError.name,
  CanonicalSyncInboxStateError.name,
]);
