import { afterEach, describe, expect, it, vi } from 'vitest';
import ePrescribingRoutes from '../src/routes/tenant/ePrescribing';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('e-prescribing safety route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /formulary/search falls back to the local Bangladesh master drug catalog', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('count(*) as count from drug_interaction_pairs')) {
          return { first: { count: 1 }, success: true, meta: {} };
        }

        if (normalized.includes('from formulary_items')) {
          return { results: [], success: true, meta: {} };
        }

        if (normalized.includes('from master_drugs')) {
          return {
            results: [{
              name: 'Napa',
              generic_name: 'Paracetamol',
              manufacturer: 'Beximco Pharmaceuticals Ltd.',
              strength: '500mg',
              dosage_form: 'Tablet',
            }],
            success: true,
            meta: {},
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: ePrescribingRoutes,
      routePath: '/api/e-prescribing',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/e-prescribing/formulary/search?q=nap');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      medicines: Array<{ name: string; generic: string; manufacturer: string; strength: string; dosage_form: string; source: string }>;
    };
    expect(body.medicines).toEqual([
      expect.objectContaining({
        name: 'Napa',
        generic: 'Paracetamol',
        manufacturer: 'Beximco Pharmaceuticals Ltd.',
        strength: '500mg',
        dosage_form: 'Tablet',
        source: 'bd_master',
      }),
    ]);
  });

  it('GET /formulary/frequent returns doctor-specific recent medicine usage', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          return { first: { id: 7 }, success: true, meta: {} };
        }

        if (normalized.includes('from prescription_medicine_usage_stats')) {
          return {
            results: [{
              medicine_name: 'Napa',
              generic_name: 'Paracetamol',
              strength: '500mg',
              dosage_form: 'Tablet',
              manufacturer: 'Beximco Pharmaceuticals Ltd.',
              default_frequency: '1+1+1',
              default_duration: '5 days',
              default_instructions: 'After meal',
              usage_count: 9,
            }],
            success: true,
            meta: {},
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: ePrescribingRoutes,
      routePath: '/api/e-prescribing',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/e-prescribing/formulary/frequent?limit=5');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      medicines: Array<{ name: string; strength: string; dosage_form: string; usage_count: number; source: string }>;
    };
    expect(body.medicines).toEqual([
      expect.objectContaining({
        name: 'Napa',
        strength: '500mg',
        dosage_form: 'Tablet',
        usage_count: 9,
        source: 'doctor_usage',
      }),
    ]);
  });

  it('does not let a doctor read another doctor frequent medicine list by query param', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          return { first: { id: 7 }, success: true, meta: {} };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: ePrescribingRoutes,
      routePath: '/api/e-prescribing',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/e-prescribing/formulary/frequent?doctorId=12');

    expect(res.status).toBe(403);
  });

  it('GET /formulary/external-search fetches and caches external medicine results on demand', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`
      <div class="search-result-title"><a>Napa 500mg (Tablet)</a></div>
      <p><i>(Paracetamol)</i> is manufactured by Beximco Pharmaceuticals Ltd.</p>
    `, { status: 200 })));

    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select id from master_generics')) {
          return { first: { id: 1124 }, success: true, meta: {} };
        }
        if (normalized.includes('select id from master_companies')) {
          return { first: { id: 101 }, success: true, meta: {} };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: ePrescribingRoutes,
      routePath: '/api/e-prescribing',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/e-prescribing/formulary/external-search?q=napa');

    expect(res.status).toBe(200);
    const body = await res.json() as { medicines: Array<{ name: string; generic: string; strength: string; dosage_form: string; source: string }> };
    expect(body.medicines).toEqual([
      expect.objectContaining({
        name: 'Napa',
        generic: 'Paracetamol',
        strength: '500mg',
        dosage_form: 'Tablet',
        source: 'medex',
      }),
    ]);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into master_drugs'))).toBe(true);
  });

  it('GET /formulary/search exposes configured hospital stock mapping without inferring it for free text', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('count(*) as count from drug_interaction_pairs')) {
          return { first: { count: 1 }, success: true, meta: {} };
        }
        if (normalized.includes('from formulary_items')) {
          return {
            results: [{
              name: 'Amlodipine',
              generic_name: 'Amlodipine',
              manufacturer: 'Local Provider',
              strength: '5 mg',
              dosage_form: 'Tablet',
              default_frequency: 'Once daily',
              default_duration: '30 days',
              default_instructions: null,
              medicine_id: 501,
              tenant_id: 'tenant-1',
            }],
            success: true,
            meta: {},
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: ePrescribingRoutes,
      routePath: '/api/e-prescribing',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/e-prescribing/formulary/search?q=aml');
    expect(res.status).toBe(200);
    const body = await res.json() as { medicines: Array<{ medicine_id?: number | null }> };
    expect(body.medicines[0]?.medicine_id).toBe(501);
  });


  it('lists safety override audit entries with role-aware filtering', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('count(*) as total') && normalized.includes('from prescription_safety_checks')) {
          return { first: { total: 1 }, success: true, meta: {} };
        }
        if (normalized.includes('from prescription_safety_checks psc') && normalized.includes('left join patients')) {
          return {
            results: [{
              id: 77,
              prescription_id: 501,
              patient_id: 1,
              patient_name: 'Rahim Uddin',
              patient_code: 'P-001',
              medication_name: 'Warfarin, Aspirin',
              generic_name: 'warfarin',
              check_type: 'combined',
              warning_count: 2,
              override_reason: 'Benefit outweighs risk after counselling',
              checked_by: 9,
              checked_by_name: 'Dr. Safety',
              checked_at: '2026-06-20 10:00:00',
            }],
            success: true,
            meta: {},
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: ePrescribingRoutes,
      routePath: '/api/e-prescribing',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/api/e-prescribing/safety-overrides?patientId=1&limit=10');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      overrides: Array<{ id: number; override_reason: string; checked_by: number }>;
      pagination: { total: number; limit: number };
    };
    expect(body.overrides).toEqual([
      expect.objectContaining({
        id: 77,
        override_reason: 'Benefit outweighs risk after counselling',
        checked_by: 9,
      }),
    ]);
    expect(body.pagination).toMatchObject({ total: 1, limit: 10 });
    const sql = mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n');
    expect(sql).toContain("psc.action_taken = 'overridden'");
    expect(sql).toContain('cast(psc.checked_by as text) = ?');
  });

  it('restricts safety override audit logs to clinical and admin roles', async () => {
    const { app } = createTestApp({
      route: ePrescribingRoutes,
      routePath: '/api/e-prescribing',
      role: 'reception',
      mockDB: createMockDB(),
    });

    const res = await jsonRequest(app, '/api/e-prescribing/safety-overrides');

    expect(res.status).toBe(403);
  });

  it('POST /check-safety evaluates active meds and same-order items with blocking summary', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('count(*) as count from drug_interaction_pairs')) {
          return { first: { count: 1 }, success: true, meta: {} };
        }

        if (normalized.includes('from patient_active_medications')) {
          if (normalized.includes("status in ('discontinued', 'completed', 'on_hold', 'suspended')")) {
            return {
              results: [{
                medication_name: 'Phenelzine',
                generic_name: 'phenelzine',
                status: 'discontinued',
                stop_date: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString(),
              }],
              success: true,
              meta: {},
            };
          }

          return {
            results: [{ medication_name: 'Warfarin', generic_name: 'warfarin', status: 'active' }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from patient_allergies')) {
          return {
            results: [],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from drug_interaction_pairs')) {
          return {
            results: [{
              drug_a_name: 'warfarin',
              drug_b_name: 'ibuprofen',
              severity: 'major',
              description: 'Bleeding risk',
              recommendation: 'Avoid combination',
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from formulary_items')) {
          return {
            results: [{
              name: 'Ibuprofen',
              generic_name: 'Ibuprofen',
              max_daily_dose_mg: 2400,
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('insert into prescription_safety_checks')) {
          return {
            success: true,
            meta: { last_row_id: 77, changes: 1, duration: 0 },
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: ePrescribingRoutes,
      routePath: '/api/e-prescribing',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/e-prescribing/check-safety', {
      method: 'POST',
      body: {
        patient_id: 1,
        medications: [
          { medication_name: 'Ibuprofen', generic_name: 'ibuprofen', dose_mg: 800, frequency_per_day: 4 },
          { medication_name: 'Warfarin', generic_name: 'warfarin' },
          { medication_name: 'Sertraline', generic_name: 'sertraline' },
          { medication_name: 'Metformin', generic_name: 'metformin', dose_mg: 500, frequency_per_day: 2 },
        ],
        patient_context: {
          age_years: 68,
          egfr: 25,
          diagnoses: ['Chronic Kidney Disease'],
        },
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      has_blocking: boolean;
      findings: Array<{ type: string; blocking: boolean }>;
      warnings: Array<{ type: string }>;
      safety_check_id: number;
    };

    expect(body.has_blocking).toBe(true);
    expect(body.findings.some((item) => item.type === 'drug_interaction' && item.blocking)).toBe(true);
    expect(body.findings.some((item) => item.type === 'washout_interaction' && item.blocking)).toBe(true);
    expect(body.findings.some((item) => item.type === 'duplicate_therapy')).toBe(true);
    expect(body.findings.some((item) => item.type === 'drug_condition')).toBe(true);
    expect(body.findings.some((item) => item.type === 'dose_adjustment')).toBe(true);
    expect(body.warnings.length).toBe(body.findings.length);
    expect(body.safety_check_id).toBe(77);
  });
});
