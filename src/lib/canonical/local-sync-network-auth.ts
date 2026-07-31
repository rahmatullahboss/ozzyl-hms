import type {
  CanonicalSyncNetworkExchangePort,
  CanonicalSyncNetworkExchangeRequest,
  CanonicalSyncNetworkExchangeResponse,
} from './local-sync-network-delivery';

export const CANONICAL_SYNC_AUTH_PROTOCOL_VERSION = 1 as const;

const CONTENT_TYPE_HEADER = 'content-type';
const NETWORK_PROTOCOL_HEADER = 'x-canonical-sync-protocol';
const REQUEST_DIGEST_HEADER = 'x-canonical-sync-request-sha256';
const AUTH_VERSION_HEADER = 'x-canonical-sync-auth-version';
const AUTH_KEY_ID_HEADER = 'x-canonical-sync-key-id';
const AUTH_SIGNED_AT_HEADER = 'x-canonical-sync-signed-at';
const AUTH_NONCE_HEADER = 'x-canonical-sync-nonce';
const AUTH_SIGNATURE_HEADER = 'x-canonical-sync-signature';
const AUTH_REPLAY_HEADER = 'x-canonical-sync-auth-replay';
const JSON_CONTENT_TYPE = 'application/json';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43,684}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const BASE_REQUEST_HEADERS = [
  CONTENT_TYPE_HEADER,
  NETWORK_PROTOCOL_HEADER,
  REQUEST_DIGEST_HEADER,
] as const;
const AUTH_REQUEST_HEADERS = [
  ...BASE_REQUEST_HEADERS,
  AUTH_VERSION_HEADER,
  AUTH_KEY_ID_HEADER,
  AUTH_SIGNED_AT_HEADER,
  AUTH_NONCE_HEADER,
  AUTH_SIGNATURE_HEADER,
] as const;
const BASE_RESPONSE_HEADERS = BASE_REQUEST_HEADERS;
const AUTH_RESPONSE_HEADERS = [
  ...BASE_RESPONSE_HEADERS,
  AUTH_VERSION_HEADER,
  AUTH_KEY_ID_HEADER,
  AUTH_NONCE_HEADER,
  AUTH_REPLAY_HEADER,
] as const;

export type CanonicalSyncNetworkAuthenticationErrorCode =
  | 'CANONICAL_SYNC_AUTH_CONFIG'
  | 'CANONICAL_SYNC_AUTH_EVIDENCE'
  | 'CANONICAL_SYNC_AUTH_FRESHNESS'
  | 'CANONICAL_SYNC_AUTH_SIGNATURE'
  | 'CANONICAL_SYNC_AUTH_REPLAY'
  | 'CANONICAL_SYNC_AUTH_RESPONSE';

export class CanonicalSyncNetworkAuthenticationError extends Error {
  readonly code: CanonicalSyncNetworkAuthenticationErrorCode;

  constructor(code: CanonicalSyncNetworkAuthenticationErrorCode, message: string) {
    super(message);
    this.name = 'CanonicalSyncNetworkAuthenticationError';
    this.code = code;
  }
}

export interface CanonicalSyncAuthenticationEvidence {
  keyId: string;
  signedAtUtc: string;
  noncePublicId: string;
}

export interface CanonicalSyncAuthenticationEvidenceProvider {
  provide(input: {
    endpoint: string;
    requestSha256: string;
    eventPublicId: string;
  }): Promise<CanonicalSyncAuthenticationEvidence>;
}

export interface CanonicalSyncAuthenticationSignerPort {
  sign(input: {
    keyId: string;
    canonicalMessage: string;
  }): Promise<string>;
}

export interface CanonicalSyncAuthenticationVerifierPort {
  verify(input: {
    keyId: string;
    canonicalMessage: string;
    signature: string;
  }): Promise<boolean>;
}

export type CanonicalSyncAuthenticationReplayReservation =
  | 'reserved'
  | 'exact_replay'
  | 'conflict';

export interface CanonicalSyncAuthenticationReplayStore {
  reserve(input: {
    keyId: string;
    noncePublicId: string;
    requestSha256: string;
    eventPublicId: string;
    signedAtUtc: string;
    acceptedAtUtc: string;
  }): Promise<CanonicalSyncAuthenticationReplayReservation>;
}

