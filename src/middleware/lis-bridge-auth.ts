import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../types';
import {
  constantTimeEqualHex,
  createLisBridgeRequestSignature,
  sha256Hex,
} from '../lib/lis-bridge-signing';

type AppEnv = {
  Bindings: Env;
  Variables: Variables;
};

interface LisBridgeKeyConfig {
  secret: string;
  tenantId: string;
  userId?: string;
  revoked?: boolean;
  notBefore?: string | number;
  expiresAt?: string | number;
  allowedMachineIds?: number[];
  allowedMachineCodes?: string[];
}

const LIS_BRIDGE_ALLOWED_ROUTES: Array<{ pattern: RegExp; methods: readonly string[] }> = [
  { pattern: /^\/api\/lab-machines\/\d+\/receive\/?$/, methods: ['POST'] },
  { pattern: /^\/api\/lab-machines\/(hl7|astm)\/receive\/?$/, methods: ['POST'] },
  { pattern: /^\/api\/lab-machines\/bridge-agents\/heartbeat\/?$/, methods: ['POST'] },
  { pattern: /^\/api\/lab-machines\/\d+\/pending-orders\/?$/, methods: ['GET', 'HEAD'] },
  { pattern: /^\/api\/lab-machines\/\d+\/send-orders\/?$/, methods: ['POST'] },
  { pattern: /^\/api\/lab-machines\/\d+\/acknowledge\/?$/, methods: ['POST'] },
  { pattern: /^\/api\/lab-machines\/\d+\/ping\/?$/, methods: ['POST'] },
];

const SIGNED_REQUEST_MAX_SKEW_SECONDS = 300;

function isLisBridgeRoute(path: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return LIS_BRIDGE_ALLOWED_ROUTES.some((route) => (
    route.pattern.test(path) && route.methods.includes(normalizedMethod)
  ));
}

function normalizeToken(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveBridgeAuditActor(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = normalizeToken(value);
    const parsed = Number(normalized);
    if (normalized && Number.isInteger(parsed) && parsed > 0) return normalized;
  }
  throw new HTTPException(503, { message: 'LIS bridge audit actor is not configured' });
}

function parseBridgeKeys(raw?: string): Record<string, LisBridgeKeyConfig> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HTTPException(503, { message: 'LIS bridge signed-key configuration is invalid' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HTTPException(503, { message: 'LIS bridge signed-key configuration is invalid' });
  }
  return parsed as Record<string, LisBridgeKeyConfig>;
}

function parseBoundaryTimestamp(value: string | number | undefined): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function assertKeyTimeWindow(key: LisBridgeKeyConfig, nowSeconds: number): void {
  const notBefore = parseBoundaryTimestamp(key.notBefore);
  const expiresAt = parseBoundaryTimestamp(key.expiresAt);
  if (notBefore != null && nowSeconds < notBefore) {
    throw new HTTPException(401, { message: 'LIS bridge key is not active yet' });
  }
  if (expiresAt != null && nowSeconds >= expiresAt) {
    throw new HTTPException(401, { message: 'LIS bridge key has expired' });
  }
}

