export type PatientAuthTokenScope = 'global' | 'pending';

export interface PatientAuthScopeDecision {
  scope: PatientAuthTokenScope;
  verificationRequired: boolean;
  status: 'verified' | 'pending_verification';
}

export class PatientAuthSuspendedError extends Error {
  constructor() {
    super('Patient account verification is suspended');
    this.name = 'PatientAuthSuspendedError';
  }
}

export function resolvePatientAuthScope(authStatus: unknown): PatientAuthScopeDecision {
  const normalized = String(authStatus ?? '').trim().toLowerCase();
  if (normalized === 'verified') {
    return {
      scope: 'global',
      verificationRequired: false,
      status: 'verified',
    };
  }
  if (normalized === 'suspended') {
    throw new PatientAuthSuspendedError();
  }
  return {
    scope: 'pending',
    verificationRequired: true,
    status: 'pending_verification',
  };
}
