import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type ReportingRouteClassification = 'legacy_active' | 'canonical_canary';

export interface ReportingRouteContract {
  id: string;
  classification: ReportingRouteClassification;
  method: 'GET';
  pathTemplate: string;
  mountPrefix: string;
  handlerFile: string;
  handlerMarker: string;
  guardContract: string;
  permissionPrefix: string | null;
  expectedShapePaths: readonly string[];
  allowedStatuses: readonly number[];
}

export type ReportingRouteIssueCode =
  | 'CDB101_ROUTE_REGISTRY_INVALID'
  | 'CDB101_ROUTE_MOUNT_MISSING'
  | 'CDB101_ROUTE_HANDLER_MARKER_MISSING'
  | 'CDB101_ROUTE_PERMISSION_MISSING'
  | 'CDB101_ROUTE_PATTERN_MISMATCH'
  | 'CDB101_WORKER_VERSION_MISSING'
  | 'CDB101_LIVE_ROUTE_OBSERVATION_MISSING'
  | 'CDB101_LIVE_ROUTE_OBSERVATION_DUPLICATE'
  | 'CDB101_LIVE_ROUTE_STATUS_INVALID'
  | 'CDB101_LIVE_ROUTE_SHAPE_MISSING'
  | 'CDB101_LEGACY_ROUTE_CANONICALIZED'
  | 'CDB101_CANONICAL_ROUTE_NOT_SEPARATE'
  | 'CDB101_ACTIVE_ROUTE_SWITCHED'
  | 'CDB101_ROUTE_EVIDENCE_SENSITIVE'
  | 'CDB101_ROUTE_EVIDENCE_INVALID';

export interface ReportingRouteIssue {
  code: ReportingRouteIssueCode;
  gate: 'repository' | 'live';
  severity: 'blocker';
  summary: string;
}

export interface ReportingRouteRepositoryEvidence {
  schemaVersion: 1;
  gitCommit: string;
  workerName: string;
  routePatterns: string[];
  runWorkerFirst: string[];
  routeCount: number;
  legacyRouteCount: number;
  canonicalRouteCount: number;
  fileHashes: Record<string, string>;
  registrySha256: string;
  issues: ReportingRouteIssue[];
}

export interface ReportingRouteObservation {
  routeId: string;
  method: 'GET';
  resolvedPath: string | null;
  tenantScope: string | null;
  role: string | null;
  status: number | null;
  normalizedShapePaths: string[];
  normalizedShapeSha256: string | null;
  canonicalHandlerObserved: boolean | null;
  activeRouteSwitched: boolean | null;
  latencyMs: number | null;
  errorClass: string | null;
  responseValuesRetained: boolean;
  secretHeadersRetained: boolean;
}

export interface ReportingRouteLiveEvidence {
  schemaVersion: 1;
  workerName: string;
  activeWorkerVersionId: string | null;
  previousWorkerVersionId: string | null;
  scriptEtagSha256: string | null;
  capturedAtUtc: string | null;
  routePatterns: string[];
  observations: ReportingRouteObservation[];
}

export interface ReportingRouteFingerprintInput {
  repository: ReportingRouteRepositoryEvidence;
  live: ReportingRouteLiveEvidence | null;
}

export interface ReportingRouteFingerprintResult {
  schemaVersion: 1;
  repositoryReady: boolean;
  liveEvidenceReady: boolean;
  activeRoutesUnchanged: boolean;
  routeFingerprintSha256: string | null;
  evidenceId: string | null;
  issueCount: number;
  issues: ReportingRouteIssue[];
  routeCount: number;
  legacyRouteCount: number;
  canonicalRouteCount: number;
  aggregateOnly: true;
  productionMutationPerformed: false;
}

export interface ReportingRouteFingerprintCliOptions {
  mode: 'repository-only' | 'evidence';
  evidencePath: string | null;
}

export const EXPECTED_PRODUCTION_ROUTE_PATTERNS = Object.freeze([
  '*.ozzyl.com/*',
  'admin.ozzyl.com/*',
  'app.ozzyl.com/*',
  'hms.ozzyl.com/*',
] as const);

export const EXPECTED_RUN_WORKER_FIRST = Object.freeze([
  '/api/*',
  '/patient/*',
  '/site',
  '/site/*',
] as const);