export interface CanonicalSyncAuthenticationMessageInput
  extends CanonicalSyncAuthenticationEvidence {
  endpoint: string;
  requestSha256: string;
  eventPublicId: string;
}

export interface CanonicalSyncAuthenticatedNetworkExchangePortOptions {
  innerExchange: CanonicalSyncNetworkExchangePort;
  evidenceProvider: CanonicalSyncAuthenticationEvidenceProvider;
  signer: CanonicalSyncAuthenticationSignerPort;
}

export interface CanonicalSyncAuthenticatedNetworkReceiverOptions {
  verifier: CanonicalSyncAuthenticationVerifierPort;
  replayStore: CanonicalSyncAuthenticationReplayStore;
  targetExchange: CanonicalSyncNetworkExchangePort;
  acceptedAtUtc: string;
  maxClockSkewSeconds: number;
}

interface NetworkRequestIdentity {
  endpoint: string;
  requestSha256: string;
  eventPublicId: string;
}

function fail(
  code: CanonicalSyncNetworkAuthenticationErrorCode,
  message: string,
): never {
  throw new CanonicalSyncNetworkAuthenticationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
  code: CanonicalSyncNetworkAuthenticationErrorCode,
): void {
  const actual = Object.keys(value).sort();
  const normalizedExpected = [...expected].sort();
  if (
    actual.length !== normalizedExpected.length
    || !actual.every((key, index) => key === normalizedExpected[index])
  ) {
    fail(code, `${label} must contain exactly: ${normalizedExpected.join(', ')}`);
  }
}

function assertExactString(
  value: unknown,
  label: string,
  maxLength: number,
  code: CanonicalSyncNetworkAuthenticationErrorCode,
): asserts value is string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || value.length > maxLength
  ) {
    fail(code, `${label} must be non-empty without surrounding whitespace and at most ${maxLength} characters`);
  }
}

function assertPublicId(
  value: unknown,
  label: string,
  maxLength: number,
  code: CanonicalSyncNetworkAuthenticationErrorCode,
): asserts value is string {
  assertExactString(value, label, maxLength, code);
  if (/^\d+$/.test(value)) fail(code, `${label} must be a stable public identifier`);
}

function assertDigest(
  value: unknown,
  label: string,
  code: CanonicalSyncNetworkAuthenticationErrorCode,
): asserts value is string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(code, `${label} must be a lowercase SHA-256 digest`);
  }
}

function assertUtc(
  value: unknown,
  label: string,
  code: CanonicalSyncNetworkAuthenticationErrorCode,
): asserts value is string {
  if (typeof value !== 'string' || !UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(code, `${label} must be a valid ISO-8601 UTC timestamp`);
  }
}

function assertSignature(
  value: unknown,
  label: string,
  code: CanonicalSyncNetworkAuthenticationErrorCode,
): asserts value is string {
  if (typeof value !== 'string' || !SIGNATURE_PATTERN.test(value)) {
    fail(code, `${label} must be an unpadded base64url signature`);
  }
}

function validateEndpoint(
  value: unknown,
  code: CanonicalSyncNetworkAuthenticationErrorCode,
): string {
  assertExactString(value, 'endpoint', 2048, code);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(code, 'endpoint must be an absolute URL');
  }
  if (parsed.protocol !== 'https:') fail(code, 'endpoint must use HTTPS');
  if (parsed.username !== '' || parsed.password !== '') fail(code, 'endpoint must not contain credentials');
  if (parsed.search !== '' || parsed.hash !== '') fail(code, 'endpoint must not contain query or fragment components');
  if (parsed.hostname === '' || parsed.pathname === '' || parsed.pathname === '/') {
    fail(code, 'endpoint must contain a host and non-root path');
  }
  return value;
}

function validateEvidence(
  value: unknown,
  code: CanonicalSyncNetworkAuthenticationErrorCode,
): CanonicalSyncAuthenticationEvidence {
  if (!isRecord(value)) fail(code, 'authentication evidence must be an object');
  assertExactKeys(value, ['keyId', 'signedAtUtc', 'noncePublicId'], 'authentication evidence', code);
  assertPublicId(value.keyId, 'keyId', 128, code);
  assertUtc(value.signedAtUtc, 'signedAtUtc', code);
  assertPublicId(value.noncePublicId, 'noncePublicId', 192, code);
  return value as unknown as CanonicalSyncAuthenticationEvidence;
}

