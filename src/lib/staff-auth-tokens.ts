import type { Env } from '../types';
import { generateToken, type JWTPayload } from '../middleware/auth';
import { normalizeRole } from './authz';
import { resolveUserPermissions } from '../middleware/rbac';
import { STAFF_SESSION_TTL_SECONDS } from './staff-session-cookie';
import { registerStaffSession } from './staff-auth-session-store';

export interface StaffAuthIdentity {
  id: string | number;
  role: string;
  tenantId: string | number;
}

export interface StaffTokenPair {
  accessToken: string;
  sessionToken: string;
  sessionId: string;
}

export async function issueStaffTokenPair(
  env: Pick<Env, 'DB' | 'JWT_SECRET'>,
  user: StaffAuthIdentity,
): Promise<StaffTokenPair> {
  const tenantId = String(user.tenantId);
  const role = normalizeRole(user.role) || user.role;
  const permissions = await resolveUserPermissions(
    env.DB,
    tenantId,
    role,
    String(user.id),
  );
  const sessionId = crypto.randomUUID();
  const commonPayload = {
    userId: String(user.id),
    role,
    tenantId,
    permissions,
    sessionId,
  };

  const [accessToken, sessionToken] = await Promise.all([
    generateToken({ ...commonPayload, tokenUse: 'access' } as JWTPayload, env.JWT_SECRET, 8),
    generateToken({ ...commonPayload, tokenUse: 'session' } as JWTPayload, env.JWT_SECRET, 8),
  ]);

  await registerStaffSession(env.DB, {
    sessionId,
    tenantId,
    userId: String(user.id),
  }, STAFF_SESSION_TTL_SECONDS);

  return { accessToken, sessionToken, sessionId };
}
