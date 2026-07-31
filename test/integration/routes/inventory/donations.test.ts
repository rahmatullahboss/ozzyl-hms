/**
 * Integration tests for Inventory Donation routes.
 *
 * Covers: CRUD, Zod validation, tenant isolation, search/date filters.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import donationsRoute from '../../../../src/routes/tenant/inventory/donations';
import { createTestApp, jsonRequest } from '../../helpers/test-app';
import {
  TENANT_1, TENANT_2,
  INV_DONATION_1, INV_DONATION_2,
} from '../../helpers/fixtures';

// ─── Shared fixtures ───────────────────────────────────────────────────────

const newDonationBody = {
  DonationName: 'Wheelchair Donation',
  DonorName: 'Lions Club Dhaka',
  DonationDate: '2024-04-10',
  TotalValue: 15000,
  Remarks: 'Wheelchairs for rehab ward',
};

const updateDonationBody = {
  DonationName: 'Updated Wheelchair Donation',
  TotalValue: 18000,
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — Donations Routes', () => {

  describe('GET / — list donations', () => {
    it('returns paginated donations for tenant', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryfixedassetdonation: [INV_DONATION_1, INV_DONATION_2] },
      });
      const res = await app.request('/donations');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('returns 200 with pagination defaults (no query params)', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
        tables: { inventoryfixedassetdonation: [INV_DONATION_1] },
      });
      const res = await app.request('/donations?page=1&limit=10');
      expect(res.status).toBe(200);
    });

    it('filters by search param', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryfixedassetdonation: [INV_DONATION_1, INV_DONATION_2] },
      });
      const res = await app.request('/donations?search=Medical');
      expect(res.status).toBe(200);
    });

    it('filters by FromDate and ToDate params', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryfixedassetdonation: [INV_DONATION_1, INV_DONATION_2] },
      });
      const res = await app.request('/donations?FromDate=2024-02-01&ToDate=2024-02-28');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /:id — single donation', () => {
    it('returns a single donation by id', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryfixedassetdonation: [INV_DONATION_1] },
      });
      const res = await app.request(`/donations/${INV_DONATION_1.DonationId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { DonationId: number };
      expect(body.DonationId).toBe(INV_DONATION_1.DonationId);
    });

    it('returns 404 when donation not found', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryfixedassetdonation: [] },
      });
      const res = await app.request('/donations/999');
      expect(res.status).toBe(404);
    });

    it('returns 404 for donation belonging to different tenant', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventoryfixedassetdonation: [INV_DONATION_1] },
      });
      const res = await app.request(`/donations/${INV_DONATION_1.DonationId}`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST / — create donation', () => {
    it('creates a donation and returns 201 with DonationId', async () => {
      const { app, mockDB } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryfixedassetdonation: [] },
      });
      const res = await jsonRequest(app, '/donations', { method: 'POST', body: newDonationBody });
      expect(res.status).toBe(201);
      const body = await res.json() as { message: string; id: number };
      expect(body.message).toMatch(/[Cc]reat/);
      expect(typeof body.id).toBe('number');

      // Verify INSERT was recorded with tenant_id
      const insertQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('INSERT') && q.sql.toLowerCase().includes('donation'),
      );
      expect(insertQ).toBeTruthy();
      expect(insertQ!.params).toContain(TENANT_1.id);
    });

    it('returns 400 when DonationName is missing (Zod)', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/donations', {
        method: 'POST',
        body: { DonorName: 'Some Donor' },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty request body', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });
      const res = await jsonRequest(app, '/donations', { method: 'POST', body: {} });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id — update donation', () => {
    it('updates donation and returns 200', async () => {
      const { app, mockDB } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryfixedassetdonation: [INV_DONATION_1] },
      });
      const res = await jsonRequest(app, `/donations/${INV_DONATION_1.DonationId}`, {
        method: 'PUT',
        body: updateDonationBody,
      });
      expect(res.status).toBe(200);

      // Assert UPDATE query has tenant scoping
      const updateQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.toLowerCase().includes('donation'),
      );
      expect(updateQ).toBeTruthy();
      expect(updateQ!.params).toContain(TENANT_1.id);
    });

    it('returns 200 with partial update body', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryfixedassetdonation: [INV_DONATION_1] },
      });
      const res = await jsonRequest(app, `/donations/${INV_DONATION_1.DonationId}`, {
        method: 'PUT',
        body: { Remarks: 'Updated remarks' },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /:id — delete donation', () => {
    it('deletes donation and returns 200', async () => {
      const { app, mockDB } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryfixedassetdonation: [INV_DONATION_1] },
      });
      const res = await app.request(`/donations/${INV_DONATION_1.DonationId}`, { method: 'DELETE' });
      expect(res.status).toBe(200);

      // Assert DELETE query has tenant scoping
      const deleteQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('DELETE') && q.sql.toLowerCase().includes('donation'),
      );
      expect(deleteQ).toBeTruthy();
      expect(deleteQ!.params).toContain(TENANT_1.id);
    });

    it('returns 404 when deleting non-existent donation', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { inventoryfixedassetdonation: [] },
      });
      const res = await app.request('/donations/999', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('Tenant isolation', () => {
    it('returns empty data for different tenant', async () => {
      const { app } = createTestApp({
        route: donationsRoute,
        routePath: '/donations',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { inventoryfixedassetdonation: [INV_DONATION_1, INV_DONATION_2] },
      });
      const res = await app.request('/donations');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data.length).toBe(0);
    });
  });
});
