import { describe, expect, it } from 'vitest';
import {
  PatientAuthSuspendedError,
  resolvePatientAuthScope,
} from '../src/lib/patient-auth-scope';

describe('patient auth token scope policy', () => {
  it('grants global scope only to verified patient identities', () => {
    expect(resolvePatientAuthScope('verified')).toEqual({
      scope: 'global',
      verificationRequired: false,
      status: 'verified',
    });
  });

  it('keeps pending and unknown legacy states fail-closed', () => {
    expect(resolvePatientAuthScope('pending_verification')).toEqual({
      scope: 'pending',
      verificationRequired: true,
      status: 'pending_verification',
    });
    expect(resolvePatientAuthScope(null)).toEqual({
      scope: 'pending',
      verificationRequired: true,
      status: 'pending_verification',
    });
    expect(resolvePatientAuthScope('unexpected')).toEqual({
      scope: 'pending',
      verificationRequired: true,
      status: 'pending_verification',
    });
  });

  it('denies suspended patient identities', () => {
    expect(() => resolvePatientAuthScope('suspended')).toThrow(PatientAuthSuspendedError);
  });
});
