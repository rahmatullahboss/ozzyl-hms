/**
 * LIS readiness/read-only E2E smoke tests.
 *
 * These intentionally avoid POSTing analyzer results or mutating production data.
 * Result ingestion, QC routing, reprocess, and reconciliation write behavior are
 * covered by local Vitest suites; this file verifies that live/admin-facing LIS
 * readiness APIs remain reachable and structurally consistent.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { loadAuth, authHeaders } from '../helpers/auth-helper';

const BASE_URL = process.env.E2E_BASE_URL || 'https://hms-saas-production.rahmatullahzisan.workers.dev';
const REQUIRE_LIS_ENDPOINTS = process.env.E2E_REQUIRE_LIS_ENDPOINTS === 'true';

type MachineRow = { id: number; machine_name?: string; machine_code?: string };

async function authedHeaders() {
  const auth = await loadAuth();
  return authHeaders(auth);
}

async function firstMachineId(request: APIRequestContext, headers: Record<string, string>): Promise<number | null> {
  const res = await request.get(`${BASE_URL}/api/lab-monitoring/machines`, { headers });
  expect([200, 403, 404]).toContain(res.status());
  if (!res.ok()) return null;
  const body = await res.json() as { data?: MachineRow[]; machines?: MachineRow[] };
  return (body.data ?? body.machines ?? [])[0]?.id ?? null;
}

function skipIfUndeployed(status: number, label: string) {
  if (status === 404 && !REQUIRE_LIS_ENDPOINTS) test.skip(true, `${label} is not deployed on ${BASE_URL}`);
}

test.describe('LIS readiness and deployment smoke', () => {
  test('GET readiness/checklist/stabilization APIs are reachable and structurally consistent', async ({ request }) => {
    const headers = await authedHeaders();

    const readiness = await request.get(`${BASE_URL}/api/lab-monitoring/lis-go-live-readiness`, { headers });
    skipIfUndeployed(readiness.status(), 'LIS go-live readiness API');
    expect(readiness.status()).toBe(200);
    const readinessBody = await readiness.json() as any;
    expect(['ready', 'warning', 'blocked']).toContain(readinessBody.data?.overall_status);
    expect(typeof readinessBody.data?.readiness_score).toBe('number');
    expect(Array.isArray(readinessBody.data?.checks)).toBe(true);
    expect(readinessBody.data.checks.map((check: any) => check.id)).toEqual(expect.arrayContaining([
      'machine-config',
      'test-mapping',
      'bridge-heartbeat',
      'qc-setup',
      'unmatched-queue',
      'analyzer-run-smoke-test',
      'reagent-readiness',
    ]));

    const checklist = await request.get(`${BASE_URL}/api/lab-monitoring/lis-bridge-deployment-checklist`, { headers });
    expect(checklist.status()).toBe(200);
    const checklistBody = await checklist.json() as any;
    expect(Array.isArray(checklistBody.data?.checklist)).toBe(true);
    expect(checklistBody.data.checklist.map((stage: any) => stage.id)).toEqual(expect.arrayContaining([
      'site-survey',
      'bridge-installation',
      'hms-configuration',
      'qc-smoke-test',
      'patient-smoke-test',
      'go-live-controls',
    ]));

    const stabilization = await request.get(`${BASE_URL}/api/lab-monitoring/lis-stabilization-review`, { headers });
    expect(stabilization.status()).toBe(200);
    const stabilizationBody = await stabilization.json() as any;
    expect(stabilizationBody.data?.summary).toMatchObject({ sections: 5, gates: 13, must_pass: 9 });
    expect(stabilizationBody.data.sections.map((section: any) => section.id)).toEqual(expect.arrayContaining([
      'merge-hygiene',
      'analyzer-bridge',
      'result-safety',
      'workflow-reconciliation',
      'operator-readiness',
    ]));
  });

  test('GET analyzer capability/profile APIs expose setup data for bridge configuration', async ({ request }) => {
    const headers = await authedHeaders();

    const capabilities = await request.get(`${BASE_URL}/api/lab-machines/capabilities`, { headers });
    skipIfUndeployed(capabilities.status(), 'LIS machine capabilities API');
    expect(capabilities.status()).toBe(200);
    const capabilitiesBody = await capabilities.json() as any;
    expect(Array.isArray(capabilitiesBody.machineTypes ?? capabilitiesBody.data?.machineTypes ?? [])).toBe(true);

    const profiles = await request.get(`${BASE_URL}/api/lab-machines/analyzer-profiles`, { headers });
    expect(profiles.status()).toBe(200);
    const profilesBody = await profiles.json() as any;
    const list = profilesBody.data ?? profilesBody.profiles ?? [];
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((profile: any) => String(profile.manufacturer ?? '').toLowerCase().includes('mindray'))).toBe(true);
  });

  test('GET machine-specific run/log/config endpoints are safe when a machine exists', async ({ request }) => {
    const headers = await authedHeaders();
    const machineId = await firstMachineId(request, headers);
    test.skip(!machineId, 'No LIS machine configured in this environment');

    const runs = await request.get(`${BASE_URL}/api/lab-machines/${machineId}/runs`, { headers });
    expect(runs.status()).toBe(200);
    const runsBody = await runs.json() as any;
    expect(Array.isArray(runsBody.data)).toBe(true);
    expect(runsBody.summary).toBeTruthy();

    const logs = await request.get(`${BASE_URL}/api/lab-machines/${machineId}/logs`, { headers });
    expect(logs.status()).toBe(200);
    const logsBody = await logs.json() as any;
    expect(Array.isArray(logsBody.data)).toBe(true);

    const config = await request.get(`${BASE_URL}/api/lab-machines/${machineId}/middleware-config`, { headers });
    expect(config.status()).toBe(200);
    const configBody = await config.json() as any;
    const serialized = JSON.stringify(configBody);
    expect(serialized).toContain('[REDACTED_SECRET]');
    expect(serialized).not.toContain('LIS_BRIDGE_API_KEY=');
  });
});
