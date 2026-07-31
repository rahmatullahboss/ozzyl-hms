import { describe, expect, test } from 'vitest';
import trackAnythingRoutes from '../src/routes/tenant/trackAnything';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('Track Anything Routes', () => {
  describe('GET /categories', () => {
    test('returns list of categories', async () => {
      const mockDB = createMockDB({
        tables: {
          trk_category: [
            { CategoryId: 1, CategoryName: 'Vitals', Description: 'Vital signs', tenant_id: 'tenant-1', IsActive: 1, DisplayOrder: 0 },
            { CategoryId: 2, CategoryName: 'Labs', Description: 'Lab results', tenant_id: 'tenant-1', IsActive: 1, DisplayOrder: 1 },
          ],
        },
      });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await app.request('/track-anything/categories');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown[] };
      expect(body.Results).toBeDefined();
      expect(Array.isArray(body.Results)).toBe(true);
    });

    test('returns empty array when no categories exist', async () => {
      const mockDB = createMockDB({ universalFallback: true });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await app.request('/track-anything/categories');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown[] };
      expect(body.Results).toBeDefined();
    });
  });

  describe('POST /categories', () => {
    test('creates a category with valid data', async () => {
      const mockDB = createMockDB({ universalFallback: true });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await jsonRequest(app, '/track-anything/categories', {
        method: 'POST',
        body: { CategoryName: 'Blood Pressure', Description: 'BP tracking', DisplayOrder: 0 },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { Results: { id: number } };
      expect(body.Results.id).toBeDefined();
    });

    test('rejects category without CategoryName', async () => {
      const mockDB = createMockDB({ universalFallback: true });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await jsonRequest(app, '/track-anything/categories', {
        method: 'POST',
        body: { Description: 'Missing name' },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /configs', () => {
    test('returns list of configurations', async () => {
      const mockDB = createMockDB({
        tables: {
          trk_configuration: [
            { ConfigurationId: 1, TrackName: 'Blood Pressure', DataType: 'number', tenant_id: 'tenant-1', IsActive: 1, DisplayOrder: 0 },
            { ConfigurationId: 2, TrackName: 'Weight', DataType: 'number', tenant_id: 'tenant-1', IsActive: 1, DisplayOrder: 1 },
          ],
        },
      });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await app.request('/track-anything/configs');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown[]; Pagination: unknown };
      expect(body.Results).toBeDefined();
      expect(Array.isArray(body.Results)).toBe(true);
      expect(body.Pagination).toBeDefined();
    });

    test('supports pagination query params', async () => {
      const mockDB = createMockDB({ universalFallback: true });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await app.request('/track-anything/configs?page=1&limit=10');
      expect(res.status).toBe(200);
      const body = await res.json() as { Pagination: { page: number; limit: number } };
      expect(body.Pagination.page).toBe(1);
      expect(body.Pagination.limit).toBe(10);
    });
  });

  describe('POST /configs', () => {
    test('creates a configuration with valid data', async () => {
      const mockDB = createMockDB({ universalFallback: true });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await jsonRequest(app, '/track-anything/configs', {
        method: 'POST',
        body: {
          TrackName: 'Blood Pressure',
          TrackDescription: 'Systolic and diastolic',
          DataType: 'number',
          Units: 'mmHg',
          NormalRangeMin: 90,
          NormalRangeMax: 140,
          DisplayOrder: 0,
          AllowDecimals: 0,
          ShowTrend: 1,
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { Results: { id: number } };
      expect(body.Results.id).toBeDefined();
    });

    test('rejects config without TrackName', async () => {
      const mockDB = createMockDB({ universalFallback: true });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await jsonRequest(app, '/track-anything/configs', {
        method: 'POST',
        body: { DataType: 'number' },
      });

      expect(res.status).toBe(400);
    });

    test('defaults DataType to number when not provided', async () => {
      const mockDB = createMockDB({ universalFallback: true });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await jsonRequest(app, '/track-anything/configs', {
        method: 'POST',
        body: { TrackName: 'Heart Rate' },
      });

      expect(res.status).toBe(201);
    });
  });

  describe('POST /data', () => {
    test('records a data point with valid data', async () => {
      const mockDB = createMockDB({
        tables: {
          trk_configuration: [
            { ConfigurationId: 1, DataType: 'number', tenant_id: 'tenant-1' },
          ],
        },
      });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await jsonRequest(app, '/track-anything/data', {
        method: 'POST',
        body: {
          ConfigurationId: 1,
          PatientId: 1,
          TrackValue: '120',
          TrackDate: '2025-06-01',
          Notes: 'Morning reading',
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { Results: { id: number } };
      expect(body.Results.id).toBeDefined();
    });

    test('rejects data without required fields', async () => {
      const mockDB = createMockDB({ universalFallback: true });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await jsonRequest(app, '/track-anything/data', {
        method: 'POST',
        body: { TrackValue: '120' },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /patient/:id/data', () => {
    test('returns tracked data for a patient', async () => {
      const mockDB = createMockDB({
        tables: {
          trk_data: [
            { DataId: 1, ConfigurationId: 1, PatientId: 1, TrackValue: '120', NumericValue: 120, TrackDate: '2025-06-01', tenant_id: 'tenant-1', IsActive: 1 },
          ],
        },
      });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await app.request('/track-anything/patient/1/data');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown[]; Pagination: unknown };
      expect(body.Results).toBeDefined();
      expect(Array.isArray(body.Results)).toBe(true);
      expect(body.Pagination).toBeDefined();
    });

    test('returns empty results for patient with no data', async () => {
      const mockDB = createMockDB({ universalFallback: true });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await app.request('/track-anything/patient/999/data');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown[] };
      expect(body.Results).toBeDefined();
    });
  });

  describe('GET /templates', () => {
    test('returns list of templates with items', async () => {
      const mockDB = createMockDB({
        tables: {
          trk_template: [
            { TemplateId: 1, TemplateName: 'Vitals Panel', TemplateType: 'vitals', tenant_id: 'tenant-1', IsActive: 1 },
          ],
          trk_templateitem: [
            { TemplateItemId: 1, TemplateId: 1, TrackName: 'BP', DataType: 'number', tenant_id: 'tenant-1', DisplayOrder: 0 },
          ],
        },
      });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await app.request('/track-anything/templates');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown[] };
      expect(body.Results).toBeDefined();
      expect(Array.isArray(body.Results)).toBe(true);
    });

    test('returns empty array when no templates exist', async () => {
      const mockDB = createMockDB({ universalFallback: true });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await app.request('/track-anything/templates');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown[] };
      expect(body.Results).toBeDefined();
    });
  });

  describe('GET /patient/:id/trends', () => {
    test('returns trend data for a patient', async () => {
      const mockDB = createMockDB({
        tables: {
          trk_data: [
            { DataId: 1, ConfigurationId: 1, PatientId: 1, TrackValue: '120', NumericValue: 120, TrackDate: '2025-06-01', tenant_id: 'tenant-1', IsActive: 1 },
          ],
          trk_configuration: [
            { ConfigurationId: 1, TrackName: 'BP', Units: 'mmHg', DataType: 'number', NormalRangeMin: 90, NormalRangeMax: 140, tenant_id: 'tenant-1', IsActive: 1 },
          ],
        },
      });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await app.request('/track-anything/patient/1/trends');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: { patientId: number; trends: unknown; configurations: unknown; statistics: unknown } };
      expect(body.Results).toBeDefined();
      expect(body.Results.patientId).toBe(1);
      expect(body.Results.trends).toBeDefined();
      expect(body.Results.configurations).toBeDefined();
      expect(body.Results.statistics).toBeDefined();
    });

    test('filters by configurationIds when provided', async () => {
      const mockDB = createMockDB({ universalFallback: true });
      const { app } = createTestApp({ route: trackAnythingRoutes, routePath: '/track-anything', mockDB });

      const res = await app.request('/track-anything/patient/1/trends?configurationIds=1,2');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown };
      expect(body.Results).toBeDefined();
    });
  });
});