export const REPORTING_ROUTE_REGISTRY: readonly ReportingRouteContract[] = Object.freeze([
  {
    id: 'dashboard_kpi_summary',
    classification: 'legacy_active',
    method: 'GET',
    pathTemplate: '/api/dashboard/kpi-summary',
    mountPrefix: '/api/dashboard',
    handlerFile: 'src/routes/tenant/dashboard.ts',
    handlerMarker: "dashboardRoutes.get('/kpi-summary', adminGuard,",
    guardContract: 'adminGuard',
    permissionPrefix: null,
    expectedShapePaths: ['metrics[]', 'metrics[].metric', 'metrics[].total', 'metrics[].valueType', 'period'],
    allowedStatuses: [200],
  },
  {
    id: 'dashboard_doctor_performance',
    classification: 'legacy_active',
    method: 'GET',
    pathTemplate: '/api/dashboard/doctor-performance',
    mountPrefix: '/api/dashboard',
    handlerFile: 'src/routes/tenant/dashboard.ts',
    handlerMarker: "dashboardRoutes.get('/doctor-performance', adminGuard,",
    guardContract: 'adminGuard',
    permissionPrefix: null,
    expectedShapePaths: ['hasNextPage', 'page', 'pageSize', 'period', 'rows[]', 'totalRows'],
    allowedStatuses: [200],
  },
  {
    id: 'dashboard_doctor_performance_details',
    classification: 'legacy_active',
    method: 'GET',
    pathTemplate: '/api/dashboard/doctor-performance/details',
    mountPrefix: '/api/dashboard',
    handlerFile: 'src/routes/tenant/dashboard.ts',
    handlerMarker: "dashboardRoutes.get('/doctor-performance/details', adminGuard,",
    guardContract: 'adminGuard',
    permissionPrefix: null,
    expectedShapePaths: ['doctorId', 'hasNextPage', 'page', 'pageSize', 'period', 'rows[]', 'tab', 'totalRows'],
    allowedStatuses: [200],
  },
  {
    id: 'dashboard_test_performance',
    classification: 'legacy_active',
    method: 'GET',
    pathTemplate: '/api/dashboard/test-performance',
    mountPrefix: '/api/dashboard',
    handlerFile: 'src/routes/tenant/dashboard.ts',
    handlerMarker: "dashboardRoutes.get('/test-performance', adminGuard,",
    guardContract: 'adminGuard',
    permissionPrefix: null,
    expectedShapePaths: ['hasNextPage', 'page', 'pageSize', 'period', 'rows[]', 'totalRows'],
    allowedStatuses: [200],
  },
  {
    id: 'dashboard_test_performance_details',
    classification: 'legacy_active',
    method: 'GET',
    pathTemplate: '/api/dashboard/test-performance/:testId/details',
    mountPrefix: '/api/dashboard',
    handlerFile: 'src/routes/tenant/dashboard.ts',
    handlerMarker: "dashboardRoutes.get('/test-performance/:testId/details', adminGuard,",
    guardContract: 'adminGuard',
    permissionPrefix: null,
    expectedShapePaths: ['hasNextPage', 'page', 'pageSize', 'period', 'rows[]', 'testId', 'totalRows'],
    allowedStatuses: [200],
  },
  {
    id: 'daily_collection',
    classification: 'legacy_active',
    method: 'GET',
    pathTemplate: '/api/reports/daily-collection',
    mountPrefix: '/api/reports/daily-collection',
    handlerFile: 'src/routes/tenant/dailyCollection.ts',
    handlerMarker: "dailyCollectionRoutes.get('/', async (c) => {",
    guardContract: 'daily-collection-role-scope',
    permissionPrefix: null,
    expectedShapePaths: ['date', 'payment_methods[]', 'summary'],
    allowedStatuses: [200],
  },
  {
    id: 'ipd_revenue',
    classification: 'legacy_active',
    method: 'GET',
    pathTemplate: '/api/ipd-reports/revenue',
    mountPrefix: '/api/ipd-reports',
    handlerFile: 'src/routes/tenant/ipdReports.ts',
    handlerMarker: "app.get('/revenue', async (c) => {",
    guardContract: 'ipd-report-role-scope',
    permissionPrefix: '/api/ipd-reports',
    expectedShapePaths: ['by_type[]', 'by_ward[]', 'daily[]', 'total_revenue'],
    allowedStatuses: [200],
  },
  {
    id: 'canonical_reporting_status',
    classification: 'canonical_canary',
    method: 'GET',
    pathTemplate: '/api/canonical-reporting/status',
    mountPrefix: '/api/canonical-reporting',
    handlerFile: 'src/routes/tenant/canonicalReporting.ts',
    handlerMarker: "canonicalReporting.get('/status', async (c) => {",
    guardContract: 'requireRole:hospital_admin,md,director,manager,accountant',
    permissionPrefix: '/api/canonical-reporting',
    expectedShapePaths: ['canonical', 'data.activeRouteSwitched', 'data.metricCount', 'data.mode', 'data.readOnly'],
    allowedStatuses: [200, 404],
  },
  {
    id: 'canonical_doctor_performance',
    classification: 'canonical_canary',
    method: 'GET',
    pathTemplate: '/api/canonical-reporting/doctor-performance',
    mountPrefix: '/api/canonical-reporting',
    handlerFile: 'src/routes/tenant/canonicalReporting.ts',
    handlerMarker: "canonicalReporting.get('/doctor-performance', async (c) => {",
    guardContract: 'requireRole:hospital_admin,md,director,manager,accountant',
    permissionPrefix: '/api/canonical-reporting',
    expectedShapePaths: ['activeRouteSwitched', 'canonical', 'data', 'mode', 'readOnly'],
    allowedStatuses: [200, 404],
  },
  {
    id: 'canonical_test_performance',
    classification: 'canonical_canary',
    method: 'GET',
    pathTemplate: '/api/canonical-reporting/test-performance',
    mountPrefix: '/api/canonical-reporting',
    handlerFile: 'src/routes/tenant/canonicalReporting.ts',
    handlerMarker: "canonicalReporting.get('/test-performance', async (c) => {",
    guardContract: 'requireRole:hospital_admin,md,director,manager,accountant',
    permissionPrefix: '/api/canonical-reporting',
    expectedShapePaths: ['activeRouteSwitched', 'canonical', 'data', 'mode', 'readOnly'],
    allowedStatuses: [200, 404],
  },
  {
    id: 'canonical_collections',
    classification: 'canonical_canary',
    method: 'GET',
    pathTemplate: '/api/canonical-reporting/collections',
    mountPrefix: '/api/canonical-reporting',
    handlerFile: 'src/routes/tenant/canonicalReporting.ts',
    handlerMarker: "canonicalReporting.get('/collections', async (c) => {",
    guardContract: 'requireRole:hospital_admin,md,director,manager,accountant',
    permissionPrefix: '/api/canonical-reporting',
    expectedShapePaths: ['activeRouteSwitched', 'canonical', 'data', 'mode', 'readOnly'],
    allowedStatuses: [200, 404],
  },
  {
    id: 'canonical_ipd_finance',
    classification: 'canonical_canary',
    method: 'GET',
    pathTemplate: '/api/canonical-reporting/ipd-finance',
    mountPrefix: '/api/canonical-reporting',
    handlerFile: 'src/routes/tenant/canonicalReporting.ts',
    handlerMarker: "canonicalReporting.get('/ipd-finance', async (c) => {",
    guardContract: 'requireRole:hospital_admin,md,director,manager,accountant',
    permissionPrefix: '/api/canonical-reporting',
    expectedShapePaths: ['activeRouteSwitched', 'canonical', 'data', 'mode', 'readOnly'],
    allowedStatuses: [200, 404],
  },
]);

