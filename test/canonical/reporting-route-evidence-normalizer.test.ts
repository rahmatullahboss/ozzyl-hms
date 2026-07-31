import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REPORTING_ROUTE_REGISTRY,
  evaluateReportingRouteFingerprint,
  type ReportingRouteLiveEvidence,
} from '../../scripts/canonical/reporting-route-fingerprint';
import {
  DEFAULT_REPORTING_SHAPE_LIMITS,
  deriveReportingRouteMarkers,
  extractNormalizedReportingShapePaths,
  generateProtectedReportingRouteEvidence,
  parseReportingRouteEvidenceNormalizerArgs,
  type ProtectedReportingRouteManifest,
} from '../../scripts/canonical/normalize-reporting-route-evidence';

const temporaryRoots: string[] = [];

function makeTemporaryRoot(prefix = 'cdb101-route-normalizer-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function bodyForRoute(routeId: string): unknown {
  switch (routeId) {
    case 'dashboard_kpi_summary':
      return {
        metrics: [{ metric: 'revenue', total: 125000, valueType: 'minor_units' }],
        period: { startDate: '2026-07-01', endDate: '2026-07-15' },
      };
    case 'dashboard_doctor_performance':
    case 'dashboard_test_performance':
      return {
        hasNextPage: false,
        page: 1,
        pageSize: 20,
        period: { startDate: '2026-07-01', endDate: '2026-07-15' },
        rows: [],
        totalRows: 0,
      };
    case 'dashboard_doctor_performance_details':
      return {
        doctorId: null,
        hasNextPage: false,
        page: 1,
        pageSize: 20,
        period: {},
        rows: [{ patientName: 'Protected Patient', amount: 100 }],
        tab: 'visits',
        totalRows: 1,
      };
    case 'dashboard_test_performance_details':
      return {
        hasNextPage: false,
        page: 1,
        pageSize: 20,
        period: {},
        rows: [{ patientName: 'Protected Patient', amount: 100 }],
        testId: 500,
        totalRows: 1,
      };
    case 'daily_collection':
      return {
        date: '2026-07-15',
        doctor_performance: [],
        payment_methods: [],
        summary: { collected: 500 },
        transactions: [{ patient_name: 'Protected Patient', amount: 500 }],
      };
    case 'ipd_revenue':
      return {
        by_type: [{ type: 'room', amount: 1000 }],
        by_ward: [{ ward_name: 'Protected Ward', amount: 1000 }],
        daily: [{ charge_date: '2026-07-15', daily_amount: 1000 }],
        total_revenue: 1000,
      };
    case 'canonical_reporting_status':
      return {
        data: {
          mode: 'shadow',
          metricCount: 5,
          readOnly: true,
          activeRouteSwitched: false,
        },
        canonical: true,
      };
    case 'canonical_doctor_performance':
    case 'canonical_test_performance':
    case 'canonical_collections':
    case 'canonical_ipd_finance':
      return {
        activeRouteSwitched: false,
        canonical: true,
        data: {},
        mode: 'shadow',
        readOnly: true,
      };
    default:
      throw new Error(`Unknown route fixture: ${routeId}`);
  }
}

function createProtectedFixture(options: {
  manifestMutation?: (manifest: ProtectedReportingRouteManifest) => void;
  bodyMutation?: (routeId: string, body: unknown) => unknown;
  bodyMode?: number;
  manifestMode?: number;
} = {}): {
  protectedRoot: string;
  manifestName: string;
  outputName: string;
  manifest: ProtectedReportingRouteManifest;
} {
  const protectedRoot = makeTemporaryRoot();
  const manifestName = 'probe-manifest.json';
  const outputName = 'normalized-evidence.json';

  const probes = REPORTING_ROUTE_REGISTRY.map((route) => {
    const bodyName = `${route.id}.json`;
    const initialBody = bodyForRoute(route.id);
    const body = options.bodyMutation?.(route.id, initialBody) ?? initialBody;
    writeFileSync(join(protectedRoot, bodyName), JSON.stringify(body), { mode: 0o600 });
    chmodSync(join(protectedRoot, bodyName), options.bodyMode ?? 0o600);
    return {
      routeId: route.id,
      bodyFile: bodyName,
      tenantScope: '100',
      role: 'hospital_admin',
      status: 200,
      latencyMs: 125,
      errorClass: null,
    };
  });

  const manifest: ProtectedReportingRouteManifest = {
    schemaVersion: 1,
    workerName: 'hms-saas-production',
    activeWorkerVersionId: '11111111-1111-4111-8111-111111111111',
    previousWorkerVersionId: '22222222-2222-4222-8222-222222222222',
    scriptEtagSha256: 'a'.repeat(64),
    capturedAtUtc: '2026-07-14T18:30:00.000Z',
    routePatterns: [
      '*.ozzyl.com/*',
      'admin.ozzyl.com/*',
      'app.ozzyl.com/*',
      'hms.ozzyl.com/*',
    ],
    probes,
  };
  options.manifestMutation?.(manifest);
  writeFileSync(join(protectedRoot, manifestName), JSON.stringify(manifest), { mode: 0o600 });
  chmodSync(join(protectedRoot, manifestName), options.manifestMode ?? 0o600);

  return { protectedRoot, manifestName, outputName, manifest };
}

