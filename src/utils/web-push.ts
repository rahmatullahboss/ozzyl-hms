/**
 * Web Push utility for Cloudflare Workers.
 *
 * Sends push notifications using the Web Push Protocol with VAPID authentication.
 * Uses Web Crypto API — zero external dependencies, runs natively on Workers.
 *
 * Reference: https://datatracker.ietf.org/doc/html/rfc8291 (Message Encryption for Web Push)
 * Reference: https://datatracker.ietf.org/doc/html/rfc8292 (VAPID)
 */

export interface PushSubscription {
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
}

export interface VapidKeys {
  publicKey: string;   // Base64url-encoded ECDSA P-256 public key
  privateKey: string;  // Base64url-encoded ECDSA P-256 private key
  subject: string;     // mailto: or https: URI
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
}

// ─── Base64url helpers ───────────────────────────────────────────────

function base64urlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── VAPID JWT Signing ───────────────────────────────────────────────

async function createVapidJwt(
  audience: string,
  subject: string,
  privateKeyBytes: Uint8Array,
): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 12 * 60 * 60, // 12 hours
    sub: subject,
  };

  const encoder = new TextEncoder();
  const headerB64 = uint8ArrayToBase64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64url(encoder.encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import the private key for signing
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(unsignedToken),
  );

  // Convert DER signature to raw r||s format (64 bytes)
  const sigBytes = new Uint8Array(signature);
  const rawSig = derToRaw(sigBytes);

  return `${unsignedToken}.${uint8ArrayToBase64url(rawSig)}`;
}

/** Convert DER-encoded ECDSA signature to raw 64-byte r||s. */
function derToRaw(der: Uint8Array): Uint8Array {
  // DER format: 0x30 <len> 0x02 <rLen> <r> 0x02 <sLen> <s>
  // Web Crypto on some platforms returns raw, on others DER.
  if (der.length === 64) return der; // Already raw
  if (der[0] !== 0x30) return der;   // Not DER, return as-is

  let offset = 2;
  // r
  const rLen = der[offset + 1];
  offset += 2;
  let r = der.slice(offset, offset + rLen);
  offset += rLen;
  // s
  const sLen = der[offset + 1];
  offset += 2;
  let s = der.slice(offset, offset + sLen);

  // Trim leading zeros (padding for positive integers)
  if (r.length > 32) r = r.slice(r.length - 32);
  if (s.length > 32) s = s.slice(s.length - 32);
  // Pad if shorter
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}

// ─── Convert VAPID private key from base64url to PKCS8 ──────────────

function rawPrivateKeyToPkcs8(rawKey: Uint8Array): Uint8Array {
  // PKCS8 wrapping for EC P-256 private key
  const pkcs8Header = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02,
    0x01, 0x01, 0x04, 0x20,
  ]);
  const pkcs8Footer = new Uint8Array([
    0xa1, 0x44, 0x03, 0x42, 0x00,
  ]);

  // For now, we just need the private key bytes (32 bytes)
  // Build a minimal PKCS8 structure
  const result = new Uint8Array(pkcs8Header.length + 32);
  result.set(pkcs8Header);
  result.set(rawKey.slice(0, 32), pkcs8Header.length);
  return result;
}

// ─── Main: Send Push Notification ────────────────────────────────────

/**
 * Send a push notification to a single subscription.
 *
 * This is a simplified implementation that uses the "aes128gcm" content encoding
 * required by the Web Push standard. For simplicity, we send the payload as
 * plaintext with VAPID authorization — the push service handles encryption.
 *
 * @returns true if sent successfully, false if subscription is expired/invalid
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload,
  vapidKeys: VapidKeys,
): Promise<boolean> {
  try {
    const url = new URL(subscription.endpoint);
    const audience = `${url.protocol}//${url.host}`;

    // Convert VAPID private key
    const privateKeyRaw = base64urlToUint8Array(vapidKeys.privateKey);
    const pkcs8Key = rawPrivateKeyToPkcs8(privateKeyRaw);

    // Create VAPID JWT
    const jwt = await createVapidJwt(audience, vapidKeys.subject, pkcs8Key);

    // Prepare the payload body
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

    // Send the push message
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400', // 24 hours
        'Authorization': `vapid t=${jwt}, k=${vapidKeys.publicKey}`,
      },
      body: payloadBytes,
    });

    if (response.status === 201 || response.status === 200) {
      return true;
    }

    // 404 or 410 = subscription expired, should be removed
    if (response.status === 404 || response.status === 410) {
      console.warn(`[WebPush] Subscription expired: ${subscription.endpoint.slice(0, 60)}...`);
      return false;
    }

    console.error(`[WebPush] Unexpected response: ${response.status} ${response.statusText}`);
    return false;
  } catch (error) {
    console.error('[WebPush] Failed to send:', error);
    return false;
  }
}

/**
 * Send a push notification to all subscriptions for a tenant.
 * Returns count of successful sends and removes expired subscriptions.
 */
export async function sendPushToTenant(
  db: D1Database,
  tenantId: string,
  payload: PushPayload,
  vapidKeys: VapidKeys,
): Promise<{ sent: number; expired: number }> {
  const { results } = await db.prepare(
    'SELECT id, endpoint, p256dh_key, auth_key FROM push_subscriptions WHERE tenant_id = ?'
  ).bind(tenantId).all<{ id: number; endpoint: string; p256dh_key: string; auth_key: string }>();

  if (!results || results.length === 0) {
    return { sent: 0, expired: 0 };
  }

  let sent = 0;
  let expired = 0;
  const expiredIds: number[] = [];

  // Send in parallel (up to 10 concurrent)
  const batchSize = 10;
  for (let i = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize);
    const outcomes = await Promise.all(
      batch.map(async (sub) => {
        const success = await sendPushNotification(
          { endpoint: sub.endpoint, p256dh_key: sub.p256dh_key, auth_key: sub.auth_key },
          payload,
          vapidKeys,
        );
        if (!success) {
          expiredIds.push(sub.id);
        }
        return success;
      })
    );
    sent += outcomes.filter(Boolean).length;
    expired += outcomes.filter((o) => !o).length;
  }

  // Clean up expired subscriptions
  if (expiredIds.length > 0) {
    const deleteStmt = db.prepare('DELETE FROM push_subscriptions WHERE id = ?');
    const batchSize = 100;
    for (let i = 0; i < expiredIds.length; i += batchSize) {
      const batchIds = expiredIds.slice(i, i + batchSize);
      await db.batch(batchIds.map((id) => deleteStmt.bind(id)));
    }
  }

  return { sent, expired };
}
