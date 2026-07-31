import { describe, it, expect, vi } from 'vitest';

// Mock hono/jwt
let tokenCounter = 0;
vi.mock('hono/jwt', () => ({
  sign: vi.fn(async (payload: any, _secret: string) => {
    tokenCounter++;
    return `mock-jwt-${tokenCounter}-${JSON.stringify(payload)}`;
  }),
  verify: vi.fn(async (token: string, _secret: string) => {
    const match = token.match(/^mock-jwt-\d+-(.+)$/);
    if (match) {
      const payload = JSON.parse(match[1]);
      // Check expiry
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('token has expired');
      }
      return payload;
    }
    throw new Error('Invalid token');
  }),
}));

import { generateTokenPair, refreshAccessToken, isRefreshToken } from '../../src/lib/refresh-token';

describe('refresh tokens', () => {
  const secret = 'test-secret-key';

  describe('generateTokenPair', () => {
    it('returns both access and refresh tokens', async () => {
      const pair = await generateTokenPair(
        { userId: 'user-1', role: 'doctor', tenantId: 'tenant-1', permissions: ['patients:read'] },
        secret,
      );

      expect(pair.accessToken).toBeDefined();
      expect(pair.refreshToken).toBeDefined();
      expect(pair.accessToken).not.toBe(pair.refreshToken);
      expect(pair.accessExpiresIn).toBeLessThan(pair.refreshExpiresIn);
    });

    it('access token expires in 15 minutes', async () => {
      const pair = await generateTokenPair(
        { userId: 'user-1', role: 'doctor', tenantId: 'tenant-1', permissions: [] },
        secret,
      );

      expect(pair.accessExpiresIn).toBe(15 * 60); // 15 min in seconds
    });

    it('refresh token expires in 7 days', async () => {
      const pair = await generateTokenPair(
        { userId: 'user-1', role: 'doctor', tenantId: 'tenant-1', permissions: [] },
        secret,
      );

      expect(pair.refreshExpiresIn).toBe(7 * 24 * 60 * 60); // 7 days in seconds
    });

    it('refresh token is marked with type=refresh', async () => {
      const pair = await generateTokenPair(
        { userId: 'user-1', role: 'doctor', tenantId: 'tenant-1', permissions: [] },
        secret,
      );

      expect(isRefreshToken(pair.refreshToken, secret)).resolves.toBe(true);
    });

    it('access token is NOT marked as refresh', async () => {
      const pair = await generateTokenPair(
        { userId: 'user-1', role: 'doctor', tenantId: 'tenant-1', permissions: [] },
        secret,
      );

      expect(isRefreshToken(pair.accessToken, secret)).resolves.toBe(false);
    });
  });

  describe('refreshAccessToken', () => {
    it('issues new access token from valid refresh token', async () => {
      const pair = await generateTokenPair(
        { userId: 'user-1', role: 'doctor', tenantId: 'tenant-1', permissions: ['patients:read'] },
        secret,
      );

      const newAccessToken = await refreshAccessToken(pair.refreshToken, secret);

      expect(newAccessToken).toBeDefined();
      expect(newAccessToken).not.toBe(pair.accessToken);
    });

    it('rejects access token used as refresh token', async () => {
      const pair = await generateTokenPair(
        { userId: 'user-1', role: 'doctor', tenantId: 'tenant-1', permissions: [] },
        secret,
      );

      await expect(refreshAccessToken(pair.accessToken, secret)).rejects.toThrow('Not a refresh token');
    });

    it('rejects expired refresh token', async () => {
      // Create an already-expired token
      const now = Math.floor(Date.now() / 1000);
      const expiredPayload = {
        userId: 'user-1',
        role: 'doctor',
        tenantId: 'tenant-1',
        permissions: [],
        type: 'refresh',
        iat: now - 8 * 24 * 3600,
        exp: now - 1, // expired 1 second ago
      };

      const { sign } = await import('hono/jwt');
      const expiredToken = await sign(expiredPayload, secret);

      await expect(refreshAccessToken(expiredToken, secret)).rejects.toThrow();
    });

    it('new access token has same user context as refresh token', async () => {
      const pair = await generateTokenPair(
        { userId: 'user-1', role: 'doctor', tenantId: 'tenant-1', permissions: ['billing:refund'] },
        secret,
      );

      const newAccessToken = await refreshAccessToken(pair.refreshToken, secret);

      // Verify the new token contains the same user info
      const { verify } = await import('hono/jwt');
      const decoded = await verify(newAccessToken, secret) as any;
      expect(decoded.userId).toBe('user-1');
      expect(decoded.role).toBe('doctor');
      expect(decoded.tenantId).toBe('tenant-1');
    });
  });
});
