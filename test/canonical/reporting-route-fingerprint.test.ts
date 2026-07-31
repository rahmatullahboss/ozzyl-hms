import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXPECTED_PRODUCTION_ROUTE_PATTERNS,
  EXPECTED_RUN_WORKER_FIRST,
  REPORTING_ROUTE_REGISTRY,
  canonicalJson,
  collectReportingRouteRepositoryEvidence,
  evaluateReportingRouteFingerprint,
  parseReportingRouteFingerprintArgs,
  sha256Hex,
  type ReportingRouteLiveEvidence,
  type ReportingRouteRepositoryEvidence,
} from '../../scripts/canonical/reporting-route-fingerprint';

const EXPECTED_ROUTE_IDS = [
  'dashboard_kpi_summary',
  'dashboard_doctor_performance',
  'dashboard_doctor_performance_details',
  'dashboard_test_performance',
  'dashboard_test_performance_details',
  'daily_collection',
  'ipd_revenue',
  'canonical_reporting_status',
  'canonical_doctor_performance',
  'canonical_test_performance',
  'canonical_collections',
  'canonical_ipd_finance',
] as const;

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repositoryEvidence(): ReportingRouteRepositoryEvidence {
  return {
    schemaVersion: 1,
    gitCommit: 'a'.repeat(40),
    workerName: 'hms-saas-production',
    routePatterns: [...EXPECTED_PRODUCTION_ROUTE_PATTERNS],
    runWorkerFirst: [...EXPECTED_RUN_WORKER_FIRST],
    routeCount: 12,
    legacyRouteCount: 7,
    canonicalRouteCount: 5,
    fileHashes: {
      'wrangler.toml': '1'.repeat(64),
      'src/index.ts': '2'.repeat(64),
      'src/lib/route-permissions.ts': '3'.repeat(64),
      'src/routes/tenant/canonicalReporting.ts': '4'.repeat(64),
      'src/routes/tenant/dailyCollection.ts': '5'.repeat(64),
      'src/routes/tenant/dashboard.ts': '6'.repeat(64),
      'src/routes/tenant/ipdReports.ts': '7'.repeat(64),
    },
    registrySha256: '4'.repeat(64),
    issues: [],
  };
}

function liveEvidence(repository = repositoryEvidence()): ReportingRouteLiveEvidence {
  return {
    schemaVersion: 1,
    workerName: 'hms-saas-production',
    activeWorkerVersionId: '11111111-1111-4111-8111-111111111111',
    previousWorkerVersionId: '22222222-2222-4222-8222-222222222222',
    scriptEtagSha256: '5'.repeat(64),
    capturedAtUtc: '2026-07-14T18:00:00.000Z',
    routePatterns: [...repository.routePatterns],
    observations: REPORTING_ROUTE_REGISTRY.map((route) => {
      const normalizedShapePaths = [...route.expectedShapePaths].sort();
      return {
        routeId: route.id,
        method: route.method,
        resolvedPath: route.pathTemplate,
        tenantScope: '100',
        role: 'hospital_admin',
        status: 200,
        normalizedShapePaths,
        normalizedShapeSha256: sha256Hex(canonicalJson(normalizedShapePaths)),
        canonicalHandlerObserved: route.classification === 'canonical_canary',
        activeRouteSwitched: false,
        latencyMs: 125,
        errorClass: null,
        responseValuesRetained: false,
        secretHeadersRetained: false,
      };
    }),
  };
}

function writeFixtureFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

function fixtureWrangler(options: { routePatterns?: string[]; runWorkerFirst?: string[] } = {}): string {
  const routePatterns = options.routePatterns ?? [...EXPECTED_PRODUCTION_ROUTE_PATTERNS];
  const runWorkerFirst = options.runWorkerFirst ?? [...EXPECTED_RUN_WORKER_FIRST];
  return `
name = "hms-saas"
main = "src/index.ts"

[env.production]
name = "hms-saas-production"
routes = [
${routePatterns.map((pattern) => `  { pattern = "${pattern}", zone_name = "ozzyl.com" }`).join(',\n')}
]

[env.production.assets]
run_worker_first = [${runWorkerFirst.map((pattern) => `"${pattern}"`).join(', ')}]
`;
}