describe('CDB-101 protected reporting route evidence normalizer', () => {
  it('extracts deterministic, sorted, value-free object and array shape paths', () => {
    const left = extractNormalizedReportingShapePaths({
      summary: { total: 100, nested: { value: 'secret-one' } },
      rows: [
        { doctorId: 1, patientName: 'Protected Patient' },
        { amount: 500, doctorId: 2 },
      ],
      empty: [],
    });
    const right = extractNormalizedReportingShapePaths({
      empty: [],
      rows: [
        { amount: 999, doctorId: 200 },
        { patientName: 'Different Protected Patient', doctorId: 100 },
      ],
      summary: { nested: { value: 'secret-two' }, total: 900 },
    });

    expect(left).toEqual([
      'empty[]',
      'rows[]',
      'rows[].amount',
      'rows[].doctorId',
      'rows[].patientName',
      'summary',
      'summary.nested',
      'summary.nested.value',
      'summary.total',
    ]);
    expect(right).toEqual(left);
    expect(JSON.stringify(left)).not.toMatch(/Protected|secret|100|500|999/);
  });

  it('derives canonical-handler and active-route markers without accepting operator claims', () => {
    expect(deriveReportingRouteMarkers({
      canonical: true,
      data: { activeRouteSwitched: false },
    })).toEqual({
      canonicalHandlerObserved: true,
      activeRouteSwitched: false,
    });
    expect(deriveReportingRouteMarkers({
      canonical: false,
      nested: [{ activeRouteSwitched: true }],
    })).toEqual({
      canonicalHandlerObserved: false,
      activeRouteSwitched: true,
    });
    expect(deriveReportingRouteMarkers({ data: {} })).toEqual({
      canonicalHandlerObserved: false,
      activeRouteSwitched: null,
    });
    expect(deriveReportingRouteMarkers({ data: { canonical: true } })).toEqual({
      canonicalHandlerObserved: false,
      activeRouteSwitched: null,
    });
  });

  it('fails closed on excessive depth, path count, node count, or unsafe keys', () => {
    let deep: unknown = 'value';
    for (let index = 0; index < DEFAULT_REPORTING_SHAPE_LIMITS.maxDepth + 1; index += 1) {
      deep = { nested: deep };
    }
    expect(() => extractNormalizedReportingShapePaths(deep)).toThrow(/depth/i);
    expect(() => extractNormalizedReportingShapePaths(
      Object.fromEntries(Array.from(
        { length: DEFAULT_REPORTING_SHAPE_LIMITS.maxPaths + 1 },
        (_, index) => [`key${index}`, index],
      )),
    )).toThrow(/path/i);
    expect(() => extractNormalizedReportingShapePaths(
      Array.from({ length: DEFAULT_REPORTING_SHAPE_LIMITS.maxNodes + 1 }, () => 1),
    )).toThrow(/node/i);
    expect(() => extractNormalizedReportingShapePaths({ 'bad\nkey': true })).toThrow(/key/i);
    let message = '';
    try {
      extractNormalizedReportingShapePaths({ 'Protected Patient Name': true });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/key/i);
    expect(message).not.toContain('Protected Patient Name');
  });

  it('rejects non-JSON object instances in the pure shape API', () => {
    expect(() => extractNormalizedReportingShapePaths(new Date())).toThrow(/unsupported|json object/i);
    expect(() => extractNormalizedReportingShapePaths(new Map([['key', 'value']]))).toThrow(/unsupported|json object/i);
  });

  it('generates exact twelve-route evidence that passes the existing fingerprint validator', () => {
    const fixture = createProtectedFixture();
    const receipt = generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: fixture.protectedRoot,
      manifestPath: fixture.manifestName,
      outputPath: fixture.outputName,
    });
    const outputPath = join(fixture.protectedRoot, fixture.outputName);
    const evidence = JSON.parse(readFileSync(outputPath, 'utf8')) as ReportingRouteLiveEvidence;

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      evidenceCreated: true,
      observationCount: 12,
      repositoryReady: true,
      liveEvidenceReady: true,
      activeRoutesUnchanged: true,
      aggregateOnly: true,
      productionMutationPerformed: false,
      networkRequestPerformed: false,
      responseValuesRetained: false,
      secretHeadersRetained: false,
    });
    expect(receipt.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    expect(evidence.observations).toHaveLength(12);
    expect(JSON.stringify(evidence)).not.toMatch(/Protected Patient|Protected Name|125000/);

    const fingerprint = evaluateReportingRouteFingerprint({
      repository: receipt.repositoryEvidence,
      live: evidence,
    });
    expect(fingerprint.issues).toEqual([]);
    expect(fingerprint.activeRoutesUnchanged).toBe(true);
  });

  it('rejects duplicate, missing, unexpected, and sensitive manifest fields', () => {
    const duplicate = createProtectedFixture({
      manifestMutation: (manifest) => manifest.probes.push(structuredClone(manifest.probes[0])),
    });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: duplicate.protectedRoot,
      manifestPath: duplicate.manifestName,
      outputPath: duplicate.outputName,
    })).toThrow(/duplicate/i);

    const missing = createProtectedFixture({
      manifestMutation: (manifest) => manifest.probes.pop(),
    });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: missing.protectedRoot,
      manifestPath: missing.manifestName,
      outputPath: missing.outputName,
    })).toThrow(/missing/i);

    const unexpected = createProtectedFixture({
      manifestMutation: (manifest) => {
        manifest.probes[0].routeId = 'unexpected_route';
      },
    });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: unexpected.protectedRoot,
      manifestPath: unexpected.manifestName,
      outputPath: unexpected.outputName,
    })).toThrow(/unexpected/i);

    const sensitive = createProtectedFixture({
      manifestMutation: (manifest) => {
        (manifest as ProtectedReportingRouteManifest & Record<string, unknown>).authorization = 'Bearer secret';
      },
    });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: sensitive.protectedRoot,
      manifestPath: sensitive.manifestName,
      outputPath: sensitive.outputName,
    })).toThrow(/sensitive|unknown field/i);
  });

  it('rejects reused body files and does not echo untrusted manifest values', () => {
    const reused = createProtectedFixture({
      manifestMutation: (manifest) => {
        manifest.probes[1].bodyFile = manifest.probes[0].bodyFile;
      },
    });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: reused.protectedRoot,
      manifestPath: reused.manifestName,
      outputPath: reused.outputName,
    })).toThrow(/body file.*unique|reused|duplicate/i);

    const untrusted = createProtectedFixture({
      manifestMutation: (manifest) => {
        manifest.probes[0].routeId = 'Protected Patient Secret';
      },
    });
    let message = '';
    try {
      generateProtectedReportingRouteEvidence({
        repositoryRoot: process.cwd(),
        protectedRoot: untrusted.protectedRoot,
        manifestPath: untrusted.manifestName,
        outputPath: untrusted.outputName,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/unexpected/i);
    expect(message).not.toContain('Protected Patient Secret');

    const freeFormFields = createProtectedFixture({
      manifestMutation: (manifest) => {
        manifest.probes[0].role = 'UNTRUSTED HUMAN LABEL';
        manifest.probes[0].errorClass = 'UNTRUSTED FREE FORM MESSAGE';
      },
    });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: freeFormFields.protectedRoot,
      manifestPath: freeFormFields.manifestName,
      outputPath: freeFormFields.outputName,
    })).toThrow(/role|error class|identifier/i);
  });

  it('rejects path traversal, repository-contained roots, symlinks, and incorrect modes', () => {
    const traversal = createProtectedFixture({
      manifestMutation: (manifest) => {
        manifest.probes[0].bodyFile = '../outside.json';
      },
    });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: traversal.protectedRoot,
      manifestPath: traversal.manifestName,
      outputPath: traversal.outputName,
    })).toThrow(/relative|escape|traversal/i);

    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: process.cwd(),
      manifestPath: 'package.json',
      outputPath: 'should-not-write.json',
    })).toThrow(/outside.*repository/i);

    const linkedDirectory = createProtectedFixture();
    const outsideRoot = makeTemporaryRoot('cdb101-route-outside-');
    writeFileSync(join(outsideRoot, 'outside.json'), JSON.stringify(bodyForRoute('dashboard_kpi_summary')), { mode: 0o600 });
    symlinkSync(outsideRoot, join(linkedDirectory.protectedRoot, 'linked'));
    linkedDirectory.manifest.probes[0].bodyFile = 'linked/outside.json';
    writeFileSync(
      join(linkedDirectory.protectedRoot, linkedDirectory.manifestName),
      JSON.stringify(linkedDirectory.manifest),
      { mode: 0o600 },
    );
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: linkedDirectory.protectedRoot,
      manifestPath: linkedDirectory.manifestName,
      outputPath: linkedDirectory.outputName,
    })).toThrow(/symlink|escape|outside/i);

    const wrongMode = createProtectedFixture({ bodyMode: 0o644 });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: wrongMode.protectedRoot,
      manifestPath: wrongMode.manifestName,
      outputPath: wrongMode.outputName,
    })).toThrow(/600/);

    const symlink = createProtectedFixture();
    const firstProbe = symlink.manifest.probes[0];
    const target = join(symlink.protectedRoot, firstProbe.bodyFile);
    const symlinkName = 'symlink-body.json';
    symlinkSync(target, join(symlink.protectedRoot, symlinkName));
    firstProbe.bodyFile = symlinkName;
    writeFileSync(join(symlink.protectedRoot, symlink.manifestName), JSON.stringify(symlink.manifest), { mode: 0o600 });
    expect(lstatSync(join(symlink.protectedRoot, symlinkName)).isSymbolicLink()).toBe(true);
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: symlink.protectedRoot,
      manifestPath: symlink.manifestName,
      outputPath: symlink.outputName,
    })).toThrow(/symlink/i);
  });

  it('rejects malformed or oversized JSON without leaking values or leaving partial output', () => {
    const malformed = createProtectedFixture();
    const malformedProbe = malformed.manifest.probes[0];
    writeFileSync(join(malformed.protectedRoot, malformedProbe.bodyFile), '{"patientName":"Protected Patient"', { mode: 0o600 });

    let message = '';
    try {
      generateProtectedReportingRouteEvidence({
        repositoryRoot: process.cwd(),
        protectedRoot: malformed.protectedRoot,
        manifestPath: malformed.manifestName,
        outputPath: malformed.outputName,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/invalid json/i);
    expect(message).not.toContain('Protected Patient');
    expect(readdirSync(malformed.protectedRoot).some((name) => name.includes('.partial'))).toBe(false);

    const oversized = createProtectedFixture();
    const oversizedProbe = oversized.manifest.probes[0];
    writeFileSync(
      join(oversized.protectedRoot, oversizedProbe.bodyFile),
      JSON.stringify({ large: 'x'.repeat(2_100_000) }),
      { mode: 0o600 },
    );
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: oversized.protectedRoot,
      manifestPath: oversized.manifestName,
      outputPath: oversized.outputName,
    })).toThrow(/size/i);
  });

  it('does not expose protected local paths when an input file is missing', () => {
    const missingFile = createProtectedFixture({
      manifestMutation: (manifest) => {
        manifest.probes[0].bodyFile = 'missing-body.json';
      },
    });
    let message = '';
    try {
      generateProtectedReportingRouteEvidence({
        repositoryRoot: process.cwd(),
        protectedRoot: missingFile.protectedRoot,
        manifestPath: missingFile.manifestName,
        outputPath: missingFile.outputName,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/unavailable|missing/i);
    expect(message).not.toContain(missingFile.protectedRoot);
    expect(message).not.toContain('missing-body.json');
  });

  it('refuses active switches, canonicalized legacy responses, and output overwrite', () => {
    const switched = createProtectedFixture({
      bodyMutation: (routeId, body) => routeId === 'canonical_reporting_status'
        ? { ...(body as Record<string, unknown>), activeRouteSwitched: true }
        : body,
    });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: switched.protectedRoot,
      manifestPath: switched.manifestName,
      outputPath: switched.outputName,
    })).toThrow(/active route|fingerprint/i);
    expect(readdirSync(switched.protectedRoot).some((name) => name.includes('.partial'))).toBe(false);

    const canonicalizedLegacy = createProtectedFixture({
      bodyMutation: (routeId, body) => routeId === 'dashboard_kpi_summary'
        ? { ...(body as Record<string, unknown>), canonical: true }
        : body,
    });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: canonicalizedLegacy.protectedRoot,
      manifestPath: canonicalizedLegacy.manifestName,
      outputPath: canonicalizedLegacy.outputName,
    })).toThrow(/canonical|fingerprint/i);

    const nestedCanonicalOnly = createProtectedFixture({
      bodyMutation: (routeId, body) => {
        if (routeId !== 'canonical_doctor_performance') return body;
        const source = body as Record<string, unknown>;
        return {
          activeRouteSwitched: false,
          data: { canonical: true },
          mode: source.mode,
          readOnly: source.readOnly,
        };
      },
    });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: nestedCanonicalOnly.protectedRoot,
      manifestPath: nestedCanonicalOnly.manifestName,
      outputPath: nestedCanonicalOnly.outputName,
    })).toThrow(/canonical|fingerprint/i);

    const existing = createProtectedFixture();
    writeFileSync(join(existing.protectedRoot, existing.outputName), '{}', { mode: 0o600 });
    expect(() => generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      protectedRoot: existing.protectedRoot,
      manifestPath: existing.manifestName,
      outputPath: existing.outputName,
    })).toThrow(/exists|overwrite/i);
  });

  it('ships a fail-closed probe manifest template without credential or header fields', () => {
    const templatePath = resolve(
      process.cwd(),
      'docs/database/migration-runs/production/CDB-101-reporting-route-probe-manifest-template.json',
    );
    const raw = readFileSync(templatePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      activeWorkerVersionId: string | null;
      probes: Array<{ routeId: string; status: number | null }>;
    };

    expect(parsed.probes.map((probe) => probe.routeId)).toEqual(
      REPORTING_ROUTE_REGISTRY.map((route) => route.id),
    );
    expect(parsed.activeWorkerVersionId).toBeNull();
    expect(parsed.probes.every((probe) => probe.status === null)).toBe(true);
    expect(raw).not.toMatch(/authorization|cookie|headers|token|rawBody|responseBody|password/i);
  });

  it('runs the offline CLI and emits only an aggregate receipt', () => {
    const fixture = createProtectedFixture();
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const result = spawnSync(executable, [
      'scripts/canonical/normalize-reporting-route-evidence.ts',
      '--protected-root', fixture.protectedRoot,
      '--manifest', fixture.manifestName,
      '--output', fixture.outputName,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const receipt = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      evidenceCreated: true,
      observationCount: 12,
      activeRoutesUnchanged: true,
      aggregateOnly: true,
      productionMutationPerformed: false,
      networkRequestPerformed: false,
      responseValuesRetained: false,
      secretHeadersRetained: false,
    });
    expect(receipt).not.toHaveProperty('repositoryEvidence');
    expect(result.stdout).not.toContain(fixture.protectedRoot);
    expect(result.stdout).not.toMatch(/Protected Patient|Protected Name|125000/);
    expect(readFileSync(join(fixture.protectedRoot, fixture.outputName), 'utf8')).not.toMatch(
      /Protected Patient|Protected Name|125000/,
    );
  });

  it('parses only the exact offline CLI contract', () => {
    expect(parseReportingRouteEvidenceNormalizerArgs([
      '--',
      '--protected-root', '/private/evidence',
      '--manifest', 'probe-manifest.json',
      '--output', 'normalized-evidence.json',
    ])).toEqual({
      protectedRoot: '/private/evidence',
      manifestPath: 'probe-manifest.json',
      outputPath: 'normalized-evidence.json',
    });
    expect(() => parseReportingRouteEvidenceNormalizerArgs([])).toThrow(/required/i);
    expect(() => parseReportingRouteEvidenceNormalizerArgs(['--capture-live'])).toThrow(/unknown/i);
    let message = '';
    try {
      parseReportingRouteEvidenceNormalizerArgs(['UNTRUSTED_POSITIONAL_VALUE_123']);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/unknown/i);
    expect(message).not.toContain('UNTRUSTED_POSITIONAL_VALUE_123');
    expect(() => parseReportingRouteEvidenceNormalizerArgs([
      '--protected-root', '/private/evidence',
      '--manifest', 'probe-manifest.json',
      '--output', 'normalized-evidence.json',
      '--authorization', 'secret',
    ])).toThrow(/unknown/i);
  });
});
