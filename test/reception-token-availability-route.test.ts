import { describe, expect, it } from 'vitest';
import receptionRoutes from '../src/routes/tenant/reception';
import { createTestApp } from './integration/helpers/test-app';

describe('reception token availability route', () => {
  it.each(['md', 'director', 'manager'] as const)(
    'allows %s users to open reception API workspace without 403',
    async (role) => {
      const { app } = createTestApp({
        route: receptionRoutes,
        routePath: '/reception',
        role,
        queryOverride(sql) {
          if (sql.includes('SELECT token_from, token_to, label FROM token_reservations')) {
            return { results: [] };
          }
          if (sql.includes('SELECT token_no FROM appointments')) {
            return { results: [] };
          }
          return null;
        },
      });

      const response = await app.request(
        '/reception/token-reservations/available?date=2026-06-21&doctorId=9',
      );

      expect(response.status).toBe(200);
    },
  );

  it('returns normalized booked token numbers for the serial strip', async () => {
    const { app } = createTestApp({
      route: receptionRoutes,
      routePath: '/reception',
      role: 'reception',
      queryOverride(sql) {
        if (sql.includes('SELECT token_from, token_to, label FROM token_reservations')) {
          return { results: [{ token_from: 1, token_to: 5, label: 'Reserved' }] };
        }
        if (sql.includes('SELECT token_no FROM appointments')) {
          return {
            results: [
              { token_no: 2 },
              { token_no: '4' },
              { token_no: null },
              { token_no: 0 },
            ],
          };
        }
        return null;
      },
    });

    const response = await app.request(
      '/reception/token-reservations/available?date=2026-06-21&doctorId=9',
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.bookedTokens).toEqual([2, 4]);
  });
});