function validateBaseHeaders(
  headers: unknown,
  expected: readonly string[],
  code: CanonicalSyncNetworkAuthenticationErrorCode,
): Record<string, string> {
  if (!isRecord(headers)) fail(code, 'headers must be an object');
  assertExactKeys(headers, expected, 'headers', code);
  if (headers[CONTENT_TYPE_HEADER] !== JSON_CONTENT_TYPE) fail(code, 'content-type must be application/json');
  if (headers[NETWORK_PROTOCOL_HEADER] !== '1') fail(code, 'x-canonical-sync-protocol must be 1');
  assertDigest(headers[REQUEST_DIGEST_HEADER], REQUEST_DIGEST_HEADER, code);
  return headers as Record<string, string>;
}

function parseRequestIdentity(
  request: unknown,
  expectedHeaders: readonly string[],
  code: CanonicalSyncNetworkAuthenticationErrorCode,
): NetworkRequestIdentity {
  if (!isRecord(request)) fail(code, 'network exchange request must be an object');
  assertExactKeys(request, ['method', 'endpoint', 'headers', 'body'], 'network exchange request', code);
  if (request.method !== 'POST') fail(code, 'network exchange method must be POST');
  const endpoint = validateEndpoint(request.endpoint, code);
  const headers = validateBaseHeaders(request.headers, expectedHeaders, code);
  if (typeof request.body !== 'string' || request.body.length === 0) fail(code, 'network request body must be JSON');
  let body: unknown;
  try {
    body = JSON.parse(request.body);
  } catch {
    fail(code, 'network request body must contain valid JSON');
  }
  if (!isRecord(body)) fail(code, 'network request body must contain an object');
  assertExactKeys(body, ['protocolVersion', 'requestSha256', 'deliveryRequest'], 'network request body', code);
  if (body.protocolVersion !== 1) fail(code, 'network request protocolVersion must be 1');
  assertDigest(body.requestSha256, 'network request requestSha256', code);
  if (body.requestSha256 !== headers[REQUEST_DIGEST_HEADER]) {
    fail(code, 'network request header and body digests do not match');
  }
  if (!isRecord(body.deliveryRequest) || !isRecord(body.deliveryRequest.envelope)) {
    fail(code, 'network request delivery envelope is required');
  }
  assertPublicId(
    body.deliveryRequest.envelope.eventPublicId,
    'deliveryRequest.envelope.eventPublicId',
    160,
    code,
  );
  return {
    endpoint,
    requestSha256: body.requestSha256,
    eventPublicId: body.deliveryRequest.envelope.eventPublicId,
  };
}

function stripAuthenticationRequestHeaders(
  request: CanonicalSyncNetworkExchangeRequest,
): CanonicalSyncNetworkExchangeRequest {
  const headers = request.headers;
  return {
    ...request,
    headers: Object.freeze({
      [CONTENT_TYPE_HEADER]: headers[CONTENT_TYPE_HEADER],
      [NETWORK_PROTOCOL_HEADER]: headers[NETWORK_PROTOCOL_HEADER],
      [REQUEST_DIGEST_HEADER]: headers[REQUEST_DIGEST_HEADER],
    }),
  };
}

function validateBaseResponse(
  response: unknown,
  requestSha256: string,
  code: CanonicalSyncNetworkAuthenticationErrorCode,
): CanonicalSyncNetworkExchangeResponse {
  if (!isRecord(response)) fail(code, 'network exchange response must be an object');
  assertExactKeys(response, ['statusCode', 'headers', 'body'], 'network exchange response', code);
  if (!Number.isSafeInteger(response.statusCode)) fail(code, 'network response statusCode must be a safe integer');
  if (typeof response.body !== 'string') fail(code, 'network response body must be a string');
  const headers = validateBaseHeaders(response.headers, BASE_RESPONSE_HEADERS, code);
  if (headers[REQUEST_DIGEST_HEADER] !== requestSha256) {
    fail(code, 'network response request digest does not match the authenticated request');
  }
  return response as unknown as CanonicalSyncNetworkExchangeResponse;
}

