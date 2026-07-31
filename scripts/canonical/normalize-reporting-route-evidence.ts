import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPORTING_ROUTE_REGISTRY,
  canonicalJson,
  collectReportingRouteRepositoryEvidence,
  evaluateReportingRouteFingerprint,
  sha256Hex,
  type ReportingRouteLiveEvidence,
  type ReportingRouteRepositoryEvidence,
} from './reporting-route-fingerprint';

export interface ReportingShapeLimits {
  maxDepth: number;
  maxNodes: number;
  maxPaths: number;
  maxKeyLength: number;
}

export const DEFAULT_REPORTING_SHAPE_LIMITS: Readonly<ReportingShapeLimits> = Object.freeze({
  maxDepth: 20,
  maxNodes: 20_000,
  maxPaths: 5_000,
  maxKeyLength: 256,
});

const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_BODY_BYTES = 2_000_000;

export interface ProtectedReportingRouteProbe {
  routeId: string;
  bodyFile: string;
  tenantScope: string;
  role: string;
  status: number;
  latencyMs: number;
  errorClass: string | null;
}

export interface ProtectedReportingRouteManifest {
  schemaVersion: 1;
  workerName: string;
  activeWorkerVersionId: string;
  previousWorkerVersionId: string;
  scriptEtagSha256: string;
  capturedAtUtc: string;
  routePatterns: string[];
  probes: ProtectedReportingRouteProbe[];
}

export interface ReportingRouteMarkers {
  canonicalHandlerObserved: boolean;
  activeRouteSwitched: boolean | null;
}

export interface ReportingRouteEvidenceNormalizerOptions {
  repositoryRoot: string;
  protectedRoot: string;
  manifestPath: string;
  outputPath: string;
}

export interface ReportingRouteEvidenceNormalizerCliOptions {
  protectedRoot: string;
  manifestPath: string;
  outputPath: string;
}

export interface ReportingRouteEvidenceNormalizationReceipt {
  schemaVersion: 1;
  evidenceCreated: true;
  evidenceSha256: string;
  observationCount: number;
  totalShapePathCount: number;
  repositoryReady: true;
  liveEvidenceReady: true;
  activeRoutesUnchanged: true;
  aggregateOnly: true;
  productionMutationPerformed: false;
  networkRequestPerformed: false;
  responseValuesRetained: false;
  secretHeadersRetained: false;
  repositoryEvidence: ReportingRouteRepositoryEvidence;
}

const MANIFEST_KEYS = new Set([
  'schemaVersion',
  'workerName',
  'activeWorkerVersionId',
  'previousWorkerVersionId',
  'scriptEtagSha256',
  'capturedAtUtc',
  'routePatterns',
  'probes',
]);

const PROBE_KEYS = new Set([
  'routeId',
  'bodyFile',
  'tenantScope',
  'role',
  'status',
  'latencyMs',
  'errorClass',
]);

const SENSITIVE_MANIFEST_KEYS = new Set([
  'authorization',
  'authorizationheader',
  'headers',
  'cookie',
  'cookies',
  'token',
  'accesstoken',
  'refreshtoken',
  'rawbody',
  'responsebody',
  'patientname',
  'practitionername',
  'signedurl',
  'userid',
  'useridentity',
  'password',
  'secret',
]);

function normalizedKeyName(key: string): string {
  return key.replace(/[_-]/g, '').toLowerCase();
}

function containsSensitiveManifestKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveManifestKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => (
    SENSITIVE_MANIFEST_KEYS.has(normalizedKeyName(key)) || containsSensitiveManifestKey(nested)
  ));
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains a sensitive or unknown field.`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_:-]{0,63}$/.test(value)) {
    throw new Error(`${label} must be a safe identifier.`);
  }
}

function assertRelativeProtectedPath(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (isAbsolute(value) || value.includes('\0')) {
    throw new Error(`${label} must be a safe relative path inside the protected root.`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`${label} must not escape the protected root.`);
  }
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel.length > 0 && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

function resolveInsideRoot(root: string, relativePath: string, label: string): string {
  assertRelativeProtectedPath(relativePath, label);
  const absolute = resolve(root, relativePath);
  if (!isPathInside(root, absolute)) {
    throw new Error(`${label} must not escape the protected root.`);
  }
  return absolute;
}

function safeLstat(path: string, label: string): ReturnType<typeof lstatSync> {
  try {
    return lstatSync(path);
  } catch {
    throw new Error(`${label} is unavailable.`);
  }
}

function safeRealpath(path: string, label: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw new Error(`${label} is unavailable.`);
  }
}

function assertNoSymlinkComponents(root: string, absolutePath: string, label: string): void {
  const rel = relative(root, absolutePath);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} must remain inside the protected root.`);
  }
  let current = root;
  for (const component of rel.split(sep)) {
    current = join(current, component);
    if (safeLstat(current, label).isSymbolicLink()) {
      throw new Error(`${label} must not use symlink path components.`);
    }
  }
}

