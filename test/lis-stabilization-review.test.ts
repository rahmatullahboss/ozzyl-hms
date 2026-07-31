import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import labMonitoringRoutes from '../src/routes/tenant/labMonitoring';
import { buildLisStabilizationReview, summarizeLisStabilizationReview } from '../src/lib/lis-stabilization-review';
import { createMockDB } from './integration/helpers/mock-db';

function createApp() {
  const mock = createMockDB();
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', '1');
    c.set('userId', '9');
    c.set('role', 'laboratory' as any);
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
    } as any;
    await next();
  });
  app.route('/lab-monitoring', labMonitoringRoutes);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));
  return app;
}

describe('LIS stabilization review', () => {
  it('builds final merge/deploy stabilization gates from existing Ozzyl LIS capabilities', () => {
    const sections = buildLisStabilizationReview({ machineId: 7, branchName: 'abdullah' });
    expect(sections.map((section) => section.id)).toEqual([
      'merge-hygiene',
      'analyzer-bridge',
      'result-safety',
      'workflow-reconciliation',
      'operator-readiness',
    ]);

    const gates = sections.flatMap((section) => section.gates);
    expect(gates.map((gate) => gate.id)).toContain('lis-only-commit-scope');
    expect(gates.map((gate) => gate.id)).toContain('bridge-heartbeat-readiness');
    expect(gates.map((gate) => gate.id)).toContain('qc-control-routing');
    expect(gates.map((gate) => gate.id)).toContain('manual-fallback-trained');
    expect(gates.find((gate) => gate.id === 'bridge-config-generated')?.endpoint).toBe('/api/lab-machines/7/middleware-config');
    expect(gates.find((gate) => gate.id === 'bridge-heartbeat-readiness')?.endpoint).toBe('/api/lab-monitoring/lis-go-live-readiness?machineId=7');
    expect(gates.find((gate) => gate.id === 'lis-only-commit-scope')?.evidence).toContain('abdullah');
  });

  it('summarizes stabilization gates by required review level', () => {
    const summary = summarizeLisStabilizationReview(buildLisStabilizationReview());
    expect(summary).toEqual({
      sections: 5,
      gates: 13,
      must_pass: 9,
      monitor: 2,
      manual_review: 2,
    });
  });

  it('exposes the final stabilization review through lab monitoring API', async () => {
    const app = createApp();
    const res = await app.request('/lab-monitoring/lis-stabilization-review?machineId=7&branch=abdullah');

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.machine_id).toBe(7);
    expect(body.data.branch).toBe('abdullah');
    expect(body.data.source).toContain('openelis-reference');
    expect(body.data.summary).toMatchObject({ sections: 5, gates: 13, must_pass: 9 });
    expect(body.data.sections[0]).toMatchObject({ id: 'merge-hygiene' });
    expect(body.data.sections.flatMap((section: any) => section.gates).some((gate: any) => gate.endpoint === '/api/lab-machines/7/runs')).toBe(true);
  });
});
