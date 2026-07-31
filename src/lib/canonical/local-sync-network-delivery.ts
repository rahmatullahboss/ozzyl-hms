import { createRequestFingerprint, stableCanonicalJson } from './idempotency';
import {
  validateCanonicalSyncDeliveryRequest,
  type CanonicalSyncDeliveryPort,
  type CanonicalSyncDeliveryRequest,
  type CanonicalSyncDeliveryResult,
} from './local-sync-delivery';
import { validateCanonicalSyncEnvelope } from './local-sync-protocol';

export const CANONICAL_SYNC_NETWORK_PROTOCOL_VERSION = 1 as const;
export const CANONICAL_SYNC_NETWORK_MAX_BODY_BYTES = 2 * 1024 * 1024;

const CONTENT_TYPE_HEADER = 'content-type';
const PROTOCOL_HEADER = 'x-canonical-sync-protocol';
const REQUEST_DIGEST_HEADER = 'x-canonical-sync-request-sha256';
const JSON_CONTENT_TYPE = 'application/json';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,95}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export type CanonicalSyncNetworkDeliveryErrorCode =
  | 'CANONICAL_SYNC_NETWORK_CONFIG'
  | 'CANONICAL_SYNC_NETWORK_REQUEST'
  | 'CANONICAL_SYNC_NETWORK_HTTP_STATUS'
  | 'CANONICAL_SYNC_NETWORK_RESPONSE'
  | 'CANONICAL_SYNC_NETWORK_PROTOCOL';

export class CanonicalSyncNetworkDeliveryError extends Error {
  readonly code: CanonicalSyncNetworkDeliveryErrorCode;

  constructor(code: CanonicalSyncNetworkDeliveryErrorCode, message: string) {
    super(message);
    this.name = 'CanonicalSyncNetworkDeliveryError';
    this.code = code;
  }
}

export interface CanonicalSyncNetworkExchangeRequest {
  method: 'POST';
  endpoint: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface CanonicalSyncNetworkExchangeResponse {
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface CanonicalSyncNetworkExchangePort {
  exchange(
    request: CanonicalSyncNetworkExchangeRequest,
  ): Promise<CanonicalSyncNetworkExchangeResponse>;
}

export interface CanonicalSyncNetworkDeliveryPortOptions {
  endpoint: string;
  exchange: CanonicalSyncNetworkExchangePort;
}

interface NetworkRequestBody {
  protocolVersion: 1;
  requestSha256: string;
  deliveryRequest: CanonicalSyncDeliveryRequest;
}

interface NetworkResponseBody {
  protocolVersion: 1;
  requestSha256: string;
  result: CanonicalSyncDeliveryResult;
}

function fail(
  code: CanonicalSyncNetworkDeliveryErrorCode,
  message: string,
): never {
  throw new CanonicalSyncNetworkDeliveryError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
  code: CanonicalSyncNetworkDeliveryErrorCode,
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
  code: CanonicalSyncNetworkDeliveryErrorCode,
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
  code: CanonicalSyncNetworkDeliveryErrorCode,
): asserts value is string {
  assertExactString(value, label, 192, code);
  if (/^\d+$/.test(value)) fail(code, `${label} must be a stable public identifier`);
}

function assertPositiveInteger(
  value: unknown,
  label: string,
  code: CanonicalSyncNetworkDeliveryErrorCode,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail(code, `${label} must be a positive safe integer`);
  }
}

function assertUtc(
  value: unknown,
  label: string,
  code: CanonicalSyncNetworkDeliveryErrorCode,
): asserts value is string {
  if (typeof value !== 'string' || !UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(code, `${label} must be a valid ISO-8601 UTC timestamp`);
  }
}

function assertDigest(
  value: unknown,
  label: string,
  code: CanonicalSyncNetworkDeliveryErrorCode,
): asserts value is string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(code, `${label} must be a lowercase SHA-256 digest`);
  }
}

function assertErrorCode(
  value: unknown,
  label: string,
  code: CanonicalSyncNetworkDeliveryErrorCode,
): asserts value is string {
  if (typeof value !== 'string' || !CODE_PATTERN.test(value)) {
    fail(code, `${label} must be a stable uppercase error code`);
  }
}