function validateAndStripAuthenticationResponse(
  response: unknown,
  evidence: CanonicalSyncAuthenticationEvidence,
  requestSha256: string,
): CanonicalSyncNetworkExchangeResponse {
  if (!isRecord(response)) fail('CANONICAL_SYNC_AUTH_RESPONSE', 'authenticated response must be an object');
  assertExactKeys(response, ['statusCode', 'headers', 'body'], 'authenticated response', 'CANONICAL_SYNC_AUTH_RESPONSE');
  if (!Number.isSafeInteger(response.statusCode)) {
    fail('CANONICAL_SYNC_AUTH_RESPONSE', 'authenticated response statusCode must be a safe integer');
  }
  if (typeof response.body !== 'string') fail('CANONICAL_SYNC_AUTH_RESPONSE', 'authenticated response body must be a string');
  const headers = validateBaseHeaders(
    response.headers,
    AUTH_RESPONSE_HEADERS,
    'CANONICAL_SYNC_AUTH_RESPONSE',
  );
  if (headers[REQUEST_DIGEST_HEADER] !== requestSha256) {
    fail('CANONICAL_SYNC_AUTH_RESPONSE', 'authenticated response request digest does not match');
  }
  if (headers[AUTH_VERSION_HEADER] !== '1') {
    fail('CANONICAL_SYNC_AUTH_RESPONSE', 'authenticated response auth version must be 1');
  }
  if (headers[AUTH_KEY_ID_HEADER] !== evidence.keyId) {
    fail('CANONICAL_SYNC_AUTH_RESPONSE', 'authenticated response key ID does not match');
  }
  if (headers[AUTH_NONCE_HEADER] !== evidence.noncePublicId) {
    fail('CANONICAL_SYNC_AUTH_RESPONSE', 'authenticated response nonce does not match');
  }
  if (!['reserved', 'exact_replay'].includes(headers[AUTH_REPLAY_HEADER])) {
    fail('CANONICAL_SYNC_AUTH_RESPONSE', 'authenticated response replay status is invalid');
  }
  return {
    statusCode: response.statusCode as number,
    headers: Object.freeze({
      [CONTENT_TYPE_HEADER]: headers[CONTENT_TYPE_HEADER],
      [NETWORK_PROTOCOL_HEADER]: headers[NETWORK_PROTOCOL_HEADER],
      [REQUEST_DIGEST_HEADER]: headers[REQUEST_DIGEST_HEADER],
    }),
    body: response.body,
  };
}

function validateReceiverOptions(
  options: unknown,
): CanonicalSyncAuthenticatedNetworkReceiverOptions {
  if (!isRecord(options)) fail('CANONICAL_SYNC_AUTH_CONFIG', 'receiver options are required');
  assertExactKeys(
    options,
    ['verifier', 'replayStore', 'targetExchange', 'acceptedAtUtc', 'maxClockSkewSeconds'],
    'receiver options',
    'CANONICAL_SYNC_AUTH_CONFIG',
  );
  if (!isRecord(options.verifier) || typeof options.verifier.verify !== 'function') {
    fail('CANONICAL_SYNC_AUTH_CONFIG', 'verifier.verify is required');
  }
  if (!isRecord(options.replayStore) || typeof options.replayStore.reserve !== 'function') {
    fail('CANONICAL_SYNC_AUTH_CONFIG', 'replayStore.reserve is required');
  }
  if (!isRecord(options.targetExchange) || typeof options.targetExchange.exchange !== 'function') {
    fail('CANONICAL_SYNC_AUTH_CONFIG', 'targetExchange.exchange is required');
  }
  assertUtc(options.acceptedAtUtc, 'acceptedAtUtc', 'CANONICAL_SYNC_AUTH_CONFIG');
  if (
    !Number.isSafeInteger(options.maxClockSkewSeconds)
    || Number(options.maxClockSkewSeconds) < 1
    || Number(options.maxClockSkewSeconds) > 900
  ) {
    fail('CANONICAL_SYNC_AUTH_CONFIG', 'maxClockSkewSeconds must be a safe integer from 1 through 900');
  }
  return options as unknown as CanonicalSyncAuthenticatedNetworkReceiverOptions;
}

