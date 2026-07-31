// AUTO-GENERATED — do not edit manually.
// Regenerate: npx tsx tools/generate-rbac-tests.ts
import { describe, it, expect } from 'vitest';
import { createTestApp } from '../integration/helpers/test-app';

const ADMIN_BYPASS = ['super_admin', 'hospital_admin'];

describe('RBAC Permission Matrix', () => {
  describe('consents.ts', () => {
    it('POST /templates denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies reception', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies md', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies director', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies reception', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies director', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/sign denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/:id/sign', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/sign denies reception', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/:id/sign', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/sign denies director', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/:id/sign', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/sign denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/:id/sign', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/revoke denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/:id/revoke', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/revoke denies reception', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/:id/revoke', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/revoke denies director', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/:id/revoke', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/revoke denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/consents');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/consents', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/consents/:id/revoke', { method: 'POST' });
      expect(res.status).toBe(403);
    });
  });

  describe('fhir.ts', () => {
    it('POST /Patient denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Patient', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Patient denies md', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Patient', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Patient denies director', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Patient', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Patient denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Patient', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Patient denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Patient', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Observation denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Observation', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Observation denies reception', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Observation', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Observation denies director', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Observation', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Observation denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Observation', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Encounter denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Encounter', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Encounter denies md', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Encounter', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Encounter denies director', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Encounter', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Encounter denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Encounter', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /Encounter denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/fhir');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/fhir', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/fhir/Encounter', { method: 'POST' });
      expect(res.status).toBe(403);
    });
  });

  describe('lab.ts', () => {
    it('PATCH /items/:itemId/verify denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/lab');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/lab', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/lab/items/:itemId/verify', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /items/:itemId/verify denies reception', async () => {
      const mod = await import('../../src/routes/tenant/lab');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/lab', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/lab/items/:itemId/verify', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /items/:itemId/verify denies director', async () => {
      const mod = await import('../../src/routes/tenant/lab');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/lab', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/lab/items/:itemId/verify', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /items/:itemId/verify denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/lab');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/lab', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/lab/items/:itemId/verify', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /items/:itemId/verify denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/lab');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/lab', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/lab/items/:itemId/verify', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
  });

  describe('medicalRecords.ts', () => {
    it('GET / denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST / denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /births denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /births denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /births denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /births denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /births denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /births denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /births denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /births denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /births denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /births/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /births/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /births/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /births/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /births/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('DELETE /births/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /births/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /births/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /births/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /births/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/births/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('GET /deaths denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /deaths denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /deaths denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /deaths denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /deaths denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /deaths denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /deaths denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /deaths denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /deaths denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /deaths/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /deaths/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /deaths/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /deaths/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /deaths/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('DELETE /deaths/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /deaths/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /deaths/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /deaths/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /deaths/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/deaths/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('POST /diagnosis denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /diagnosis denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /diagnosis denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /diagnosis denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /diagnosis denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /diagnosis denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /diagnosis/:visitId denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis/:visitId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /diagnosis/:visitId denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis/:visitId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /diagnosis/:visitId denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis/:visitId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /diagnosis/:visitId denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis/:visitId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('DELETE /diagnosis/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /diagnosis/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /diagnosis/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /diagnosis/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /diagnosis/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /diagnosis/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/diagnosis/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('GET /icd10 denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/icd10', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /icd10 denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/icd10', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /icd10 denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/icd10', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /icd10 denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/icd10', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-data denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/master-data', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-data denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/master-data', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-data denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/master-data', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-data denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/master-data', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /documents denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /documents denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /documents denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /documents denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /documents denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /documents denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('DELETE /documents/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /documents/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /documents/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /documents/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /documents/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /documents/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/documents/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('GET /referrals denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/referrals', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /referrals denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/referrals', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /referrals denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/referrals', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /referrals denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/referrals', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stats denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stats denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stats denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stats denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/medicalRecords');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/medical-records', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/medical-records/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
  });

  describe('orderSets.ts', () => {
    it('POST / denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies reception', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies director', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/items denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/items denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/items denies reception', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/items denies director', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/items denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/items denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id/items/:itemId denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id/items/:itemId denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id/items/:itemId denies reception', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id/items/:itemId denies director', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id/items/:itemId denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id/items/:itemId denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id/items/:itemId denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id/items/:itemId denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id/items/:itemId denies reception', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id/items/:itemId denies director', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id/items/:itemId denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id/items/:itemId denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/items/:itemId', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/apply denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/apply', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/apply denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/apply', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/apply denies reception', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/apply', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/apply denies director', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/apply', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/apply denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/apply', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /:id/apply denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/:id/apply', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /favorites denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/favorites', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /favorites denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/favorites', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /favorites denies reception', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/favorites', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /favorites denies director', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/favorites', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /favorites denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/favorites', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /favorites denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/orderSets');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/order-sets', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/order-sets/favorites', { method: 'POST' });
      expect(res.status).toBe(403);
    });
  });

  describe('permissions.ts', () => {
    it('GET /catalog denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/catalog', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /catalog denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/catalog', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /catalog denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/catalog', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /catalog denies reception', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/catalog', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /catalog denies director', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/catalog', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /catalog denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/catalog', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /catalog denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/catalog', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /matrix denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/matrix', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /matrix denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/matrix', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /matrix denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/matrix', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /matrix denies reception', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/matrix', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /matrix denies director', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/matrix', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /matrix denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/matrix', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /matrix denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/matrix', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('PUT /role denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /role denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /role denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /role denies reception', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /role denies director', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /role denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /role denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('DELETE /role/:role denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role/:role', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /role/:role denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role/:role', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /role/:role denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role/:role', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /role/:role denies reception', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role/:role', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /role/:role denies director', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role/:role', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /role/:role denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role/:role', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /role/:role denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/role/:role', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('GET /user/:userId denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/:userId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /user/:userId denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/:userId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /user/:userId denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/:userId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /user/:userId denies reception', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/:userId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /user/:userId denies director', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/:userId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /user/:userId denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/:userId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /user/:userId denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/:userId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /user/override denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /user/override denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /user/override denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /user/override denies reception', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /user/override denies director', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /user/override denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /user/override denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('DELETE /user/override/:userId/:permission denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override/:userId/:permission', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /user/override/:userId/:permission denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override/:userId/:permission', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /user/override/:userId/:permission denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override/:userId/:permission', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /user/override/:userId/:permission denies reception', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override/:userId/:permission', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /user/override/:userId/:permission denies director', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override/:userId/:permission', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /user/override/:userId/:permission denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override/:userId/:permission', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /user/override/:userId/:permission denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/user/override/:userId/:permission', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('GET /modules denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules denies reception', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules denies director', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('PUT /modules denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /modules denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /modules denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /modules denies reception', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /modules denies director', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /modules denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /modules denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /modules/:role denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules/:role', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules/:role denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules/:role', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules/:role denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules/:role', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules/:role denies reception', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules/:role', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules/:role denies director', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules/:role', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules/:role denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules/:role', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /modules/:role denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/permissions');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/permissions', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/permissions/modules/:role', { method: 'GET' });
      expect(res.status).toBe(403);
    });
  });

  describe('pharmacy.ts', () => {
    it('GET /medicines denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /medicines denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /medicines denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /medicines denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /medicines denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /medicines denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /medicines denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /medicines denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /medicines denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /medicines denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /medicines denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /medicines/:id denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /medicines/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /medicines/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /medicines/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /medicines/:id denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /medicines/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /medicines/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /medicines/:id/stock denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines/:id/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /medicines/:id/stock denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines/:id/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /medicines/:id/stock denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines/:id/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /medicines/:id/stock denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines/:id/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /suppliers denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /suppliers denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /suppliers denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /suppliers denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /suppliers denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /suppliers denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /suppliers denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /suppliers/:id denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /suppliers/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /suppliers/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /suppliers/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /suppliers/:id denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /suppliers/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /suppliers/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /purchases denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchases', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchases denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchases', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchases denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchases', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchases denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchases', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /purchases denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchases', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchases denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchases', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchases denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchases', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchases denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchases', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchases denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchases', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchases denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchases', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchases denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchases', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /sales denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/sales', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /sales denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/sales', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /sales denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/sales', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /sales denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/sales', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /sales denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/sales', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /sales denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/sales', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /sales denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/sales', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /billing denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/billing', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /billing denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/billing', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /billing denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/billing', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /billing denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/billing', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /billing denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/billing', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /billing denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/billing', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /billing denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/billing', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /alerts/low-stock denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/alerts/low-stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /alerts/low-stock denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/alerts/low-stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /alerts/low-stock denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/alerts/low-stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /alerts/low-stock denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/alerts/low-stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /alerts/expiring denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/alerts/expiring', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /alerts/expiring denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/alerts/expiring', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /alerts/expiring denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/alerts/expiring', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /alerts/expiring denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/alerts/expiring', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /summary denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /summary denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /summary denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /summary denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /categories denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /categories denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /categories denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /categories denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /categories denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /categories denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /categories denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /categories denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /categories denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /categories denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /categories denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /categories/:id denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /categories/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /categories/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /categories/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /categories/:id denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /categories/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /categories/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/categories/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /generics denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /generics denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /generics denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /generics denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /generics denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /generics denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /generics denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /generics denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /generics denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /generics denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /generics denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /generics/:id denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /generics/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /generics/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /generics/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /generics/:id denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /generics/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /generics/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/generics/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /pharmacy-suppliers denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /pharmacy-suppliers denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /pharmacy-suppliers denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /pharmacy-suppliers denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /pharmacy-suppliers denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /pharmacy-suppliers denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /pharmacy-suppliers denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /pharmacy-suppliers denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /pharmacy-suppliers denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /pharmacy-suppliers denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /pharmacy-suppliers denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /pharmacy-suppliers/:id denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /pharmacy-suppliers/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /pharmacy-suppliers/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /pharmacy-suppliers/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /pharmacy-suppliers/:id denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /pharmacy-suppliers/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /pharmacy-suppliers/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/pharmacy-suppliers/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /uom denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/uom', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /uom denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/uom', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /uom denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/uom', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /uom denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/uom', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /uom denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/uom', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /uom denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/uom', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /uom denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/uom', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /uom denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/uom', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /uom denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/uom', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /uom denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/uom', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /uom denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/uom', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /packing-types denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/packing-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /packing-types denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/packing-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /packing-types denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/packing-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /packing-types denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/packing-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /packing-types denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/packing-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /packing-types denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/packing-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /packing-types denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/packing-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /packing-types denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/packing-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /packing-types denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/packing-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /packing-types denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/packing-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /packing-types denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/packing-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /racks denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/racks', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /racks denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/racks', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /racks denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/racks', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /racks denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/racks', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /racks denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/racks', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /racks denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/racks', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /racks denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/racks', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /racks denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/racks', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /racks denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/racks', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /racks denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/racks', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /racks denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/racks', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /items denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /items denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /stock denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /stock/adjustment denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock/adjustment', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /stock/adjustment denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock/adjustment', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /stock/adjustment denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock/adjustment', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /stock/adjustment denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock/adjustment', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /stock/adjustment denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock/adjustment', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /stock/adjustment denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock/adjustment', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /stock/adjustment denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock/adjustment', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /stock/transactions denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock/transactions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock/transactions denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock/transactions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock/transactions denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock/transactions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock/transactions denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/stock/transactions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-orders denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-orders denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-orders denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-orders denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-orders/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-orders/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-orders/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-orders/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /purchase-orders denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchase-orders denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchase-orders denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchase-orders denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchase-orders denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchase-orders denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /purchase-orders denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id/cancel denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id/cancel', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id/cancel denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id/cancel', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id/cancel denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id/cancel', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id/cancel denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id/cancel', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id/cancel denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id/cancel', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id/cancel denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id/cancel', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id/cancel denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id/cancel', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /goods-receipts denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /goods-receipts denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /goods-receipts denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /goods-receipts denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /goods-receipts/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /goods-receipts/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /goods-receipts/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /goods-receipts/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /goods-receipts denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /goods-receipts denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /goods-receipts denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /goods-receipts denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /goods-receipts denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /goods-receipts denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /goods-receipts denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/goods-receipts', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /returns/supplier denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/returns/supplier', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /returns/supplier denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/returns/supplier', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /returns/supplier denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/returns/supplier', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /returns/supplier denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/returns/supplier', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /returns/supplier denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/returns/supplier', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /returns/supplier denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/returns/supplier', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /returns/supplier denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/returns/supplier', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /returns/supplier denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/returns/supplier', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /returns/supplier denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/returns/supplier', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /returns/supplier denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/returns/supplier', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /returns/supplier denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/returns/supplier', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /invoices denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /invoices denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices', { method: 'GET' });
      expect(res.status).toBe(403);
    });

    it('GET /invoices denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /invoices/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /invoices/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });

    it('GET /invoices/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /invoices denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /invoices denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /invoices denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /invoices denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });


    it('POST /invoices denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /invoice-returns denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoice-returns', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /invoice-returns denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoice-returns', { method: 'GET' });
      expect(res.status).toBe(403);
    });

    it('GET /invoice-returns denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoice-returns', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /invoice-returns denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoice-returns', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /invoice-returns denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoice-returns', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /invoice-returns denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoice-returns', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /invoice-returns denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoice-returns', { method: 'POST' });
      expect(res.status).toBe(403);
    });


    it('POST /invoice-returns denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoice-returns', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /deposits denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /deposits denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits', { method: 'GET' });
      expect(res.status).toBe(403);
    });

    it('GET /deposits denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /deposits/balance/:patientId denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/balance/:patientId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /deposits/balance/:patientId denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/balance/:patientId', { method: 'GET' });
      expect(res.status).toBe(403);
    });

    it('GET /deposits/balance/:patientId denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/balance/:patientId', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /deposits denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /deposits denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /deposits denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /deposits denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits', { method: 'POST' });
      expect(res.status).toBe(403);
    });


    it('POST /deposits denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /deposits/return denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/return', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /deposits/return denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/return', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /deposits/return denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/return', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /deposits/return denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/return', { method: 'POST' });
      expect(res.status).toBe(403);
    });


    it('POST /deposits/return denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/return', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /settlements denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/settlements', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /settlements denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/settlements', { method: 'GET' });
      expect(res.status).toBe(403);
    });

    it('GET /settlements denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/settlements', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /settlements denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/settlements', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /settlements denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/settlements', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /settlements denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/settlements', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /settlements denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/settlements', { method: 'POST' });
      expect(res.status).toBe(403);
    });


    it('POST /settlements denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/settlements', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /counters denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/counters', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /counters denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/counters', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /counters denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/counters', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /counters denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/counters', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /counters denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/counters', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /counters denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/counters', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /counters denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/counters', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /counters denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/counters', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /counters denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/counters', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /counters denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/counters', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /counters denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/counters', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /provisional-invoices denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/provisional-invoices', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /provisional-invoices denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/provisional-invoices', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /provisional-invoices denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/provisional-invoices', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /provisional-invoices denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/provisional-invoices', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /provisional-invoices denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/provisional-invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /provisional-invoices denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/provisional-invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /provisional-invoices denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/provisional-invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /provisional-invoices denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/provisional-invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /provisional-invoices denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/provisional-invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /provisional-invoices denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/provisional-invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /provisional-invoices denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/provisional-invoices', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /prescriptions denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /prescriptions denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /prescriptions denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /prescriptions denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /prescriptions/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /prescriptions/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /prescriptions/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /prescriptions/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /prescriptions denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /prescriptions denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /prescriptions denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /prescriptions denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /prescriptions denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /prescriptions denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /prescriptions denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /prescriptions/:id/dispense denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions/:id/dispense', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /prescriptions/:id/dispense denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions/:id/dispense', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /prescriptions/:id/dispense denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions/:id/dispense', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /prescriptions/:id/dispense denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions/:id/dispense', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /prescriptions/:id/dispense denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions/:id/dispense', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /prescriptions/:id/dispense denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions/:id/dispense', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /prescriptions/:id/dispense denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/prescriptions/:id/dispense', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /narcotics denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/narcotics', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /narcotics denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/narcotics', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /narcotics denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/narcotics', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /narcotics denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/narcotics', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /narcotics denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/narcotics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /narcotics denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/narcotics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /narcotics denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/narcotics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /narcotics denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/narcotics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /narcotics denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/narcotics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /narcotics denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/narcotics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /narcotics denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/narcotics', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /write-offs denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /write-offs denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /write-offs denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /write-offs denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /write-offs denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /write-offs denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /write-offs denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /write-offs denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /write-offs denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /write-offs denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /write-offs denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /requisitions denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/requisitions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /requisitions denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/requisitions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /requisitions denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/requisitions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /requisitions denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/requisitions', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /requisitions denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/requisitions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /requisitions denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/requisitions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /requisitions denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/requisitions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /requisitions denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/requisitions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /requisitions denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/requisitions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /requisitions denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/requisitions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /requisitions denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/requisitions', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /dispatches denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispatches', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dispatches denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispatches', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dispatches denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispatches', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dispatches denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispatches', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /dispatches denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispatches', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dispatches denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispatches', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dispatches denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispatches', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dispatches denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispatches', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dispatches denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispatches', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dispatches denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispatches', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dispatches denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispatches', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /master-drugs/search denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-drugs/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-drugs/search denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-drugs/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-drugs/search denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-drugs/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-drugs/search denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-drugs/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-generics/search denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-generics/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-generics/search denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-generics/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-generics/search denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-generics/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-generics/search denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-generics/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-companies/search denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-companies/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-companies/search denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-companies/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-companies/search denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-companies/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-companies/search denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-companies/search', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-drugs/stats denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-drugs/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-drugs/stats denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-drugs/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-drugs/stats denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-drugs/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /master-drugs/stats denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/master-drugs/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/billing-summary denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/billing-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/billing-summary denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/billing-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/billing-summary denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/billing-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/billing-summary denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/billing-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/bill-history denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/bill-history', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/bill-history denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/bill-history', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/bill-history denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/bill-history', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/bill-history denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/bill-history', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/provisional denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/provisional', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/provisional denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/provisional', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/provisional denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/provisional', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/provisional denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/provisional', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/deposits denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/deposits', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/deposits denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/deposits', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/deposits denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/deposits', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /patient/:patientId/deposits denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/patient/:patientId/deposits', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /invoices/:id/receipt denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id/receipt', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /invoices/:id/receipt denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id/receipt', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /invoices/:id/receipt denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id/receipt', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /invoices/:id/receipt denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id/receipt', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('PUT /invoices/:id/print-count denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /invoices/:id/print-count denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /invoices/:id/print-count denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /invoices/:id/print-count denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /invoices/:id/print-count denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /invoices/:id/print-count denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /invoices/:id/print-count denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/invoices/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /deposits/:id/print-count denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /deposits/:id/print-count denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /deposits/:id/print-count denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /deposits/:id/print-count denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /deposits/:id/print-count denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /deposits/:id/print-count denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /deposits/:id/print-count denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/deposits/:id/print-count', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /purchase-orders/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/purchase-orders/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/stock denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/stock denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/stock denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/stock denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/sales denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/sales', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/sales denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/sales', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/sales denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/sales', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/sales denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/sales', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/expiry denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/expiry', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/expiry denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/expiry', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/expiry denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/expiry', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /reports/expiry denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/reports/expiry', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers/:id/ledger denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id/ledger', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers/:id/ledger denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id/ledger', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers/:id/ledger denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id/ledger', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers/:id/ledger denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id/ledger', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers/:id/summary denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id/summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers/:id/summary denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id/summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers/:id/summary denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id/summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /suppliers/:id/summary denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/suppliers/:id/summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dispensary-stock denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispensary-stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dispensary-stock denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispensary-stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dispensary-stock denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispensary-stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dispensary-stock denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dispensary-stock', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /tax-config denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /tax-config denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /tax-config denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /tax-config denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /tax-config denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /tax-config denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /tax-config denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /tax-config denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /tax-config denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /tax-config denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /tax-config denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /tax-config/:id denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /tax-config/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /tax-config/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /tax-config/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /tax-config/:id denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /tax-config/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /tax-config/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('DELETE /tax-config/:id denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /tax-config/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /tax-config/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /tax-config/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /tax-config/:id denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /tax-config/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /tax-config/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/tax-config/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('PATCH /items/:id/type denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/type', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /items/:id/type denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/type', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /items/:id/type denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/type', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /items/:id/type denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/type', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /items/:id/type denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/type', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /items/:id/type denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/type', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /items/:id/type denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/type', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('GET /items/:id/price-history denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/price-history', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items/:id/price-history denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/price-history', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items/:id/price-history denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/price-history', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items/:id/price-history denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/price-history', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /items/:id/price-history denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/price-history', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items/:id/price-history denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/price-history', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items/:id/price-history denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/price-history', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items/:id/price-history denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/price-history', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items/:id/price-history denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/price-history', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items/:id/price-history denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/price-history', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /items/:id/price-history denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/price-history', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /items/barcode/:code denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/barcode/:code', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items/barcode/:code denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/barcode/:code', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items/barcode/:code denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/barcode/:code', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /items/barcode/:code denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/barcode/:code', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id/barcode denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/barcode', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id/barcode denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/barcode', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id/barcode denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/barcode', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id/barcode denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/barcode', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id/barcode denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/barcode', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id/barcode denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/barcode', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /items/:id/barcode denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/items/:id/barcode', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /dosage-templates denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dosage-templates denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dosage-templates denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dosage-templates denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /dosage-templates denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dosage-templates denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dosage-templates denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dosage-templates denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dosage-templates denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dosage-templates denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /dosage-templates denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /dosage-templates/:id denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /dosage-templates/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /dosage-templates/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /dosage-templates/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /dosage-templates/:id denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /dosage-templates/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /dosage-templates/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('DELETE /dosage-templates/:id denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /dosage-templates/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /dosage-templates/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /dosage-templates/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /dosage-templates/:id denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /dosage-templates/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /dosage-templates/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/dosage-templates/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('GET /grn/pending-approval denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/grn/pending-approval', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /grn/pending-approval denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/grn/pending-approval', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /grn/pending-approval denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/grn/pending-approval', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /grn/pending-approval denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/grn/pending-approval', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('PUT /grn/:id/approve denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/grn/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /grn/:id/approve denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/grn/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /grn/:id/approve denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/grn/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /grn/:id/approve denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/grn/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /grn/:id/approve denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/grn/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /grn/:id/approve denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/grn/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /grn/:id/approve denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/grn/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /write-offs/pending-approval denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs/pending-approval', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /write-offs/pending-approval denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs/pending-approval', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /write-offs/pending-approval denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs/pending-approval', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /write-offs/pending-approval denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs/pending-approval', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('PUT /write-offs/:id/approve denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /write-offs/:id/approve denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /write-offs/:id/approve denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /write-offs/:id/approve denies reception', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /write-offs/:id/approve denies md', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'md',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /write-offs/:id/approve denies director', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /write-offs/:id/approve denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/pharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/pharmacy/write-offs/:id/approve', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
  });

  describe('qualityKpi.ts', () => {
    it('GET /dashboard denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/dashboard', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dashboard denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/dashboard', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dashboard denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/dashboard', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dashboard denies reception', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/dashboard', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dashboard denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/dashboard', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dashboard denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/dashboard', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /trends denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/trends', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /trends denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/trends', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /trends denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/trends', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /trends denies reception', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/trends', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /trends denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/trends', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /trends denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/trends', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /snapshot denies doctor', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'doctor',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/snapshot', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /snapshot denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/snapshot', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /snapshot denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/snapshot', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /snapshot denies reception', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/snapshot', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /snapshot denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/snapshot', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /snapshot denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/qualityKpi');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/quality-kpi', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/quality-kpi/snapshot', { method: 'POST' });
      expect(res.status).toBe(403);
    });
  });

  describe('reportPharmacy.ts', () => {
    it('GET /dispensing-summary denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/dispensing-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dispensing-summary denies reception', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/dispensing-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dispensing-summary denies director', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/dispensing-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /dispensing-summary denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/dispensing-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock-value denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/stock-value', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock-value denies reception', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/stock-value', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock-value denies director', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/stock-value', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock-value denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/stock-value', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /expiry-alerts denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/expiry-alerts', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /expiry-alerts denies reception', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/expiry-alerts', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /expiry-alerts denies director', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/expiry-alerts', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /expiry-alerts denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/expiry-alerts', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /top-dispensed denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/top-dispensed', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /top-dispensed denies reception', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/top-dispensed', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /top-dispensed denies director', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/top-dispensed', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /top-dispensed denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/top-dispensed', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-summary denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/purchase-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-summary denies reception', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/purchase-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-summary denies director', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/purchase-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /purchase-summary denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/purchase-summary', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock-movements denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/stock-movements', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock-movements denies reception', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/stock-movements', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock-movements denies director', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/stock-movements', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stock-movements denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/reportPharmacy');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/reports/pharmacy', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/reports/pharmacy/stock-movements', { method: 'GET' });
      expect(res.status).toBe(403);
    });
  });

  describe('radiology/catalog.ts', () => {
    it('GET /imaging-types denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /imaging-types denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /imaging-types denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /imaging-types denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-types denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-types denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-types denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-types denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-types denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-types denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-types/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-types/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-types/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-types/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-types/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-types/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-types/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-types/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-types/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-types/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-types/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-types/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-types/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('GET /imaging-items denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /imaging-items denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /imaging-items denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /imaging-items denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-items denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-items denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-items denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-items denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-items denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /imaging-items denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-items/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-items/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-items/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-items/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-items/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /imaging-items/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-items/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-items/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-items/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-items/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-items/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /imaging-items/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/imaging-items/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('GET /templates denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /templates denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /templates denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /templates denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /templates/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /templates/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /templates/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /templates/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /templates denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('PUT /templates/:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /templates/:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /templates/:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /templates/:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /templates/:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /templates/:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/templates/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('GET /film-types denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/film-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /film-types denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/film-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /film-types denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/film-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /film-types denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/film-types', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST /film-types denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/film-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /film-types denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/film-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /film-types denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/film-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /film-types denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/film-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /film-types denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/film-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST /film-types denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/film-types', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /stats denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stats denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stats denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /stats denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/catalog');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/catalog', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/catalog/stats', { method: 'GET' });
      expect(res.status).toBe(403);
    });
  });

  describe('radiology/orders.ts', () => {
    it('GET / denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST / denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/scan denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/scan', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/scan denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/scan', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/scan denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/scan', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/scan denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/scan', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/scan denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/scan', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/unscan denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/unscan', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/unscan denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/unscan', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/unscan denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/unscan', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/unscan denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/unscan', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/unscan denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/unscan', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/unscan denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/unscan', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/cancel denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/cancel', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/cancel denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/cancel', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/cancel denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/cancel', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/cancel denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/cancel', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/cancel denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/cancel', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/cancel denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id/cancel', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/orders');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/orders', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/orders/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
  });

  describe('radiology/pacs.ts', () => {
    it('GET / denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST / denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('PUT /upload/:key{.+} denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/upload/:key{.+}', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /upload/:key{.+} denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/upload/:key{.+}', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /upload/:key{.+} denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/upload/:key{.+}', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /upload/:key{.+} denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/upload/:key{.+}', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /upload/:key{.+} denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/pacs');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/pacs', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/pacs/upload/:key{.+}', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
  });

  describe('radiology/reports.ts', () => {
    it('GET / denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET / denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('POST / denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('POST / denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports', { method: 'POST' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('GET /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'GET' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PUT /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'PUT' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/finalize denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id/finalize', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/finalize denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id/finalize', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/finalize denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id/finalize', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/finalize denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id/finalize', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/finalize denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id/finalize', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('PATCH /:id/finalize denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id/finalize', { method: 'PATCH' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies nurse', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'nurse',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies laboratory', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'laboratory',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies reception', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'reception',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies director', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'director',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies pharmacist', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'pharmacist',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
    it('DELETE /:id denies accountant', async () => {
      const mod = await import('../../src/routes/tenant/radiology/reports');
      const route = mod.default;
      const { app } = createTestApp({
        route, routePath: '/api/radiology/reports', role: 'accountant',
        tenantId: 'tenant-1', userId: 1, tables: {},
      });
      const res = await app.request('/api/radiology/reports/:id', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
  });

});
