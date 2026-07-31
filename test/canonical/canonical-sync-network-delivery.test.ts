import { describe, expect, it, vi } from 'vitest';
import { createRequestFingerprint, stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createCanonicalSyncBusinessPayload } from '../../src/lib/canonical/local-sync-business-payload';
import type {
  CanonicalSyncDeliveryPort,
  CanonicalSyncDeliveryRequest,
  CanonicalSyncDeliveryResult,
} from '../../src/lib/canonical/local-sync-delivery';
import { createCanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-protocol';
import {
  CanonicalSyncNetworkDeliveryError,
  createCanonicalSyncNetworkDeliveryPort,
  handleCanonicalSyncNetworkDeliveryExchange,
  type CanonicalSyncNetworkExchangePort,
  type CanonicalSyncNetworkExchangeRequest,
  type CanonicalSyncNetworkExchangeResponse,
} from '../../src/lib/canonical/local-sync-network-delivery';

const ENDPOINT = 'https://sync.example.test/v1/canonical/deliver';
const PROTOCOL_HEADER = 'x-canonical-sync-protocol';
const DIGEST_HEADER = 'x-canonical-sync-request-sha256';

async function envelope() {
  return createCanonicalSyncEnvelope({
    tenantId: '100',
    eventPublicId: 'outbox-encounter-1',
    entityType: 'encounter',
    entityPublicId: 'encounter-1',
    eventType: 'canonical.encounter.started',
    aggregateVersion: 1,
    operation: 'upsert',
    occurredAtUtc: '2026-07-26T03:00:00Z',
    sourceNodePublicId: 'node-source-1',
    payload: createCanonicalSyncBusinessPayload({
      event: {
        encounterPublicId: 'encounter-1',
        encounterType: 'outpatient',
        status: 'in_progress',
      },
      mutation: {
        kind: 'encounter_started',
        entityPublicId: 'encounter-1',
        patientSyncKey: 'uhid:P-001',
        encounterType: 'outpatient',
        startedAtUtc: '2026-07-26T03:00:00Z',
        sourceEvidenceSha256: 'a'.repeat(64),
      },
    }),
    dependencies: [],
  });
}

async function deliveryRequest(): Promise<CanonicalSyncDeliveryRequest> {
  return {
    envelope: await envelope(),
    receivedAtUtc: '2026-07-26T04:00:00Z',
    targetClaimPublicId: 'target-claim-1',
    targetClaimOwnerPublicId: 'target-worker-1',
    targetClaimedAtUtc: '2026-07-26T04:01:00Z',
    targetClaimExpiresAtUtc: '2026-07-26T04:30:00Z',
    targetAppliedAtUtc: '2026-07-26T04:02:00Z',
    targetNextAttemptAtUtc: '2026-07-26T04:10:00Z',
    targetMaxAttempts: 3,
  };
}

function result(status: CanonicalSyncDeliveryResult['status']): CanonicalSyncDeliveryResult {
  if (status === 'applied') {
    return {
      status,
      eventPublicId: 'outbox-encounter-1',
      targetAttemptCount: 1,
      replayed: false,
    };
  }
  if (status === 'dead_letter') {
    return {
      status,
      eventPublicId: 'outbox-encounter-1',
      targetAttemptCount: 3,
      errorCode: 'CANONICAL_SYNC_TARGET_PERMANENT',
      errorHash: 'b'.repeat(64),
    };
  }
  if (status === 'busy') {
    return {
      status,
      eventPublicId: 'outbox-encounter-1',
      targetAttemptCount: 1,
      retryAtUtc: '2026-07-26T04:30:00Z',
      errorCode: 'CANONICAL_SYNC_TARGET_BUSY',
      errorHash: 'c'.repeat(64),
    };
  }
  return {
    status,
    eventPublicId: 'outbox-encounter-1',
    targetAttemptCount: 1,
    retryAtUtc: '2026-07-26T04:10:00Z',
    errorCode: 'CANONICAL_SYNC_TARGET_RETRY',
    errorHash: 'd'.repeat(64),
  };
}

function responseFor(
  exchangeRequest: CanonicalSyncNetworkExchangeRequest,
  deliveryResult: CanonicalSyncDeliveryResult,
): CanonicalSyncNetworkExchangeResponse {
  const body = JSON.parse(exchangeRequest.body) as { requestSha256: string };
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      [PROTOCOL_HEADER]: '1',
      [DIGEST_HEADER]: body.requestSha256,
    },
    body: stableCanonicalJson({
      protocolVersion: 1,
      requestSha256: body.requestSha256,
      result: deliveryResult,
    }),
  };
}