function modeBits(path: string): number {
  return safeLstat(path, 'Protected evidence output').mode & 0o777;
}

function validateProtectedRoot(repositoryRoot: string, protectedRoot: string): string {
  if (!isAbsolute(protectedRoot)) {
    throw new Error('Protected root must be an absolute path outside the repository.');
  }
  const rootInfo = safeLstat(protectedRoot, 'Protected root');
  if (rootInfo.isSymbolicLink()) throw new Error('Protected root must not be a symlink.');
  if (!rootInfo.isDirectory()) throw new Error('Protected root must be a directory.');

  const repositoryReal = safeRealpath(repositoryRoot, 'Repository root');
  const protectedReal = safeRealpath(protectedRoot, 'Protected root');
  if (protectedReal === repositoryReal || isPathInside(repositoryReal, protectedReal)) {
    throw new Error('Protected root must remain outside the repository.');
  }
  if ((rootInfo.mode & 0o777) !== 0o700) throw new Error('Protected root must use mode 700.');
  return protectedReal;
}

function readProtectedJson(
  root: string,
  path: string,
  maxBytes: number,
  label: string,
): { value: unknown; identity: string } {
  assertNoSymlinkComponents(root, path, label);
  const realPath = safeRealpath(path, label);
  if (!isPathInside(root, realPath)) throw new Error(`${label} must not resolve outside the protected root.`);

  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error(`${label} is unavailable.`);
  }

  let raw: string;
  let info: ReturnType<typeof fstatSync>;
  try {
    info = fstatSync(descriptor);
    if (!info.isFile()) throw new Error(`${label} must be a regular file.`);
    if ((info.mode & 0o777) !== 0o600) throw new Error(`${label} must use mode 600.`);
    if (info.size <= 0 || info.size > maxBytes) throw new Error(`${label} exceeds the permitted size.`);
    raw = readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }

  try {
    return {
      value: JSON.parse(raw) as unknown,
      identity: `${info.dev}:${info.ino}`,
    };
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
}

function isPlainJsonObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateShapeKey(key: string, limits: ReportingShapeLimits): void {
  if (
    key.length === 0
    || key.length > limits.maxKeyLength
    || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)
  ) {
    throw new Error('Response shape contains an unsafe object key.');
  }
}

export function extractNormalizedReportingShapePaths(
  value: unknown,
  limits: ReportingShapeLimits = DEFAULT_REPORTING_SHAPE_LIMITS,
): string[] {
  const paths = new Set<string>();
  let nodeCount = 0;

  const addPath = (path: string): void => {
    paths.add(path);
    if (paths.size > limits.maxPaths) {
      throw new Error('Response shape exceeds the permitted path count.');
    }
  };

  const visit = (item: unknown, prefix: string, depth: number, recordSelf: boolean): void => {
    if (depth > limits.maxDepth) throw new Error('Response shape exceeds the permitted depth.');
    nodeCount += 1;
    if (nodeCount > limits.maxNodes) throw new Error('Response shape exceeds the permitted node count.');

    if (Array.isArray(item)) {
      const arrayPath = prefix ? `${prefix}[]` : '[]';
      addPath(arrayPath);
      for (const child of item) visit(child, arrayPath, depth + 1, false);
      return;
    }

    if (item !== null && typeof item === 'object') {
      if (!isPlainJsonObject(item)) throw new Error('Response shape contains an unsupported non-JSON object.');
      if (recordSelf && prefix) addPath(prefix);
      for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
        validateShapeKey(key, limits);
        const childPath = prefix ? `${prefix}.${key}` : key;
        visit(child, childPath, depth + 1, true);
      }
      return;
    }

    if (recordSelf && prefix) addPath(prefix);
  };

  visit(value, '', 0, false);
  return [...paths].sort((left, right) => left.localeCompare(right));
}

