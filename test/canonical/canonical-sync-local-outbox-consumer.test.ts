import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalBatchDatabase } from '../../src/lib/canonical/command-batch';
import type { CanonicalSyncDeliveryPort } from '../../src/lib/canonical/local-sync-delivery';
import type {
  CanonicalSyncOrchestrationInput,
  CanonicalSyncOrchestrationResult,
} from '../../src/lib/canonical/local-sync-orchestrator';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  runOnce: vi.fn(),
}));

vi.mock('../../src/lib/canonical/local-sync-orchestrator', () => ({
  validateCanonicalSyncOrchestrationInput: mocks.validate,
  runCanonicalSyncOrchestrationOnce: mocks.runOnce,
}));

import { createCanonicalSyncLocalOutboxConsumerConnection } from '../../src/lib/canonical/local-sync-consumer';

function sourceDb(): CanonicalBatchDatabase {
  return {
    prepare: vi.fn(),
    batch: vi.fn(),
  } as unknown as CanonicalBatchDatabase;
}

function deliveryPort(): CanonicalSyncDeliveryPort {
  return {
    deliver: vi.fn(),
  };
}

function orchestrationInput(): CanonicalSyncOrchestrationInput {
  return {
    tenantId: '100',
    sourceNodePublicId: 'node-local-1',
    sourceClaimOwnerPublicId: 'source-worker-1',
    targetClaimOwnerPublicId: 'target-worker-1',
    sourceMaxAttempts: 3,
    targetMaxAttempts: 3,
    timeline: {
      sourceClaimedAtUtc: '2026-07-26T01:00:00Z',
      sourceClaimExpiresAtUtc: '2026-07-26T01:10:00Z',
      targetReceivedAtUtc: '2026-07-26T01:01:00Z',
      targetClaimedAtUtc: '2026-07-26T01:02:00Z',
      targetClaimExpiresAtUtc: '2026-07-26T01:08:00Z',
      targetAppliedAtUtc: '2026-07-26T01:03:00Z',
      sourcePublishedAtUtc: '2026-07-26T01:04:00Z',
      sourceNextAttemptAtUtc: '2026-07-26T01:20:00Z',
      targetNextAttemptAtUtc: '2026-07-26T01:15:00Z',
    },
  };
}

describe('canonical local outbox consumer connection', () => {
  beforeEach(() => {
    mocks.validate.mockReset();
    mocks.runOnce.mockReset();
  });

  it('rejects an invalid source database before returning a connection', () => {
    expect(() => createCanonicalSyncLocalOutboxConsumerConnection(
      null as unknown as CanonicalBatchDatabase,
      deliveryPort(),
    )).toThrow(/sourceDb\.prepare/i);
    expect(() => createCanonicalSyncLocalOutboxConsumerConnection(
      { prepare: vi.fn() } as unknown as CanonicalBatchDatabase,
      deliveryPort(),
    )).toThrow(/sourceDb\.batch/i);
  });

  it('rejects an invalid delivery port before returning a connection', () => {
    expect(() => createCanonicalSyncLocalOutboxConsumerConnection(
      sourceDb(),
      {} as CanonicalSyncDeliveryPort,
    )).toThrow(/deliveryPort\.deliver/i);
  });

  it('validates the full orchestration input before invoking the orchestrator', async () => {
    const source = sourceDb();
    const port = deliveryPort();
    const input = orchestrationInput();
    mocks.validate.mockImplementation(() => {
      throw new RangeError('invalid deterministic timeline');
    });
    const connection = createCanonicalSyncLocalOutboxConsumerConnection(source, port);

    await expect(connection.consumeOnce(input)).rejects.toThrow(/invalid deterministic timeline/i);
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    expect(mocks.validate).toHaveBeenCalledWith(input);
    expect(mocks.runOnce).not.toHaveBeenCalled();
  });

  it('binds source and delivery dependencies and delegates exactly once', async () => {
    const source = sourceDb();
    const port = deliveryPort();
    const input = orchestrationInput();
    const result: CanonicalSyncOrchestrationResult = {
      status: 'published',
      eventPublicId: 'event-1',
      sourceAttemptCount: 1,
      targetAttemptCount: 1,
      targetReplayed: false,
    };
    mocks.runOnce.mockResolvedValue(result);
    const connection = createCanonicalSyncLocalOutboxConsumerConnection(source, port);

    await expect(connection.consumeOnce(input)).resolves.toBe(result);
    expect(connection.kind).toBe('canonical_local_outbox_consumer');
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    expect(mocks.runOnce).toHaveBeenCalledTimes(1);
    expect(mocks.runOnce).toHaveBeenCalledWith(source, port, input);
  });

  it.each<CanonicalSyncOrchestrationResult>([
    { status: 'idle' },
    {
      status: 'retry',
      eventPublicId: 'event-retry',
      sourceAttemptCount: 1,
      retryAtUtc: '2026-07-26T01:20:00Z',
      errorCode: 'CANONICAL_SYNC_TRANSPORT_FAILURE',
      errorHash: 'a'.repeat(64),
    },
    {
      status: 'dead_letter',
      eventPublicId: 'event-dead',
      sourceAttemptCount: 3,
      errorCode: 'CANONICAL_SYNC_TARGET_DEAD_LETTER',
      errorHash: 'b'.repeat(64),
    },
    {
      status: 'source_ack_pending',
      eventPublicId: 'event-ack',
      sourceAttemptCount: 1,
      targetAttemptCount: 1,
      recoverAfterUtc: '2026-07-26T01:10:00Z',
      errorCode: 'CANONICAL_SYNC_SOURCE_ACK_PENDING',
      errorHash: 'c'.repeat(64),
    },
  ])('returns the orchestrator result unchanged: $status', async (result) => {
    const source = sourceDb();
    const port = deliveryPort();
    const input = orchestrationInput();
    mocks.runOnce.mockResolvedValue(result);
    const connection = createCanonicalSyncLocalOutboxConsumerConnection(source, port);

    await expect(connection.consumeOnce(input)).resolves.toBe(result);
    expect(mocks.runOnce).toHaveBeenCalledTimes(1);
  });
});
