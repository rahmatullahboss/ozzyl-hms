import type { CanonicalBatchDatabase } from './command-batch';
import type { CanonicalSyncDeliveryPort } from './local-sync-delivery';
import {
  runCanonicalSyncOrchestrationOnce,
  validateCanonicalSyncOrchestrationInput,
  type CanonicalSyncOrchestrationInput,
  type CanonicalSyncOrchestrationResult,
} from './local-sync-orchestrator';

export interface CanonicalSyncLocalOutboxConsumerConnection {
  readonly kind: 'canonical_local_outbox_consumer';
  consumeOnce(
    input: CanonicalSyncOrchestrationInput,
  ): Promise<CanonicalSyncOrchestrationResult>;
}

function assertSourceDatabase(
  sourceDb: CanonicalBatchDatabase,
): asserts sourceDb is CanonicalBatchDatabase {
  if (!sourceDb || typeof sourceDb.prepare !== 'function') {
    throw new TypeError('sourceDb.prepare is required');
  }
  if (typeof sourceDb.batch !== 'function') {
    throw new TypeError('sourceDb.batch is required');
  }
}

function assertDeliveryPort(
  deliveryPort: CanonicalSyncDeliveryPort,
): asserts deliveryPort is CanonicalSyncDeliveryPort {
  if (!deliveryPort || typeof deliveryPort.deliver !== 'function') {
    throw new TypeError('deliveryPort.deliver is required');
  }
}

export function createCanonicalSyncLocalOutboxConsumerConnection(
  sourceDb: CanonicalBatchDatabase,
  deliveryPort: CanonicalSyncDeliveryPort,
): CanonicalSyncLocalOutboxConsumerConnection {
  assertSourceDatabase(sourceDb);
  assertDeliveryPort(deliveryPort);

  return Object.freeze({
    kind: 'canonical_local_outbox_consumer' as const,
    async consumeOnce(
      input: CanonicalSyncOrchestrationInput,
    ): Promise<CanonicalSyncOrchestrationResult> {
      validateCanonicalSyncOrchestrationInput(input);
      return runCanonicalSyncOrchestrationOnce(sourceDb, deliveryPort, input);
    },
  });
}
