/**
 * Security Tests — SQL Injection
 *
 * Sends 5 classic SQL injection payloads against:
 *   - Patient search (GET /patients?search=PAYLOAD)
 *   - Patient creation (POST /patients with name=PAYLOAD)
 *
 * Assertions: NEVER 500, always 200 or 400.
 * The app uses Drizzle ORM with parameterised queries so injections
 * should be treated as literal strings, never executed.
 */

import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';
import patientRoutes from '../../src/routes/tenant/patients';

const SQL_INJECTION_PAYLOADS = [
  "'; DROP TABLE patients; --",
  "' OR '1'='1",
  "'; SELECT * FROM users; --",
  "1; UPDATE patients SET name='hacked'",
  "' UNION SELECT id, name, phone FROM patients --",
];

// ─── Search endpoint ─────────────────────────────────────────────────────────

describe('SQL Injection — Patient Search (GET /patients?search=)', () => {
  for (const payload of SQL_INJECTION_PAYLOADS) {
    it(`search with payload: ${payload.slice(0, 40)}...`, async () => {
      const { app } = createTestApp({
        route: patientRoutes,
        routePath: '/patients',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        tables: {
          patients: [
            { id: 1, tenant_id: 'tenant-1', name: 'Normal Patient', mobile: '01700000001' },
          ],
        },
      });

      const encodedPayload = encodeURIComponent(payload);
      const res = await app.request(`/patients?search=${encodedPayload}`, { method: 'GET' });

      // Must NEVER be 500 — if parameterisation works, it either returns
      // results (200) or rejects the input (400)
      expect(res.status).not.toBe(500);
      expect([200, 400]).toContain(res.status);

      if (res.status === 200) {
        const body = await res.json() as { patients: unknown[] };
        // The injection payload should never cause data from other tables
        // to leak; the result should be empty or contain only matching rows
        expect(Array.isArray(body.patients)).toBe(true);
      }
    });
  }
});

// ─── Creation endpoint ───────────────────────────────────────────────────────

describe('SQL Injection — Patient Creation (POST /patients)', () => {
  for (const payload of SQL_INJECTION_PAYLOADS) {
    it(`create with name payload: ${payload.slice(0, 40)}...`, async () => {
      const { app, mockDB } = createTestApp({
        route: patientRoutes,
        routePath: '/patients',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        universalFallback: true,
        tables: {
          patients: [],
          serials: [],
          sequence_counters: [],
          global_identities: [],
          patient_health_links: [],
          tenants: [{ id: 'tenant-1', name: 'Test Hospital' }],
        },
      });

      const res = await jsonRequest(app, '/patients', {
        method: 'POST',
        body: {
          name: payload,
          fatherHusband: 'Test Father',
          address: 'Test Address',
          mobile: '01700000099',
        },
      });

      // Must NEVER be 500 — either validates successfully (201)
      // or Zod/sanitisation rejects it (400)
      expect(res.status).not.toBe(500);
      expect([200, 201, 400]).toContain(res.status);

      if (res.status === 200 || res.status === 201) {
        // If it was accepted, the payload was stored as a literal string.
        // Verify the query used parameterised binding (not string concat).
        const insertQueries = mockDB.queries.filter((q) =>
          q.sql.toUpperCase().includes('INSERT') && q.sql.toUpperCase().includes('PATIENTS'),
        );
        for (const query of insertQueries) {
          // The SQL template must use ? placeholders, never inline the payload
          expect(query.sql).not.toContain(payload);
        }
      }
    });
  }
});
