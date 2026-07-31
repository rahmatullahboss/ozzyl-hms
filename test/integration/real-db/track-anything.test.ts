/**
 * Track Anything — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Covers categories, configurations, data recording, patient data queries,
 * and templates endpoints.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface Category {
  CategoryId: number;
  CategoryName: string;
  Description: string | null;
  DisplayOrder: number;
  tenant_id: number;
}

interface Configuration {
  ConfigurationId: number;
  TrackName: string;
  DataType: string;
  Units: string | null;
  tenant_id: number;
}

interface DataPoint {
  DataId: number;
  ConfigurationId: number;
  PatientId: number;
  TrackValue: string;
  TrackDate: string;
  tenant_id: number;
}

interface Template {
  TemplateId: number;
  TemplateName: string;
  TemplateType: string;
  Items?: unknown[];
}

interface PaginatedResponse<T> {
  Results?: T[];
  data?: T[];
  items?: T[];
  Pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

let adminH: Record<string, string>;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
});

// ═══════════════════════════════════════════════════════════════════════════
// Categories
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/track-anything/categories', () => {
  it('returns list of categories', async () => {
    const res = await api.get<PaginatedResponse<Category>>(
      '/api/track-anything/categories',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.Results ?? res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/track-anything/categories',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/track-anything/categories', () => {
  let createdId: number | null = null;

  it('creates a category', async () => {
    const payload = {
      CategoryName: `Test Category ${Date.now()}`,
      Description: 'Integration test category',
      DisplayOrder: 99,
    };

    const res = await api.post<{ Results?: { id: number } }>(
      '/api/track-anything/categories',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
    if (res.body.Results?.id) {
      createdId = res.body.Results.id;
      expect(typeof createdId).toBe('number');
    }
  });

  it('returns 400 for missing CategoryName', async () => {
    const res = await api.post(
      '/api/track-anything/categories',
      adminH,
      { Description: 'No name' },
    );
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/track-anything/categories',
      noAuthHeaders(),
      { CategoryName: 'Unauthorized' },
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Configurations
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/track-anything/configs', () => {
  it('returns configurations with pagination', async () => {
    const res = await api.get<PaginatedResponse<Configuration>>(
      '/api/track-anything/configs',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.Results ?? res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
    expect(res.body.Pagination).toBeDefined();
    expect(typeof res.body.Pagination!.total).toBe('number');
  });

  it('supports pagination params', async () => {
    const res = await api.get<PaginatedResponse<Configuration>>(
      '/api/track-anything/configs?page=1&limit=5',
      adminH,
    );
    expect(res.status).toBe(200);
    expect(res.body.Pagination!.limit).toBe(5);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/track-anything/configs',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/track-anything/configs', () => {
  it('creates a configuration', async () => {
    const payload = {
      TrackName: `Test Metric ${Date.now()}`,
      TrackDescription: 'Integration test metric',
      DataType: 'number',
      Units: 'mg/dL',
      NormalRangeMin: 70,
      NormalRangeMax: 100,
      DisplayOrder: 0,
      AllowDecimals: 1,
      ShowTrend: 1,
    };

    const res = await api.post<{ Results?: { id: number } }>(
      '/api/track-anything/configs',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
    if (res.body.Results?.id) {
      expect(typeof res.body.Results.id).toBe('number');
    }
  });

  it('returns 400 for missing TrackName', async () => {
    const res = await api.post(
      '/api/track-anything/configs',
      adminH,
      { DataType: 'number' },
    );
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/track-anything/configs',
      noAuthHeaders(),
      { TrackName: 'Unauthorized' },
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Data Recording
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/track-anything/data', () => {
  it('records a data point', async () => {
    const payload = {
      ConfigurationId: 1,
      PatientId: 1001,
      TrackValue: '95',
      TrackDate: new Date().toISOString(),
      Notes: 'Integration test data point',
      Source: 'manual',
    };

    const res = await api.post<{ Results?: { id: number } }>(
      '/api/track-anything/data',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
    if (res.body.Results?.id) {
      expect(typeof res.body.Results.id).toBe('number');
    }
  });

  it('returns 404 for non-existent configuration', async () => {
    const payload = {
      ConfigurationId: 999999,
      PatientId: 1001,
      TrackValue: '100',
    };

    const res = await api.post(
      '/api/track-anything/data',
      adminH,
      payload,
    );
    expect([404, 400]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/track-anything/data',
      noAuthHeaders(),
      { ConfigurationId: 1, PatientId: 1001, TrackValue: '50' },
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Patient Data
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/track-anything/patient/:id/data', () => {
  it('returns patient data with pagination', async () => {
    const res = await api.get<PaginatedResponse<DataPoint>>(
      '/api/track-anything/patient/1001/data',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.Results ?? res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
    expect(res.body.Pagination).toBeDefined();
  });

  it('supports configurationId filter', async () => {
    const res = await api.get<PaginatedResponse<DataPoint>>(
      '/api/track-anything/patient/1001/data?configurationId=1',
      adminH,
    );
    expect(res.status).toBe(200);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/track-anything/patient/1001/data',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/track-anything/templates', () => {
  it('returns templates list', async () => {
    const res = await api.get<PaginatedResponse<Template>>(
      '/api/track-anything/templates',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.Results ?? res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/track-anything/templates',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/track-anything/templates', () => {
  it('creates a template with items', async () => {
    const payload = {
      TemplateName: `Test Template ${Date.now()}`,
      TemplateDescription: 'Integration test template',
      TemplateType: 'vitals',
      Items: [
        {
          TrackName: 'Blood Pressure Systolic',
          TrackDescription: 'Systolic BP',
          DataType: 'number',
          Units: 'mmHg',
          NormalRangeMin: 90,
          NormalRangeMax: 140,
          DisplayOrder: 0,
        },
        {
          TrackName: 'Blood Pressure Diastolic',
          TrackDescription: 'Diastolic BP',
          DataType: 'number',
          Units: 'mmHg',
          NormalRangeMin: 60,
          NormalRangeMax: 90,
          DisplayOrder: 1,
        },
      ],
    };

    const res = await api.post<{ Results?: { id: number } }>(
      '/api/track-anything/templates',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
    if (res.body.Results?.id) {
      expect(typeof res.body.Results.id).toBe('number');
    }
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/track-anything/templates',
      noAuthHeaders(),
      { TemplateName: 'Unauthorized', TemplateType: 'general' },
    );
    expect(res.status).toBe(401);
  });
});
