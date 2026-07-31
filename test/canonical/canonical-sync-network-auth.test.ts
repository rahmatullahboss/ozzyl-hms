import { describe, expect, it, vi } from 'vitest';
import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import type {
  CanonicalSyncNetworkExchangePort,
  CanonicalSyncNetworkExchangeRequest,
  CanonicalSyncNetworkExchangeResponse,
} from '../../src/lib/canonical/local-sync-network-delivery';
import {
  CanonicalSyncNetworkAuthenticationError,
  buildCanonicalSyncAuthenticationMessage,
  createCanonicalSyncAuthenticatedNetworkExchangePort,
  handleCanonicalSyncAuthenticatedNetworkExchange,
  type CanonicalSyncAuthenticationReplayStore,
} from '../../src/lib/canonical/local-sync-network-auth';

const ENDPOINT = 'https://sync.example.test/v1/canonical/deliver';
const REQUEST_DIGEST = 'a'.repeat(64);
const SIGNATURE = 'A'.repeat(43);
const EVENT_ID = 'outbox-encounter-1';
const KEY_ID = 'key-sync-1';
const NONCE_ID = 'nonce-sync-1';
const SIGNED_AT = '2026-07-26T05:00:00Z';
const ACCEPTED_AT = '2026-07-26T05:00:30Z';

const BASE_HEADERS = {
  'content-type': 'application/json',
  'x-canonical-sync-protocol': '1',
  'x-canonical-sync-request-sha256': REQUEST_DIGEST,
} as const;

function baseRequest(overrides: Partial<CanonicalSyncNetworkExchangeRequest> = {}): CanonicalSyncNetworkExchangeRequest {
  return {
    method: 'POST',
    endpoint: ENDPOINT,
    headers: BASE_HEADERS,
    body: stableCanonicalJson({
      protocolVersion: 1,
      requestSha256: REQUEST_DIGEST,
      deliveryRequest: {
        envelope: { eventPublicId: EVENT_ID },
      },
    }),
    ...overrides,
  };
}

function baseResponse(
  request: CanonicalSyncNetworkExchangeRequest,
  overrides: Partial<CanonicalSyncNetworkExchangeResponse> = {},
): CanonicalSyncNetworkExchangeResponse {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      'x-canonical-sync-protocol': '1',
      'x-canonical-sync-request-sha256': request.headers['x-canonical-sync-request-sha256'],
    },
    body: stableCanonicalJson({ ok: true }),
    ...overrides,
  };
}

function authenticatedHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...BASE_HEADERS,
    'x-canonical-sync-auth-version': '1',
    'x-canonical-sync-key-id': KEY_ID,
    'x-canonical-sync-signed-at': SIGNED_AT,
    'x-canonical-sync-nonce': NONCE_ID,
    'x-canonical-sync-signature': SIGNATURE,
    ...overrides,
  };
}

function authenticatedRequest(overrides: Partial<CanonicalSyncNetworkExchangeRequest> = {}): CanonicalSyncNetworkExchangeRequest {
  return baseRequest({
    headers: authenticatedHeaders(),
    ...overrides,
  });
}

function replayStore(
  result: 'reserved' | 'exact_replay' | 'conflict' = 'reserved',
): CanonicalSyncAuthenticationReplayStore & { reserve: ReturnType<typeof vi.fn> } {
  return {
    reserve: vi.fn(async () => result),
  };
}

function receiverOptions(overrides: Record<string, unknown> = {}) {
  return {
    verifier: { verify: vi.fn(async () => true) },
    replayStore: replayStore(),
    targetExchange: {
      exchange: vi.fn(async (request: CanonicalSyncNetworkExchangeRequest) => baseResponse(request)),
    },
    acceptedAtUtc: ACCEPTED_AT,
    maxClockSkewSeconds: 300,
    ...overrides,
  };
}