const MOUNT_MARKERS: Readonly<Record<string, string>> = Object.freeze({
  '/api/dashboard': "app.route('/api/dashboard', dashboardRoutes);",
  '/api/reports/daily-collection': "app.route('/api/reports/daily-collection', dailyCollectionRoutes);",
  '/api/ipd-reports': "app.route('/api/ipd-reports', ipdReportRoutes);",
  '/api/canonical-reporting': "app.route('/api/canonical-reporting', canonicalReportingRoutes);",
});

const GUARD_MARKERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  adminGuard: ['const adminGuard = requireRole(...ADMIN_DASHBOARD_ROLES);'],
  'daily-collection-role-scope': ["dailyCollectionRoutes.use('*', requireRole(...REPORT_ROLES));"],
  'ipd-report-role-scope': ["app.use('*', async (c, next) => {", 'REPORT_ROLES.includes'],
  'requireRole:hospital_admin,md,director,manager,accountant': [
    "canonicalReporting.use('*', requireRole(...REPORTING_ROLES));",
  ],
});

const TOP_LEVEL_LIVE_KEYS = new Set([
  'schemaVersion',
  'workerName',
  'activeWorkerVersionId',
  'previousWorkerVersionId',
  'scriptEtagSha256',
  'capturedAtUtc',
  'routePatterns',
  'observations',
]);

