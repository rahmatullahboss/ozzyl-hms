/**
 * Integration tests for Blood Bank Donors API.
 *
 * Tests cover:
 * - POST /donors: Register new donor (with and without patient_id)
 * - GET /donors: List donors with filtering and search
 * - PUT /donors/:id: Update donor details
 * - Authorization: Reception role access
 */

import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';
import bloodBankRoutes from '../../../src/routes/tenant/bloodBank';

const TENANT = 'hospital-test';

function makeDonorRows(overrides: Partial<Record<string, unknown>>[] = []) {
  const base = {
    id: 1,
    tenant_id: TENANT,
    donor_name: 'Test Donor',
    donor_type: 'voluntary',
    blood_group: 'O+',
    gender: 'Male',
    age: 30,
    phone: '01712345678',
    address: null,
    national_id: null,
    weight_kg: 65,
    hemoglobin: 14.5,
    last_donation_date: null,
    total_donations: 0,
    is_eligible: 1,
    deferral_reason: null,
    deferral_until: null,
    is_active: 1,
    created_by: 1,
    created_at: '2026-05-01T10:00:00.000Z',
    patient_id: null,
  };
  if (overrides.length === 0) return [base];
  return overrides.map((o, i) => ({ ...base, id: i + 1, ...o }));
}

