import { describe, expect, it } from 'vitest';
import { isLegacyBcryptHash } from '../../src/lib/password';

const DOLLAR = String.fromCharCode(36);

describe('password CPU hardening', () => {
  it('recognizes supported legacy bcrypt prefixes only', () => {
    expect(isLegacyBcryptHash(`${DOLLAR}2a${DOLLAR}10${DOLLAR}legacy`)).toBe(true);
    expect(isLegacyBcryptHash(`${DOLLAR}2b${DOLLAR}10${DOLLAR}legacy`)).toBe(true);
    expect(isLegacyBcryptHash('pbkdf2:100000:salt:hash')).toBe(false);
    expect(isLegacyBcryptHash(null)).toBe(false);
  });
});
