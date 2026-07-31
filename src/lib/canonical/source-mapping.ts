import { createRequestFingerprint } from './idempotency';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function requireIdentityComponent(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function encode128Bits(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new RangeError('Deterministic source hash requires at least 128 bits');
  let value = 0n;
  for (let index = 0; index < 16; index += 1) value = (value << 8n) | BigInt(bytes[index]);

  let output = '';
  for (let index = 0; index < 26; index += 1) {
    output = CROCKFORD_BASE32[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}

export function normalizeIdentityText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  return normalized || null;
}

export function normalizeRegistrationNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLocaleUpperCase('en-US')
    .replace(/[\s-]+/g, '');
  return normalized || null;
}

/**
 * Hashes normalized source evidence without persisting the underlying identifying fields.
 */
export async function createSourceEvidenceSha256(evidence: unknown): Promise<string> {
  return createRequestFingerprint({ schemaVersion: 1, evidence });
}

/**
 * Creates a stable public identifier from an explicit tenant and legacy source key.
 * Names, phone numbers, emails, and other mutable/PHI fields must never be inputs.
 */
export async function createDeterministicSourceId(
  prefix: string,
  tenantId: string,
  sourceType: string,
  sourcePublicId: string,
): Promise<string> {
  const safePrefix = requireIdentityComponent(prefix, 'prefix');
  if (!/^[a-z][a-z0-9]{1,11}$/.test(safePrefix)) {
    throw new TypeError('prefix must be 2-12 lowercase alphanumeric characters starting with a letter');
  }
  const tenant = requireIdentityComponent(tenantId, 'tenantId');
  const source = requireIdentityComponent(sourceType, 'sourceType');
  const sourceId = requireIdentityComponent(sourcePublicId, 'sourcePublicId');
  const canonicalKey = JSON.stringify([1, tenant, source, sourceId]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalKey));
  return `${safePrefix}_${encode128Bits(new Uint8Array(digest))}`;
}