function createRepositoryFixture(options: {
  indexSource?: string;
  wranglerSource?: string;
  handlerOverrides?: Record<string, string>;
  permissionsSource?: string;
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb101-route-fingerprint-'));
  temporaryRoots.push(root);

  const indexSource = options.indexSource ?? [
    "app.route('/api/dashboard', dashboardRoutes);",
    "app.route('/api/reports/daily-collection', dailyCollectionRoutes);",
    "app.route('/api/ipd-reports', ipdReportRoutes);",
    "app.route('/api/canonical-reporting', canonicalReportingRoutes);",
  ].join('\n');

  const guardMarkers: Record<string, string[]> = {
    'src/routes/tenant/dashboard.ts': ['const adminGuard = requireRole(...ADMIN_DASHBOARD_ROLES);'],
    'src/routes/tenant/dailyCollection.ts': ["dailyCollectionRoutes.use('*', requireRole(...REPORT_ROLES));"],
    'src/routes/tenant/ipdReports.ts': ["app.use('*', async (c, next) => {", 'REPORT_ROLES.includes'],
    'src/routes/tenant/canonicalReporting.ts': ["canonicalReporting.use('*', requireRole(...REPORTING_ROLES));"],
  };

  const handlerFiles = [...new Set(REPORTING_ROUTE_REGISTRY.map((route) => route.handlerFile))];
  for (const handlerFile of handlerFiles) {
    const markers = REPORTING_ROUTE_REGISTRY
      .filter((route) => route.handlerFile === handlerFile)
      .map((route) => route.handlerMarker);
    const content = options.handlerOverrides?.[handlerFile]
      ?? [...(guardMarkers[handlerFile] ?? []), ...markers].join('\n');
    writeFixtureFile(root, handlerFile, content);
  }

  writeFixtureFile(root, 'src/index.ts', indexSource);
  writeFixtureFile(
    root,
    'src/lib/route-permissions.ts',
    options.permissionsSource ?? [
      "prefix: '/api/ipd-reports',",
      "prefix: '/api/canonical-reporting',",
    ].join('\n'),
  );
  writeFixtureFile(root, 'wrangler.toml', options.wranglerSource ?? fixtureWrangler());
  return root;
}

describe('CDB-101 reporting route fingerprint', () => {
  it('matches the deployed legacy reporting response contracts', () => {
    const routes = new Map(REPORTING_ROUTE_REGISTRY.map((route) => [route.id, route]));

    expect(routes.get('dashboard_doctor_performance_details')).toMatchObject({
      expectedShapePaths: ['doctorId', 'hasNextPage', 'page', 'pageSize', 'period', 'rows[]', 'tab', 'totalRows'],
    });
    expect(routes.get('dashboard_test_performance_details')).toMatchObject({
      expectedShapePaths: ['hasNextPage', 'page', 'pageSize', 'period', 'rows[]', 'testId', 'totalRows'],
    });
    expect(routes.get('daily_collection')).toMatchObject({
      pathTemplate: '/api/reports/daily-collection',
      expectedShapePaths: ['date', 'payment_methods[]', 'summary'],
    });
    expect(routes.get('ipd_revenue')).toMatchObject({
      expectedShapePaths: ['by_type[]', 'by_ward[]', 'daily[]', 'total_revenue'],
    });
  });

  it('registers the exact legacy and canonical route inventory', () => {
    expect(REPORTING_ROUTE_REGISTRY.map((route) => route.id)).toEqual(EXPECTED_ROUTE_IDS);
    expect(REPORTING_ROUTE_REGISTRY.filter((route) => route.classification === 'legacy_active')).toHaveLength(7);
    expect(REPORTING_ROUTE_REGISTRY.filter((route) => route.classification === 'canonical_canary')).toHaveLength(5);
    expect(new Set(REPORTING_ROUTE_REGISTRY.map((route) => route.id)).size).toBe(12);
  });

  it('serializes canonical JSON with stable recursive key ordering', () => {
    const left = canonicalJson({ z: 1, a: { y: 2, x: [{ b: 2, a: 1 }] } });
    const right = canonicalJson({ a: { x: [{ a: 1, b: 2 }], y: 2 }, z: 1 });
    expect(left).toBe(right);
    expect(left).toBe('{"a":{"x":[{"a":1,"b":2}],"y":2},"z":1}');
  });

  it('keeps repository-only evidence live-incomplete and production-safe', () => {
    const result = evaluateReportingRouteFingerprint({
      repository: repositoryEvidence(),
      live: null,
    });

    expect(result).toMatchObject({
      repositoryReady: true,
      liveEvidenceReady: false,
      activeRoutesUnchanged: false,
      routeFingerprintSha256: null,
      evidenceId: null,
      aggregateOnly: true,
      productionMutationPerformed: false,
      routeCount: 12,
      legacyRouteCount: 7,
      canonicalRouteCount: 5,
    });
    expect(result.issues.map((issue) => issue.code)).toContain('CDB101_WORKER_VERSION_MISSING');
  });

  it('ships a fail-closed normalized evidence template without credential or body fields', () => {
    const templatePath = resolve(
      process.cwd(),
      'docs/database/migration-runs/production/CDB-101-reporting-route-evidence-template.json',
    );
    const raw = readFileSync(templatePath, 'utf8');
    const parsed = JSON.parse(raw) as { observations: Array<{ routeId: string }> };

    expect(parsed.observations.map((item) => item.routeId)).toEqual(EXPECTED_ROUTE_IDS);
    expect(raw).not.toMatch(/authorization|cookie|rawBody|patientName|practitionerName|signedUrl/i);
  });

  it('captures a complete repository fingerprint from the real repository', () => {
    const repository = collectReportingRouteRepositoryEvidence({
      rootDir: process.cwd(),
      gitCommit: 'a'.repeat(40),
    });
    const result = evaluateReportingRouteFingerprint({ repository, live: null });

    expect(repository.issues).toEqual([]);
    expect(repository.routePatterns).toEqual(EXPECTED_PRODUCTION_ROUTE_PATTERNS);
    expect(repository.runWorkerFirst).toEqual(EXPECTED_RUN_WORKER_FIRST);
    expect(Object.keys(repository.fileHashes)).toEqual(expect.arrayContaining([
      'wrangler.toml',
      'src/index.ts',
      'src/lib/route-permissions.ts',
      'src/routes/tenant/dashboard.ts',
      'src/routes/tenant/dailyCollection.ts',
      'src/routes/tenant/ipdReports.ts',
      'src/routes/tenant/canonicalReporting.ts',
    ]));
    expect(result.repositoryReady).toBe(true);
    expect(result.activeRoutesUnchanged).toBe(false);
  });

  it('fails closed when an expected route mount is missing', () => {
    const root = createRepositoryFixture({
      indexSource: [
        "app.route('/api/reports/daily-collection', dailyCollectionRoutes);",
        "app.route('/api/ipd-reports', ipdReportRoutes);",
        "app.route('/api/canonical-reporting', canonicalReportingRoutes);",
      ].join('\n'),
    });
    const evidence = collectReportingRouteRepositoryEvidence({ rootDir: root, gitCommit: 'a'.repeat(40) });
    expect(evidence.issues.map((item) => item.code)).toContain('CDB101_ROUTE_MOUNT_MISSING');
  });

  it('fails closed when a registered handler marker is missing', () => {
    const dashboardSource = REPORTING_ROUTE_REGISTRY
      .filter((route) => route.handlerFile === 'src/routes/tenant/dashboard.ts')
      .filter((route) => route.id !== 'dashboard_doctor_performance')
      .map((route) => route.handlerMarker)
      .join('\n');
    const root = createRepositoryFixture({
      handlerOverrides: { 'src/routes/tenant/dashboard.ts': dashboardSource },
    });
    const evidence = collectReportingRouteRepositoryEvidence({ rootDir: root, gitCommit: 'a'.repeat(40) });
    expect(evidence.issues.map((item) => item.code)).toContain('CDB101_ROUTE_HANDLER_MARKER_MISSING');
  });

  it('fails closed when a required permission prefix is missing', () => {
    const root = createRepositoryFixture({ permissionsSource: "prefix: '/api/ipd-reports'," });
    const evidence = collectReportingRouteRepositoryEvidence({ rootDir: root, gitCommit: 'a'.repeat(40) });
    expect(evidence.issues.map((item) => item.code)).toContain('CDB101_ROUTE_PERMISSION_MISSING');
  });

  it('fails closed when production route patterns or Worker-first paths drift', () => {
    const root = createRepositoryFixture({
      wranglerSource: fixtureWrangler({
        routePatterns: ['hms.ozzyl.com/*'],
        runWorkerFirst: ['/api/*'],
      }),
    });
    const evidence = collectReportingRouteRepositoryEvidence({ rootDir: root, gitCommit: 'a'.repeat(40) });
    expect(evidence.issues.map((item) => item.code)).toContain('CDB101_ROUTE_PATTERN_MISMATCH');
  });

  it('rejects missing Worker metadata and incomplete observations', () => {
    const repository = repositoryEvidence();
    const live = liveEvidence(repository);
    live.activeWorkerVersionId = null;
    live.observations.pop();

    const codes = evaluateReportingRouteFingerprint({ repository, live }).issues.map((item) => item.code);
    expect(codes).toContain('CDB101_WORKER_VERSION_MISSING');
    expect(codes).toContain('CDB101_LIVE_ROUTE_OBSERVATION_MISSING');
  });

  it('rejects duplicate or non-string production route patterns instead of normalizing them away', () => {
    const repository = repositoryEvidence();
    const duplicate = liveEvidence(repository);
    duplicate.routePatterns.push(duplicate.routePatterns[0]);
    const malformed = liveEvidence(repository) as ReportingRouteLiveEvidence & { routePatterns: unknown[] };
    malformed.routePatterns.push(123);

    expect(evaluateReportingRouteFingerprint({ repository, live: duplicate }).issues.map((item) => item.code))
      .toContain('CDB101_ROUTE_PATTERN_MISMATCH');
    expect(evaluateReportingRouteFingerprint({
      repository,
      live: malformed as ReportingRouteLiveEvidence,
    }).issues.map((item) => item.code)).toContain('CDB101_ROUTE_PATTERN_MISMATCH');
  });

  it('rejects duplicate and unexpected route observations', () => {
    const repository = repositoryEvidence();
    const live = liveEvidence(repository);
    live.observations.push(structuredClone(live.observations[0]));
    live.observations.push({
      ...structuredClone(live.observations[0]),
      routeId: 'unexpected_route',
    });

    const codes = evaluateReportingRouteFingerprint({ repository, live }).issues.map((item) => item.code);
    expect(codes).toContain('CDB101_LIVE_ROUTE_OBSERVATION_DUPLICATE');
    expect(codes).toContain('CDB101_ROUTE_EVIDENCE_INVALID');
  });

  it('rejects missing or incorrect normalized shape evidence and invalid statuses', () => {
    const repository = repositoryEvidence();
    const live = liveEvidence(repository);
    live.observations[0].normalizedShapeSha256 = null;
    live.observations[1].normalizedShapeSha256 = '9'.repeat(64);
    live.observations[2].status = 403;

    const codes = evaluateReportingRouteFingerprint({ repository, live }).issues.map((item) => item.code);
    expect(codes).toContain('CDB101_LIVE_ROUTE_SHAPE_MISSING');
    expect(codes).toContain('CDB101_LIVE_ROUTE_STATUS_INVALID');
  });

  it('rejects a legacy route observed through a canonical handler', () => {
    const repository = repositoryEvidence();
    const live = liveEvidence(repository);
    live.observations[0].canonicalHandlerObserved = true;

    expect(evaluateReportingRouteFingerprint({ repository, live }).issues.map((item) => item.code))
      .toContain('CDB101_LEGACY_ROUTE_CANONICALIZED');
  });

  it('rejects an active route switch on canonical status evidence', () => {
    const repository = repositoryEvidence();
    const live = liveEvidence(repository);
    const status = live.observations.find((item) => item.routeId === 'canonical_reporting_status');
    if (!status) throw new Error('missing canonical status fixture');
    status.activeRouteSwitched = true;

    expect(evaluateReportingRouteFingerprint({ repository, live }).issues.map((item) => item.code))
      .toContain('CDB101_ACTIVE_ROUTE_SWITCHED');
  });

  it('rejects retained values, secret headers, and sensitive extra keys without echoing them', () => {
    const repository = repositoryEvidence();
    const live = liveEvidence(repository) as ReportingRouteLiveEvidence & Record<string, unknown>;
    live.observations[0].responseValuesRetained = true;
    live.observations[1].secretHeadersRetained = true;
    live.rawBody = 'patient-value-that-must-never-be-echoed';

    const result = evaluateReportingRouteFingerprint({ repository, live });
    expect(result.issues.map((item) => item.code)).toContain('CDB101_ROUTE_EVIDENCE_SENSITIVE');
    expect(JSON.stringify(result)).not.toContain('patient-value-that-must-never-be-echoed');
  });

  it('rejects repository evidence with missing required file hashes', () => {
    const repository = repositoryEvidence();
    repository.fileHashes = {};

    const result = evaluateReportingRouteFingerprint({ repository, live: null });
    expect(result.repositoryReady).toBe(false);
    expect(result.issues.map((item) => item.code)).toContain('CDB101_ROUTE_REGISTRY_INVALID');
  });

  it('detects sensitive keys recursively instead of treating them as a generic extra field', () => {
    const repository = repositoryEvidence();
    const live = liveEvidence(repository) as ReportingRouteLiveEvidence & {
      observations: Array<ReportingRouteLiveEvidence['observations'][number] & Record<string, unknown>>;
    };
    live.observations[0].diagnostics = { rawBody: 'redacted-value' };

    const result = evaluateReportingRouteFingerprint({ repository, live });
    expect(result.issues.map((item) => item.code)).toContain('CDB101_ROUTE_EVIDENCE_SENSITIVE');
    expect(JSON.stringify(result)).not.toContain('redacted-value');
  });

  it('produces a deterministic fingerprint only for complete normalized evidence', () => {
    const repository = repositoryEvidence();
    const live = liveEvidence(repository);

    const first = evaluateReportingRouteFingerprint({ repository, live });
    const second = evaluateReportingRouteFingerprint({
      repository: JSON.parse(JSON.stringify(repository)) as ReportingRouteRepositoryEvidence,
      live: JSON.parse(JSON.stringify(live)) as ReportingRouteLiveEvidence,
    });

    expect(first.issues).toEqual([]);
    expect(first).toMatchObject({
      repositoryReady: true,
      liveEvidenceReady: true,
      activeRoutesUnchanged: true,
      aggregateOnly: true,
      productionMutationPerformed: false,
    });
    expect(first.routeFingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.evidenceId).toBe(`cdb101-route-${first.routeFingerprintSha256?.slice(0, 16)}`);
    expect(second.routeFingerprintSha256).toBe(first.routeFingerprintSha256);
  });

  it('parses only repository-only or protected evidence CLI modes', () => {
    expect(parseReportingRouteFingerprintArgs(['--', '--repository-only'])).toEqual({
      mode: 'repository-only',
      evidencePath: null,
    });
    expect(parseReportingRouteFingerprintArgs(['--evidence', '/protected/evidence.json'])).toEqual({
      mode: 'evidence',
      evidencePath: '/protected/evidence.json',
    });
    expect(() => parseReportingRouteFingerprintArgs([])).toThrow(/exactly one mode/i);
    expect(() => parseReportingRouteFingerprintArgs(['--capture-live'])).toThrow(/unknown argument/i);
    expect(() => parseReportingRouteFingerprintArgs(['--repository-only', '--evidence', 'x.json']))
      .toThrow(/exactly one mode/i);
  });
});
