type KeyFactory = () => string;

type PatientRegistrationAttemptTracker = {
  keyFor(payload: Record<string, unknown>): string;
  reset(): void;
};

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

function defaultKeyFactory(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `patient-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createPatientRegistrationAttemptTracker(
  createKey: KeyFactory = defaultKeyFactory,
): PatientRegistrationAttemptTracker {
  let activeFingerprint: string | null = null;
  let activeKey: string | null = null;

  return {
    keyFor(payload) {
      const fingerprint = JSON.stringify(normalize(payload));
      if (activeFingerprint !== fingerprint || !activeKey) {
        activeFingerprint = fingerprint;
        activeKey = createKey();
      }
      return activeKey;
    },
    reset() {
      activeFingerprint = null;
      activeKey = null;
    },
  };
}
