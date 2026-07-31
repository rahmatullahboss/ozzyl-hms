import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = resolve(process.cwd(), 'src');
const REHEARSAL_MODULE = 'src/lib/canonical/local-sync-rehearsal.ts';
const SOURCE_EXTENSION = /\.(?:ts|tsx|js|mjs)$/;
const REFERENCES = ['local-sync-rehearsal', 'runCanonicalSyncOfflineRehearsal'] as const;
const FORBIDDEN = [
  /\bfetch\s*\(/,
  /\bHono\b/,
  /CLOUD_SYNC_/,
  /\bsetInterval\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bDate\.now\s*\(/,
  /\brandomUUID\s*\(/,
  /from\s+['"]node:fs['"]/,
  /from\s+['"]node:child_process['"]/,
  /\bprocess\.argv\b/,
  /\bwhile\s*\(/,
] as const;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const metadata = statSync(path);
    if (metadata.isDirectory()) files.push(...sourceFiles(path));
    else if (metadata.isFile() && SOURCE_EXTENSION.test(entry)) files.push(path);
  }
  return files;
}

function repositoryPath(path: string): string {
  return relative(process.cwd(), path).replaceAll('\\', '/');
}

describe('canonical disconnected rehearsal runtime isolation', () => {
  it('has no application route, worker, scheduler, startup, or other runtime caller', () => {
    const references = sourceFiles(SOURCE_ROOT).flatMap((path) => {
      const repoPath = repositoryPath(path);
      if (repoPath === REHEARSAL_MODULE) return [];
      const body = readFileSync(path, 'utf8');
      return REFERENCES
        .filter((reference) => body.includes(reference))
        .map((reference) => `${repoPath}:${reference}`);
    });
    expect(references).toEqual([]);
  });

  it('contains no network, process, filesystem, timer, wall-clock, random-ID, or unbounded-loop primitive', () => {
    const body = readFileSync(REHEARSAL_MODULE, 'utf8');
    const matches = FORBIDDEN
      .filter((pattern) => pattern.test(body))
      .map((pattern) => pattern.source);
    expect(matches).toEqual([]);
  });
});
