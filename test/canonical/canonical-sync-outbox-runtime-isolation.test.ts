import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = resolve(process.cwd(), 'src');
const APPROVED_OFFLINE_MODULES = new Set([
  'src/lib/canonical/local-sync-outbox-lifecycle.ts',
  'src/lib/canonical/local-sync-orchestrator.ts',
]);
const SOURCE_EXTENSION = /\.(?:ts|tsx|js|mjs)$/;
const RUNTIME_REFERENCES = [
  'local-sync-outbox-lifecycle',
  'claimNextCanonicalSyncOutboxEnvelope',
  'completeCanonicalSyncOutboxPublication',
  'deadLetterCanonicalSyncOutboxPublication',
  'failCanonicalSyncOutboxPublication',
  'recoverExpiredCanonicalSyncOutboxLease',
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

describe('canonical source outbox lifecycle runtime isolation', () => {
  it('has no route, worker, scheduler, or application runtime caller', () => {
    const runtimeReferences = sourceFiles(SOURCE_ROOT).flatMap((path) => {
      const repositoryPath = relative(process.cwd(), path).replaceAll('\\', '/');
      if (APPROVED_OFFLINE_MODULES.has(repositoryPath)) return [];
      const source = readFileSync(path, 'utf8');
      const matchedReferences = RUNTIME_REFERENCES.filter((reference) => source.includes(reference));
      return matchedReferences.map((reference) => `${repositoryPath}:${reference}`);
    });

    expect(runtimeReferences).toEqual([]);
  });
});