export function deriveReportingRouteMarkers(
  value: unknown,
  limits: ReportingShapeLimits = DEFAULT_REPORTING_SHAPE_LIMITS,
): ReportingRouteMarkers {
  let canonicalHandlerObserved = false;
  let sawSwitchFalse = false;
  let sawSwitchTrue = false;
  let nodeCount = 0;

  const visit = (item: unknown, depth: number): void => {
    if (depth > limits.maxDepth) throw new Error('Response marker scan exceeds the permitted depth.');
    nodeCount += 1;
    if (nodeCount > limits.maxNodes) throw new Error('Response marker scan exceeds the permitted node count.');
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (!item || typeof item !== 'object') return;
    if (!isPlainJsonObject(item)) throw new Error('Response marker scan contains an unsupported non-JSON object.');
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (depth === 0 && key === 'canonical' && child === true) canonicalHandlerObserved = true;
      if (key === 'activeRouteSwitched' && child === true) sawSwitchTrue = true;
      if (key === 'activeRouteSwitched' && child === false) sawSwitchFalse = true;
      visit(child, depth + 1);
    }
  };

  visit(value, 0);
  return {
    canonicalHandlerObserved,
    activeRouteSwitched: sawSwitchTrue ? true : sawSwitchFalse ? false : null,
  };
}

function parseManifest(raw: unknown): ProtectedReportingRouteManifest {
  if (containsSensitiveManifestKey(raw)) {
    throw new Error('Protected manifest contains a sensitive field.');
  }
  assertPlainObject(raw, 'Protected manifest');
  assertExactKeys(raw, MANIFEST_KEYS, 'Protected manifest');

  const probesRaw = raw.probes;
  if (!Array.isArray(probesRaw)) throw new Error('Protected manifest probes must be an array.');
  const probes: ProtectedReportingRouteProbe[] = probesRaw.map((probeRaw, index) => {
    assertPlainObject(probeRaw, `Probe ${index + 1}`);
    assertExactKeys(probeRaw, PROBE_KEYS, `Probe ${index + 1}`);
    const probeLabel = `Probe ${index + 1}`;
    assertNonEmptyString(probeRaw.routeId, `${probeLabel} routeId`);
    assertRelativeProtectedPath(probeRaw.bodyFile, `${probeLabel} bodyFile`);
    assertNonEmptyString(probeRaw.tenantScope, `${probeLabel} tenantScope`);
    assertSafeIdentifier(probeRaw.role, `${probeLabel} role`);
    if (!Number.isSafeInteger(probeRaw.status)) throw new Error(`${probeLabel} status is invalid.`);
    if (!Number.isSafeInteger(probeRaw.latencyMs) || Number(probeRaw.latencyMs) < 0) {
      throw new Error(`${probeLabel} latency is invalid.`);
    }
    if (probeRaw.errorClass !== null) {
      assertSafeIdentifier(probeRaw.errorClass, `${probeLabel} error class`);
    }
    return {
      routeId: probeRaw.routeId,
      bodyFile: probeRaw.bodyFile,
      tenantScope: probeRaw.tenantScope,
      role: probeRaw.role,
      status: probeRaw.status,
      latencyMs: probeRaw.latencyMs,
      errorClass: probeRaw.errorClass,
    };
  });

  const routeIds = probes.map((probe) => probe.routeId);
  const duplicates = routeIds.filter((routeId, index) => routeIds.indexOf(routeId) !== index);
  if (duplicates.length > 0) throw new Error('Protected manifest contains duplicate route probes.');
  const bodyFiles = probes.map((probe) => probe.bodyFile);
  if (new Set(bodyFiles).size !== bodyFiles.length) {
    throw new Error('Protected manifest body files must be unique for every route probe.');
  }
  const expectedIds = REPORTING_ROUTE_REGISTRY.map((route) => route.id);
  const unexpected = routeIds.filter((routeId) => !expectedIds.includes(routeId));
  if (unexpected.length > 0) throw new Error('Protected manifest contains an unexpected route probe.');
  const missing = expectedIds.filter((routeId) => !routeIds.includes(routeId));
  if (missing.length > 0) throw new Error('Protected manifest is missing one or more route probes.');

  assertNonEmptyString(raw.workerName, 'Protected manifest workerName');
  assertNonEmptyString(raw.activeWorkerVersionId, 'Protected manifest activeWorkerVersionId');
  assertNonEmptyString(raw.previousWorkerVersionId, 'Protected manifest previousWorkerVersionId');
  assertNonEmptyString(raw.scriptEtagSha256, 'Protected manifest scriptEtagSha256');
  assertNonEmptyString(raw.capturedAtUtc, 'Protected manifest capturedAtUtc');
  if (raw.schemaVersion !== 1) throw new Error('Protected manifest schemaVersion must be 1.');
  if (!Array.isArray(raw.routePatterns) || raw.routePatterns.some((value) => typeof value !== 'string')) {
    throw new Error('Protected manifest routePatterns are invalid.');
  }

  return {
    schemaVersion: 1,
    workerName: raw.workerName,
    activeWorkerVersionId: raw.activeWorkerVersionId,
    previousWorkerVersionId: raw.previousWorkerVersionId,
    scriptEtagSha256: raw.scriptEtagSha256,
    capturedAtUtc: raw.capturedAtUtc,
    routePatterns: [...raw.routePatterns],
    probes,
  };
}

