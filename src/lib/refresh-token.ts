/**
 * Refresh token utility.
 *
 * Implements short-lived access tokens (15 min) + long-lived refresh tokens (7 days).
 * Refresh tokens are marked with type='refresh' to prevent access token reuse.
 *
 * Flow:
 * 1. Login → generateTokenPair() → { accessToken, refreshToken }
 * 2. Access token expires → POST /auth/refresh with refreshToken
 * 3. Server validates refresh token → issues new accessToken
 * 4. Logout → blacklist both tokens
 */

import { sign, verify } from 'hono/jwt';
import type { JWTPayload } from '../middleware/auth';

const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;      // 15 minutes
const REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 3600; // 7 days

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;  // seconds
  refreshExpiresIn: number; // seconds
}

interface RefreshJWTPayload extends JWTPayload {
  type: 'refresh';
}

/**
 * Generate an access + refresh token pair.
 */
export async function generateTokenPair(
  userPayload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
): Promise<TokenPair> {
  const now = Math.floor(Date.now() / 1000);

  const accessToken = await sign(
    {
      ...userPayload,
      iat: now,
      exp: now + ACCESS_TOKEN_EXPIRY_SECONDS,
    } as Record<string, unknown>,
    secret,
  );

  const refreshToken = await sign(
    {
      ...userPayload,
      type: 'refresh',
      iat: now,
      exp: now + REFRESH_TOKEN_EXPIRY_SECONDS,
    } as Record<string, unknown>,
    secret,
  );

  return {
    accessToken,
    refreshToken,
    accessExpiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
    refreshExpiresIn: REFRESH_TOKEN_EXPIRY_SECONDS,
  };
}

/**
 * Check if a token is a refresh token.
 */
export async function isRefreshToken(token: string, secret: string): Promise<boolean> {
  try {
    const decoded = (await verify(token, secret, 'HS256')) as Record<string, unknown>;
    return decoded.type === 'refresh';
  } catch {
    return false;
  }
}

/**
 * Exchange a refresh token for a new access token.
 * Validates that the token is a refresh token (not an access token).
 */
export async function refreshAccessToken(
  refreshToken: string,
  secret: string,
): Promise<string> {
  // Verify it's a valid token
  const decoded = (await verify(refreshToken, secret, 'HS256')) as unknown as RefreshJWTPayload;

  // Must be a refresh token
  if (decoded.type !== 'refresh') {
    throw new Error('Not a refresh token');
  }

  // Generate new access token with same user context
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await sign(
    {
      userId: decoded.userId,
      role: decoded.role,
      tenantId: decoded.tenantId,
      permissions: decoded.permissions,
      iat: now,
      exp: now + ACCESS_TOKEN_EXPIRY_SECONDS,
    } as Record<string, unknown>,
    secret,
  );

  return accessToken;
}

/**
 * Get TTL for blacklisting a refresh token (remaining lifetime in seconds).
 */
export function getRefreshTokenTtl(): number {
  return REFRESH_TOKEN_EXPIRY_SECONDS;
}
