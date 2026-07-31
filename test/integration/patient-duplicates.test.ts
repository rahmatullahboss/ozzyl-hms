import { describe, it, expect, beforeEach } from 'vitest';
import duplicates from '../../src/routes/tenant/patientDuplicates';
import { createTestApp, jsonRequest } from './helpers/test-app';
import { createMockDB, type MockDB } from './helpers/mock-db';

// ═══════════════════════════════════════════════════════════════════════════════
// Patient Duplicates — Unmerge Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Patient Duplicates — Unmerge', () => {
  const TENANT_ID = 'tenant-1';

  function setup(opts: {
    mergeLog?: Record<string, unknown> | null;
    role?: string;
    recordMap?: boolean;
    queryOverride?: MockDB['queries'] extends Array<infer _> ? Parameters<typeof createMockDB>[0]['queryOverride'] : never;
  } = {}) {
    const mergeLog = opts.mergeLog ?? {
      id: 1,
      tenant_id: TENANT_ID,
      primary_patient_id: 100,
      merged_patient_id: 200,
      merged_data: JSON.stringify({
        id: 200,
        name: 'Abdul Karim',
        mobile: '01812345678',
        tenant_id: TENANT_ID,
      }),
      tables_updated: JSON.stringify({ visits: 3, prescriptions: 2 }),
      merged_at: '2026-03-01T10:00:00Z',
      is_unmerged: 0,
      merge_reason: 'Duplicate phone',
      merged_by: '1',
    };

    const mockDB = createMockDB({
      tables: {
        patient_merge_log: mergeLog ? [mergeLog] : [],
        patient_merge_record_map: mergeLog && opts.recordMap !== false ? [
          { id: 1, merge_log_id: 1, tenant_id: TENANT_ID, table_name: 'visits', column_name: 'patient_id', record_id: 1, original_patient_id: 200, target_patient_id: 100 },
          { id: 2, merge_log_id: 1, tenant_id: TENANT_ID, table_name: 'prescriptions', column_name: 'patient_id', record_id: 10, original_patient_id: 200, target_patient_id: 100 },
        ] : [],
        patients: [
          { id: 100, tenant_id: TENANT_ID, name: 'Rahim Uddin', mobile: '01712345678' },
          { id: 200, tenant_id: TENANT_ID, name: 'Abdul Karim [MERGED→100]', mobile: 'MERGED-01812345678' },
        ],
        visits: [
          { id: 1, patient_id: 100, tenant_id: TENANT_ID, created_at: '2026-02-15T10:00:00Z' },
          { id: 2, patient_id: 100, tenant_id: TENANT_ID, created_at: '2026-02-20T10:00:00Z' },
          { id: 3, patient_id: 100, tenant_id: TENANT_ID, created_at: '2026-02-25T10:00:00Z' },
        ],
        prescriptions: [
          { id: 10, patient_id: 100, tenant_id: TENANT_ID, created_at: '2026-02-15T10:00:00Z' },
          { id: 11, patient_id: 100, tenant_id: TENANT_ID, created_at: '2026-02-20T10:00:00Z' },
        ],
      },
      queryOverride: (sql, params) => {
        if (sql.includes('PRAGMA table_info') && sql.includes('patient_merge_log')) {
          return { results: [{ name: 'is_unmerged' }] };
        }
        if (sql.includes('PRAGMA table_info') && (sql.includes('visits') || sql.includes('prescriptions'))) {
          return { results: [{ name: 'created_at' }] };
        }
        return opts.queryOverride?.(sql, params) ?? null;
      },
    });

    const { app } = createTestApp({
      route: duplicates,
      routePath: '/patient-duplicates',
      role: opts.role ?? 'hospital_admin',
      tenantId: TENANT_ID,
      userId: 1,
      mockDB,
    });

    return { app, mockDB };
  }

  it('successfully unmerges a previously merged patient', async () => {
    const { app, mockDB } = setup();

    const res = await jsonRequest(app, '/patient-duplicates/unmerge', {
      method: 'POST',
      body: { merge_log_id: 1, unmerge_reason: 'Incorrectly merged' },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toContain('reversed');

    // Verify UPDATE patients query was issued to restore name/mobile
    const restoreQuery = mockDB.queries.find(
      (q) => q.method === 'run' && q.sql.replace(/\s+/g, ' ').includes('UPDATE patients SET name = ?') && q.params.includes('Abdul Karim'),
    );
    expect(restoreQuery).toBeTruthy();

    // Verify merge log was updated
    const logUpdate = mockDB.queries.find(
      (q) => q.method === 'run' && q.sql.includes('UPDATE patient_merge_log') && q.sql.includes('is_unmerged = 1'),
    );
    expect(logUpdate).toBeTruthy();
  });

  it('rejects unmerge from non-admin roles', async () => {
    const { app } = setup({ role: 'doctor' });

    const res = await jsonRequest(app, '/patient-duplicates/unmerge', {
      method: 'POST',
      body: { merge_log_id: 1, unmerge_reason: 'Wrongly merged' },
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain('Insufficient permissions');
  });

  it('rejects unmerge for nurse role', async () => {
    const { app } = setup({ role: 'nurse' });

    const res = await jsonRequest(app, '/patient-duplicates/unmerge', {
      method: 'POST',
      body: { merge_log_id: 1, unmerge_reason: 'Wrongly merged' },
    });

    expect(res.status).toBe(403);
  });

  it('allows super_admin to unmerge', async () => {
    const { app } = setup({ role: 'super_admin' });

    const res = await jsonRequest(app, '/patient-duplicates/unmerge', {
      method: 'POST',
      body: { merge_log_id: 1, unmerge_reason: 'Admin override' },
    });

    expect(res.status).toBe(200);
  });

  it('returns 404 when merge log not found', async () => {
    const { app } = setup({ mergeLog: null });

    const res = await jsonRequest(app, '/patient-duplicates/unmerge', {
      method: 'POST',
      body: { merge_log_id: 999, unmerge_reason: 'Not found test' },
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('Merge log not found');
  });

  it('returns 400 when merge is already unmerged', async () => {
    const { app } = setup({
      mergeLog: {
        id: 1,
        tenant_id: TENANT_ID,
        primary_patient_id: 100,
        merged_patient_id: 200,
        merged_data: '{}',
        tables_updated: '{}',
        merged_at: '2026-03-01T10:00:00Z',
        is_unmerged: 1,
        merge_reason: 'test',
        merged_by: '1',
      },
    });

    const res = await jsonRequest(app, '/patient-duplicates/unmerge', {
      method: 'POST',
      body: { merge_log_id: 1, unmerge_reason: 'Try again' },
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('already been reversed');
  });

  it('validates request body — missing merge_log_id', async () => {
    const { app } = setup();

    const res = await jsonRequest(app, '/patient-duplicates/unmerge', {
      method: 'POST',
      body: { unmerge_reason: 'No log id' },
    });

    expect(res.status).toBe(400);
  });

  it('validates request body — empty unmerge_reason', async () => {
    const { app } = setup();

    const res = await jsonRequest(app, '/patient-duplicates/unmerge', {
      method: 'POST',
      body: { merge_log_id: 1, unmerge_reason: '' },
    });

    expect(res.status).toBe(400);
  });

  it('validates request body — negative merge_log_id', async () => {
    const { app } = setup();

    const res = await jsonRequest(app, '/patient-duplicates/unmerge', {
      method: 'POST',
      body: { merge_log_id: -1, unmerge_reason: 'bad id' },
    });

    expect(res.status).toBe(400);
  });

  it('reverses only exact rows captured in the record map', async () => {
    const { app, mockDB } = setup();

    await jsonRequest(app, '/patient-duplicates/unmerge', {
      method: 'POST',
      body: { merge_log_id: 1, unmerge_reason: 'Testing FK reversal' },
    });

    // The current rollback path uses exact table/column/record identities from patient_merge_record_map.
    const fkUpdates = mockDB.queries.filter(
      (q) => q.method === 'run'
        && q.sql.includes('UPDATE')
        && q.sql.includes('WHERE id = ?')
        && !q.sql.includes('patient_merge_log')
        && !q.sql.replace(/\s+/g, ' ').includes('UPDATE patients SET name'),
    );

    // Only mapped visit and prescription rows are eligible for reversal.
    const tablesAttempted = fkUpdates.map((q) => {
      const match = q.sql.match(/UPDATE\s+"?(\w+)"?/i);
      return match?.[1];
    });

    expect(tablesAttempted).toContain('visits');
    expect(tablesAttempted).toContain('prescriptions');
    // Should NOT attempt tables not in tables_updated
    expect(tablesAttempted).not.toContain('admissions');
    expect(tablesAttempted).not.toContain('lab_orders');
  });

  it('uses temporal constraint (created_at < merged_at) in FK reversal', async () => {
    const { app, mockDB } = setup({ recordMap: false });

    await jsonRequest(app, '/patient-duplicates/unmerge', {
      method: 'POST',
      body: { merge_log_id: 1, unmerge_reason: 'Temporal check' },
    });

    const fkUpdates = mockDB.queries.filter(
      (q) => q.method === 'run'
        && q.sql.includes('created_at <')
        && !q.sql.includes('patient_merge_log'),
    );

    // Each FK reversal should include the merged_at timestamp as a parameter
    for (const query of fkUpdates) {
      expect(query.params).toContain('2026-03-01T10:00:00Z');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Patient Duplicates — Scan & Merge (Existing Endpoints)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Patient Duplicates — Scan', () => {
  const TENANT_ID = 'tenant-1';

  it('GET /scan returns duplicate patients by phone', async () => {
    const { app } = createTestApp({
      route: duplicates,
      routePath: '/patient-duplicates',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: {
        patients: [
          { id: 1, tenant_id: TENANT_ID, name: 'Rahim', mobile: '01712345678', id1: 1, name1: 'Rahim', code1: 'P001', phone1: '01712345678', id2: 2, name2: 'Rohim', code2: 'P002', phone2: '01712345678', match_type: 'phone', confidence: 100 },
        ],
      },
    });

    const res = await app.request('/patient-duplicates/scan?method=phone');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('data');
    expect(data).toHaveProperty('pagination');
  });

  it('GET /stats returns duplicate statistics', async () => {
    const { app } = createTestApp({
      route: duplicates,
      routePath: '/patient-duplicates',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: {
        patients: [],
        patient_merge_log: [],
      },
    });

    const res = await app.request('/patient-duplicates/stats');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('duplicate_phones');
    expect(data).toHaveProperty('duplicate_nids');
    expect(data).toHaveProperty('total_merges');
  });
});
