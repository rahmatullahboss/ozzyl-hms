import { describe, it, expect } from 'vitest';
import { buildTenantUrl } from '../lib/tenant-url';

describe('buildTenantUrl', () => {
  it('joins subdomain and base domain with a single dot', () => {
    expect(buildTenantUrl('city', 'hms.example.com')).toBe('https://city.hms.example.com');
  });

  it('lowercases and trims the subdomain', () => {
    expect(buildTenantUrl('  City  ', 'hms.example.com')).toBe('https://city.hms.example.com');
  });

  it('uses the default domain when no env override is provided', () => {
    const original = import.meta.env.VITE_APP_BASE_DOMAIN;
    // @ts-expect-error: env may be undefined in tests
    delete import.meta.env.VITE_APP_BASE_DOMAIN;
    expect(buildTenantUrl('foo')).toBe('https://foo.hms.ozzyl.com');
    if (original !== undefined) {
      // @ts-expect-error: test restore
      import.meta.env.VITE_APP_BASE_DOMAIN = original;
    }
  });
});
