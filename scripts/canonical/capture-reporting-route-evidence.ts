import {
  chmodSync,
  existsSync,
  lstatSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  generateProtectedReportingRouteEvidence,
  type ProtectedReportingRouteManifest,
  type ReportingRouteEvidenceNormalizationReceipt,
} from './normalize-reporting-route-evidence';
import {
  REPORTING_ROUTE_REGISTRY,
  collectReportingRouteRepositoryEvidence,
} from './reporting-route-fingerprint';

const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_BASE_URL = 'https://hms.ozzyl.com';
const DEFAULT_ROLE = 'hospital_admin';
const DEFAULT_TENANT_SCOPE = '100';
const PRODUCTION_WORKER_NAME = 'hms-saas-production';

export type ReportingRouteCaptureFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface CaptureReportingRouteEvidenceOptions {
  repositoryRoot: string;
  protectedRoot: string;
  outputFile: string;
  baseUrl: string;
  bearerToken: string;
  tenantSlug: string;
  tenantScope: string;
  role: string;
  activeWorkerVersionId: string;
  previousWorkerVersionId: string;
  scriptEtagSha256: string;
  capturedAtUtc?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  fetchImpl?: ReportingRouteCaptureFetch;
}

export interface ReportingRouteCaptureCliOptions {
  protectedRoot: string;
  outputFile: string;
  activeWorkerVersionId: string;
  previousWorkerVersionId: string;
  scriptEtagSha256: string;
  baseUrl?: string;
  tenantScope?: string;
  role?: string;
}

export interface ReportingRouteCaptureReceipt {
  schemaVersion: 1;
  evidenceCreated: true;
  evidenceSha256: string;
  observationCount: 12;
  totalShapePathCount: number;
  rawProbeCount: 12;
  rawProbeFilesRetained: false;
  credentialsRetained: false;
  requestMethod: 'GET';
  networkRequestPerformed: true;
  productionMutationPerformed: false;
  aggregateOnly: true;
}

interface CapturedProbe {
  routeId: string;
  body: unknown;
  status: number;
  latencyMs: number;
  errorClass: string | null;
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel.length > 0 && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

function assertProtectedRoot(repositoryRoot: string, protectedRoot: string): string {
  const repository = resolve(repositoryRoot);
  const root = resolve(protectedRoot);
  if (!isPathInside(repository, root) && root !== repository) {
    // Expected: protected root is outside the repository.
  } else {
    throw new Error('Protected route capture root must remain outside the repository');
  }
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
    throw new Error('Protected route capture root must be a mode-700 directory');
  }
  return root;
}

function assertRelativeOutput(value: string): void {
  if (!value || isAbsolute(value) || value.includes('\0')) {
    throw new Error('Route evidence output must be a safe relative path');
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('Route evidence output must remain inside the protected root');
  }
}

function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
}

function assertSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be SHA-256`);
}

function absoluteUtc(value: string, label: string): string {
  if (!value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an absolute UTC timestamp`);
  }
  return new Date(value).toISOString();
}

function safeIdentifier(value: string, label: string): void {
  if (!/^[a-z][a-z0-9_:-]{0,63}$/.test(value)) throw new Error(`${label} is invalid`);
}

function routeRequestPath(routeId: string): string {
  const paths: Record<string, string> = {
    dashboard_kpi_summary: '/api/dashboard/kpi-summary?preset=today',
    dashboard_doctor_performance: '/api/dashboard/doctor-performance?preset=today&page=1&pageSize=25',
    dashboard_doctor_performance_details:
      '/api/dashboard/doctor-performance/details?preset=today&doctorId=unassigned&tab=visits&page=1&pageSize=25',
    dashboard_test_performance: '/api/dashboard/test-performance?preset=today&page=1&pageSize=25',
    dashboard_test_performance_details:
      '/api/dashboard/test-performance/-1/details?preset=today&page=1&pageSize=25',
    daily_collection: '/api/reports/daily-collection',
    ipd_revenue: '/api/ipd-reports/revenue',
    canonical_reporting_status: '/api/canonical-reporting/status',
    canonical_doctor_performance: '/api/canonical-reporting/doctor-performance',
    canonical_test_performance: '/api/canonical-reporting/test-performance',
    canonical_collections: '/api/canonical-reporting/collections',
    canonical_ipd_finance: '/api/canonical-reporting/ipd-finance',
  };
  const path = paths[routeId];
  if (!path) throw new Error(`No capture path is registered for ${routeId}`);
  return path;
}

function writeProtectedJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

async function captureProbe(
  routeId: string,
  allowedStatuses: readonly number[],
  options: CaptureReportingRouteEvidenceOptions,
  fetchImpl: ReportingRouteCaptureFetch,
): Promise<CapturedProbe> {
  const requestUrl = new URL(routeRequestPath(routeId), options.baseUrl);
  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${options.bearerToken}`,
    'Cloudflare-Workers-Version-Overrides':
      `${PRODUCTION_WORKER_NAME}="${options.activeWorkerVersionId}"`,
    'X-Tenant-Slug': options.tenantSlug,
  });
  if (options.cfAccessClientId && options.cfAccessClientSecret) {
    headers.set('CF-Access-Client-Id', options.cfAccessClientId);
    headers.set('CF-Access-Client-Secret', options.cfAccessClientSecret);
  }

  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetchImpl(requestUrl, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(`Route ${routeId} request failed`);
  }
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
  if (!allowedStatuses.includes(response.status)) {
    throw new Error(`Route ${routeId} returned an unapproved status`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`Route ${routeId} did not return JSON`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error(`Route ${routeId} response exceeded the protected size limit`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Route ${routeId} returned invalid JSON`);
  }
  return {
    routeId,
    body,
    status: response.status,
    latencyMs,
    errorClass: response.status >= 400 ? `http_${response.status}` : null,
  };
}

function aggregateReceipt(
  normalized: ReportingRouteEvidenceNormalizationReceipt,
): ReportingRouteCaptureReceipt {
  return {
    schemaVersion: 1,
    evidenceCreated: true,
    evidenceSha256: normalized.evidenceSha256,
    observationCount: 12,
    totalShapePathCount: normalized.totalShapePathCount,
    rawProbeCount: 12,
    rawProbeFilesRetained: false,
    credentialsRetained: false,
    requestMethod: 'GET',
    networkRequestPerformed: true,
    productionMutationPerformed: false,
    aggregateOnly: true,
  };
}

