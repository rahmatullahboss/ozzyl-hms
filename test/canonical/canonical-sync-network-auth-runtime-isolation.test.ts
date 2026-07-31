import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const AUTH_MODULE = 'src/lib/canonical/local-sync-network-auth.ts';
const APPLICATION_ROOTS = [
  resolve(process.cwd(), 'src'),
  resolve(process.cwd(), 'scripts/local-server'),
] as const;
const SOURCE_EXTENSION = /\.(?:ts|tsx|js|mjs|sh)$/;
const AUTH_REFERENCES = [
  'local-sync-network-auth',
  'createCanonicalSyncAuthenticatedNetworkExchangePort',
  'handleCanonicalSyncAuthenticatedNetworkExchange',
  'CanonicalSyncAuthenticationSignerPort',
  'CanonicalSyncAuthenticationVerifierPort',
] as const;
const FORBIDDEN_AUTH_PATTERNS = [
  /\bfetch\s*\(/,
  /\bHono\b/,
  /\bprocess\b/,
  /\benv\b/,
  /\bsetInterval\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bDate\.now\s*\(/,
  /\brandomUUID\s*\(/,
  /from\s+['"]node:(?:fs|crypto|http|https|net|tls|process)['"]/,
  /\bcrypto\.subtle\b/,
  /\bcreateHmac\b/,
  /\bcreateSign\b/,
  /\bcreateVerify\b/,
  /\bimportKey\s*\(/,
  /\bwhile\s*\(/,
] as const;
const FORBIDDEN_COUPLINGS = [
  'lis-bridge-signing',
  'lis-bridge-auth',
  'routes/local-server/schema-sync',
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

describe('canonical network authentication evidence runtime isolation', () => {
  it('has no route, middleware, worker, scheduler, startup, local-server loop, or shell caller', () => {
    const references = APPLICATION_ROOTS.flatMap(files).flatMap((path) => {
      const relativePath = repoPath(path);
      if (relativePath === AUTH_MODULE) return [];
      const source = readFileSync(path, 'utf8');
      return AUTH_REFERENCES
        .filter((reference) => source.includes(reference))
        .map((reference) => `${relativePath}:${reference}`);
    });

    expect(references).toEqual([]);
  });

  it('contains no crypto implementation, built-in I/O, secret lookup, timer, wall-clock, random-ID, or loop primitive', () => {
    const source = readFileSync(AUTH_MODULE, 'utf8');
    const matched = FORBIDDEN_AUTH_PATTERNS
      .filter((pattern) => pattern.test(source))
      .map((pattern) => pattern.source);

    expect(matched).toEqual([]);
  });

  it('does not import existing LIS or local schema-sync authentication implementations', () => {
    const source = readFileSync(AUTH_MODULE, 'utf8');
    expect(FORBIDDEN_COUPLINGS.filter((reference) => source.includes(reference))).toEqual([]);
  });

  it('keeps the legacy route and shell worker on their existing generic protocol', () => {
    const route = readFileSync('src/routes/sync.ts', 'utf8');
    const worker = readFileSync('scripts/local-server/sync-worker.sh', 'utf8');

    expect(route).toContain('local_sync_outbox');
    expect(route).toContain('/outbox/flush');
    expect(route).not.toContain('local-sync-network-auth');
    expect(route).not.toContain('createCanonicalSyncAuthenticatedNetworkExchangePort');
    expect(worker).toContain('/api/sync/outbox/flush');
    expect(worker).not.toContain('local-sync-network-auth');
    expect(worker).not.toContain('createCanonicalSyncAuthenticatedNetworkExchangePort');
  });
});
