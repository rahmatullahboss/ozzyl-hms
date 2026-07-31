import { describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXPORT_SCRIPT = 'scripts/canonical/export-production.sh';
const IMPORT_SCRIPT = 'scripts/canonical/import-staging.sh';

function readScript(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

function runScript(path: string, env: Record<string, string>) {
  return spawnSync('bash', [resolve(path)], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ...env,
    },
  });
}

function createFakePnpm(root: string): { binDir: string; logFile: string } {
  const binDir = join(root, 'bin');
  const logFile = join(root, 'pnpm.log');
  mkdirSync(binDir, { recursive: true });
  const pnpmPath = join(binDir, 'pnpm');
  writeFileSync(
    pnpmPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_PNPM_LOG"

if [[ "$*" == "exec wrangler d1 info production-db --json" ]]; then
  printf '%s\\n' '{"uuid":"11111111-1111-4111-8111-111111111111","name":"production-db"}'
  exit 0
fi

if [[ "$*" == "exec wrangler d1 info clone-db --json" ]]; then
  printf '%s\\n' '{"uuid":"22222222-2222-4222-8222-222222222222","name":"clone-db","num_tables":'"\${FAKE_CLONE_TABLES:-0}"'}'
  exit 0
fi

if [[ "$1 $2 $3 $4 $5" == "exec wrangler d1 time-travel info" ]]; then
  printf '%s\\n' '{"bookmark":"test-bookmark"}'
  exit 0
fi

if [[ "$1 $2 $3 $4" == "exec wrangler d1 export" ]]; then
  output=''
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--output" ]]; then
      output="$2"
      break
    fi
    shift
  done
  [[ -n "$output" ]]
  printf '%s\\n' 'CREATE TABLE example (id INTEGER PRIMARY KEY);' > "$output"
  printf '%s\\n' 'INSERT INTO example (id) VALUES (1);' >> "$output"
  exit 0
fi

if [[ "$1 $2 $3 $4" == "exec wrangler d1 execute" ]]; then
  [[ "$5" == "clone-db" ]]
  exit 0
fi

if [[ "$1 $2 $3" == "exec tsx scripts/canonical/reconcile-clone-exports.ts" ]]; then
  output=''
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--output" ]]; then
      output="$2"
      break
    fi
    shift
  done
  [[ -n "$output" ]]
  printf '%s\\n' '{"exactMatch":true}' > "$output"
  exit 0
fi

printf 'Unexpected fake pnpm command: %s\\n' "$*" >&2
exit 70
`,
    'utf8',
  );
  chmodSync(pnpmPath, 0o755);
  return { binDir, logFile };
}

describe('CDB-011 clone script contracts', () => {
  it('hardens both scripts and requires explicit confirmation tokens', () => {
    const exportScript = readScript(EXPORT_SCRIPT);
    const importScript = readScript(IMPORT_SCRIPT);

    for (const script of [exportScript, importScript]) {
      expect(script).toContain('set -euo pipefail');
      expect(script).toContain('umask 077');
      expect(script).not.toMatch(/wrangler\.toml/);
      expect(script).not.toMatch(/d1\s+delete/);
    }

    expect(exportScript).toContain('EXPORT_PRODUCTION_D1');
    expect(importScript).toContain('IMPORT_CANONICAL_REHEARSAL_D1');
  });

  it('keeps production read-only in the export script', () => {
    const script = readScript(EXPORT_SCRIPT);

    expect(script).toMatch(/d1["'\s]+info/);
    expect(script).toMatch(/d1["'\s]+time-travel["'\s]+info/);
    expect(script).toMatch(/d1["'\s]+export/);
    expect(script).not.toMatch(/d1["'\s]+execute/);
    expect(script).not.toMatch(/d1["'\s]+restore/);
    expect(script).toContain('--remote');
    expect(script).toContain('--skip-confirmation');
  });

  it('uses timestamped non-overwriting exports with restrictive permissions', () => {
    const script = readScript(EXPORT_SCRIPT);

    expect(script).toMatch(/date\s+-u/);
    expect(script).toMatch(/EXPORT_DIR/);
    expect(script).toMatch(/\[\[\s+-e\s+"\$EXPORT_FILE"\s+\]\]/);
    expect(script).toMatch(/chmod\s+600\s+"\$EXPORT_FILE"/);
    expect(script).toMatch(/shasum\s+-a\s+256/);
    expect(script).toMatch(/wc\s+-c/);
  });

  it('refuses missing export configuration before contacting Wrangler', () => {
    const result = runScript(EXPORT_SCRIPT, {});

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/PRODUCTION_DB_NAME/);
  });

  it('refuses identical production and clone identities before import', () => {
    const result = runScript(IMPORT_SCRIPT, {
      PRODUCTION_DB_NAME: 'production-db',
      PRODUCTION_DB_ID: 'same-id',
      CLONE_DB_NAME: 'clone-db',
      CLONE_DB_ID: 'same-id',
      EXPORT_FILE: '/tmp/does-not-matter.sql',
      EXPORT_SHA256: '0'.repeat(64),
      CLONE_IMPORT_FILE: '/tmp/does-not-matter-import.sql',
      CLONE_IMPORT_SHA256: '1'.repeat(64),
      CLONE_IMPORT_CONFIRMATION: 'IMPORT_CANONICAL_REHEARSAL_D1',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/must differ/i);
  });

  it('protects known drifted and restore-drill targets', () => {
    const script = readScript(IMPORT_SCRIPT);

    expect(script).toContain('9e72382e-0d73-49da-90c8-ad5ff6fc5911');
    expect(script).toContain('860ffc7b-3add-4b99-9538-1fdb707c9590');
    expect(script).toContain('a9fbe8cb-3fc0-41cf-9272-e561fe65affd');
    expect(script).toContain('hms-super-admin-staging');
    expect(script).toContain('hms-restore-drill-20260713');
    expect(script).toMatch(/protected target/i);
  });

  it('verifies both identities and executes only the validated import bundle against the clone', () => {
    const script = readScript(IMPORT_SCRIPT);

    expect(script).toMatch(/d1["'\s]+info["'\s]+"\$PRODUCTION_DB_NAME"/);
    expect(script).toMatch(/d1["'\s]+info["'\s]+"\$CLONE_DB_NAME"/);
    expect(script).toMatch(/d1["'\s]+execute["'\s]+"\$CLONE_DB_NAME"/);
    expect(script).not.toMatch(/d1["'\s]+execute["'\s]+"\$PRODUCTION_DB_NAME"/);
    expect(script).toMatch(/--file\s+"\$CLONE_IMPORT_FILE"/);
    expect(script).not.toMatch(/--file\s+"\$EXPORT_FILE"/);
    expect(script).toContain('--remote');
    expect(script).toContain('--yes');
  });

  it('requires source export and import bundle and validates both SHA-256 values', () => {
    const script = readScript(IMPORT_SCRIPT);

    expect(script).toMatch(/\[\[\s+!\s+-f\s+"\$EXPORT_FILE"\s+\]\]/);
    expect(script).toMatch(/\[\[\s+!\s+-f\s+"\$CLONE_IMPORT_FILE"\s+\]\]/);
    expect(script).toContain('EXPORT_SHA256');
    expect(script).toContain('CLONE_IMPORT_SHA256');
    expect(script).toMatch(/shasum\s+-a\s+256/);
    expect(script).toMatch(/export checksum mismatch/i);
    expect(script).toMatch(/import bundle checksum mismatch/i);
  });

  it('exports the clone and reconciles table and row counts locally after import', () => {
    const script = readScript(IMPORT_SCRIPT);

    expect(script).toMatch(/d1["'\s]+export["'\s]+"\$CLONE_DB_NAME"/);
    expect(script).toContain('reconcile-clone-exports.ts');
    expect(script).toContain('CLONE_EXPORT_FILE');
    expect(script).toContain('RECONCILIATION_FILE');
    expect(script).toContain('--source');
    expect(script).toContain('--clone');
    expect(script).toContain('--output');
  });

  it('runs the export flow against a fake Wrangler without writing SQL to production', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-011-export-'));
    const exportDir = join(root, 'exports');
    const { binDir, logFile } = createFakePnpm(root);
    const result = runScript(EXPORT_SCRIPT, {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      FAKE_PNPM_LOG: logFile,
      PRODUCTION_DB_NAME: 'production-db',
      PRODUCTION_DB_ID: '11111111-1111-4111-8111-111111111111',
      EXPORT_DIR: exportDir,
      EXPORT_TIMESTAMP_UTC: '20260713T170000Z',
      TIME_TRAVEL_TIMESTAMP_UTC: '2026-07-13T17:00:00Z',
      PRODUCTION_EXPORT_CONFIRMATION: 'EXPORT_PRODUCTION_D1',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const exportFile = join(exportDir, 'production-db-20260713T170000Z.sql');
    const metadataFile = join(
      exportDir,
      'production-db-20260713T170000Z-metadata.json',
    );
    expect(readdirSync(exportDir).sort()).toEqual([
      'production-db-20260713T170000Z-metadata.json',
      'production-db-20260713T170000Z-time-travel.json',
      'production-db-20260713T170000Z.sql',
    ]);
    const exportBytes = readFileSync(exportFile);
    const timeTravelFile = join(
      exportDir,
      'production-db-20260713T170000Z-time-travel.json',
    );
    const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as {
      exportSha256: string;
      exportSizeBytes: number;
      timeTravelEvidenceSha256: string;
    };
    expect(metadata.exportSha256).toBe(
      createHash('sha256').update(exportBytes).digest('hex'),
    );
    expect(metadata.exportSizeBytes).toBe(exportBytes.length);
    const timeTravelBytes = readFileSync(timeTravelFile);
    const expectedTimeTravelSha256 = createHash('sha256').update(timeTravelBytes).digest('hex');
    expect(metadata.timeTravelEvidenceSha256).toBe(expectedTimeTravelSha256);
    const commandLog = readFileSync(logFile, 'utf8');
    expect(commandLog).toContain('d1 info production-db --json');
    expect(commandLog).toContain('d1 time-travel info production-db');
    expect(commandLog).toContain('d1 export production-db');
    expect(commandLog).not.toContain('d1 execute production-db');
  });

  it('refuses existing evidence paths before executing the import bundle', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-011-existing-evidence-'));
    const { binDir, logFile } = createFakePnpm(root);
    const exportFile = join(root, 'production.sql');
    const importFile = join(root, 'topological-import.sql');
    const cloneExportFile = join(root, 'already-exists.sql');
    writeFileSync(exportFile, 'CREATE TABLE example (id INTEGER PRIMARY KEY);\n');
    writeFileSync(importFile, 'CREATE TABLE example (id INTEGER PRIMARY KEY);\n');
    writeFileSync(cloneExportFile, 'existing evidence');
    const exportSha256 = createHash('sha256')
      .update(readFileSync(exportFile))
      .digest('hex');
    const importSha256 = createHash('sha256')
      .update(readFileSync(importFile))
      .digest('hex');

    const result = runScript(IMPORT_SCRIPT, {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      FAKE_PNPM_LOG: logFile,
      PRODUCTION_DB_NAME: 'production-db',
      PRODUCTION_DB_ID: '11111111-1111-4111-8111-111111111111',
      CLONE_DB_NAME: 'clone-db',
      CLONE_DB_ID: '22222222-2222-4222-8222-222222222222',
      EXPORT_FILE: exportFile,
      EXPORT_SHA256: exportSha256,
      CLONE_IMPORT_FILE: importFile,
      CLONE_IMPORT_SHA256: importSha256,
      CLONE_EXPORT_FILE: cloneExportFile,
      CLONE_IMPORT_CONFIRMATION: 'IMPORT_CANONICAL_REHEARSAL_D1',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/overwrite existing clone evidence/i);
    expect(existsSync(logFile)).toBe(false);
  });

  it('refuses a non-empty clone before executing the import bundle', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-011-non-empty-'));
    const { binDir, logFile } = createFakePnpm(root);
    const exportFile = join(root, 'production.sql');
    const importFile = join(root, 'topological-import.sql');
    writeFileSync(exportFile, 'CREATE TABLE example (id INTEGER PRIMARY KEY);\n');
    writeFileSync(importFile, 'CREATE TABLE example (id INTEGER PRIMARY KEY);\n');
    const exportSha256 = createHash('sha256')
      .update(readFileSync(exportFile))
      .digest('hex');
    const importSha256 = createHash('sha256')
      .update(readFileSync(importFile))
      .digest('hex');

    const result = runScript(IMPORT_SCRIPT, {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      FAKE_PNPM_LOG: logFile,
      FAKE_CLONE_TABLES: '3',
      PRODUCTION_DB_NAME: 'production-db',
      PRODUCTION_DB_ID: '11111111-1111-4111-8111-111111111111',
      CLONE_DB_NAME: 'clone-db',
      CLONE_DB_ID: '22222222-2222-4222-8222-222222222222',
      EXPORT_FILE: exportFile,
      EXPORT_SHA256: exportSha256,
      CLONE_IMPORT_FILE: importFile,
      CLONE_IMPORT_SHA256: importSha256,
      CLONE_IMPORT_CONFIRMATION: 'IMPORT_CANONICAL_REHEARSAL_D1',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/clone is not empty/i);
    expect(readFileSync(logFile, 'utf8')).not.toContain('d1 execute clone-db');
  });

  it('runs the import flow only against the verified clone with a fake Wrangler', () => {
    const root = mkdtempSync(join(tmpdir(), 'cdb-011-import-'));
    const { binDir, logFile } = createFakePnpm(root);
    const exportFile = join(root, 'production.sql');
    const importFile = join(root, 'topological-import.sql');
    const metadataFile = join(root, 'clone-import.json');
    writeFileSync(exportFile, 'CREATE TABLE example (id INTEGER PRIMARY KEY);\n');
    writeFileSync(importFile, 'CREATE TABLE example (id INTEGER PRIMARY KEY);\n');
    const exportSha256 = createHash('sha256')
      .update(readFileSync(exportFile))
      .digest('hex');
    const importSha256 = createHash('sha256')
      .update(readFileSync(importFile))
      .digest('hex');

    const result = runScript(IMPORT_SCRIPT, {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      FAKE_PNPM_LOG: logFile,
      PRODUCTION_DB_NAME: 'production-db',
      PRODUCTION_DB_ID: '11111111-1111-4111-8111-111111111111',
      CLONE_DB_NAME: 'clone-db',
      CLONE_DB_ID: '22222222-2222-4222-8222-222222222222',
      EXPORT_FILE: exportFile,
      EXPORT_SHA256: exportSha256,
      CLONE_IMPORT_FILE: importFile,
      CLONE_IMPORT_SHA256: importSha256,
      IMPORT_METADATA_FILE: metadataFile,
      CLONE_IMPORT_CONFIRMATION: 'IMPORT_CANONICAL_REHEARSAL_D1',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const commandLog = readFileSync(logFile, 'utf8');
    expect(commandLog).toContain('d1 info production-db --json');
    expect(commandLog).toContain('d1 info clone-db --json');
    expect(commandLog).toContain(
      `d1 execute clone-db --remote --file ${importFile}`,
    );
    expect(commandLog).not.toContain(`--file ${exportFile}`);
    expect(commandLog).not.toContain('d1 execute production-db');
    const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as {
      cloneDatabaseId: string;
      exportSha256: string;
      cloneImportSha256: string;
    };
    expect(metadata.cloneDatabaseId).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(metadata.exportSha256).toBe(exportSha256);
    expect(metadata.cloneImportSha256).toBe(importSha256);
  });
});