const OBSERVATION_KEYS = new Set([
  'routeId',
  'method',
  'resolvedPath',
  'tenantScope',
  'role',
  'status',
  'normalizedShapePaths',
  'normalizedShapeSha256',
  'canonicalHandlerObserved',
  'activeRouteSwitched',
  'latencyMs',
  'errorClass',
  'responseValuesRetained',
  'secretHeadersRetained',
]);

const SENSITIVE_EXTRA_KEYS = new Set([
  'authorization',
  'authorizationheader',
  'cookie',
  'cookies',
  'rawbody',
  'responsebody',
  'patientname',
  'practitionername',
  'signedurl',
  'token',
  'accesstoken',
  'refreshtoken',
  'userid',
  'useridentity',
  'headers',
]);

function normalizeCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeCanonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeCanonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalValue(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function issue(
  code: ReportingRouteIssueCode,
  gate: ReportingRouteIssue['gate'],
  summary: string,
): ReportingRouteIssue {
  return { code, gate, severity: 'blocker', summary };
}

function uniqueIssues(issues: ReportingRouteIssue[]): ReportingRouteIssue[] {
  const seen = new Set<string>();
  return issues.filter((item) => {
    const key = `${item.code}:${item.gate}:${item.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function requiredRepositoryFilePaths(): string[] {
  return sortedUniqueStrings([
    'wrangler.toml',
    'src/index.ts',
    'src/lib/route-permissions.ts',
    ...REPORTING_ROUTE_REGISTRY.map((route) => route.handlerFile),
  ]);
}

function exactStringArray(values: readonly string[], expected: readonly string[]): boolean {
  return values.length === expected.length && values.every((value, index) => value === expected[index]);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function isCommit(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isAbsoluteUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !value.endsWith('Z')) return false;
  return Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function registryIssues(): ReportingRouteIssue[] {
  const issues: ReportingRouteIssue[] = [];
  const ids = REPORTING_ROUTE_REGISTRY.map((route) => route.id);
  if (new Set(ids).size !== ids.length) {
    issues.push(issue('CDB101_ROUTE_REGISTRY_INVALID', 'repository', 'Reporting route IDs must be unique.'));
  }
  if (REPORTING_ROUTE_REGISTRY.some((route) => (
    route.classification === 'legacy_active'
    && route.pathTemplate.startsWith('/api/canonical-reporting')
  ))) {
    issues.push(issue(
      'CDB101_CANONICAL_ROUTE_NOT_SEPARATE',
      'repository',
      'A legacy route is registered under the canonical reporting prefix.',
    ));
  }
  for (const route of REPORTING_ROUTE_REGISTRY) {
    if (!MOUNT_MARKERS[route.mountPrefix] || !GUARD_MARKERS[route.guardContract]) {
      issues.push(issue(
        'CDB101_ROUTE_REGISTRY_INVALID',
        'repository',
        `Route ${route.id} references an unknown mount or guard contract.`,
      ));
    }
  }
  return issues;
}

function extractTomlSection(source: string, sectionName: string): string {
  const marker = `[${sectionName}]`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const contentStart = start + marker.length;
  const remaining = source.slice(contentStart);
  const nextSection = remaining.search(/\n\s*\[[^\]]+\]/);
  return nextSection < 0 ? remaining : remaining.slice(0, nextSection);
}

function parseProductionRoutePatterns(wranglerSource: string): string[] {
  const production = extractTomlSection(wranglerSource, 'env.production');
  const routesMatch = /routes\s*=\s*\[([\s\S]*?)\]/m.exec(production);
  if (!routesMatch) return [];
  return sortedUniqueStrings(
    [...routesMatch[1].matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((match) => match[1]),
  );
}

function parseRunWorkerFirst(wranglerSource: string): string[] {
  const assets = extractTomlSection(wranglerSource, 'env.production.assets');
  const arrayMatch = /run_worker_first\s*=\s*\[([\s\S]*?)\]/m.exec(assets);
  if (!arrayMatch) return [];
  return sortedUniqueStrings(
    [...arrayMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]),
  );
}

function parseProductionWorkerName(wranglerSource: string): string {
  const production = extractTomlSection(wranglerSource, 'env.production');
  return /(?:^|\n)\s*name\s*=\s*"([^"]+)"/.exec(production)?.[1] ?? '';
}

function resolveGitCommit(rootDir: string, injected?: string): string {
  if (injected !== undefined) return injected;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function collectReportingRouteRepositoryEvidence(options: {
  rootDir: string;
  gitCommit?: string;
}): ReportingRouteRepositoryEvidence {
  const rootDir = resolve(options.rootDir);
  const issues = registryIssues();
  const fileHashes: Record<string, string> = {};
  const sources = new Map<string, string>();
  const filePaths = requiredRepositoryFilePaths();

  for (const path of filePaths) {
    const absolutePath = resolve(rootDir, path);
    if (!existsSync(absolutePath)) {
      issues.push(issue(
        'CDB101_ROUTE_REGISTRY_INVALID',
        'repository',
        `Required repository fingerprint file is missing: ${path}.`,
      ));
      continue;
    }
    const source = readFileSync(absolutePath, 'utf8');
    sources.set(path, source);
    fileHashes[path] = sha256Hex(source);
  }

  const indexSource = sources.get('src/index.ts') ?? '';
  const permissionSource = sources.get('src/lib/route-permissions.ts') ?? '';
  for (const route of REPORTING_ROUTE_REGISTRY) {
    const mountMarker = MOUNT_MARKERS[route.mountPrefix];
    if (!indexSource.includes(mountMarker)) {
      issues.push(issue(
        'CDB101_ROUTE_MOUNT_MISSING',
        'repository',
        `Registered route mount is absent for ${route.id}.`,
      ));
    }

    const handlerSource = sources.get(route.handlerFile) ?? '';
    if (!handlerSource.includes(route.handlerMarker)) {
      issues.push(issue(
        'CDB101_ROUTE_HANDLER_MARKER_MISSING',
        'repository',
        `Registered handler marker is absent for ${route.id}.`,
      ));
    }
    for (const guardMarker of GUARD_MARKERS[route.guardContract] ?? []) {
      if (!handlerSource.includes(guardMarker)) {
        issues.push(issue(
          'CDB101_ROUTE_HANDLER_MARKER_MISSING',
          'repository',
          `Registered guard contract is absent for ${route.id}.`,
        ));
      }
    }
    if (route.permissionPrefix && !permissionSource.includes(`prefix: '${route.permissionPrefix}'`)) {
      issues.push(issue(
        'CDB101_ROUTE_PERMISSION_MISSING',
        'repository',
        `Registered permission prefix is absent for ${route.id}.`,
      ));
    }
  }

  const wranglerSource = sources.get('wrangler.toml') ?? '';
  const routePatterns = parseProductionRoutePatterns(wranglerSource);
  const runWorkerFirst = parseRunWorkerFirst(wranglerSource);
  const workerName = parseProductionWorkerName(wranglerSource);
  if (
    workerName !== 'hms-saas-production'
    || !exactStringArray(routePatterns, EXPECTED_PRODUCTION_ROUTE_PATTERNS)
    || !exactStringArray(runWorkerFirst, EXPECTED_RUN_WORKER_FIRST)
  ) {
    issues.push(issue(
      'CDB101_ROUTE_PATTERN_MISMATCH',
      'repository',
      'Production Worker name, route patterns, or Worker-first paths differ from the approved contract.',
    ));
  }

  const gitCommit = resolveGitCommit(rootDir, options.gitCommit);
  if (!isCommit(gitCommit)) {
    issues.push(issue(
      'CDB101_ROUTE_REGISTRY_INVALID',
      'repository',
      'Repository evidence requires one full immutable Git commit.',
    ));
  }

  return {
    schemaVersion: 1,
    gitCommit,
    workerName,
    routePatterns,
    runWorkerFirst,
    routeCount: REPORTING_ROUTE_REGISTRY.length,
    legacyRouteCount: REPORTING_ROUTE_REGISTRY.filter((route) => route.classification === 'legacy_active').length,
    canonicalRouteCount: REPORTING_ROUTE_REGISTRY.filter((route) => route.classification === 'canonical_canary').length,
    fileHashes,
    registrySha256: sha256Hex(canonicalJson(REPORTING_ROUTE_REGISTRY)),
    issues: uniqueIssues(issues),
  };
}

function unknownKeys(value: unknown, allowed: ReadonlySet<string>): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).filter((key) => !allowed.has(key));
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_EXTRA_KEYS.has(key.replace(/[_-]/g, '').toLowerCase());
}

function containsSensitiveKeyRecursively(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveKeyRecursively);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => (
    isSensitiveKey(key) || containsSensitiveKeyRecursively(nested)
  ));
}

function validateLiveEvidence(
  repository: ReportingRouteRepositoryEvidence,
  live: ReportingRouteLiveEvidence,
): { issues: ReportingRouteIssue[]; normalized: ReportingRouteLiveEvidence | null } {
  const issues: ReportingRouteIssue[] = [];
  const topLevelExtras = unknownKeys(live, TOP_LEVEL_LIVE_KEYS);
  if (containsSensitiveKeyRecursively(live)) {
    issues.push(issue(
      'CDB101_ROUTE_EVIDENCE_SENSITIVE',
      'live',
      'Protected route evidence contains a forbidden sensitive field.',
    ));
  }
  if (topLevelExtras.some((key) => !isSensitiveKey(key))) {
    issues.push(issue(
      'CDB101_ROUTE_EVIDENCE_INVALID',
      'live',
      'Protected route evidence contains an unknown field.',
    ));
  }

  if (
    live.schemaVersion !== 1
    || live.workerName !== 'hms-saas-production'
    || !isUuid(live.activeWorkerVersionId)
    || !isUuid(live.previousWorkerVersionId)
    || live.activeWorkerVersionId === live.previousWorkerVersionId
    || !isSha256(live.scriptEtagSha256)
    || !isAbsoluteUtc(live.capturedAtUtc)
  ) {
    issues.push(issue(
      'CDB101_WORKER_VERSION_MISSING',
      'live',
      'Active and previous Worker metadata must be complete, immutable, and well formed.',
    ));
  }

  const routePatternValues = Array.isArray(live.routePatterns)
    ? live.routePatterns.filter((value): value is string => typeof value === 'string')
    : [];
  const normalizedRoutePatterns = sortedUniqueStrings(routePatternValues);
  const routePatternsAreExact = Array.isArray(live.routePatterns)
    && routePatternValues.length === live.routePatterns.length
    && exactStringArray(live.routePatterns as string[], normalizedRoutePatterns)
    && exactStringArray(normalizedRoutePatterns, repository.routePatterns);
  if (!routePatternsAreExact) {
    issues.push(issue(
      'CDB101_ROUTE_PATTERN_MISMATCH',
      'live',
      'Observed production route patterns must be sorted, unique, string-only, and equal to repository patterns.',
    ));
  }

  if (!Array.isArray(live.observations)) {
    issues.push(issue(
      'CDB101_ROUTE_EVIDENCE_INVALID',
      'live',
      'Protected route observations must be an array.',
    ));
    return { issues: uniqueIssues(issues), normalized: null };
  }

  const routeById = new Map(REPORTING_ROUTE_REGISTRY.map((route) => [route.id, route]));
  const observationsById = new Map<string, ReportingRouteObservation[]>();
  let sensitiveObservation = false;
  let invalidObservation = false;

  for (const rawObservation of live.observations as unknown[]) {
    const extras = unknownKeys(rawObservation, OBSERVATION_KEYS);
    if (extras.some(isSensitiveKey)) sensitiveObservation = true;
    if (extras.some((key) => !isSensitiveKey(key))) invalidObservation = true;
    if (!rawObservation || typeof rawObservation !== 'object' || Array.isArray(rawObservation)) {
      invalidObservation = true;
      continue;
    }
    const observation = rawObservation as ReportingRouteObservation;
    if (!isNonEmptyString(observation.routeId) || !routeById.has(observation.routeId)) {
      invalidObservation = true;
      continue;
    }
    const list = observationsById.get(observation.routeId) ?? [];
    list.push(observation);
    observationsById.set(observation.routeId, list);
  }

  if (sensitiveObservation || live.observations.some((observation) => (
    observation?.responseValuesRetained !== false || observation?.secretHeadersRetained !== false
  ))) {
    issues.push(issue(
      'CDB101_ROUTE_EVIDENCE_SENSITIVE',
      'live',
      'Protected route evidence retained response values, secret headers, or a forbidden sensitive field.',
    ));
  }
  if (invalidObservation) {
    issues.push(issue(
      'CDB101_ROUTE_EVIDENCE_INVALID',
      'live',
      'Protected route evidence contains an invalid or unexpected observation.',
    ));
  }

  const normalizedObservations: ReportingRouteObservation[] = [];
  for (const route of REPORTING_ROUTE_REGISTRY) {
    const matches = observationsById.get(route.id) ?? [];
    if (matches.length === 0) {
      issues.push(issue(
        'CDB101_LIVE_ROUTE_OBSERVATION_MISSING',
        'live',
        `Normalized live observation is missing for ${route.id}.`,
      ));
      continue;
    }
    if (matches.length > 1) {
      issues.push(issue(
        'CDB101_LIVE_ROUTE_OBSERVATION_DUPLICATE',
        'live',
        `Normalized live observation is duplicated for ${route.id}.`,
      ));
      continue;
    }

    const observation = matches[0];
    const shapePaths = Array.isArray(observation.normalizedShapePaths)
      ? observation.normalizedShapePaths.filter((value): value is string => typeof value === 'string')
      : [];
    const sortedShapePaths = sortedUniqueStrings(shapePaths);
    const shapeHash = sha256Hex(canonicalJson(sortedShapePaths));
    const shapeOrderValid = exactStringArray(shapePaths, sortedShapePaths);
    const expectedShapePresent = observation.status !== 200
      || route.expectedShapePaths.every((path) => sortedShapePaths.includes(path));

    if (
      !shapeOrderValid
      || sortedShapePaths.length === 0
      || !isSha256(observation.normalizedShapeSha256)
      || observation.normalizedShapeSha256 !== shapeHash
      || !expectedShapePresent
    ) {
      issues.push(issue(
        'CDB101_LIVE_ROUTE_SHAPE_MISSING',
        'live',
        `Normalized response shape evidence is missing or invalid for ${route.id}.`,
      ));
    }

    if (
      observation.method !== route.method
      || observation.resolvedPath !== route.pathTemplate
      || !isNonEmptyString(observation.tenantScope)
      || !/^(100|negative-control:[a-z0-9_-]+)$/.test(observation.tenantScope)
      || !isNonEmptyString(observation.role)
      || typeof observation.status !== 'number'
      || !Number.isSafeInteger(observation.status)
      || !route.allowedStatuses.includes(observation.status)
      || typeof observation.latencyMs !== 'number'
      || !Number.isSafeInteger(observation.latencyMs)
      || observation.latencyMs < 0
      || (observation.errorClass !== null && !isNonEmptyString(observation.errorClass))
    ) {
      issues.push(issue(
        'CDB101_LIVE_ROUTE_STATUS_INVALID',
        'live',
        `Method, normalized path, tenant scope, role, status, or latency is invalid for ${route.id}.`,
      ));
    }

    if (route.classification === 'legacy_active' && observation.canonicalHandlerObserved !== false) {
      issues.push(issue(
        'CDB101_LEGACY_ROUTE_CANONICALIZED',
        'live',
        `Legacy route ${route.id} was observed through a canonical handler.`,
      ));
    }
    if (
      route.classification === 'canonical_canary'
      && observation.status === 200
      && observation.canonicalHandlerObserved !== true
    ) {
      issues.push(issue(
        'CDB101_CANONICAL_ROUTE_NOT_SEPARATE',
        'live',
        `Canonical route ${route.id} was not observed through its separate handler.`,
      ));
    }
    if (observation.activeRouteSwitched === true) {
      issues.push(issue(
        'CDB101_ACTIVE_ROUTE_SWITCHED',
        'live',
        `Route observation ${route.id} reports an active route switch.`,
      ));
    }
    if (
      observation.activeRouteSwitched !== false
      && !(route.classification === 'canonical_canary' && observation.status === 404 && observation.activeRouteSwitched === null)
    ) {
      issues.push(issue(
        'CDB101_ROUTE_EVIDENCE_INVALID',
        'live',
        `Route observation ${route.id} does not explicitly preserve the active route.`,
      ));
    }

    normalizedObservations.push({
      routeId: route.id,
      method: route.method,
      resolvedPath: observation.resolvedPath,
      tenantScope: observation.tenantScope,
      role: observation.role,
      status: observation.status,
      normalizedShapePaths: sortedShapePaths,
      normalizedShapeSha256: observation.normalizedShapeSha256,
      canonicalHandlerObserved: observation.canonicalHandlerObserved,
      activeRouteSwitched: observation.activeRouteSwitched,
      latencyMs: observation.latencyMs,
      errorClass: observation.errorClass,
      responseValuesRetained: false,
      secretHeadersRetained: false,
    });
  }

  const normalized: ReportingRouteLiveEvidence = {
    schemaVersion: 1,
    workerName: live.workerName,
    activeWorkerVersionId: live.activeWorkerVersionId,
    previousWorkerVersionId: live.previousWorkerVersionId,
    scriptEtagSha256: live.scriptEtagSha256,
    capturedAtUtc: live.capturedAtUtc,
    routePatterns: normalizedRoutePatterns,
    observations: normalizedObservations,
  };
  return { issues: uniqueIssues(issues), normalized };
}

export function evaluateReportingRouteFingerprint(
  input: ReportingRouteFingerprintInput,
): ReportingRouteFingerprintResult {
  const repositoryIssues = uniqueIssues([
    ...registryIssues(),
    ...input.repository.issues,
  ]);
  const expectedLegacyCount = REPORTING_ROUTE_REGISTRY.filter((route) => route.classification === 'legacy_active').length;
  const expectedCanonicalCount = REPORTING_ROUTE_REGISTRY.filter((route) => route.classification === 'canonical_canary').length;
  if (
    input.repository.schemaVersion !== 1
    || !isCommit(input.repository.gitCommit)
    || input.repository.workerName !== 'hms-saas-production'
    || !exactStringArray(input.repository.routePatterns, EXPECTED_PRODUCTION_ROUTE_PATTERNS)
    || !exactStringArray(input.repository.runWorkerFirst, EXPECTED_RUN_WORKER_FIRST)
    || input.repository.routeCount !== REPORTING_ROUTE_REGISTRY.length
    || input.repository.legacyRouteCount !== expectedLegacyCount
    || input.repository.canonicalRouteCount !== expectedCanonicalCount
    || !isSha256(input.repository.registrySha256)
    || !exactStringArray(sortedUniqueStrings(Object.keys(input.repository.fileHashes)), requiredRepositoryFilePaths())
    || Object.values(input.repository.fileHashes).some((hash) => !isSha256(hash))
  ) {
    repositoryIssues.push(issue(
      'CDB101_ROUTE_REGISTRY_INVALID',
      'repository',
      'Repository route evidence is incomplete or differs from the approved contract.',
    ));
  }

  const repositoryReady = uniqueIssues(repositoryIssues).length === 0;
  let liveIssues: ReportingRouteIssue[] = [];
  let normalizedLive: ReportingRouteLiveEvidence | null = null;
  if (!input.live) {
    liveIssues.push(issue(
      'CDB101_WORKER_VERSION_MISSING',
      'live',
      'Normalized active Worker and route observation evidence is absent.',
    ));
  } else {
    const validation = validateLiveEvidence(input.repository, input.live);
    liveIssues = validation.issues;
    normalizedLive = validation.normalized;
  }

  const issues = uniqueIssues([...repositoryIssues, ...liveIssues]);
  const liveEvidenceReady = repositoryReady && input.live !== null && liveIssues.length === 0 && normalizedLive !== null;
  const routeFingerprintSha256 = liveEvidenceReady
    ? sha256Hex(canonicalJson({ repository: input.repository, live: normalizedLive }))
    : null;

  return {
    schemaVersion: 1,
    repositoryReady,
    liveEvidenceReady,
    activeRoutesUnchanged: liveEvidenceReady,
    routeFingerprintSha256,
    evidenceId: routeFingerprintSha256 ? `cdb101-route-${routeFingerprintSha256.slice(0, 16)}` : null,
    issueCount: issues.length,
    issues,
    routeCount: input.repository.routeCount,
    legacyRouteCount: input.repository.legacyRouteCount,
    canonicalRouteCount: input.repository.canonicalRouteCount,
    aggregateOnly: true,
    productionMutationPerformed: false,
  };
}

export function parseReportingRouteFingerprintArgs(args: string[]): ReportingRouteFingerprintCliOptions {
  let repositoryOnly = false;
  let evidencePath: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg === '--repository-only') {
      repositoryOnly = true;
      continue;
    }
    if (arg === '--evidence') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--evidence requires a protected JSON path');
      evidencePath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (Number(repositoryOnly) + Number(evidencePath !== null) !== 1) {
    throw new Error('Select exactly one mode: --repository-only or --evidence <path>');
  }
  return repositoryOnly
    ? { mode: 'repository-only', evidencePath: null }
    : { mode: 'evidence', evidencePath };
}

function main(): void {
  try {
    const options = parseReportingRouteFingerprintArgs(process.argv.slice(2));
    const repository = collectReportingRouteRepositoryEvidence({ rootDir: process.cwd() });
    let live: ReportingRouteLiveEvidence | null = null;
    if (options.mode === 'evidence') {
      if (!options.evidencePath) throw new Error('Protected evidence path is missing');
      live = JSON.parse(readFileSync(resolve(options.evidencePath), 'utf8')) as ReportingRouteLiveEvidence;
    }
    const result = evaluateReportingRouteFingerprint({ repository, live });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.repositoryReady || (options.mode === 'evidence' && !result.liveEvidenceReady)) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 route fingerprint failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
