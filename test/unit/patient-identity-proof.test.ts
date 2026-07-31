import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

import { verifyPatientIdentity } from '../../src/lib/patient-identity-proof';

describe('patient identity proof verification', () => {
  it('does not promote a patient identity with an arbitrary fake proof reference', async () => {
    await expect(
      verifyPatientIdentity({} as D1Database, {
        userId: 123,
        method: 'email_otp',
        proofRef: 'fake-proof-ref',
      }),
    ).rejects.toThrow(/server-side proof validation/i);
  });
});
