import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { assertSchemaGovernance } from './canonical/check-schema-governance';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');
const OUTPUT_PATH = join(ROOT, 'src', 'data', 'schema-migrations.generated.ts');
const ARTIFACT_PATH = join(ROOT, '.generated', 'schema-migrations', 'manifest.json.gz');

export type Safety = 'safe' | 'destructive';

export interface MigrationEntry {
  filename: string;
  order: number;
  safety: Safety;
  contentHash: string;
  sql: string;
}

export interface MigrationMetadataEntry {
  filename: string;
  order: number;
  safety: Safety;
  contentHash: string;
}

const FILENAME_RE = /^(\d{4})(?:([dD])_|_)([a-z0-9_]+)\.sql$/i;

export function classifyMigration(filename: string): Safety {
  if (!FILENAME_RE.test(filename)) {
    throw new Error(
      `Migration filename must match NNNN_description.sql or NNNNd_description.sql: ${filename}`,
    );
  }
  return /^\d{4}[dD]_/.test(filename) ? 'destructive' : 'safe';
}

export function buildMigrationManifestVersion(checksum: string): string {
  const match = /^sha256:([0-9a-f]{64})$/.exec(checksum);
  if (!match) throw new Error('Migration manifest checksum must be SHA-256');
  return `manifest:${match[1]}`;
}

export function buildCompressedMigrationManifest(input: {
  version: string;
  checksum: string;
  migrations: readonly MigrationEntry[];
}): Buffer {
  return gzipSync(JSON.stringify(input), { level: 9 });
}

export function decodeCompressedMigrationManifest(buffer: Buffer): {
  version: string;
  checksum: string;
  migrations: MigrationEntry[];
} {
  return JSON.parse(gunzipSync(buffer).toString('utf8')) as {
    version: string;
    checksum: string;
    migrations: MigrationEntry[];
  };
}

export function buildMigrationEntry(filename: string, sql: string): MigrationEntry {
  const match = FILENAME_RE.exec(filename);
  if (!match) {
    throw new Error(`Migration filename must match NNNN_description.sql or NNNNd_description.sql: ${filename}`);
  }
  const baseNumber = Number(match[1]);
  const isDestructive = match[2] !== undefined;
  return {
    filename,
    order: isDestructive ? baseNumber + 0.1 : baseNumber,
    safety: isDestructive ? 'destructive' : 'safe',
    contentHash: `sha256:${createHash('sha256').update(sql).digest('hex')}`,
    sql,
  };
}

export function toMigrationMetadata(entry: MigrationEntry): MigrationMetadataEntry {
  return {
    filename: entry.filename,
    order: entry.order,
    safety: entry.safety,
    contentHash: entry.contentHash,
  };
}

function listMigrationFiles(): string[] {
  const allSql = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const matching: string[] = [];
  const skipped: string[] = [];
  for (const f of allSql) {
    if (f.startsWith('seed_') || f.endsWith('.bak')) {
      skipped.push(f);
      continue;
    }
    if (!FILENAME_RE.test(f)) {
      skipped.push(f);
      continue;
    }
    matching.push(f);
  }
  if (skipped.length > 0) {
    console.warn(
      `Skipping ${skipped.length} non-conforming file(s) in ${MIGRATIONS_DIR}:\n  ` +
        skipped.join('\n  '),
    );
  }
  return matching.sort();
}

function main(): void {
  assertSchemaGovernance({ root: ROOT });
  const filenames = listMigrationFiles();
  const entries: MigrationEntry[] = filenames.map((filename) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8').trim();
    return buildMigrationEntry(filename, sql);
  });
  const checksum =
    'sha256:' +
    createHash('sha256')
      .update(entries.map((e) => `${e.filename}:${e.contentHash}`).join('\n'))
      .digest('hex');
  const version = buildMigrationManifestVersion(checksum);
  const r2Key = `system/schema-migrations/${checksum.slice('sha256:'.length)}.json.gz`;
  const metadata = entries.map(toMigrationMetadata);

  const generated =
    `// AUTO-GENERATED FILE — DO NOT EDIT.\n` +
    `// Regenerate by running: pnpm build:migrations\n` +
    `// Source: scripts/build-migration-manifest.ts\n\n` +
    `export interface MigrationMetadataEntry {\n` +
    `  filename: string;\n` +
    `  order: number;\n` +
    `  safety: 'safe' | 'destructive';\n` +
    `  contentHash: string;\n` +
    `}\n\n` +
    `export const MIGRATIONS: readonly MigrationMetadataEntry[] = Object.freeze([\n` +
    metadata
      .map(
        (e) =>
          `  {\n` +
          `    filename: ${JSON.stringify(e.filename)},\n` +
          `    order: ${e.order},\n` +
          `    safety: ${JSON.stringify(e.safety)},\n` +
          `    contentHash: ${JSON.stringify(e.contentHash)},\n` +
          `  },\n`,
      )
      .join('') +
    `]);\n\n` +
    `export const MIGRATIONS_VERSION = ${JSON.stringify(version)};\n` +
    `export const MIGRATIONS_CHECKSUM = ${JSON.stringify(checksum)};\n` +
    `export const MIGRATIONS_R2_KEY = ${JSON.stringify(r2Key)};\n`;

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, generated, 'utf8');
  mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
  writeFileSync(ARTIFACT_PATH, buildCompressedMigrationManifest({
    version,
    checksum,
    migrations: entries,
  }));
  console.log(`Wrote ${entries.length} migration(s) to ${OUTPUT_PATH}`);
  console.log(`Wrote compressed migration manifest to ${ARTIFACT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