function validateEndpoint(endpoint: unknown): string {
  assertExactString(endpoint, 'endpoint', 2048, 'CANONICAL_SYNC_NETWORK_CONFIG');
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    fail('CANONICAL_SYNC_NETWORK_CONFIG', 'endpoint must be an absolute URL');
  }
  if (parsed.protocol !== 'https:') {
    fail('CANONICAL_SYNC_NETWORK_CONFIG', 'endpoint must use HTTPS');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    fail('CANONICAL_SYNC_NETWORK_CONFIG', 'endpoint must not contain credentials');
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    fail('CANONICAL_SYNC_NETWORK_CONFIG', 'endpoint must not contain query or fragment components');
  }
  if (parsed.hostname === '' || parsed.pathname === '' || parsed.pathname === '/') {
    fail('CANONICAL_SYNC_NETWORK_CONFIG', 'endpoint must contain a host and non-root path');
  }
  return endpoint;
}

function bodyBytes(body: string): number {
  return new TextEncoder().encode(body).byteLength;
}

function parseBody(
  body: unknown,
  label: string,
  code: CanonicalSyncNetworkDeliveryErrorCode,
): Record<string, unknown> {
  if (typeof body !== 'string' || body.length === 0) fail(code, `${label} must be a non-empty JSON string`);
  if (bodyBytes(body) > CANONICAL_SYNC_NETWORK_MAX_BODY_BYTES) {
    fail(code, `${label} exceeds the ${CANONICAL_SYNC_NETWORK_MAX_BODY_BYTES}-byte limit`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail(code, `${label} must contain valid JSON`);
  }
  if (!isRecord(parsed)) fail(code, `${label} must contain a JSON object`);
  return parsed;
}

function validateHeaders(
  headers: unknown,
  expectedDigest: string | null,
  code: CanonicalSyncNetworkDeliveryErrorCode,
): Record<string, string> {
  if (!isRecord(headers)) fail(code, 'headers must be an object');
  assertExactKeys(
    headers,
    [CONTENT_TYPE_HEADER, PROTOCOL_HEADER, REQUEST_DIGEST_HEADER],
    'headers',
    code,
  );
  if (headers[CONTENT_TYPE_HEADER] !== JSON_CONTENT_TYPE) {
    fail(code, 'content-type must be application/json');
  }
  if (headers[PROTOCOL_HEADER] !== String(CANONICAL_SYNC_NETWORK_PROTOCOL_VERSION)) {
    fail(code, 'x-canonical-sync-protocol must be 1');
  }
  assertDigest(headers[REQUEST_DIGEST_HEADER], REQUEST_DIGEST_HEADER, code);
  if (expectedDigest !== null && headers[REQUEST_DIGEST_HEADER] !== expectedDigest) {
    fail(code, 'request digest header does not match the expected digest');
  }
  return headers as Record<string, string>;
}

async function validateDeliveryRequest(
  request: unknown,
  code: CanonicalSyncNetworkDeliveryErrorCode,
): Promise<CanonicalSyncDeliveryRequest> {
  if (!isRecord(request)) fail(code, 'deliveryRequest must be an object');
  try {
    validateCanonicalSyncDeliveryRequest(request as unknown as CanonicalSyncDeliveryRequest);
    await validateCanonicalSyncEnvelope(
      (request as unknown as CanonicalSyncDeliveryRequest).envelope,
    );
  } catch (error) {
    if (error instanceof CanonicalSyncNetworkDeliveryError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    fail(code, `deliveryRequest is invalid: ${message}`);
  }
  return request as unknown as CanonicalSyncDeliveryRequest;
}

function validateDeliveryResult(
  value: unknown,
  expectedEventPublicId: string,
  code: CanonicalSyncNetworkDeliveryErrorCode,
): CanonicalSyncDeliveryResult {
  if (!isRecord(value)) fail(code, 'result must be an object');
  assertExactString(value.status, 'result.status', 32, code);
  const status = value.status;
  if (status === 'applied') {
    assertExactKeys(value, ['status', 'eventPublicId', 'targetAttemptCount', 'replayed'], 'result', code);
    assertPublicId(value.eventPublicId, 'result.eventPublicId', code);
    assertPositiveInteger(value.targetAttemptCount, 'result.targetAttemptCount', code);
    if (typeof value.replayed !== 'boolean') fail(code, 'result.replayed must be boolean');
  } else if (status === 'retry' || status === 'busy') {
    assertExactKeys(
      value,
      ['status', 'eventPublicId', 'targetAttemptCount', 'retryAtUtc', 'errorCode', 'errorHash'],
      'result',
      code,
    );
    assertPublicId(value.eventPublicId, 'result.eventPublicId', code);
    assertPositiveInteger(value.targetAttemptCount, 'result.targetAttemptCount', code);
    assertUtc(value.retryAtUtc, 'result.retryAtUtc', code);
    assertErrorCode(value.errorCode, 'result.errorCode', code);
    assertDigest(value.errorHash, 'result.errorHash', code);
    if (status === 'busy' && value.errorCode !== 'CANONICAL_SYNC_TARGET_BUSY') {
      fail(code, 'busy result must use CANONICAL_SYNC_TARGET_BUSY');
    }
  } else if (status === 'dead_letter') {
    assertExactKeys(
      value,
      ['status', 'eventPublicId', 'targetAttemptCount', 'errorCode', 'errorHash'],
      'result',
      code,
    );
    assertPublicId(value.eventPublicId, 'result.eventPublicId', code);
    assertPositiveInteger(value.targetAttemptCount, 'result.targetAttemptCount', code);
    assertErrorCode(value.errorCode, 'result.errorCode', code);
    assertDigest(value.errorHash, 'result.errorHash', code);
  } else {
    fail(code, `unsupported delivery result status: ${status}`);
  }
  if (value.eventPublicId !== expectedEventPublicId) {
    fail(code, 'result eventPublicId does not match the delivery request');
  }
  return value as unknown as CanonicalSyncDeliveryResult;
}

async function buildExchangeRequest(
  endpoint: string,
  request: CanonicalSyncDeliveryRequest,
): Promise<{ wireRequest: CanonicalSyncNetworkExchangeRequest; requestSha256: string }> {
  const validatedRequest = await validateDeliveryRequest(request, 'CANONICAL_SYNC_NETWORK_REQUEST');
  const requestSha256 = await createRequestFingerprint(validatedRequest);
  const body = stableCanonicalJson({
    protocolVersion: CANONICAL_SYNC_NETWORK_PROTOCOL_VERSION,
    requestSha256,
    deliveryRequest: validatedRequest,
  } satisfies NetworkRequestBody);
  if (bodyBytes(body) > CANONICAL_SYNC_NETWORK_MAX_BODY_BYTES) {
    fail('CANONICAL_SYNC_NETWORK_REQUEST', 'canonical network request body exceeds the size limit');
  }
  return {
    requestSha256,
    wireRequest: {
      method: 'POST',
      endpoint,
      headers: Object.freeze({
        [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
        [PROTOCOL_HEADER]: String(CANONICAL_SYNC_NETWORK_PROTOCOL_VERSION),
        [REQUEST_DIGEST_HEADER]: requestSha256,
      }),
      body,
    },
  };
}

async function parseNetworkRequest(
  request: CanonicalSyncNetworkExchangeRequest,
): Promise<{ deliveryRequest: CanonicalSyncDeliveryRequest; requestSha256: string }> {
  if (!isRecord(request)) fail('CANONICAL_SYNC_NETWORK_PROTOCOL', 'network exchange request must be an object');
  assertExactKeys(request, ['method', 'endpoint', 'headers', 'body'], 'network exchange request', 'CANONICAL_SYNC_NETWORK_PROTOCOL');
  if (request.method !== 'POST') fail('CANONICAL_SYNC_NETWORK_PROTOCOL', 'network exchange method must be POST');
  validateEndpoint(request.endpoint);
  const headers = validateHeaders(request.headers, null, 'CANONICAL_SYNC_NETWORK_PROTOCOL');
  const body = parseBody(request.body, 'network request body', 'CANONICAL_SYNC_NETWORK_PROTOCOL');
  assertExactKeys(
    body,
    ['protocolVersion', 'requestSha256', 'deliveryRequest'],
    'network request body',
    'CANONICAL_SYNC_NETWORK_PROTOCOL',
  );
  if (body.protocolVersion !== CANONICAL_SYNC_NETWORK_PROTOCOL_VERSION) {
    fail('CANONICAL_SYNC_NETWORK_PROTOCOL', 'network request protocolVersion must be 1');
  }
  assertDigest(body.requestSha256, 'network request requestSha256', 'CANONICAL_SYNC_NETWORK_PROTOCOL');
  if (headers[REQUEST_DIGEST_HEADER] !== body.requestSha256) {
    fail('CANONICAL_SYNC_NETWORK_PROTOCOL', 'network request header and body digests do not match');
  }
  const deliveryRequest = await validateDeliveryRequest(
    body.deliveryRequest,
    'CANONICAL_SYNC_NETWORK_PROTOCOL',
  );
  const computedDigest = await createRequestFingerprint(deliveryRequest);
  if (computedDigest !== body.requestSha256) {
    fail('CANONICAL_SYNC_NETWORK_PROTOCOL', 'network request digest does not match deliveryRequest');
  }
  return { deliveryRequest, requestSha256: body.requestSha256 };
}

function parseNetworkResponse(
  response: CanonicalSyncNetworkExchangeResponse,
  requestSha256: string,
  expectedEventPublicId: string,
): CanonicalSyncDeliveryResult {
  if (!isRecord(response)) fail('CANONICAL_SYNC_NETWORK_RESPONSE', 'network exchange response must be an object');
  assertExactKeys(response, ['statusCode', 'headers', 'body'], 'network exchange response', 'CANONICAL_SYNC_NETWORK_RESPONSE');
  if (!Number.isSafeInteger(response.statusCode) || response.statusCode !== 200) {
    fail(
      'CANONICAL_SYNC_NETWORK_HTTP_STATUS',
      `network exchange status must be 200, received ${String(response.statusCode)}`,
    );
  }
  validateHeaders(response.headers, requestSha256, 'CANONICAL_SYNC_NETWORK_RESPONSE');
  const body = parseBody(response.body, 'network response body', 'CANONICAL_SYNC_NETWORK_RESPONSE');
  assertExactKeys(
    body,
    ['protocolVersion', 'requestSha256', 'result'],
    'network response body',
    'CANONICAL_SYNC_NETWORK_RESPONSE',
  );
  if (body.protocolVersion !== CANONICAL_SYNC_NETWORK_PROTOCOL_VERSION) {
    fail('CANONICAL_SYNC_NETWORK_RESPONSE', 'network response protocolVersion must be 1');
  }
  assertDigest(body.requestSha256, 'network response requestSha256', 'CANONICAL_SYNC_NETWORK_RESPONSE');
  if (body.requestSha256 !== requestSha256) {
    fail('CANONICAL_SYNC_NETWORK_RESPONSE', 'network response digest does not match the request');
  }
  return validateDeliveryResult(
    body.result,
    expectedEventPublicId,
    'CANONICAL_SYNC_NETWORK_RESPONSE',
  );
}

export function createCanonicalSyncNetworkDeliveryPort(
  options: CanonicalSyncNetworkDeliveryPortOptions,
): CanonicalSyncDeliveryPort {
  if (!isRecord(options)) fail('CANONICAL_SYNC_NETWORK_CONFIG', 'network delivery options are required');
  assertExactKeys(options, ['endpoint', 'exchange'], 'network delivery options', 'CANONICAL_SYNC_NETWORK_CONFIG');
  const endpoint = validateEndpoint(options.endpoint);
  if (!isRecord(options.exchange) || typeof options.exchange.exchange !== 'function') {
    fail('CANONICAL_SYNC_NETWORK_CONFIG', 'exchange.exchange is required');
  }
  const exchange = options.exchange;

  return Object.freeze({
    async deliver(request: CanonicalSyncDeliveryRequest): Promise<CanonicalSyncDeliveryResult> {
      const built = await buildExchangeRequest(endpoint, request);
      const response = await exchange.exchange(built.wireRequest);
      return parseNetworkResponse(
        response,
        built.requestSha256,
        request.envelope.eventPublicId,
      );
    },
  });
}

export async function handleCanonicalSyncNetworkDeliveryExchange(
  targetPort: CanonicalSyncDeliveryPort,
  exchangeRequest: CanonicalSyncNetworkExchangeRequest,
): Promise<CanonicalSyncNetworkExchangeResponse> {
  if (!targetPort || typeof targetPort.deliver !== 'function') {
    fail('CANONICAL_SYNC_NETWORK_CONFIG', 'targetPort.deliver is required');
  }
  const parsed = await parseNetworkRequest(exchangeRequest);
  const result = await targetPort.deliver(parsed.deliveryRequest);
  const validatedResult = validateDeliveryResult(
    result,
    parsed.deliveryRequest.envelope.eventPublicId,
    'CANONICAL_SYNC_NETWORK_PROTOCOL',
  );
  const body = stableCanonicalJson({
    protocolVersion: CANONICAL_SYNC_NETWORK_PROTOCOL_VERSION,
    requestSha256: parsed.requestSha256,
    result: validatedResult,
  } satisfies NetworkResponseBody);
  if (bodyBytes(body) > CANONICAL_SYNC_NETWORK_MAX_BODY_BYTES) {
    fail('CANONICAL_SYNC_NETWORK_RESPONSE', 'canonical network response body exceeds the size limit');
  }
  return {
    statusCode: 200,
    headers: Object.freeze({
      [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
      [PROTOCOL_HEADER]: String(CANONICAL_SYNC_NETWORK_PROTOCOL_VERSION),
      [REQUEST_DIGEST_HEADER]: parsed.requestSha256,
    }),
    body,
  };
}
