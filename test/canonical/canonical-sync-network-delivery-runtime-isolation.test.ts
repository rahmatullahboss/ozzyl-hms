import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const NETWORK_MODULE = 'src/lib/canonical/local-sync-network-delivery.ts';
const ALLOWED_LIBRARY_CALLERS = new Set([
  'src/lib/canonical/local-sync-network-auth.ts',
]);
const APPLICATION_ROOTS = [
  resolve(process.cwd(), 'src'),
  resolve(process.cwd(), 'scripts/local-server'),
] as const;
const SOURCE_EXTENSION = /\.(?:ts|tsx|js|mjs|sh)$/;
const NETWORK_REFERENCES = [
  'local-sync-network-delivery',
  'createCanonicalSyncNetworkDeliveryPort',
  'handleCanonicalSyncNetworkDeliveryExchange',
  'CanonicalSyncNetworkExchangePort',
] as const;
const FORBIDDEN_PATTERNS = [
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

describe('canonical network delivery adapter runtime isolation', () => {
  it('has no route, worker, scheduler, startup, local-server loop, or shell caller', () => {
    const references = APPLICATION_ROOTS.flatMap(files).flatMap((path) => {
      const relativePath = repoPath(path);
      if (relativePath === NETWORK_MODULE || ALLOWED_LIBRARY_CALLERS.has(relativePath)) return [];
      const source = readFileSync(path, 'utf8');
      return NETWORK_REFERENCES
        .filter((reference) => source.includes(reference))
        .map((reference) => `${relativePath}:${reference}`);
    });

    expect(references).toEqual([]);
  });

  it('contains no built-in I/O, framework, credential lookup, timer, wall-clock, random-ID, or loop primitive', () => {
    const source = readFileSync(NETWORK_MODULE, 'utf8');
    const matched = FORBIDDEN_PATTERNS
      .filter((pattern) => pattern.test(source))
      .map((pattern) => pattern.source);

    expect(matched).toEqual([]);
  });

  it('keeps the legacy route and shell worker on their existing generic protocol', () => {
    const route = readFileSync('src/routes/sync.ts', 'utf8');
    const worker = readFileSync('scripts/local-server/sync-worker.sh', 'utf8');

    expect(route).toContain('local_sync_outbox');
    expect(route).toContain('/outbox/flush');
    expect(route).not.toContain('local-sync-network-delivery');
    expect(route).not.toContain('createCanonicalSyncNetworkDeliveryPort');
    expect(worker).toContain('/api/sync/outbox/flush');
    expect(worker).not.toContain('local-sync-network-delivery');
    expect(worker).not.toContain('createCanonicalSyncNetworkDeliveryPort');
  });
});
