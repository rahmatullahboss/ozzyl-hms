import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CONSUMER_MODULE = 'src/lib/canonical/local-sync-consumer.ts';
const APPLICATION_ROOTS = [
  resolve(process.cwd(), 'src'),
  resolve(process.cwd(), 'scripts/local-server'),
] as const;
const SOURCE_EXTENSION = /\.(?:ts|tsx|js|mjs|sh)$/;
const CONSUMER_REFERENCES = [
  'local-sync-consumer',
  'createCanonicalSyncLocalOutboxConsumerConnection',
  'CanonicalSyncLocalOutboxConsumerConnection',
] as const;
const FORBIDDEN_CONSUMER_PATTERNS = [
  /\bfetch\s*\(/,
  /\bHono\b/,
  /\bprocess\b/,
  /\benv\b/,
  /\bsetInterval\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bDate\.now\s*\(/,
  /\brandomUUID\s*\(/,
  /from\s+['"]node:(?:fs|http|https|net|tls|process)['"]/,
  /\bwhile\s*\(/,
] as const;

function files(directory: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const metadata = statSync(path);
    if (metadata.isDirectory()) output.push(...files(path));
    else if (metadata.isFile() && SOURCE_EXTENSION.test(entry)) output.push(path);
  }
  return output;
}

function repoPath(path: string): string {
  return relative(process.cwd(), path).replaceAll('\\', '/');
}

describe('canonical local outbox consumer runtime isolation', () => {
  it('has no route, worker, scheduler, startup, local-server loop, or shell caller', () => {
    const references = APPLICATION_ROOTS.flatMap(files).flatMap((path) => {
      const relativePath = repoPath(path);
      if (relativePath === CONSUMER_MODULE) return [];
      const source = readFileSync(path, 'utf8');
      return CONSUMER_REFERENCES
        .filter((reference) => source.includes(reference))
        .map((reference) => `${relativePath}:${reference}`);
    });

    expect(references).toEqual([]);
  });

  it('contains no runtime, network, timer, environment, filesystem, or implicit-clock primitive', () => {
    const source = readFileSync(CONSUMER_MODULE, 'utf8');
    const matched = FORBIDDEN_CONSUMER_PATTERNS
      .filter((pattern) => pattern.test(source))
      .map((pattern) => pattern.source);

    expect(matched).toEqual([]);
  });

  it('keeps the legacy route and shell worker on their existing generic protocol', () => {
    const route = readFileSync('src/routes/sync.ts', 'utf8');
    const worker = readFileSync('scripts/local-server/sync-worker.sh', 'utf8');

    expect(route).toContain('local_sync_outbox');
    expect(route).toContain('/outbox/flush');
    expect(route).not.toContain('local-sync-consumer');
    expect(route).not.toContain('createCanonicalSyncLocalOutboxConsumerConnection');
    expect(worker).toContain('/api/sync/outbox/flush');
    expect(worker).not.toContain('local-sync-consumer');
    expect(worker).not.toContain('createCanonicalSyncLocalOutboxConsumerConnection');
  });
});