export async function captureReportingRouteEvidence(
  options: CaptureReportingRouteEvidenceOptions,
): Promise<ReportingRouteCaptureReceipt> {
  if (!options.bearerToken.trim()) throw new Error('Authenticated route capture credential is required');
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(options.tenantSlug)) {
    throw new Error('Tenant slug is invalid');
  }
  if (options.tenantScope !== '100') throw new Error('Tenant scope must be exactly 100');
  safeIdentifier(options.role, 'Role');
  assertUuid(options.activeWorkerVersionId, 'Candidate Worker version');
  assertUuid(options.previousWorkerVersionId, 'Previous Worker version');
  if (options.activeWorkerVersionId === options.previousWorkerVersionId) {
    throw new Error('Candidate and previous Worker versions must be distinct');
  }
  assertSha256(options.scriptEtagSha256, 'Candidate script ETag');
  assertRelativeOutput(options.outputFile);
  const capturedAtUtc = absoluteUtc(
    options.capturedAtUtc ?? new Date().toISOString(),
    'Capture time',
  );
  const root = assertProtectedRoot(options.repositoryRoot, options.protectedRoot);
  const outputPath = resolve(root, options.outputFile);
  if (!isPathInside(root, outputPath) || existsSync(outputPath)) {
    throw new Error('Protected route evidence output is unsafe or already exists');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const rawFiles: string[] = [];
  const manifestFile = resolve(root, 'route-probe-manifest.json');
  if (existsSync(manifestFile)) throw new Error('Protected route probe manifest already exists');

  try {
    const probes: CapturedProbe[] = [];
    for (const route of REPORTING_ROUTE_REGISTRY) {
      probes.push(await captureProbe(route.id, route.allowedStatuses, options, fetchImpl));
    }

    const manifest: ProtectedReportingRouteManifest = {
      schemaVersion: 1,
      workerName: PRODUCTION_WORKER_NAME,
      activeWorkerVersionId: options.activeWorkerVersionId,
      previousWorkerVersionId: options.previousWorkerVersionId,
      scriptEtagSha256: options.scriptEtagSha256,
      capturedAtUtc,
      routePatterns: [...collectReportingRouteRepositoryEvidence({
        rootDir: options.repositoryRoot,
      }).routePatterns],
      probes: probes.map((probe) => {
        const bodyFile = `${probe.routeId}.json`;
        const bodyPath = resolve(root, bodyFile);
        if (!isPathInside(root, bodyPath) || existsSync(bodyPath)) {
          throw new Error('Protected route body output is unsafe or already exists');
        }
        writeProtectedJson(bodyPath, probe.body);
        rawFiles.push(bodyPath);
        return {
          routeId: probe.routeId,
          bodyFile,
          tenantScope: options.tenantScope,
          role: options.role,
          status: probe.status,
          latencyMs: probe.latencyMs,
          errorClass: probe.errorClass,
        };
      }),
    };
    writeProtectedJson(manifestFile, manifest);
    rawFiles.push(manifestFile);

    const normalized = generateProtectedReportingRouteEvidence({
      repositoryRoot: options.repositoryRoot,
      protectedRoot: root,
      manifestPath: 'route-probe-manifest.json',
      outputPath: options.outputFile,
    });
    return aggregateReceipt(normalized);
  } finally {
    for (const path of rawFiles) rmSync(path, { force: true });
  }
}

export function parseReportingRouteCaptureArgs(
  args: string[],
): ReportingRouteCaptureCliOptions {
  const map: Record<string, keyof ReportingRouteCaptureCliOptions> = {
    '--protected-root': 'protectedRoot',
    '--output': 'outputFile',
    '--candidate-version': 'activeWorkerVersionId',
    '--previous-version': 'previousWorkerVersionId',
    '--script-etag': 'scriptEtagSha256',
    '--base-url': 'baseUrl',
    '--tenant-scope': 'tenantScope',
    '--role': 'role',
  };
  const values: Partial<ReportingRouteCaptureCliOptions> = {};
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    const key = map[arg];
    if (!key) throw new Error(`Unknown argument: ${arg}`);
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values[key] = value;
    seen.add(arg);
    index += 1;
  }
  for (const required of [
    'protectedRoot',
    'outputFile',
    'activeWorkerVersionId',
    'previousWorkerVersionId',
    'scriptEtagSha256',
  ] as const) {
    if (!values[required]) throw new Error(`${required} is required`);
  }
  return values as ReportingRouteCaptureCliOptions;
}

async function main(): Promise<void> {
  try {
    const cli = parseReportingRouteCaptureArgs(process.argv.slice(2));
    const bearerToken = process.env.CDB101_ROUTE_BEARER_TOKEN ?? '';
    const tenantSlug = process.env.CDB101_ROUTE_TENANT_SLUG ?? '';
    const receipt = await captureReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: cli.protectedRoot,
      outputFile: cli.outputFile,
      baseUrl: cli.baseUrl ?? process.env.CDB101_ROUTE_BASE_URL ?? DEFAULT_BASE_URL,
      bearerToken,
      tenantSlug,
      tenantScope: cli.tenantScope ?? DEFAULT_TENANT_SCOPE,
      role: cli.role ?? DEFAULT_ROLE,
      activeWorkerVersionId: cli.activeWorkerVersionId,
      previousWorkerVersionId: cli.previousWorkerVersionId,
      scriptEtagSha256: cli.scriptEtagSha256,
      cfAccessClientId: process.env.CF_ACCESS_CLIENT_ID,
      cfAccessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 authenticated route capture failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