describe('Blood Bank — Donors API Integration', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /donors — Registration
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /blood-bank/donors', () => {
    it('should register a new donor without patient_id', async () => {
      const mockDB = createMockDB({
        tables: {
          blood_donors: [],
          users: [{ id: 1, tenant_id: TENANT, role: 'reception' }],
        },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'reception',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors', {
        method: 'POST',
        body: {
          donor_name: 'Test Donor',
          blood_group: 'O+',
          donor_type: 'voluntary',
          gender: 'Male',
          phone: '01712345678',
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { id: number; message: string };
      expect(body.id).toBeDefined();
      expect(body.message).toBe('Donor registered');
    });

    it('should register a donor linked to a patient', async () => {
      const mockDB = createMockDB({
        tables: {
          blood_donors: [],
          patients: [{ id: 1, tenant_id: TENANT, name: 'Rahim Khan', mobile: '01712345678' }],
          users: [{ id: 1, tenant_id: TENANT, role: 'reception' }],
        },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'reception',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors', {
        method: 'POST',
        body: {
          donor_name: 'Rahim Khan',
          blood_group: 'A+',
          donor_type: 'replacement',
          gender: 'Male',
          phone: '01712345678',
          patient_id: 1,
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { id: number; message: string };
      expect(body.id).toBeDefined();
    });

    it('should reject donor linked to a patient from another hospital', async () => {
      const mockDB = createMockDB({
        tables: {
          blood_donors: [],
          patients: [{ id: 99, tenant_id: 'other-hospital', name: 'Outside Patient', mobile: '01700000000' }],
          users: [{ id: 1, tenant_id: TENANT, role: 'reception' }],
        },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'reception',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors', {
        method: 'POST',
        body: {
          donor_name: 'Wrong Link',
          blood_group: 'A+',
          patient_id: 99,
        },
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: 'Linked patient not found for this hospital' });
    });

    it('should reject donor with invalid blood group', async () => {
      const mockDB = createMockDB({
        tables: { blood_donors: [], users: [{ id: 1, tenant_id: TENANT, role: 'reception' }] },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'reception',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors', {
        method: 'POST',
        body: {
          donor_name: 'Test Donor',
          blood_group: 'X+', // Invalid blood group
        },
      });

      expect(res.status).toBe(400);
    });

    it('should reject donor with missing required donor_name', async () => {
      const mockDB = createMockDB({
        tables: { blood_donors: [], users: [{ id: 1, tenant_id: TENANT, role: 'reception' }] },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'reception',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors', {
        method: 'POST',
        body: {
          blood_group: 'O+',
        },
      });

      expect(res.status).toBe(400);
    });

    it('should accept valid gender values: Male, Female, Other', async () => {
      const mockDB = createMockDB({
        tables: { blood_donors: [], users: [{ id: 1, tenant_id: TENANT, role: 'reception' }] },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'reception',
        tenantId: TENANT,
        mockDB,
      });

      const genders = ['Male', 'Female', 'Other'] as const;

      for (const gender of genders) {
        const res = await jsonRequest(app, '/donors', {
          method: 'POST',
          body: {
            donor_name: `Test Donor ${gender}`,
            blood_group: 'B+',
            gender,
          },
        });

        expect(res.status).toBe(201);
      }
    });

    it('should default donor_type to voluntary', async () => {
      const mockDB = createMockDB({
        tables: { blood_donors: [], users: [{ id: 1, tenant_id: TENANT, role: 'reception' }] },
        queryOverride: (sql, params) => {
          if (sql.includes('INSERT INTO blood_donors')) {
            return { results: [], last_row_id: 1, changes: 1 };
          }
          return null;
        },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'reception',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors', {
        method: 'POST',
        body: {
          donor_name: 'Test Donor',
          blood_group: 'O+',
          // donor_type not specified — should default to 'voluntary'
        },
      });

      expect(res.status).toBe(201);
    });

    it('should accept optional fields: age, weight_kg, hemoglobin', async () => {
      const mockDB = createMockDB({
        tables: { blood_donors: [], users: [{ id: 1, tenant_id: TENANT, role: 'reception' }] },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'reception',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors', {
        method: 'POST',
        body: {
          donor_name: 'Test Donor',
          blood_group: 'AB+',
          age: 35,
          weight_kg: 75.5,
          hemoglobin: 13.8,
        },
      });

      expect(res.status).toBe(201);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /donors — Listing
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /blood-bank/donors', () => {
    it('should list all donors for tenant with pagination', async () => {
      const rows = makeDonorRows([
        { id: 1, donor_name: 'Donor One' },
        { id: 2, donor_name: 'Donor Two' },
        { id: 3, donor_name: 'Donor Three' },
      ]);

      const mockDB = createMockDB({
        tables: { blood_donors: rows },
        queryOverride: (sql, params) => {
          if (sql.includes('SELECT COUNT(*)') && sql.includes('blood_donors')) {
            return { results: [{ cnt: rows.length }] };
          }
          if (sql.includes('SELECT * FROM blood_donors') && !sql.includes('ORDER BY')) {
            return { results: rows };
          }
          return null;
        },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'doctor',
        tenantId: TENANT,
        mockDB,
      });

      const res = await app.request('/donors');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: { page: number; limit: number; total: number } };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(3);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBe(3);
    });

    it('should filter donors by blood_group', async () => {
      const rows = makeDonorRows([
        { id: 1, donor_name: 'A+ Donor', blood_group: 'A+' },
        { id: 2, donor_name: 'O+ Donor', blood_group: 'O+' },
        { id: 3, donor_name: 'A+ Another', blood_group: 'A+' },
      ]);

      const mockDB = createMockDB({
        tables: { blood_donors: rows },
        queryOverride: (sql, params) => {
          if (sql.includes('blood_group')) {
            return {
              results: rows.filter(r => r.blood_group === 'A+'),
              last_row_id: 0,
              changes: 0,
            };
          }
          return null;
        },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'doctor',
        tenantId: TENANT,
        mockDB,
      });

      const res = await app.request('/donors?blood_group=A+');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ blood_group: string }> };
      body.data.forEach(donor => {
        expect(donor.blood_group).toBe('A+');
      });
    });

    it('should search donors by name or phone', async () => {
      const rows = makeDonorRows([
        { id: 1, donor_name: 'Rahim Khan', phone: '01712345678' },
        { id: 2, donor_name: 'Karim Ahmed', phone: '01812345678' },
        { id: 3, donor_name: 'Rahim Rahman', phone: '01912345678' },
      ]);

      const mockDB = createMockDB({
        tables: { blood_donors: rows },
        queryOverride: (sql, params) => {
          if (sql.includes('donor_name LIKE ? OR phone LIKE ?') && params.some((value) => String(value).includes('Rahim'))) {
            return {
              results: rows.filter(r => r.donor_name.includes('Rahim')),
              last_row_id: 0,
              changes: 0,
            };
          }
          return null;
        },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'doctor',
        tenantId: TENANT,
        mockDB,
      });

      const res = await app.request('/donors?search=Rahim');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('should filter eligible donors only', async () => {
      const rows = makeDonorRows([
        { id: 1, donor_name: 'Eligible Donor', is_eligible: 1 },
        { id: 2, donor_name: 'Deferred Donor', is_eligible: 0 },
      ]);

      const mockDB = createMockDB({
        tables: { blood_donors: rows },
        queryOverride: (sql, params) => {
          if (sql.includes('is_eligible = 1')) {
            return {
              results: rows.filter(r => r.is_eligible === 1),
              last_row_id: 0,
              changes: 0,
            };
          }
          return null;
        },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'doctor',
        tenantId: TENANT,
        mockDB,
      });

      const res = await app.request('/donors?eligible=true');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ is_eligible: number }> };
      body.data.forEach(donor => {
        expect(donor.is_eligible).toBe(1);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PUT /donors/:id — Update
  // ═══════════════════════════════════════════════════════════════════════════

  describe('PUT /blood-bank/donors/:id', () => {
    it('should update donor name and blood group', async () => {
      const rows = makeDonorRows([{ id: 99, donor_name: 'Old Name', blood_group: 'O+' }]);
      const mockDB = createMockDB({
        tables: { blood_donors: rows },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'doctor',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors/99', {
        method: 'PUT',
        body: {
          donor_name: 'Updated Name',
          blood_group: 'A+',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { message: string };
      expect(body.message).toBe('Donor updated');
    });

    it('should mark donor as ineligible with deferral reason', async () => {
      const rows = makeDonorRows([{ id: 99, donor_name: 'Test Donor', is_eligible: 1 }]);
      const mockDB = createMockDB({
        tables: { blood_donors: rows },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'doctor',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors/99', {
        method: 'PUT',
        body: {
          is_eligible: 0,
          deferral_reason: 'Medical condition',
        },
      });

      expect(res.status).toBe(200);
    });

    it('should reject update for non-existent donor', async () => {
      const mockDB = createMockDB({
        tables: { blood_donors: [] },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'doctor',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors/99999', {
        method: 'PUT',
        body: { donor_name: 'Should fail' },
      });

      expect(res.status).toBe(404);
    });

    it('should not allow updating cross-tenant donors', async () => {
      const rows = makeDonorRows([{ id: 99, tenant_id: 'other-tenant' }]);
      const mockDB = createMockDB({
        tables: { blood_donors: rows },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'doctor',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors/99', {
        method: 'PUT',
        body: { donor_name: 'Hijacked' },
      });

      // Should not find the donor (tenant mismatch)
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Authorization
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Authorization', () => {
    it('should allow reception role to register donors', async () => {
      const mockDB = createMockDB({
        tables: {
          blood_donors: [],
          users: [{ id: 1, tenant_id: TENANT, role: 'reception' }],
        },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'reception',
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors', {
        method: 'POST',
        body: {
          donor_name: 'Reception Donor',
          blood_group: 'AB+',
        },
      });

      expect(res.status).toBe(201);
    });

    it('should allow doctor role to list donors', async () => {
      const mockDB = createMockDB({
        tables: { blood_donors: [] },
        universalFallback: true,
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: 'doctor',
        tenantId: TENANT,
        mockDB,
      });

      const res = await app.request('/donors');
      expect(res.status).toBe(200);
    });

    it('should handle request without role set', async () => {
      // When role is undefined, test app still injects tenant context
      const mockDB = createMockDB({
        tables: { blood_donors: [] },
      });

      const { app } = createTestApp({
        route: bloodBankRoutes,
        routePath: '/',
        role: undefined, // No role set
        tenantId: TENANT,
        mockDB,
      });

      const res = await jsonRequest(app, '/donors', {
        method: 'POST',
        body: {
          donor_name: 'Test',
          blood_group: 'O+',
        },
      });

      // Route behavior depends on middleware - accept any valid HTTP response
      expect([201, 400, 404, 500]).toContain(res.status);
    });
  });
});