describe('canonical network authentication evidence contract', () => {
  it('builds the exact deterministic canonical signing message', () => {
    expect(buildCanonicalSyncAuthenticationMessage({
      endpoint: ENDPOINT,
      keyId: KEY_ID,
      signedAtUtc: SIGNED_AT,
      noncePublicId: NONCE_ID,
      requestSha256: REQUEST_DIGEST,
      eventPublicId: EVENT_ID,
    })).toBe([
      'CANONICAL-SYNC-AUTH-V1',
      'POST',
      ENDPOINT,
      '1',
      KEY_ID,
      SIGNED_AT,
      NONCE_ID,
      REQUEST_DIGEST,
      EVENT_ID,
    ].join('\n'));
  });

  it('rejects missing sender dependencies before returning an exchange port', () => {
    const valid = {
      innerExchange: { exchange: vi.fn() },
      evidenceProvider: { provide: vi.fn() },
      signer: { sign: vi.fn() },
    };
    expect(() => createCanonicalSyncAuthenticatedNetworkExchangePort({
      ...valid,
      innerExchange: {} as CanonicalSyncNetworkExchangePort,
    })).toThrow(/innerExchange\.exchange/i);
    expect(() => createCanonicalSyncAuthenticatedNetworkExchangePort({
      ...valid,
      evidenceProvider: {} as never,
    })).toThrow(/evidenceProvider\.provide/i);
    expect(() => createCanonicalSyncAuthenticatedNetworkExchangePort({
      ...valid,
      signer: {} as never,
    })).toThrow(/signer\.sign/i);
  });

  it('adds exact authentication headers, signs once, and strips receipt headers from the response', async () => {
    const provider = vi.fn(async () => ({
      keyId: KEY_ID,
      signedAtUtc: SIGNED_AT,
      noncePublicId: NONCE_ID,
    }));
    const signer = vi.fn(async () => SIGNATURE);
    const innerExchange = vi.fn(async (request: CanonicalSyncNetworkExchangeRequest) => {
      expect(request.headers).toEqual(authenticatedHeaders());
      expect(request.body).toBe(baseRequest().body);
      return {
        ...baseResponse(request),
        headers: {
          ...BASE_HEADERS,
          'x-canonical-sync-auth-version': '1',
          'x-canonical-sync-key-id': KEY_ID,
          'x-canonical-sync-nonce': NONCE_ID,
          'x-canonical-sync-auth-replay': 'reserved',
        },
      };
    });
    const port = createCanonicalSyncAuthenticatedNetworkExchangePort({
      innerExchange: { exchange: innerExchange },
      evidenceProvider: { provide: provider },
      signer: { sign: signer },
    });

    await expect(port.exchange(baseRequest())).resolves.toEqual(baseResponse(baseRequest()));
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledWith({
      endpoint: ENDPOINT,
      requestSha256: REQUEST_DIGEST,
      eventPublicId: EVENT_ID,
    });
    expect(signer).toHaveBeenCalledTimes(1);
    expect(signer).toHaveBeenCalledWith({
      keyId: KEY_ID,
      canonicalMessage: buildCanonicalSyncAuthenticationMessage({
        endpoint: ENDPOINT,
        keyId: KEY_ID,
        signedAtUtc: SIGNED_AT,
        noncePublicId: NONCE_ID,
        requestSha256: REQUEST_DIGEST,
        eventPublicId: EVENT_ID,
      }),
    });
  });

  it.each(['reserved', 'exact_replay'] as const)(
    'verifies signature, reserves %s evidence, and invokes the target exactly once',
    async (reservation) => {
      const verifier = vi.fn(async () => true);
      const store = replayStore(reservation);
      const targetExchange = vi.fn(async (request: CanonicalSyncNetworkExchangeRequest) => baseResponse(request));
      const response = await handleCanonicalSyncAuthenticatedNetworkExchange({
        verifier: { verify: verifier },
        replayStore: store,
        targetExchange: { exchange: targetExchange },
        acceptedAtUtc: ACCEPTED_AT,
        maxClockSkewSeconds: 300,
      }, authenticatedRequest());

      expect(verifier).toHaveBeenCalledTimes(1);
      expect(store.reserve).toHaveBeenCalledTimes(1);
      expect(targetExchange).toHaveBeenCalledTimes(1);
      expect(targetExchange.mock.calls[0][0]).toEqual(baseRequest());
      expect(response.headers).toEqual({
        ...BASE_HEADERS,
        'x-canonical-sync-auth-version': '1',
        'x-canonical-sync-key-id': KEY_ID,
        'x-canonical-sync-nonce': NONCE_ID,
        'x-canonical-sync-auth-replay': reservation,
      });
    },
  );

  it('rejects invalid signatures before replay reservation and target invocation', async () => {
    const store = replayStore();
    const targetExchange = vi.fn();
    const options = receiverOptions({
      verifier: { verify: vi.fn(async () => false) },
      replayStore: store,
      targetExchange: { exchange: targetExchange },
    });

    await expect(handleCanonicalSyncAuthenticatedNetworkExchange(options, authenticatedRequest()))
      .rejects.toMatchObject({ code: 'CANONICAL_SYNC_AUTH_SIGNATURE' });
    expect(store.reserve).not.toHaveBeenCalled();
    expect(targetExchange).not.toHaveBeenCalled();
  });

  it.each([
    ['2026-07-26T04:54:59Z', 'stale'],
    ['2026-07-26T05:05:31Z', 'future'],
  ])('rejects a %s signed timestamp outside the explicit skew window', async (signedAtUtc) => {
    const store = replayStore();
    const targetExchange = vi.fn();
    await expect(handleCanonicalSyncAuthenticatedNetworkExchange(
      receiverOptions({ replayStore: store, targetExchange: { exchange: targetExchange } }),
      authenticatedRequest({ headers: authenticatedHeaders({ 'x-canonical-sync-signed-at': signedAtUtc }) }),
    )).rejects.toMatchObject({ code: 'CANONICAL_SYNC_AUTH_FRESHNESS' });
    expect(store.reserve).not.toHaveBeenCalled();
    expect(targetExchange).not.toHaveBeenCalled();
  });

  it('rejects nonce conflict before target invocation', async () => {
    const store = replayStore('conflict');
    const targetExchange = vi.fn();
    await expect(handleCanonicalSyncAuthenticatedNetworkExchange(
      receiverOptions({ replayStore: store, targetExchange: { exchange: targetExchange } }),
      authenticatedRequest(),
    )).rejects.toMatchObject({ code: 'CANONICAL_SYNC_AUTH_REPLAY' });
    expect(targetExchange).not.toHaveBeenCalled();
  });

  it.each([
    ['x-canonical-sync-key-id', 'other-key'],
    ['x-canonical-sync-nonce', 'other-nonce'],
  ])('rejects signature-bound authentication evidence tampering in %s', async (header, value) => {
    const expectedMessage = buildCanonicalSyncAuthenticationMessage({
      endpoint: ENDPOINT,
      keyId: KEY_ID,
      signedAtUtc: SIGNED_AT,
      noncePublicId: NONCE_ID,
      requestSha256: REQUEST_DIGEST,
      eventPublicId: EVENT_ID,
    });
    const options = receiverOptions({
      verifier: {
        verify: vi.fn(async ({ canonicalMessage }: { canonicalMessage: string }) => canonicalMessage === expectedMessage),
      },
    });
    await expect(handleCanonicalSyncAuthenticatedNetworkExchange(
      options,
      authenticatedRequest({ headers: authenticatedHeaders({ [header]: value }) }),
    )).rejects.toMatchObject({ code: 'CANONICAL_SYNC_AUTH_SIGNATURE' });
  });

  it.each([
    ['x-canonical-sync-signature', 'invalid'],
    ['x-canonical-sync-request-sha256', 'b'.repeat(64)],
  ])('rejects malformed authentication evidence in %s', async (header, value) => {
    await expect(handleCanonicalSyncAuthenticatedNetworkExchange(
      receiverOptions(),
      authenticatedRequest({ headers: authenticatedHeaders({ [header]: value }) }),
    )).rejects.toBeInstanceOf(CanonicalSyncNetworkAuthenticationError);
  });

  it('rejects missing receiver dependencies and invalid explicit freshness policy', async () => {
    for (const options of [
      receiverOptions({ verifier: {} }),
      receiverOptions({ replayStore: {} }),
      receiverOptions({ targetExchange: {} }),
      receiverOptions({ acceptedAtUtc: 'invalid' }),
      receiverOptions({ maxClockSkewSeconds: 0 }),
      receiverOptions({ maxClockSkewSeconds: 901 }),
    ]) {
      await expect(handleCanonicalSyncAuthenticatedNetworkExchange(options, authenticatedRequest()))
        .rejects.toBeInstanceOf(CanonicalSyncNetworkAuthenticationError);
    }
  });

  it('rejects mismatched authentication receipt evidence on the sender', async () => {
    const scenarios = [
      { 'x-canonical-sync-key-id': 'wrong-key' },
      { 'x-canonical-sync-nonce': 'wrong-nonce' },
      { 'x-canonical-sync-auth-replay': 'conflict' },
    ];
    for (const receiptOverride of scenarios) {
      const port = createCanonicalSyncAuthenticatedNetworkExchangePort({
        innerExchange: {
          async exchange(request) {
            return {
              ...baseResponse(request),
              headers: {
                ...BASE_HEADERS,
                'x-canonical-sync-auth-version': '1',
                'x-canonical-sync-key-id': KEY_ID,
                'x-canonical-sync-nonce': NONCE_ID,
                'x-canonical-sync-auth-replay': 'reserved',
                ...receiptOverride,
              },
            };
          },
        },
        evidenceProvider: {
          async provide() {
            return { keyId: KEY_ID, signedAtUtc: SIGNED_AT, noncePublicId: NONCE_ID };
          },
        },
        signer: { async sign() { return SIGNATURE; } },
      });
      await expect(port.exchange(baseRequest())).rejects.toMatchObject({
        code: 'CANONICAL_SYNC_AUTH_RESPONSE',
      });
    }
  });
});