function writeAtomicProtectedJson(root: string, targetPath: string, value: unknown): void {
  if (existsSync(targetPath)) throw new Error('Protected evidence output already exists; overwrite is prohibited.');
  const parent = dirname(targetPath);
  if (parent !== root) assertNoSymlinkComponents(root, parent, 'Protected output parent');
  const parentReal = safeRealpath(parent, 'Protected output parent');
  if (parentReal !== root && !isPathInside(root, parentReal)) {
    throw new Error('Protected output parent must remain inside the protected root.');
  }
  const parentInfo = safeLstat(parent, 'Protected output parent');
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) {
    throw new Error('Protected output parent must be a real directory.');
  }
  if ((parentInfo.mode & 0o777) !== 0o700) throw new Error('Protected output parent must use mode 700.');

  const temporaryPath = `${targetPath}.partial-${process.pid}-${randomUUID()}`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, null, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, targetPath);
    if (modeBits(targetPath) !== 0o600) {
      rmSync(targetPath, { force: true });
      throw new Error('Protected evidence output did not preserve mode 600.');
    }
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
    if (error instanceof Error && error.message === 'Protected evidence output did not preserve mode 600.') {
      throw error;
    }
    throw new Error('Protected evidence output could not be written safely.');
  }
}

export function generateProtectedReportingRouteEvidence(
  options: ReportingRouteEvidenceNormalizerOptions,
): ReportingRouteEvidenceNormalizationReceipt {
  const repositoryRoot = safeRealpath(options.repositoryRoot, 'Repository root');
  const protectedRoot = validateProtectedRoot(repositoryRoot, options.protectedRoot);
  const manifestFile = resolveInsideRoot(protectedRoot, options.manifestPath, 'Manifest path');
  const outputFile = resolveInsideRoot(protectedRoot, options.outputPath, 'Output path');
  if (existsSync(outputFile)) throw new Error('Protected evidence output already exists; overwrite is prohibited.');

  const manifestRecord = readProtectedJson(
    protectedRoot,
    manifestFile,
    MAX_MANIFEST_BYTES,
    'Protected manifest',
  );
  const manifest = parseManifest(manifestRecord.value);
  const probeByRoute = new Map(manifest.probes.map((probe) => [probe.routeId, probe]));
  const usedFileIdentities = new Set([manifestRecord.identity]);
  let totalShapePathCount = 0;

  const observations = REPORTING_ROUTE_REGISTRY.map((route) => {
    const probe = probeByRoute.get(route.id);
    if (!probe) throw new Error('Protected manifest is missing one or more route probes.');
    const bodyFile = resolveInsideRoot(protectedRoot, probe.bodyFile, `Probe ${route.id} bodyFile`);
    const bodyRecord = readProtectedJson(protectedRoot, bodyFile, MAX_BODY_BYTES, `Probe ${route.id} body`);
    if (usedFileIdentities.has(bodyRecord.identity)) {
      throw new Error('Protected manifest body files must be unique for every route probe.');
    }
    usedFileIdentities.add(bodyRecord.identity);
    const body = bodyRecord.value;
    const normalizedShapePaths = extractNormalizedReportingShapePaths(body);
    totalShapePathCount += normalizedShapePaths.length;
    const markers = deriveReportingRouteMarkers(body);
    const activeRouteSwitched = markers.activeRouteSwitched !== null
      ? markers.activeRouteSwitched
      : route.classification === 'legacy_active'
        ? false
        : probe.status === 404
          ? null
          : null;

    return {
      routeId: route.id,
      method: route.method,
      resolvedPath: route.pathTemplate,
      tenantScope: probe.tenantScope,
      role: probe.role,
      status: probe.status,
      normalizedShapePaths,
      normalizedShapeSha256: sha256Hex(canonicalJson(normalizedShapePaths)),
      canonicalHandlerObserved: markers.canonicalHandlerObserved,
      activeRouteSwitched,
      latencyMs: probe.latencyMs,
      errorClass: probe.errorClass,
      responseValuesRetained: false,
      secretHeadersRetained: false,
    };
  });

  const evidence: ReportingRouteLiveEvidence = {
    schemaVersion: 1,
    workerName: manifest.workerName,
    activeWorkerVersionId: manifest.activeWorkerVersionId,
    previousWorkerVersionId: manifest.previousWorkerVersionId,
    scriptEtagSha256: manifest.scriptEtagSha256,
    capturedAtUtc: manifest.capturedAtUtc,
    routePatterns: [...manifest.routePatterns],
    observations,
  };

  const repositoryEvidence = collectReportingRouteRepositoryEvidence({ rootDir: repositoryRoot });
  const fingerprint = evaluateReportingRouteFingerprint({ repository: repositoryEvidence, live: evidence });
  if (!fingerprint.liveEvidenceReady || !fingerprint.activeRoutesUnchanged) {
    const codes = fingerprint.issues.map((item) => item.code).join(', ');
    throw new Error(`Protected route fingerprint validation failed: ${codes || 'unknown blocker'}.`);
  }

  writeAtomicProtectedJson(protectedRoot, outputFile, evidence);
  return {
    schemaVersion: 1,
    evidenceCreated: true,
    evidenceSha256: sha256Hex(canonicalJson(evidence)),
    observationCount: evidence.observations.length,
    totalShapePathCount,
    repositoryReady: true,
    liveEvidenceReady: true,
    activeRoutesUnchanged: true,
    aggregateOnly: true,
    productionMutationPerformed: false,
    networkRequestPerformed: false,
    responseValuesRetained: false,
    secretHeadersRetained: false,
    repositoryEvidence,
  };
}

