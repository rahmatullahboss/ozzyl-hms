import { describe, it, expect } from 'vitest';

// ═════════════════════════════════════════════════════════════════════════════
// TIMING-SAFE COMPARISON TESTS
// Verify password hash comparison uses constant-time logic to prevent
// timing attacks from leaking hash content byte-by-byte.
// ═════════════════════════════════════════════════════════════════════════════

// Inline the same XOR-based timingSafeEqual used in production code
// so we can test the algorithm itself independently.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

describe('timingSafeEqual — constant-time string comparison', () => {

  it('returns true for identical strings', () => {
    const hash = 'a'.repeat(64);
    expect(timingSafeEqual(hash, hash)).toBe(true);
  });

  it('returns false for strings of different length (fast reject)', () => {
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
  });

  it('returns false when strings differ by one character', () => {
    const a = 'a'.repeat(64);
    const b = 'a'.repeat(63) + 'b';
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it('returns false when strings differ at the first byte', () => {
    const a = 'a'.repeat(64);
    const b = 'b' + 'a'.repeat(63);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it('returns false for completely different same-length strings', () => {
    const a = '0'.repeat(64);
    const b = 'f'.repeat(64);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it('works with hex hash strings (SHA-256 output length = 64 hex chars)', () => {
    const realHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(timingSafeEqual(realHash, realHash)).toBe(true);

    const tampered = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856';
    expect(timingSafeEqual(realHash, tampered)).toBe(false);
  });

  it('delegates production comparison to the platform timing-safe primitive', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const srcPath = path.resolve(__dirname, '../src/routes/doctor-auth.ts');
    const src = fs.readFileSync(srcPath, 'utf-8');

    const fnStart = src.indexOf('function timingSafeEqual');
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = src.indexOf('\n}', fnStart);
    const timingSafeFn = src.slice(fnStart, fnEnd + 2);

    expect(timingSafeFn).toContain('crypto.subtle.timingSafeEqual');
    expect(timingSafeFn).not.toContain('=== b');
  });
});

describe('verifyPassword uses timingSafeEqual (source-level check)', () => {
  it('doctor-auth.ts should not use === for hash comparison', async () => {
    // Read the source and assert the vulnerable pattern is absent.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const srcPath = path.resolve(__dirname, '../src/routes/doctor-auth.ts');
    const src = fs.readFileSync(srcPath, 'utf-8');

    // Extract the verifyPassword function body (from its declaration to its closing brace)
    const fnStart = src.indexOf('async function verifyPassword');
    expect(fnStart).toBeGreaterThan(-1);
    // Walk forward to find the matching closing brace
    let depth = 0;
    let fnEnd = fnStart;
    for (let i = fnStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') {
        depth--;
        if (depth === 0) { fnEnd = i + 1; break; }
      }
    }
    const verifyFn = src.slice(fnStart, fnEnd);

    // The function body of verifyPassword must NOT contain "=== storedHash"
    expect(verifyFn).not.toContain('=== storedHash');

    // It SHOULD call timingSafeEqual
    expect(verifyFn).toContain('timingSafeEqual');
  });
});
