import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { MIGRATIONS_R2_KEY } from '../../src/data/schema-migrations.generated';

export interface D1ProductionConfig {
  environment: 'production';
  workerName: string;
  binding: string;
  databaseName: string;
  databaseId: string;
  accountId: string;
  manifestBucket: string;
  manifestKey: string;
}

export interface ReadOnlyCommandResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

export type ReadOnlyCommandRunner = (
  args: string[],
) => Promise<ReadOnlyCommandResult>;

export interface ProductionIdentityResult {
  environment: 'production';
  workerName: string;
  binding: string;
  databaseName: string;
  databaseId: string;
  databaseRegion: string | null;
  databaseTableCount: number | null;
  databaseSizeBytes: number | null;
  accountIdMasked: string;
  accountMatched: boolean;
  remoteDatabaseMatched: boolean;
  manifestBucket: string;
  manifestKey: string;
  manifestObjectFound: boolean;
  manifestObjectSha256: string;
  manifestChecksum: string;
  manifestChecksumMatched: boolean;
  manifestMigrationCount: number;
  checkedAtUtc: string;
}

interface InspectProductionOptions {
  configText: string;
  manifestKey: string;
  runner: ReadOnlyCommandRunner;
  now?: () => Date;
}

interface WranglerWhoami {
  loggedIn?: boolean;
  accounts?: Array<{ id?: string; name?: string }>;
}

interface WranglerD1Database {
  uuid?: string;
  name?: string;
}

interface WranglerD1Info extends WranglerD1Database {
  num_tables?: number;
  running_in_region?: string;
  database_size?: number;
}

interface RemoteMigrationManifest {
  version?: string;
  checksum?: string;
  migrations?: unknown[];
}

const PROHIBITED_WRANGLER_TOKENS = new Set([
  'create',
  'delete',
  'deploy',
  'execute',
  'export',
  'import',
  'put',
  'restore',
]);

export function parseRequestedEnvironment(args: string[]): 'production' {
  let requested: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--env' || token === '-e') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`${token} requires a value`);
      }
      requested = value;
      index += 1;
      continue;
    }
    if (token.startsWith('--env=')) {
      const value = token.slice('--env='.length);
      if (!value) throw new Error('--env requires a value');
      requested = value;
    }
  }

  const environment = requested ?? 'production';
  if (environment !== 'production') {
    throw new Error(
      `This inspection is production-only; refusing environment: ${environment}`,
    );
  }

  return 'production';
}

export function maskIdentifier(value: string): string {
  if (value.length <= 8) {
    return `${value.slice(0, 2)}…${value.slice(-2)}`;
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (!match) {
    throw new Error(`Expected a quoted TOML string, received: ${trimmed}`);
  }
  return JSON.parse(`"${match[1]}"`) as string;
}

function parseAssignments(lines: string[]): Map<string, string> {
  const assignments = new Map<string, string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const rawValue = match[2].trim();
    if (!rawValue.startsWith('"')) continue;
    assignments.set(match[1], unquote(rawValue));
  }

  return assignments;
}

function getRootAssignments(configText: string): Map<string, string> {
  const lines = configText.split(/\r?\n/);
  const rootLines: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith('[')) break;
    rootLines.push(line);
  }

  return parseAssignments(rootLines);
}

function getTableAssignments(
  configText: string,
  tableHeader: string,
): Map<string, string> {
  const lines = configText.split(/\r?\n/);
  const expectedHeader = `[${tableHeader}]`;
  const collected: string[] = [];
  let active = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === expectedHeader) {
      active = true;
      continue;
    }
    if (active && trimmed.startsWith('[')) break;
    if (active) collected.push(line);
  }

  if (!active) {
    throw new Error(`Missing Wrangler table: ${expectedHeader}`);
  }

  return parseAssignments(collected);
}

function getArrayTableAssignments(
  configText: string,
  tableHeader: string,
): Array<Map<string, string>> {
  const lines = configText.split(/\r?\n/);
  const expectedHeader = `[[${tableHeader}]]`;
  const tables: Array<Map<string, string>> = [];
  let collected: string[] | null = null;

  const flush = () => {
    if (collected) tables.push(parseAssignments(collected));
    collected = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === expectedHeader) {
      flush();
      collected = [];
      continue;
    }
    if (collected && trimmed.startsWith('[')) {
      flush();
      continue;
    }
    if (collected) collected.push(line);
  }
  flush();

  if (tables.length === 0) {
    throw new Error(`Missing Wrangler array table: ${expectedHeader}`);
  }

  return tables;
}

function required(
  assignments: Map<string, string>,
  key: string,
  context: string,
): string {
  const value = assignments.get(key);
  if (!value) throw new Error(`Missing ${key} in ${context}`);
  return value;
}

