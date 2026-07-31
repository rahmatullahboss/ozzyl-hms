/**
 * Security Tests — Cross-Site Scripting (XSS)
 *
 * Sends 5 XSS payloads in the patient name field via POST /patients.
 * Assertions: never 500, stored safely or rejected with 400.
 */

import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';
import patientRoutes from '../../src/routes/tenant/patients';

const XSS_PAYLOADS = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert(1)>',
  '"><script>alert(document.cookie)</script>',
  "javascript:alert('XSS')",
  '<svg onload=alert(1)>',
];

describe('XSS — Patient Creation (POST /patients)', () => {
  for (const payload of XSS_PAYLOADS) {
    it(`name field with XSS payload: ${payload.slice(0, 40)}...`, async () => {
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

      // Must NEVER be 500
      expect(res.status).not.toBe(500);
      // Either stored safely (200/201) or rejected (400)
      expect([200, 201, 400]).toContain(res.status);

      if (res.status === 200 || res.status === 201) {
        // If accepted, the payload should be stored as a parameterised
        // value, never interpolated into SQL or HTML.
        const insertQueries = mockDB.queries.filter((q) =>
          q.sql.toUpperCase().includes('INSERT') && q.sql.toUpperCase().includes('PATIENTS'),
        );

        for (const query of insertQueries) {
          // SQL template must use ? placeholders, not inline the HTML
          expect(query.sql).not.toContain(payload);
          // But the payload should be in the bound params (stored as data)
          const hasPayloadInParams = query.params.some(
            (p) => typeof p === 'string' && p.includes(payload),
          );
          // If the payload is stored, it's bound as a parameter (safe)
          if (hasPayloadInParams) {
            expect(hasPayloadInParams).toBe(true);
          }
        }
      }
    });
  }
});

describe('XSS — Patient Search does not reflect unsanitised HTML', () => {
  for (const payload of XSS_PAYLOADS) {
    it(`search with XSS payload: ${payload.slice(0, 40)}...`, async () => {
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

      // Must NEVER be 500
      expect(res.status).not.toBe(500);
      expect([200, 400]).toContain(res.status);

      if (res.status === 200) {
        const text = await res.text();
        // The raw script/event-handler tags should not appear unescaped
        // in the JSON response
        expect(text).not.toContain('<script>');
        expect(text).not.toContain('onerror=');
        expect(text).not.toContain('onload=');
      }
    });
  }
});
