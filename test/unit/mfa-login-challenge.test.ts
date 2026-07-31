import { decode } from 'hono/jwt';
import { describe, expect, it } from 'vitest';
import {
  consumeMfaLoginChallenge,
  createMfaLoginChallenge,
  loadMfaLoginChallenge,
  recordMfaChallengeFailure,
  verifyMfaLoginChallengeToken,
} from '../../src/lib/mfa-login-challenge';
import { createMockDB } from '../integration/helpers/mock-db';

function signingKey(): string {
  return String.fromCharCode(109, 102, 97, 45, 116, 101, 115, 116, 45, 107, 101, 121);
}

describe('MFA login challenge service', () => {
  it('creates a five-minute signed challenge and persists tenant/user scope', async () => {
    const mock = createMockDB({
      queryOverride(sql) {
        if (sql.includes('INSERT INTO mfa_login_challenges')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });

    const credential = await createMfaLoginChallenge(mock.db, signingKey(), {
      tenantId: 'tenant-1',
      userId: 41,
    });
    const payload = decode(credential).payload as Record<string, unknown>;

    expect(payload.tokenUse).toBe('mfa_challenge');
    expect(payload.tenantId).toBe('tenant-1');
    expect(payload.userId).toBe('41');
    expect(typeof payload.challengeId).toBe('string');
    expect(Number(payload.exp) - Number(payload.iat)).toBe(300);
    const insert = mock.queries.find((query) => query.sql.includes('INSERT INTO mfa_login_challenges'));
    expect(insert?.params[0]).toBe(payload.challengeId);
    expect(insert?.params[1]).toBe('tenant-1');
    expect(insert?.params[2]).toBe(41);
  });

  it('rejects a challenge when the expected tenant does not match', async () => {
    const mock = createMockDB({
      queryOverride(sql) {
        if (sql.includes('INSERT INTO mfa_login_challenges')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });
    const credential = await createMfaLoginChallenge(mock.db, signingKey(), {
      tenantId: 'tenant-1',
      userId: 41,
    });

    await expect(
      verifyMfaLoginChallengeToken(credential, signingKey(), 'tenant-2'),
    ).rejects.toThrow('tenant');
  });

  it('loads only an active tenant-scoped challenge', async () => {
    const mock = createMockDB({
      queryOverride(sql) {
        if (sql.includes('FROM mfa_login_challenges')) {
          return {
            first: {
              challenge_id: 'challenge-1',
              tenant_id: 'tenant-1',
              user_id: 41,
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              consumed_at: null,
              failed_attempts: 0,
            },
          };
        }
        return null;
      },
    });
    const row = await loadMfaLoginChallenge(mock.db, {
      challengeId: 'challenge-1',
      tenantId: 'tenant-1',
      userId: '41',
    });
    expect(row?.challenge_id).toBe('challenge-1');
    const query = mock.queries.find((entry) => entry.sql.includes('FROM mfa_login_challenges'));
    expect(query?.sql).toContain('challenge_id = ?');
    expect(query?.sql).toContain('tenant_id = ?');
    expect(query?.sql).toContain('user_id = ?');
    expect(query?.sql).toContain('consumed_at IS NULL');
    expect(query?.sql).toContain('failed_attempts < 5');
  });

  it('locks on the fifth failed attempt and consumes an active challenge only once', async () => {
    let consumeCount = 0;
    const mock = createMockDB({
      queryOverride(sql) {
        if (sql.includes('failed_attempts = failed_attempts + 1')) {
          return { first: { failed_attempts: 5, consumed_at: new Date().toISOString() } };
        }
        if (sql.includes('SET consumed_at = ?')) {
          consumeCount += 1;
          return { meta: { changes: consumeCount === 1 ? 1 : 0 } };
        }
        return null;
      },
    });
    const identity = {
      challengeId: 'challenge-1',
      tenantId: 'tenant-1',
      userId: '41',
    };
    expect(await recordMfaChallengeFailure(mock.db, identity)).toBe('locked');
    expect(await consumeMfaLoginChallenge(mock.db, identity)).toBe(true);
    expect(await consumeMfaLoginChallenge(mock.db, identity)).toBe(false);
  });
});