function validateFreshness(
  signedAtUtc: string,
  acceptedAtUtc: string,
  maxClockSkewSeconds: number,
): void {
  const difference = Math.abs(Date.parse(signedAtUtc) - Date.parse(acceptedAtUtc));
  if (difference > maxClockSkewSeconds * 1000) {
    fail('CANONICAL_SYNC_AUTH_FRESHNESS', 'signed timestamp is outside the accepted clock-skew window');
  }
}

export function buildCanonicalSyncAuthenticationMessage(
  input: CanonicalSyncAuthenticationMessageInput,
): string {
  if (!isRecord(input)) fail('CANONICAL_SYNC_AUTH_EVIDENCE', 'authentication message input is required');
  assertExactKeys(
    input,
    ['endpoint', 'keyId', 'signedAtUtc', 'noncePublicId', 'requestSha256', 'eventPublicId'],
    'authentication message input',
    'CANONICAL_SYNC_AUTH_EVIDENCE',
  );
  const endpoint = validateEndpoint(input.endpoint, 'CANONICAL_SYNC_AUTH_EVIDENCE');
  assertPublicId(input.keyId, 'keyId', 128, 'CANONICAL_SYNC_AUTH_EVIDENCE');
  assertUtc(input.signedAtUtc, 'signedAtUtc', 'CANONICAL_SYNC_AUTH_EVIDENCE');
  assertPublicId(input.noncePublicId, 'noncePublicId', 192, 'CANONICAL_SYNC_AUTH_EVIDENCE');
  assertDigest(input.requestSha256, 'requestSha256', 'CANONICAL_SYNC_AUTH_EVIDENCE');
  assertPublicId(input.eventPublicId, 'eventPublicId', 160, 'CANONICAL_SYNC_AUTH_EVIDENCE');
  return [
    'CANONICAL-SYNC-AUTH-V1',
    'POST',
    endpoint,
    '1',
    input.keyId,
    input.signedAtUtc,
    input.noncePublicId,
    input.requestSha256,
    input.eventPublicId,
  ].join('\n');
}

export function createCanonicalSyncAuthenticatedNetworkExchangePort(
  options: CanonicalSyncAuthenticatedNetworkExchangePortOptions,
): CanonicalSyncNetworkExchangePort {
  if (!isRecord(options)) fail('CANONICAL_SYNC_AUTH_CONFIG', 'sender options are required');
  assertExactKeys(
    options,
    ['innerExchange', 'evidenceProvider', 'signer'],
    'sender options',
    'CANONICAL_SYNC_AUTH_CONFIG',
  );
  if (!isRecord(options.innerExchange) || typeof options.innerExchange.exchange !== 'function') {
    fail('CANONICAL_SYNC_AUTH_CONFIG', 'innerExchange.exchange is required');
  }
  if (!isRecord(options.evidenceProvider) || typeof options.evidenceProvider.provide !== 'function') {
    fail('CANONICAL_SYNC_AUTH_CONFIG', 'evidenceProvider.provide is required');
  }
  if (!isRecord(options.signer) || typeof options.signer.sign !== 'function') {
    fail('CANONICAL_SYNC_AUTH_CONFIG', 'signer.sign is required');
  }
  const innerExchange = options.innerExchange;
  const evidenceProvider = options.evidenceProvider;
  const signer = options.signer;

  return Object.freeze({
    async exchange(
      request: CanonicalSyncNetworkExchangeRequest,
    ): Promise<CanonicalSyncNetworkExchangeResponse> {
      const identity = parseRequestIdentity(
        request,
        BASE_REQUEST_HEADERS,
        'CANONICAL_SYNC_AUTH_EVIDENCE',
      );
      const evidence = validateEvidence(await evidenceProvider.provide(identity), 'CANONICAL_SYNC_AUTH_EVIDENCE');
      const canonicalMessage = buildCanonicalSyncAuthenticationMessage({
        ...identity,
        ...evidence,
      });
      const signature = await signer.sign({ keyId: evidence.keyId, canonicalMessage });
      assertSignature(signature, 'signature', 'CANONICAL_SYNC_AUTH_EVIDENCE');
      const authenticatedRequest: CanonicalSyncNetworkExchangeRequest = {
        ...request,
        headers: Object.freeze({
          ...request.headers,
          [AUTH_VERSION_HEADER]: '1',
          [AUTH_KEY_ID_HEADER]: evidence.keyId,
          [AUTH_SIGNED_AT_HEADER]: evidence.signedAtUtc,
          [AUTH_NONCE_HEADER]: evidence.noncePublicId,
          [AUTH_SIGNATURE_HEADER]: signature,
        }),
      };
      const response = await innerExchange.exchange(authenticatedRequest);
      return validateAndStripAuthenticationResponse(response, evidence, identity.requestSha256);
    },
  });
}

