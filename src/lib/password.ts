const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH_LENGTH = 32;
const BCRYPT_PREFIX_2A = String.fromCharCode(36) + '2a' + String.fromCharCode(36);
const BCRYPT_PREFIX_2B = String.fromCharCode(36) + '2b' + String.fromCharCode(36);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  const pairs = hex.match(/.{2}/g);
  if (!pairs || pairs.join('') !== hex) return null;
  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
}

export function isLegacyBcryptHash(storedHash: string | null | undefined): boolean {
  return Boolean(
    storedHash?.startsWith(BCRYPT_PREFIX_2A) || storedHash?.startsWith(BCRYPT_PREFIX_2B),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_HASH_LENGTH * 8,
  );
  return `pbkdf2:${PBKDF2_ITERATIONS}:${bytesToHex(salt)}:${bytesToHex(new Uint8Array(derivedBits))}`;
}

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) return false;

  const parts = storedHash.split(':');
  if (parts.length === 4 && parts[0] === 'pbkdf2') {
    const iterations = Number.parseInt(parts[1], 10);
    const salt = hexToBytes(parts[2]);
    if (!Number.isFinite(iterations) || iterations <= 0 || !salt) return false;

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      PBKDF2_HASH_LENGTH * 8,
    );
    return bytesToHex(new Uint8Array(derivedBits)) === parts[3];
  }

  if (isLegacyBcryptHash(storedHash)) {
    const bcrypt = await import('bcryptjs');
    return bcrypt.compare(password, storedHash);
  }

  return false;
}
