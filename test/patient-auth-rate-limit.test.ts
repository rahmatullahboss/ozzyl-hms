import { describe, expect, it } from 'vitest';
import { shouldBypassPatientAuthRateLimit } from '../src/lib/patient-auth-rate-limit';

describe('patient auth rate limit bypass rules', () => {
  it('bypasses read/bootstrap requests', () => {
    expect(shouldBypassPatientAuthRateLimit('/api/patient-auth/me', 'GET')).toBe(true);
    expect(shouldBypassPatientAuthRateLimit('/api/patient-auth/my-hospitals', 'GET')).toBe(true);
    expect(shouldBypassPatientAuthRateLimit('/api/patient-auth/refresh', 'POST')).toBe(true);
    expect(shouldBypassPatientAuthRateLimit('/api/patient-auth/me', 'PATCH')).toBe(true);
  });

  it('keeps login and register endpoints rate limited', () => {
    expect(shouldBypassPatientAuthRateLimit('/api/patient-auth/login', 'POST')).toBe(false);
    expect(shouldBypassPatientAuthRateLimit('/api/patient-auth/register', 'POST')).toBe(false);
    expect(shouldBypassPatientAuthRateLimit('/api/patient-auth/forgot-password', 'POST')).toBe(false);
  });
});
