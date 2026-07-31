/**
 * Integration tests for src/middleware/security.ts
 *
 * Tests sanitizeInput, email & password validators,
 * hash/verify round-trip, and security headers middleware.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  sanitizeInput,
  isValidEmail,
  isStrongPassword,
  hashPassword,
  verifyPassword,
  securityHeaders,
} from '../../../src/middleware/security';
import type { Env, Variables } from '../../../src/types';

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('sanitizeInput()', () => {
  it('strips HTML angle brackets', () => {
    expect(sanitizeInput('<script>alert(1)</script>')).not.toContain('<');
    expect(sanitizeInput('<script>alert(1)</script>')).not.toContain('>');
  });

  it('strips single and double quotes', () => {
    const result = sanitizeInput("O'Brien");
    expect(result).not.toContain("'");
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello');
  });

  it('preserves safe alphanumeric content', () => {
    const input = 'John Doe 123';
    expect(sanitizeInput(input)).toBe(input);
  });
});

describe('isValidEmail()', () => {
  it('returns true for a valid email', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('admin+tag@hospital.org')).toBe(true);
  });

  it('returns false for invalid emails', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('@nodomain.com')).toBe(false);
    expect(isValidEmail('missing@')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('isStrongPassword()', () => {
  it('returns true for passwords meeting all requirements', () => {
    expect(isStrongPassword('Secure123')).toBe(true);
    expect(isStrongPassword('Hospital@99')).toBe(true);
  });

  it('returns false for weak passwords', () => {
    expect(isStrongPassword('weak')).toBe(false);
    expect(isStrongPassword('alllowercase1')).toBe(false); // no uppercase
    expect(isStrongPassword('ALLUPPERCASE1')).toBe(false); // no lowercase
    expect(isStrongPassword('NoDigitsHere')).toBe(false); // no number
    expect(isStrongPassword('Short1')).toBe(false);         // < 8 chars
  });
});

describe('hashPassword() / verifyPassword()', () => {
  it('hashes a password and verifies it correctly', async () => {
    const password = 'SecurePass123';
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    expect(hash.startsWith('$2')).toBe(true); // bcrypt hash prefix
    const isMatch = await verifyPassword(password, hash);
    expect(isMatch).toBe(true);
  });

  it('returns false when verifying with wrong password', async () => {
    const hash = await hashPassword('CorrectPass1');
    const isMatch = await verifyPassword('WrongPass1', hash);
    expect(isMatch).toBe(false);
  });
});

describe('securityHeaders middleware', () => {
  it('sets all required security headers on every response', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', securityHeaders);
    app.get('/ping', (c) => c.json({ ok: true }));

    const res = await app.request('/ping');
    expect(res.status).toBe(200);

    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('Strict-Transport-Security')).toMatch(/max-age=/);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(res.headers.get('Permissions-Policy')).toBeTruthy();
  });
});
