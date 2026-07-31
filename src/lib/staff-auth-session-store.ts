export interface StaffAuthSessionIdentity {
  sessionId: string;
  tenantId: string | number;
  userId: string | number;
}

function isoNow(): string {
  return new Date().toISOString();
}

export async function registerStaffSession(
  db: D1Database,
  identity: StaffAuthSessionIdentity,
  ttlSeconds: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await db.prepare(`
    INSERT INTO staff_auth_sessions (
      session_id,
      tenant_id,
      user_id,
      status,
      expires_at,
      created_at
    ) VALUES (?, ?, ?, 'active', ?, ?)
  `).bind(
    identity.sessionId,
    String(identity.tenantId),
    Number(identity.userId),
    expiresAt,
    isoNow(),
  ).run();
}

export async function claimStaffSessionRotation(
  db: D1Database,
  identity: StaffAuthSessionIdentity,
): Promise<boolean> {
  const now = isoNow();
  const result = await db.prepare(`
    UPDATE staff_auth_sessions
    SET status = 'rotated',
        rotated_at = ?
    WHERE session_id = ?
      AND tenant_id = ?
      AND user_id = ?
      AND status = 'active'
      AND expires_at > ?
  `).bind(
    now,
    identity.sessionId,
    String(identity.tenantId),
    Number(identity.userId),
    now,
  ).run();

  return Number(result.meta.changes ?? 0) === 1;
}

export async function revokeStaffSession(
  db: D1Database,
  identity: StaffAuthSessionIdentity,
): Promise<void> {
  await db.prepare(`
    UPDATE staff_auth_sessions
    SET status = 'revoked',
        revoked_at = ?
    WHERE session_id = ?
      AND tenant_id = ?
      AND user_id = ?
      AND status = 'active'
  `).bind(
    isoNow(),
    identity.sessionId,
    String(identity.tenantId),
    Number(identity.userId),
  ).run();
}