function parseMachineScope(path: string, body: string): { machineId: number | null; machineCode: string | null } {
  const pathId = path.match(/^\/api\/lab-machines\/(\d+)\//)?.[1];
  let machineId = pathId ? Number(pathId) : null;
  let machineCode: string | null = null;
  if ((!machineId || machineId <= 0) && body) {
    try {
      const parsed = JSON.parse(body) as { machineId?: unknown; machineCode?: unknown };
      const parsedId = Number(parsed.machineId);
      if (Number.isInteger(parsedId) && parsedId > 0) machineId = parsedId;
      machineCode = normalizeToken(typeof parsed.machineCode === 'string' ? parsed.machineCode : null);
    } catch {
      // Non-JSON payloads are still authenticated; scoped keys require an identifier below.
    }
  }
  return { machineId, machineCode };
}

function assertMachineScope(key: LisBridgeKeyConfig, path: string, body: string): void {
  const allowedIds = Array.isArray(key.allowedMachineIds)
    ? key.allowedMachineIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const allowedCodes = Array.isArray(key.allowedMachineCodes)
    ? key.allowedMachineCodes.map((code) => String(code).trim()).filter(Boolean)
    : [];
  if (allowedIds.length === 0 && allowedCodes.length === 0) return;

  const { machineId, machineCode } = parseMachineScope(path, body);
  const idAllowed = machineId != null && allowedIds.includes(machineId);
  const codeAllowed = machineCode != null && allowedCodes.includes(machineCode);
  if (!idAllowed && !codeAllowed) {
    throw new HTTPException(403, { message: 'LIS bridge key is not authorized for this machine' });
  }
}

async function authenticateSignedBridgeRequest(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  keyId: string,
): Promise<void> {
  const timestampHeader = normalizeToken(c.req.header('X-LIS-Timestamp'));
  const nonce = normalizeToken(c.req.header('X-LIS-Nonce'));
  const deliveryId = normalizeToken(c.req.header('X-LIS-Delivery-Id'));
  const declaredBodyHash = normalizeToken(c.req.header('X-LIS-Body-SHA256'))?.toLowerCase() ?? null;
  const providedSignature = normalizeToken(c.req.header('X-LIS-Signature'))?.toLowerCase() ?? null;
  if (!timestampHeader || !nonce || !deliveryId || !declaredBodyHash || !providedSignature) {
    throw new HTTPException(401, { message: 'Incomplete LIS bridge signature headers' });
  }

  const keys = parseBridgeKeys(c.env.LIS_BRIDGE_KEYS_JSON);
  const key = keys[keyId];
  if (!key || !normalizeToken(key.secret)) {
    throw new HTTPException(401, { message: 'Unknown LIS bridge key' });
  }
  if (key.revoked) {
    throw new HTTPException(401, { message: 'LIS bridge key is revoked' });
  }

  const tenantId = String(c.get('tenantId') ?? '').trim();
  if (!tenantId || tenantId !== String(key.tenantId ?? '').trim()) {
    throw new HTTPException(403, { message: 'LIS bridge key is not authorized for this tenant' });
  }

  const timestamp = Number(timestampHeader);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > SIGNED_REQUEST_MAX_SKEW_SECONDS) {
    throw new HTTPException(401, { message: 'Expired LIS bridge request' });
  }
  assertKeyTimeWindow(key, nowSeconds);

  const body = ['GET', 'HEAD'].includes(c.req.method.toUpperCase())
    ? ''
    : await c.req.raw.clone().text();
  const actualBodyHash = await sha256Hex(body);
  if (!constantTimeEqualHex(actualBodyHash, declaredBodyHash)) {
    throw new HTTPException(401, { message: 'Invalid LIS bridge body hash' });
  }

  const expectedSignature = await createLisBridgeRequestSignature(key.secret, {
    method: c.req.method,
    path: c.req.path,
    timestamp,
    nonce,
    deliveryId,
    bodySha256: actualBodyHash,
  });
  if (!constantTimeEqualHex(expectedSignature, providedSignature)) {
    throw new HTTPException(401, { message: 'Invalid LIS bridge signature' });
  }
  assertMachineScope(key, c.req.path, body);

  try {
    await c.env.DB.prepare(`
      INSERT INTO lis_bridge_request_nonces (
        tenant_id, key_id, nonce, delivery_id, body_sha256,
        request_timestamp, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, DATETIME(?, 'unixepoch', '+10 minutes'), CURRENT_TIMESTAMP)
    `).bind(
      tenantId,
      keyId,
      nonce,
      deliveryId,
      actualBodyHash,
      timestamp,
      timestamp,
    ).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique constraint|lis_bridge_request_nonces/i.test(message)) {
      throw new HTTPException(409, { message: 'Replayed LIS bridge request' });
    }
    throw new HTTPException(503, { message: 'LIS bridge replay protection is unavailable' });
  }

  c.set('lisBridgeAuth', true);
  c.set('userId', resolveBridgeAuditActor(key.userId, c.env.LIS_BRIDGE_USER_ID));
  c.set('role', 'laboratory');
}

export const lisBridgeAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isLisBridgeRoute(c.req.path, c.req.method)) {
    await next();
    return;
  }

  const signedKeyId = normalizeToken(c.req.header('X-LIS-Key-Id'));
  const hasAnySignedHeader = [
    'X-LIS-Timestamp',
    'X-LIS-Nonce',
    'X-LIS-Delivery-Id',
    'X-LIS-Body-SHA256',
    'X-LIS-Signature',
  ].some((header) => Boolean(normalizeToken(c.req.header(header))));

  if (signedKeyId || hasAnySignedHeader) {
    if (!signedKeyId) {
      throw new HTTPException(401, { message: 'Incomplete LIS bridge signature headers' });
    }
    await authenticateSignedBridgeRequest(c, signedKeyId);
    await next();
    return;
  }

  const providedKey = normalizeToken(c.req.header('X-LIS-Bridge-Key'));
  if (!providedKey) {
    // No bridge credentials: continue to the normal staff JWT auth path.
    await next();
    return;
  }
  if (String(c.env.LIS_BRIDGE_ALLOW_LEGACY_KEY ?? 'true').toLowerCase() === 'false') {
    throw new HTTPException(401, { message: 'Legacy LIS bridge authentication is disabled' });
  }

  const expectedKey = normalizeToken(c.env.LIS_BRIDGE_API_KEY);
  if (!expectedKey) {
    throw new HTTPException(503, { message: 'LIS bridge authentication is not configured' });
  }
  if (!constantTimeEqualHex(await sha256Hex(providedKey), await sha256Hex(expectedKey))) {
    throw new HTTPException(401, { message: 'Invalid LIS bridge key' });
  }

  c.set('lisBridgeAuth', true);
  c.set('userId', resolveBridgeAuditActor(c.env.LIS_BRIDGE_USER_ID));
  c.set('role', 'laboratory');

  await next();
};
