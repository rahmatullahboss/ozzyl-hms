import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  captureReportingRouteEvidence,
  parseReportingRouteCaptureArgs,
  type ReportingRouteCaptureFetch,
} from '../../scripts/canonical/capture-reporting-route-evidence';

const CANDIDATE_ID = '5c7c39cb-4525-4f61-8692-57c109e0964f';
const PREVIOUS_ID = '578a5a24-bf53-4ab3-8538-5897dc9b4fe9';
const SCRIPT_ETAG = '6d1b65e0f21c669da75b6c4a2277dd5b237d4a466336e2f530e5acd853fb02e7';
const REDACTED_CREDENTIAL = '[REDACTED_SECRET]';

function bodyForPath(path: string): { status: number; body: unknown } {
  if (path.startsWith('/api/dashboard/kpi-summary')) {
    return {
      status: 200,
      body: {
        metrics: [{ metric: 'visits', total: 0, valueType: 'count' }],
        period: {},
      },
    };
  }
  if (path.startsWith('/api/dashboard/doctor-performance/details')) {
    return {
      status: 200,
      body: { doctorId: null, hasNextPage: false, page: 1, pageSize: 25, period: {}, rows: [], tab: 'visits', totalRows: 0 },
    };
  }
  if (path.startsWith('/api/dashboard/doctor-performance')) {
    return {
      status: 200,
      body: { hasNextPage: false, page: 1, pageSize: 25, period: {}, rows: [], totalRows: 0 },
    };
  }
  if (/^\/api\/dashboard\/test-performance\/-1\/details/.test(path)) {
    return {
      status: 200,
      body: { hasNextPage: false, page: 1, pageSize: 25, period: {}, rows: [], testId: -1, totalRows: 0 },
    };
  }
  if (path.startsWith('/api/dashboard/test-performance')) {
    return {
      status: 200,
      body: { hasNextPage: false, page: 1, pageSize: 25, period: {}, rows: [], totalRows: 0 },
    };
  }
  if (path.startsWith('/api/reports/daily-collection')) {
    return {
      status: 200,
      body: { date: '2026-07-18', payment_methods: [], summary: {} },
    };
  }
  if (path.startsWith('/api/ipd-reports/revenue')) {
    return { status: 200, body: { by_type: [], by_ward: [], daily: [], total_revenue: 0 } };
  }
  if (path.startsWith('/api/canonical-reporting/')) {
    return { status: 404, body: { error: 'Not found' } };
  }
  throw new Error(`Unexpected path: ${path}`);
}

function createFetch(seen: Array<{ url: string; headers: Headers }>): ReportingRouteCaptureFetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({ url: url.toString(), headers });
    const result = bodyForPath(`${url.pathname}${url.search}`);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('CDB-101 reporting route capture', () => {
  it('captures twelve authenticated GET probes, normalizes them, and deletes raw bodies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb101-route-capture-'));
    const seen: Array<{ url: string; headers: Headers }> = [];
    const receipt = await captureReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: root,
      outputFile: 'normalized-route-evidence.json',
      baseUrl: 'https://hms.example.test',
      bearerToken: REDACTED_CREDENTIAL,
      tenantSlug: 'demo-hospital',
      tenantScope: '100',
      role: 'hospital_admin',
      activeWorkerVersionId: CANDIDATE_ID,
      previousWorkerVersionId: PREVIOUS_ID,
      scriptEtagSha256: SCRIPT_ETAG,
      capturedAtUtc: '2026-07-18T02:30:00.000Z',
      fetchImpl: createFetch(seen),
    });

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      evidenceCreated: true,
      observationCount: 12,
      rawProbeCount: 12,
      rawProbeFilesRetained: false,
      credentialsRetained: false,
      requestMethod: 'GET',
      networkRequestPerformed: true,
      productionMutationPerformed: false,
    });
    expect(seen).toHaveLength(12);
    expect(seen.every((item) => item.headers.get('authorization') === `Bearer ${REDACTED_CREDENTIAL}`))
      .toBe(true);
    expect(seen.every((item) => item.headers.get('x-tenant-slug') === 'demo-hospital'))
      .toBe(true);
    expect(seen.every((item) => item.headers.get('cloudflare-workers-version-overrides')
      === `hms-saas-production="${CANDIDATE_ID}"`)).toBe(true);
    expect(seen.some((item) => item.url.includes('/test-performance/-1/details'))).toBe(true);
    expect(seen.some((item) => item.url.includes('doctorId=unassigned'))).toBe(true);
    expect(seen.some((item) => new URL(item.url).pathname === '/api/reports/daily-collection'))
      .toBe(true);

    const outputPath = join(root, 'normalized-route-evidence.json');
    expect(existsSync(outputPath)).toBe(true);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    const stored = readFileSync(outputPath, 'utf8');
    expect(stored).not.toContain(REDACTED_CREDENTIAL);
    expect(stored).not.toContain('demo-hospital');
    expect(readdirSync(root)).toEqual(['normalized-route-evidence.json']);
  });

  it('fails closed and removes raw files on a non-approved status', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb101-route-capture-fail-'));
    const fetchImpl: ReportingRouteCaptureFetch = async () => new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    );

    await expect(captureReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: root,
      outputFile: 'normalized-route-evidence.json',
      baseUrl: 'https://hms.example.test',
      bearerToken: REDACTED_CREDENTIAL,
      tenantSlug: 'demo-hospital',
      tenantScope: '100',
      role: 'hospital_admin',
      activeWorkerVersionId: CANDIDATE_ID,
      previousWorkerVersionId: PREVIOUS_ID,
      scriptEtagSha256: SCRIPT_ETAG,
      fetchImpl,
    })).rejects.toThrow(/status/i);

    expect(readdirSync(root)).toEqual([]);
  });

  it('removes all raw files when normalization fails after successful requests', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb101-route-capture-shape-fail-'));
    const fetchImpl: ReportingRouteCaptureFetch = async (input) => {
      const url = new URL(String(input));
      const canonical = url.pathname.startsWith('/api/canonical-reporting/');
      return new Response(JSON.stringify({ unexpected: true }), {
        status: canonical ? 404 : 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await expect(captureReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: root,
      outputFile: 'normalized-route-evidence.json',
      baseUrl: 'https://hms.example.test',
      bearerToken: REDACTED_CREDENTIAL,
      tenantSlug: 'demo-hospital',
      tenantScope: '100',
      role: 'hospital_admin',
      activeWorkerVersionId: CANDIDATE_ID,
      previousWorkerVersionId: PREVIOUS_ID,
      scriptEtagSha256: SCRIPT_ETAG,
      fetchImpl,
    })).rejects.toThrow(/fingerprint validation failed/i);

    expect(readdirSync(root)).toEqual([]);
  });

  it('requires credentials from environment rather than CLI arguments', () => {
    expect(() => parseReportingRouteCaptureArgs(['--credential', REDACTED_CREDENTIAL]))
      .toThrow(/unknown argument/i);
    expect(() => parseReportingRouteCaptureArgs([
      '--protected-root', '/tmp/protected',
      '--output', 'evidence.json',
      '--candidate-version', CANDIDATE_ID,
      '--previous-version', PREVIOUS_ID,
      '--script-etag', SCRIPT_ETAG,
    ])).not.toThrow();
  });
});
