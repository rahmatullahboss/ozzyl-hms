import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPatientRegistrationAttemptTracker } from '../lib/patientRegistrationAttempt';

describe('PatientForm registration attempt keys', () => {
  it('reuses the key for an identical payload and rotates it for a material change', () => {
    let next = 0;
    const tracker = createPatientRegistrationAttemptTracker(() => `attempt-${++next}`);
    const payload = {
      name: 'Patient A',
      mobile: '01712345678',
      duplicateOverrideReason: undefined,
    };

    const first = tracker.keyFor(payload);
    const retry = tracker.keyFor({ ...payload });
    const overridden = tracker.keyFor({
      ...payload,
      duplicateOverrideReason: 'Confirmed separate patient',
    });

    expect(retry).toBe(first);
    expect(overridden).not.toBe(first);
  });

  it('rotates after a successful registration reset', () => {
    let next = 0;
    const tracker = createPatientRegistrationAttemptTracker(() => `attempt-${++next}`);
    const payload = { name: 'Patient A', mobile: '01712345678' };

    const first = tracker.keyFor(payload);
    tracker.reset();
    const nextRegistration = tracker.keyFor(payload);

    expect(nextRegistration).not.toBe(first);
  });

  it('wires the tracker key into create requests but not edit requests', () => {
    const source = readFileSync('src/pages/PatientForm.tsx', 'utf8');
    expect(source).toContain('registrationAttemptTrackerRef.current.keyFor(payload)');
    expect(source).toContain('createMutation.mutate({ ...payload, idempotencyKey })');
    expect(source).toContain('updateMutation.mutate(payload)');
  });
});