export function parseProductionConfig(
  configText: string,
  manifestKey: string,
): D1ProductionConfig {
  const root = getRootAssignments(configText);
  const production = getTableAssignments(configText, 'env.production');
  const productionDatabases = getArrayTableAssignments(
    configText,
    'env.production.d1_databases',
  );
  const productionBuckets = getArrayTableAssignments(
    configText,
    'env.production.r2_buckets',
  );
  const stagingDatabases = getArrayTableAssignments(
    configText,
    'env.staging.d1_databases',
  );

  if (productionDatabases.length !== 1) {
    throw new Error(
      `Expected exactly one production D1 binding, found ${productionDatabases.length}`,
    );
  }

  const database = productionDatabases[0];
  const uploadBucket = productionBuckets.find(
    (bucket) => bucket.get('binding') === 'UPLOADS',
  );
  if (!uploadBucket) {
    throw new Error('Missing production UPLOADS R2 binding');
  }

  const databaseName = required(
    database,
    'database_name',
    'env.production.d1_databases',
  );
  const databaseId = required(
    database,
    'database_id',
    'env.production.d1_databases',
  );
  const binding = required(
    database,
    'binding',
    'env.production.d1_databases',
  );

  if (binding !== 'DB') {
    throw new Error(`Expected production D1 binding DB, received ${binding}`);
  }

  for (const staging of stagingDatabases) {
    const stagingName = staging.get('database_name');
    const stagingId = staging.get('database_id');
    if (stagingName === databaseName || stagingId === databaseId) {
      throw new Error('Production D1 identity must differ from staging');
    }
  }

  if (/staging|local/i.test(databaseName)) {
    throw new Error(
      `Production-only inspection refused suspicious database name: ${databaseName}`,
    );
  }

  return {
    environment: 'production',
    workerName: required(production, 'name', 'env.production'),
    binding,
    databaseName,
    databaseId,
    accountId: required(root, 'account_id', 'root Wrangler config'),
    manifestBucket: required(
      uploadBucket,
      'bucket_name',
      'env.production.r2_buckets',
    ),
    manifestKey,
  };
}

function extractJsonDocument(text: string): unknown {
  const startObject = text.indexOf('{');
  const startArray = text.indexOf('[');
  let start = -1;

  if (startObject === -1) start = startArray;
  else if (startArray === -1) start = startObject;
  else start = Math.min(startObject, startArray);

  if (start === -1) {
    throw new Error('Wrangler output did not contain JSON');
  }

  const opening = text[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) depth -= 1;
    if (depth === 0) {
      return JSON.parse(text.slice(start, index + 1)) as unknown;
    }
  }

  throw new Error('Wrangler JSON output was incomplete');
}

function assertSuccessful(
  label: string,
  result: ReadOnlyCommandResult,
): void {
  if (result.exitCode !== 0) {
    const error = result.stderr.toString('utf8').trim();
    throw new Error(`${label} failed with exit code ${result.exitCode}: ${error}`);
  }
}

function expectedChecksumFromManifestKey(manifestKey: string): string {
  const match = manifestKey.match(/\/([a-f0-9]{64})\.json\.gz$/i);
  if (!match) {
    throw new Error(`Invalid migration manifest key: ${manifestKey}`);
  }
  return `sha256:${match[1].toLowerCase()}`;
}

function extractGzipPayload(buffer: Buffer): Buffer {
  for (let index = 0; index <= buffer.length - 3; index += 1) {
    if (
      buffer[index] === 0x1f &&
      buffer[index + 1] === 0x8b &&
      buffer[index + 2] === 0x08
    ) {
      return buffer.subarray(index);
    }
  }
  throw new Error('Remote migration manifest output did not contain gzip data');
}

