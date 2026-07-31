import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import labMonitoringRoutes from '../src/routes/tenant/labMonitoring';
import { buildLisBridgeDeploymentChecklist } from '../src/lib/lis-bridge-deployment-checklist';
import { createMockDB } from './integration/helpers/mock-db';

function createApp(machineExists = true) {
  const mock = createMockDB({
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from lab_machines') && lower.includes('analyzer_profile_id')) {
        return {
          first: machineExists ? {
            id: 7,
            machine_name: 'Mindray BC-10',
            machine_code: 'BC10-LAB',
            protocol: 'hl7',
            analyzer_profile_id: 'mindray-bc2000-hl7',
          } : null,
          results: [],
          success: true,
          meta: {},
        };
      }
      return null;
    },
  });

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
  return { app, mock };
}

describe('LIS bridge deployment checklist', () => {
  it('builds an OpenELIS-style but Ozzyl-specific bridge deployment checklist', () => {
    const checklist = buildLisBridgeDeploymentChecklist({ machineId: 7, machineName: 'Mindray BC-10', protocol: 'hl7' });

    expect(checklist.map((stage) => stage.id)).toEqual([
      'site-survey',
      'bridge-installation',
      'hms-configuration',
      'qc-smoke-test',
      'patient-smoke-test',
      'go-live-controls',
    ]);
    expect(checklist[0].items[0]).toMatchObject({
      id: 'confirm-analyzer-profile',
      title: 'Confirm analyzer profile for Mindray BC-10',
      endpoint: '/api/lab-machines/7/middleware-config',
    });
    expect(checklist.flatMap((stage) => stage.items).some((item) => item.id === 'confirm-fallback-workflow')).toBe(true);
    expect(checklist.flatMap((stage) => stage.items).some((item) => item.endpoint === '/api/lab-monitoring/reagent-reconciliation')).toBe(true);
  });

  it('exposes a machine-specific deployment checklist through lab monitoring', async () => {
    const { app, mock } = createApp(true);
    const res = await app.request('/lab-monitoring/lis-bridge-deployment-checklist?machineId=7');

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.machine_id).toBe(7);
    expect(body.data.source).toContain('openelis-reference');
    expect(body.data.checklist[0].items[0]).toMatchObject({
      title: 'Confirm analyzer profile for Mindray BC-10',
      endpoint: '/api/lab-machines/7/middleware-config',
    });
    expect(body.data.checklist.flatMap((stage: any) => stage.items).map((item: any) => item.id)).toContain('verify-heartbeat');
    expect(mock.queries.some((q) => q.sql.includes('FROM lab_machines') && q.params.includes(7))).toBe(true);
  });

  it('returns 404 when a machine-specific deployment checklist targets a missing analyzer', async () => {
    const { app } = createApp(false);
    const res = await app.request('/lab-monitoring/lis-bridge-deployment-checklist?machineId=999');

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'Analyzer machine not found' });
  });
});
