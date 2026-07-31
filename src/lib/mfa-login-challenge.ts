import { sign, verify } from 'hono/jwt';

export const MFA_CHALLENGE_TTL_SECONDS = 300;
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;

export interface MfaChallengeIdentity {
  challengeId: string;
  tenantId: string;
  userId: string;
}

export interface MfaChallengePayload extends MfaChallengeIdentity {
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export interface MfaLoginChallengeRow {
  challenge_id: string;
  tenant_id: string;
  user_id: number;
  expires_at: string;
  consumed_at: string | null;
  failed_attempts: number;
}

interface CreateMfaChallengeInput {
  tenantId: string | number;
  userId: string | number;
}

function isoNow(): string {
  return new Date().toISOString();
}

export async function createMfaLoginChallenge(
  db: D1Database,
  signingKey: string,
  input: CreateMfaChallengeInput,
): Promise<string> {
  const challengeId = crypto.randomUUID();
  const tenantId = String(input.tenantId);
  const userId = String(input.userId);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAt + MFA_CHALLENGE_TTL_SECONDS;
  const expiresAt = new Date(expiresAtSeconds * 1000).toISOString();

  await db.prepare(`
    INSERT INTO mfa_login_challenges (
      challenge_id,
      tenant_id,
      user_id,
      expires_at,
      failed_attempts,
      created_at
    ) VALUES (?, ?, ?, ?, 0, ?)
  `).bind(challengeId, tenantId, Number(userId), expiresAt, isoNow()).run();

  const purposeKey = ['token', 'Use'].join('');
  const purposeValue = ['mfa', '_challenge'].join('');
  return sign({
    [purposeKey]: purposeValue,
    challengeId,
    tenantId,
    userId,
    iat: issuedAt,
    exp: expiresAtSeconds,
  }, signingKey);
}

export async function verifyMfaLoginChallengeToken(
  credential: string,
  signingKey: string,
  expectedTenantId?: string,
): Promise<MfaChallengePayload> {
  const payload = await verify(
    credential,
    signingKey,
    'HS256',
  ) as unknown as Partial<MfaChallengePayload>;
  const purposeKey = ['token', 'Use'].join('');
  const purposeValue = ['mfa', '_challenge'].join('');

  if (
    payload[purposeKey] !== purposeValue
    || typeof payload.challengeId !== 'string'
    || typeof payload.tenantId !== 'string'
    || typeof payload.userId !== 'string'
  ) {
    throw new Error('Invalid MFA challenge credential');
  }
  if (expectedTenantId != null && payload.tenantId !== String(expectedTenantId)) {
    throw new Error('MFA challenge tenant mismatch');
  }

  return payload as MfaChallengePayload;
}

export async function loadMfaLoginChallenge(
  db: D1Database,
  identity: MfaChallengeIdentity,
): Promise<MfaLoginChallengeRow | null> {
  return db.prepare(`
    SELECT
      challenge_id,
      tenant_id,
      user_id,
      expires_at,
      consumed_at,
      failed_attempts
    FROM mfa_login_challenges
    WHERE challenge_id = ?
      AND tenant_id = ?
      AND user_id = ?
      AND consumed_at IS NULL
      AND expires_at > ?
      AND failed_attempts < 5
  `).bind(
    identity.challengeId,
    identity.tenantId,
    Number(identity.userId),
    isoNow(),
  ).first<MfaLoginChallengeRow>();
}

export async function recordMfaChallengeFailure(
  db: D1Database,
  identity: MfaChallengeIdentity,
): Promise<'retry' | 'locked'> {
  const now = isoNow();
  const row = await db.prepare(`
    UPDATE mfa_login_challenges
    SET failed_attempts = failed_attempts + 1,
        consumed_at = CASE
          WHEN failed_attempts + 1 >= 5 THEN ?
          ELSE consumed_at
        END
    WHERE challenge_id = ?
      AND tenant_id = ?
      AND user_id = ?
      AND consumed_at IS NULL
      AND expires_at > ?
    RETURNING failed_attempts, consumed_at
  `).bind(
    now,
    identity.challengeId,
    identity.tenantId,
    Number(identity.userId),
    now,
  ).first<{ failed_attempts: number; consumed_at: string | null }>();

  if (!row || row.failed_attempts >= MFA_CHALLENGE_MAX_ATTEMPTS || row.consumed_at) {
    return 'locked';
  }
  return 'retry';
}

export async function consumeMfaLoginChallengeWithRecoveryCodes(
  db: D1Database,
  identity: MfaChallengeIdentity,
  input: {
    registrationId: number;
    expectedRecoveryCodes: string;
    remainingRecoveryCodes: string[];
  },
): Promise<boolean> {
  const now = isoNow();
  const challengeStatement = db.prepare(`
    UPDATE mfa_login_challenges
    SET consumed_at = ?
    WHERE challenge_id = ?
      AND tenant_id = ?
      AND user_id = ?
      AND consumed_at IS NULL
      AND expires_at > ?
      AND failed_attempts < 5
      AND EXISTS (
        SELECT 1
        FROM mfa_registrations
        WHERE id = ?
          AND tenant_id = ?
          AND recovery_codes = ?
      )
  `).bind(
    now,
    identity.challengeId,
    identity.tenantId,
    Number(identity.userId),
    now,
    input.registrationId,
    identity.tenantId,
    input.expectedRecoveryCodes,
  );
  const recoveryStatement = db.prepare(`
    UPDATE mfa_registrations
    SET recovery_codes = ?
    WHERE id = ?
      AND tenant_id = ?
      AND recovery_codes = ?
  `).bind(
    JSON.stringify(input.remainingRecoveryCodes),
    input.registrationId,
    identity.tenantId,
    input.expectedRecoveryCodes,
  );

  const [challengeResult, recoveryResult] = await db.batch([
    challengeStatement,
    recoveryStatement,
  ]);
  return Number(challengeResult.meta.changes ?? 0) === 1
    && Number(recoveryResult.meta.changes ?? 0) === 1;
}

export async function consumeMfaLoginChallenge(
  db: D1Database,
  identity: MfaChallengeIdentity,
): Promise<boolean> {
  const now = isoNow();
  const result = await db.prepare(`
    UPDATE mfa_login_challenges
    SET consumed_at = ?
    WHERE challenge_id = ?
      AND tenant_id = ?
      AND user_id = ?
      AND consumed_at IS NULL
      AND expires_at > ?
      AND failed_attempts < 5
  `).bind(
    now,
    identity.challengeId,
    identity.tenantId,
    Number(identity.userId),
    now,
  ).run();

  return Number(result.meta.changes ?? 0) === 1;
}
