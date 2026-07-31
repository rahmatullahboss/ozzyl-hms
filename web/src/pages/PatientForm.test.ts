import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/PatientForm.tsx', 'utf8');

describe('PatientForm', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientForm');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('locks rapid patient registration submits and reuses one idempotency key for the attempt', () => {
    expect(source).toContain('const patientSubmitLockRef = useRef(false)');
    expect(source).toContain('const registrationAttemptTrackerRef = useRef(createPatientRegistrationAttemptTracker())');
    expect(source).toContain('if (patientSubmitLockRef.current) return;');
    expect(source).toContain('registrationAttemptTrackerRef.current.keyFor(payload)');
    expect(source).toContain('createMutation.mutate({ ...payload, idempotencyKey })');
    expect(source).toContain('registrationAttemptTrackerRef.current.reset()');
    expect(source).toContain('patientSubmitLockRef.current = false');
    expect(source).toContain('error.status < 500');
    expect(source).toContain("error.message.includes('already being processed')");
  });
});
