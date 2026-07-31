import { describe, expect, it } from 'vitest';
import {
  claimStaffSessionRotation,
  registerStaffSession,
  revokeStaffSession,
} from '../../src/lib/staff-auth-session-store';
import { createMockDB } from '../integration/helpers/mock-db';

const identity = {
  sessionId: 'session-1',
  tenantId: 'tenant-1',
  userId: '41',
};

describe('staff authentication session store', () => {
  it('registers an active tenant-scoped session with an expiry', async () => {
    const mock = createMockDB({
      queryOverride(sql) {
        if (sql.includes('INSERT INTO staff_auth_sessions')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });

    await registerStaffSession(mock.db, identity, 3600);

    const insert = mock.queries.find((entry) => entry.sql.includes('INSERT INTO staff_auth_sessions'));
    expect(insert?.params[0]).toBe(identity.sessionId);
    expect(insert?.params[1]).toBe(identity.tenantId);
    expect(insert?.params[2]).toBe(41);
    expect(insert?.sql).toContain("'active'");
    expect(typeof insert?.params[3]).toBe('string');
  });

  it('claims an active session for rotation only once', async () => {
    let attempts = 0;
    const mock = createMockDB({
      queryOverride(sql) {
        if (sql.includes("SET status = 'rotated'")) {
          attempts += 1;
          return { meta: { changes: attempts === 1 ? 1 : 0 } };
        }
        return null;
      },
    });

    expect(await claimStaffSessionRotation(mock.db, identity)).toBe(true);
    expect(await claimStaffSessionRotation(mock.db, identity)).toBe(false);

    const update = mock.queries.find((entry) => entry.sql.includes("SET status = 'rotated'"));
    expect(update?.sql).toContain("status = 'active'");
    expect(update?.sql).toContain('expires_at > ?');
    expect(update?.sql).toContain('session_id = ?');
    expect(update?.sql).toContain('tenant_id = ?');
    expect(update?.sql).toContain('user_id = ?');
  });

  it('revokes only the matching active session', async () => {
    const mock = createMockDB({
      queryOverride(sql) {
        if (sql.includes("SET status = 'revoked'")) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });

    await revokeStaffSession(mock.db, identity);

    const update = mock.queries.find((entry) => entry.sql.includes("SET status = 'revoked'"));
    expect(update?.sql).toContain("status = 'active'");
    expect(update?.params).toContain(identity.sessionId);
    expect(update?.params).toContain(identity.tenantId);
    expect(update?.params).toContain(41);
  });
});
