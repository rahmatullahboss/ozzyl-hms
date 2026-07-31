import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';
import {
  buildLabMiddlewareConfigSnippet,
  listLabAnalyzerProfiles,
  suggestAnalyzerProfileDefaults,
} from '../src/lib/lab-analyzer-profiles';

function createApp() {
  const mock = createMockDB({
    universalFallback: true,
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from lab_machines') && lower.includes('machine_code')) {
        return {
          first: {
            id: 1,
            machine_name: 'Mindray BS-200',
            machine_code: 'BS200-01',
            manufacturer: 'Mindray',
            model_number: 'BS-200',
            protocol: 'hl7',
            port: null,
          },
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
    c.set('tenantId', 'tenant-1');
    c.set('userId', '9');
    c.set('role', 'lab_tech' as any);
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
    } as any;
    await next();
  });
  app.route('/lab-machines', labMachines);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));
  return app;
}

describe('lab analyzer profile catalog', () => {
  it('lists protocol-specific analyzer profiles based on OpenELIS-style defaults', () => {
    const hl7 = listLabAnalyzerProfiles({ protocol: 'hl7' });
    expect(hl7.length).toBeGreaterThan(0);
    expect(hl7.every((profile) => profile.protocol === 'hl7')).toBe(true);
    expect(hl7.some((profile) => profile.id === 'mindray-bc2000-hl7')).toBe(true);
  });

  it('suggests machine setup defaults from profile id or model/manufacturer', () => {
    expect(suggestAnalyzerProfileDefaults({ profileId: 'mindray-bs200-hl7' })).toMatchObject({
      profileId: 'mindray-bs200-hl7',
      machine_type: 'biochemistry',
      protocol: 'hl7',
      port: 2575,
      is_bidirectional: true,
      requiresUnitMapping: true,
    });

    expect(suggestAnalyzerProfileDefaults({ manufacturer: 'Mindray', model: 'BC-5380', protocol: 'hl7' })).toMatchObject({
      profileId: 'mindray-bc5380-hl7',
      machine_type: 'hematology',
    });
  });

  it('exposes analyzer profiles through lab machine API before dynamic ID routes', async () => {
    const app = createApp();
    const res = await app.request('/lab-machines/analyzer-profiles?protocol=astm&q=mindray');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{ id: 'mindray-ba88a-astm', protocol: 'astm', manufacturer: 'Mindray' }],
    });
  });

  it('returns suggested analyzer defaults through API', async () => {
    const app = createApp();
    const res = await app.request('/lab-machines/analyzer-profiles/suggest?model=GeneXpert&protocol=hl7');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: {
        profileId: 'genexpert-hl7',
        machine_type: 'microbiology',
        protocol: 'hl7',
        port: 2575,
        is_bidirectional: true,
        requiresQualitativeMapping: true,
      },
    });
  });

  it('builds a safe middleware config snippet without exposing secrets', () => {
    const snippet = buildLabMiddlewareConfigSnippet({
      tenantId: 'tenant-1',
      machineCode: 'BA88A-01',
      machineName: 'Mindray BA-88A',
      profileId: 'mindray-ba88a-astm',
    });

    expect(snippet.api.apiKey).toBe('[REDACTED_SECRET]');
    expect(snippet.astm.enabled).toBe(true);
    expect(snippet.astm.port).toBe(9100);
    expect(snippet.astm.machines).toEqual([{ name: 'Mindray BA-88A', ip: '[ANALYZER_IP]', machineCode: 'BA88A-01' }]);
    expect(snippet.hl7.enabled).toBe(false);
  });

  it('exposes a machine-specific middleware config template through API', async () => {
    const app = createApp();
    const res = await app.request('/lab-machines/1/middleware-config?profileId=mindray-bs200-hl7&siteName=Main%20Lab');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: {
        api: { apiKey: '[REDACTED_SECRET]', tenantId: 'tenant-1' },
        agent: { siteName: 'Main Lab' },
        hl7: {
          enabled: true,
          port: 2575,
          ackMode: 'always_ack_after_queue',
          machines: [{ name: 'Mindray BS-200', ip: '[ANALYZER_IP]', machineCode: 'BS200-01' }],
        },
      },
    });
  });
});