function decodeRemoteManifest(buffer: Buffer): RemoteMigrationManifest {
  let json: string;
  try {
    json = gunzipSync(buffer).toString('utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Remote migration manifest is not valid gzip: ${message}`);
  }

  let manifest: RemoteMigrationManifest;
  try {
    manifest = JSON.parse(json) as RemoteMigrationManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Remote migration manifest is not valid JSON: ${message}`);
  }

  if (!manifest.checksum || !Array.isArray(manifest.migrations)) {
    throw new Error('Remote migration manifest is missing checksum or migrations');
  }

  return manifest;
}

export function assertReadOnlyWranglerArgs(args: string[]): void {
  const lowered = args.map((token) => token.toLowerCase());
  const prohibited = lowered.find((token) =>
    PROHIBITED_WRANGLER_TOKENS.has(token),
  );
  if (prohibited) {
    throw new Error(`Refusing non-read-only Wrangler token: ${prohibited}`);
  }

  const command = args.join(' ');
  const allowed =
    command === 'whoami --json' ||
    command === 'd1 list --json' ||
    /^d1 info [^\s]+ --json$/.test(command) ||
    /^r2 object get [^\s]+ --pipe --remote --env production$/.test(command);

  if (!allowed) {
    throw new Error(`Wrangler command is outside the read-only allowlist: ${command}`);
  }
}

export function createWranglerRunner(root: string): ReadOnlyCommandRunner {
  return async (args) => {
    assertReadOnlyWranglerArgs(args);
    const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
      cwd: root,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
      },
    });

    if (result.error) throw result.error;

    return {
      stdout: Buffer.isBuffer(result.stdout)
        ? result.stdout
        : Buffer.from(result.stdout ?? ''),
      stderr: Buffer.isBuffer(result.stderr)
        ? result.stderr
        : Buffer.from(result.stderr ?? ''),
      exitCode: result.status ?? 1,
    };
  };
}

export async function inspectProductionIdentity(
  options: InspectProductionOptions,
): Promise<ProductionIdentityResult> {
  const config = parseProductionConfig(options.configText, options.manifestKey);

  const whoamiResult = await options.runner(['whoami', '--json']);
  assertSuccessful('wrangler whoami', whoamiResult);
  const whoami = extractJsonDocument(
    whoamiResult.stdout.toString('utf8'),
  ) as WranglerWhoami;

  if (!whoami.loggedIn) {
    throw new Error('Wrangler is not authenticated');
  }
  const accountMatched =
    whoami.accounts?.some((account) => account.id === config.accountId) ?? false;
  if (!accountMatched) {
    throw new Error(
      `Authenticated Wrangler account does not match configured account ${maskIdentifier(config.accountId)}`,
    );
  }

  const d1Result = await options.runner(['d1', 'list', '--json']);
  assertSuccessful('wrangler d1 list', d1Result);
  const databases = extractJsonDocument(
    d1Result.stdout.toString('utf8'),
  ) as WranglerD1Database[];
  if (!Array.isArray(databases)) {
    throw new Error('Wrangler D1 list response was not an array');
  }

  const idMatch = databases.find((database) => database.uuid === config.databaseId);
  const nameMatch = databases.find(
    (database) => database.name === config.databaseName,
  );
  if (!idMatch || idMatch.name !== config.databaseName) {
    throw new Error(
      `Configured production D1 was not found remotely: ${config.databaseName} (${config.databaseId})`,
    );
  }
  if (!nameMatch || nameMatch.uuid !== config.databaseId) {
    throw new Error(
      `Remote production D1 name resolves to a different ID: ${config.databaseName}`,
    );
  }

  const d1InfoResult = await options.runner([
    'd1',
    'info',
    config.databaseName,
    '--json',
  ]);
  assertSuccessful('wrangler d1 info', d1InfoResult);
  const d1Info = extractJsonDocument(
    d1InfoResult.stdout.toString('utf8'),
  ) as WranglerD1Info;
  if (
    d1Info.uuid !== config.databaseId ||
    d1Info.name !== config.databaseName
  ) {
    throw new Error(
      `Wrangler D1 info did not confirm production identity: ${config.databaseName}`,
    );
  }

  const objectPath = `${config.manifestBucket}/${config.manifestKey}`;
  const manifestResult = await options.runner([
    'r2',
    'object',
    'get',
    objectPath,
    '--pipe',
    '--remote',
    '--env',
    'production',
  ]);
  assertSuccessful('wrangler r2 object get', manifestResult);
  if (manifestResult.stdout.length === 0) {
    throw new Error(`Remote schema migration manifest was empty: ${objectPath}`);
  }

  const manifestPayload = extractGzipPayload(manifestResult.stdout);
  const manifest = decodeRemoteManifest(manifestPayload);
  const expectedManifestChecksum = expectedChecksumFromManifestKey(
    config.manifestKey,
  );
  if (manifest.checksum !== expectedManifestChecksum) {
    throw new Error(
      `Remote migration manifest checksum mismatch: expected ${expectedManifestChecksum}, received ${manifest.checksum}`,
    );
  }

  return {
    environment: 'production',
    workerName: config.workerName,
    binding: config.binding,
    databaseName: config.databaseName,
    databaseId: config.databaseId,
    databaseRegion: d1Info.running_in_region ?? null,
    databaseTableCount: d1Info.num_tables ?? null,
    databaseSizeBytes: d1Info.database_size ?? null,
    accountIdMasked: maskIdentifier(config.accountId),
    accountMatched,
    remoteDatabaseMatched: true,
    manifestBucket: config.manifestBucket,
    manifestKey: config.manifestKey,
    manifestObjectFound: true,
    manifestObjectSha256: createHash('sha256')
      .update(manifestPayload)
      .digest('hex'),
    manifestChecksum: manifest.checksum,
    manifestChecksumMatched: true,
    manifestMigrationCount: manifest.migrations?.length ?? 0,
    checkedAtUtc: (options.now ?? (() => new Date()))().toISOString(),
  };
}

export function toRedactedReport(
  result: ProductionIdentityResult,
): ProductionIdentityResult {
  return { ...result };
}

async function main(): Promise<void> {
  parseRequestedEnvironment(process.argv.slice(2));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const configText = readFileSync(join(root, 'wrangler.toml'), 'utf8');
  const result = await inspectProductionIdentity({
    configText,
    manifestKey: MIGRATIONS_R2_KEY,
    runner: createWranglerRunner(root),
  });
  process.stdout.write(`${JSON.stringify(toRedactedReport(result), null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Production inspection failed: ${message}\n`);
    process.exitCode = 1;
  });
}