export async function handleCanonicalSyncAuthenticatedNetworkExchange(
  rawOptions: CanonicalSyncAuthenticatedNetworkReceiverOptions,
  request: CanonicalSyncNetworkExchangeRequest,
): Promise<CanonicalSyncNetworkExchangeResponse> {
  const options = validateReceiverOptions(rawOptions);
  const identity = parseRequestIdentity(
    request,
    AUTH_REQUEST_HEADERS,
    'CANONICAL_SYNC_AUTH_EVIDENCE',
  );
  const headers = request.headers;
  if (headers[AUTH_VERSION_HEADER] !== '1') {
    fail('CANONICAL_SYNC_AUTH_EVIDENCE', 'authentication version must be 1');
  }
  assertPublicId(headers[AUTH_KEY_ID_HEADER], AUTH_KEY_ID_HEADER, 128, 'CANONICAL_SYNC_AUTH_EVIDENCE');
  assertUtc(headers[AUTH_SIGNED_AT_HEADER], AUTH_SIGNED_AT_HEADER, 'CANONICAL_SYNC_AUTH_EVIDENCE');
  assertPublicId(headers[AUTH_NONCE_HEADER], AUTH_NONCE_HEADER, 192, 'CANONICAL_SYNC_AUTH_EVIDENCE');
  assertSignature(headers[AUTH_SIGNATURE_HEADER], AUTH_SIGNATURE_HEADER, 'CANONICAL_SYNC_AUTH_EVIDENCE');
  validateFreshness(
    headers[AUTH_SIGNED_AT_HEADER],
    options.acceptedAtUtc,
    options.maxClockSkewSeconds,
  );
  const canonicalMessage = buildCanonicalSyncAuthenticationMessage({
    ...identity,
    keyId: headers[AUTH_KEY_ID_HEADER],
    signedAtUtc: headers[AUTH_SIGNED_AT_HEADER],
    noncePublicId: headers[AUTH_NONCE_HEADER],
  });
  const verified = await options.verifier.verify({
    keyId: headers[AUTH_KEY_ID_HEADER],
    canonicalMessage,
    signature: headers[AUTH_SIGNATURE_HEADER],
  });
  if (verified !== true) fail('CANONICAL_SYNC_AUTH_SIGNATURE', 'authentication signature is invalid');
  const reservation = await options.replayStore.reserve({
    keyId: headers[AUTH_KEY_ID_HEADER],
    noncePublicId: headers[AUTH_NONCE_HEADER],
    requestSha256: identity.requestSha256,
    eventPublicId: identity.eventPublicId,
    signedAtUtc: headers[AUTH_SIGNED_AT_HEADER],
    acceptedAtUtc: options.acceptedAtUtc,
  });
  if (!['reserved', 'exact_replay', 'conflict'].includes(reservation)) {
    fail('CANONICAL_SYNC_AUTH_REPLAY', 'replay store returned an unsupported result');
  }
  if (reservation === 'conflict') {
    fail('CANONICAL_SYNC_AUTH_REPLAY', 'authentication nonce conflicts with prior request evidence');
  }
  const targetResponse = validateBaseResponse(
    await options.targetExchange.exchange(stripAuthenticationRequestHeaders(request)),
    identity.requestSha256,
    'CANONICAL_SYNC_AUTH_RESPONSE',
  );
  return {
    ...targetResponse,
    headers: Object.freeze({
      ...targetResponse.headers,
      [AUTH_VERSION_HEADER]: '1',
      [AUTH_KEY_ID_HEADER]: headers[AUTH_KEY_ID_HEADER],
      [AUTH_NONCE_HEADER]: headers[AUTH_NONCE_HEADER],
      [AUTH_REPLAY_HEADER]: reservation,
    }),
  };
}