export function parseReportingRouteEvidenceNormalizerArgs(
  args: string[],
): ReportingRouteEvidenceNormalizerCliOptions {
  const values: Partial<ReportingRouteEvidenceNormalizerCliOptions> = {};
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    const map: Record<string, keyof ReportingRouteEvidenceNormalizerCliOptions> = {
      '--protected-root': 'protectedRoot',
      '--manifest': 'manifestPath',
      '--output': 'outputPath',
    };
    const key = map[arg];
    if (!key) throw new Error('Unknown argument.');
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
    values[key] = value;
    seen.add(arg);
    index += 1;
  }
  if (!values.protectedRoot || !values.manifestPath || !values.outputPath) {
    throw new Error('--protected-root, --manifest, and --output are required.');
  }
  return values as ReportingRouteEvidenceNormalizerCliOptions;
}

function main(): void {
  try {
    const options = parseReportingRouteEvidenceNormalizerArgs(process.argv.slice(2));
    const receipt = generateProtectedReportingRouteEvidence({
      repositoryRoot: process.cwd(),
      ...options,
    });
    const { repositoryEvidence: _repositoryEvidence, ...aggregateReceipt } = receipt;
    process.stdout.write(`${JSON.stringify(aggregateReceipt, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 protected route evidence normalization failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