describe('canonical network delivery adapter', () => {
  it('rejects insecure or ambiguous endpoint configuration and missing exchange', () => {
    const exchange = { exchange: vi.fn() } satisfies CanonicalSyncNetworkExchangePort;
    for (const endpoint of [
      'http://sync.example.test/v1/canonical/deliver',
      ' https://sync.example.test/v1/canonical/deliver',
      'https://user:pass@sync.example.test/v1/canonical/deliver',
      'https://sync.example.test/',
      'https://sync.example.test/v1/canonical/deliver?tenant=100',
      'https://sync.example.test/v1/canonical/deliver#fragment',
    ]) {
      expect(() => createCanonicalSyncNetworkDeliveryPort({ endpoint, exchange }))
        .toThrow(CanonicalSyncNetworkDeliveryError);
    }
    expect(() => createCanonicalSyncNetworkDeliveryPort({
      endpoint: ENDPOINT,
      exchange: {} as CanonicalSyncNetworkExchangePort,
    })).toThrow(/exchange\.exchange/i);
  });

  it('serializes one deterministic digest-bound request and returns applied result unchanged', async () => {
    const request = await deliveryRequest();
    const exchange = vi.fn(async (wireRequest: CanonicalSyncNetworkExchangeRequest) => {
      expect(wireRequest.method).toBe('POST');
      expect(wireRequest.endpoint).toBe(ENDPOINT);
      expect(wireRequest.headers).toEqual({
        'content-type': 'application/json',
        [PROTOCOL_HEADER]: '1',
        [DIGEST_HEADER]: await createRequestFingerprint(request),
      });
      expect(wireRequest.body).toBe(stableCanonicalJson({
        protocolVersion: 1,
        requestSha256: await createRequestFingerprint(request),
        deliveryRequest: request,
      }));
      return responseFor(wireRequest, result('applied'));
    });
    const port = createCanonicalSyncNetworkDeliveryPort({
      endpoint: ENDPOINT,
      exchange: { exchange },
    });

    await expect(port.deliver(request)).resolves.toEqual(result('applied'));
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it.each(['applied', 'retry', 'dead_letter', 'busy'] as const)(
    'round-trips the exact %s target result through the receiver handler',
    async (status) => {
      const request = await deliveryRequest();
      const expected = result(status);
      const targetDeliver = vi.fn(async () => expected);
      const targetPort: CanonicalSyncDeliveryPort = { deliver: targetDeliver };
      const exchange: CanonicalSyncNetworkExchangePort = {
        exchange(wireRequest) {
          return handleCanonicalSyncNetworkDeliveryExchange(targetPort, wireRequest);
        },
      };
      const port = createCanonicalSyncNetworkDeliveryPort({ endpoint: ENDPOINT, exchange });

      await expect(port.deliver(request)).resolves.toEqual(expected);
      expect(targetDeliver).toHaveBeenCalledTimes(1);
      expect(targetDeliver).toHaveBeenCalledWith(request);
    },
  );

  it('rejects a tampered request digest before target delivery', async () => {
    const request = await deliveryRequest();
    const digest = await createRequestFingerprint(request);
    const targetDeliver = vi.fn();
    const wireRequest: CanonicalSyncNetworkExchangeRequest = {
      method: 'POST',
      endpoint: ENDPOINT,
      headers: {
        'content-type': 'application/json',
        [PROTOCOL_HEADER]: '1',
        [DIGEST_HEADER]: 'f'.repeat(64),
      },
      body: stableCanonicalJson({
        protocolVersion: 1,
        requestSha256: digest,
        deliveryRequest: request,
      }),
    };

    await expect(handleCanonicalSyncNetworkDeliveryExchange(
      { deliver: targetDeliver },
      wireRequest,
    )).rejects.toMatchObject({ code: 'CANONICAL_SYNC_NETWORK_PROTOCOL' });
    expect(targetDeliver).not.toHaveBeenCalled();
  });

  it('rejects malformed, oversized, extra-key, and wrong-protocol request bodies before target delivery', async () => {
    const request = await deliveryRequest();
    const digest = await createRequestFingerprint(request);
    const targetDeliver = vi.fn();
    const base: Omit<CanonicalSyncNetworkExchangeRequest, 'body'> = {
      method: 'POST',
      endpoint: ENDPOINT,
      headers: {
        'content-type': 'application/json',
        [PROTOCOL_HEADER]: '1',
        [DIGEST_HEADER]: digest,
      },
    };
    for (const body of [
      '{',
      'x'.repeat((2 * 1024 * 1024) + 1),
      stableCanonicalJson({ protocolVersion: 2, requestSha256: digest, deliveryRequest: request }),
      stableCanonicalJson({ protocolVersion: 1, requestSha256: digest, deliveryRequest: request, extra: true }),
    ]) {
      await expect(handleCanonicalSyncNetworkDeliveryExchange(
        { deliver: targetDeliver },
        { ...base, body },
      )).rejects.toBeInstanceOf(CanonicalSyncNetworkDeliveryError);
    }
    expect(targetDeliver).not.toHaveBeenCalled();
  });

  it('rejects non-200, tampered digest, malformed result, and wrong event response', async () => {
    const request = await deliveryRequest();
    const scenarios: Array<(wireRequest: CanonicalSyncNetworkExchangeRequest) => CanonicalSyncNetworkExchangeResponse> = [
      (wireRequest) => ({ ...responseFor(wireRequest, result('applied')), statusCode: 503 }),
      (wireRequest) => ({
        ...responseFor(wireRequest, result('applied')),
        headers: {
          ...responseFor(wireRequest, result('applied')).headers,
          [DIGEST_HEADER]: 'e'.repeat(64),
        },
      }),
      (wireRequest) => ({
        ...responseFor(wireRequest, result('applied')),
        body: stableCanonicalJson({
          protocolVersion: 1,
          requestSha256: (JSON.parse(wireRequest.body) as { requestSha256: string }).requestSha256,
          result: { status: 'applied', eventPublicId: 'outbox-encounter-1' },
        }),
      }),
      (wireRequest) => ({
        ...responseFor(wireRequest, result('applied')),
        body: stableCanonicalJson({
          protocolVersion: 1,
          requestSha256: (JSON.parse(wireRequest.body) as { requestSha256: string }).requestSha256,
          result: { ...result('applied'), eventPublicId: 'wrong-event' },
        }),
      }),
    ];

    for (const scenario of scenarios) {
      const port = createCanonicalSyncNetworkDeliveryPort({
        endpoint: ENDPOINT,
        exchange: { exchange: async (wireRequest) => scenario(wireRequest) },
      });
      await expect(port.deliver(request)).rejects.toBeInstanceOf(CanonicalSyncNetworkDeliveryError);
    }
  });
});
