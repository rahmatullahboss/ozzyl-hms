export interface LisBridgeSignatureInput {
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  deliveryId: string;
  bodySha256: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return bytesToHex(new Uint8Array(digest));
}

export function buildLisBridgeCanonicalRequest(input: LisBridgeSignatureInput): string {
  const method = String(input.method || '').trim().toUpperCase();
  const path = String(input.path || '').trim();
  const timestamp = Number(input.timestamp);
  const nonce = String(input.nonce || '').trim();
  const deliveryId = String(input.deliveryId || '').trim();
  const bodySha256 = String(input.bodySha256 || '').trim().toLowerCase();

  if (!method || !path || !Number.isInteger(timestamp) || !nonce || !deliveryId || !/^[a-f0-9]{64}$/.test(bodySha256)) {
    throw new Error('Invalid LIS bridge signature input');
  }

  return [method, path, String(timestamp), nonce, deliveryId, bodySha256].join('\n');
}

export async function createLisBridgeRequestSignature(
  secret: string,
  input: LisBridgeSignatureInput,
): Promise<string> {
  const normalizedSecret = String(secret || '');
  if (!normalizedSecret) throw new Error('LIS bridge signing secret is required');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(buildLisBridgeCanonicalRequest(input)),
  );
  return bytesToHex(new Uint8Array(signature));
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  const maxLength = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}
