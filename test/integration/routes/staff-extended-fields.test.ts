import { describe, it, expect } from 'vitest';
import staff from '../../../src/routes/tenant/staff';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';

// ─── Staff API: Extended Fields (Danphe parity) ─────────────────────────────
// TDD cycle for adding the `email` field end-to-end:
//   RED  → write a failing test that POSTs email and asserts it lands in DB
//   GREEN → write migration + update API + update schema
//   REFACTOR → cleanup

describe('Staff API: extended fields (Danphe parity)', () => {
  describe('POST /api/staff with email', () => {
    it('persists the email column in the staff INSERT', async () => {
      const { app, mockDB } = createTestApp({
        route: staff,
        routePath: '/api/staff',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        tables: { staff: [] },
      });

      const res = await jsonRequest(app, '/api/staff', {
        method: 'POST',
        body: {
          name: 'Nurse Fatema',
          address: '123 Main',
          position: 'Nurse',
          salary: 25000,
          bankAccount: '1234567890',
          mobile: '01712345678',
          email: 'fatema@example.com',
        },
      });

      expect(res.status).toBe(201);

      // Find the staff INSERT and assert it carries the email value
      const insert = mockDB.queries.find(
        (q) => q.method === 'run' && /INSERT INTO staff/i.test(q.sql),
      );
      expect(insert, 'expected an INSERT INTO staff statement').toBeDefined();
      expect(insert!.sql).toMatch(/email/i);
      expect(insert!.params).toContain('fatema@example.com');
    });
  });

  describe('GET /api/staff returns email for each row', () => {
    it('selects the email column when listing staff', async () => {
      const { app, mockDB } = createTestApp({
        route: staff,
        routePath: '/api/staff',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        tables: {
          staff: [
            { id: 1, name: 'Nurse Fatema', email: 'fatema@example.com', tenant_id: 'tenant-1', status: 'active' },
          ],
        },
      });

      const res = await app.request('/api/staff');
      expect(res.status).toBe(200);

      const select = mockDB.queries.find(
        (q) => q.method === 'all' && /FROM staff s/i.test(q.sql),
      );
      expect(select).toBeDefined();
      expect(select!.sql).toMatch(/s\.email/i);
      expect(select!.sql).toMatch(/canonical_practitioner_employee_links/i);

      const body = await res.json() as {
        staff: Array<{
          email?: string;
          practitioner_public_id?: string | null;
          workforce_member?: { staffId: number; practitionerPublicId: string | null };
        }>;
      };
      expect(body.staff[0]?.email).toBe('fatema@example.com');
      expect(body.staff[0]?.practitioner_public_id).toBeNull();
      expect(body.staff[0]?.workforce_member).toMatchObject({ staffId: 1, practitionerPublicId: null });
    });
  });

  describe('PUT /api/staff/:id updates email and identity fields', () => {
    it('persists the email in the staff UPDATE', async () => {
      const { app, mockDB } = createTestApp({
        route: staff,
        routePath: '/api/staff',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        tables: {
          staff: [
            { id: 1, name: 'Nurse Fatema', email: null, tenant_id: 'tenant-1', status: 'active' },
          ],
        },
      });

      const res = await jsonRequest(app, '/api/staff/1', {
        method: 'PUT',
        body: {
          name: 'Nurse Fatema',
          address: '123 Main',
          position: 'Nurse',
          salary: 25000,
          bankAccount: '1234567890',
          mobile: '01712345678',
          email: 'fatema.updated@example.com',
        },
      });

      expect(res.status).toBe(200);

      const update = mockDB.queries.find(
        (q) => q.method === 'run' && /UPDATE staff/i.test(q.sql),
      );
      expect(update, 'expected an UPDATE staff statement').toBeDefined();
      expect(update!.sql).toMatch(/email/i);
      expect(update!.params).toContain('fatema.updated@example.com');
    });
  });
});
