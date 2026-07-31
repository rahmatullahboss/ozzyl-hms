import { describe, expect, it } from 'vitest';
import { normalizeBangladeshMobile } from '../../src/lib/bangladesh-phone.ts';

describe('normalizeBangladeshMobile', () => {
  it('normalizes common Bangladesh mobile input formats', () => {
    expect(normalizeBangladeshMobile('+880 1712-345678')).toBe('01712345678');
    expect(normalizeBangladeshMobile('1712345678')).toBe('01712345678');
    expect(normalizeBangladeshMobile('০১৭১২৩৪৫৬৭৮')).toBe('01712345678');
  });

  it('rejects invalid operator prefixes', () => {
    expect(normalizeBangladeshMobile('01212345678')).toBeNull();
  });
});
