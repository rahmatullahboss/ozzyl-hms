import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = resolve(process.cwd(), 'src');
const DELIVERY_MODULE = 'src/lib/canonical/local-sync-delivery.ts';
const ORCHESTRATOR_MODULE = 'src/lib/canonical/local-sync-orchestrator.ts';
const REHEARSAL_MODULE = 'src/lib/canonical/local-sync-rehearsal.ts';
const CONSUMER_MODULE = 'src/lib/canonical/local-sync-consumer.ts';
const NETWORK_DELIVERY_MODULE = 'src/lib/canonical/local-sync-network-delivery.ts';
const NETWORK_AUTH_MODULE = 'src/lib/canonical/local-sync-network-auth.ts';
const APPROVED_OFFLINE_MODULES = new Set([
  DELIVERY_MODULE,
  ORCHESTRATOR_MODULE,
  REHEARSAL_MODULE,
  CONSUMER_MODULE,
  NETWORK_DELIVERY_MODULE,
  NETWORK_AUTH_MODULE,
]);
const SOURCE_EXTENSION = /\.(?:ts|tsx|js|mjs)$/;
const OFFLINE_REFERENCES = [
  'local-sync-delivery',
  'local-sync-orchestrator',
  'createCanonicalSyncDatabaseDeliveryPort',
  'runCanonicalSyncOrchestrationOnce',
  'local-sync-consumer',
  'createCanonicalSyncLocalOutboxConsumerConnection',
  'local-sync-network-delivery',
  'createCanonicalSyncNetworkDeliveryPort',
  'handleCanonicalSyncNetworkDeliveryExchange',
  'local-sync-network-auth',
  'createCanonicalSyncAuthenticatedNetworkExchangePort',
  'handleCanonicalSyncAuthenticatedNetworkExchange',
] as const;
const FORBIDDEN_RUNTIME_PATTERNS = [
  /\bfetch\s*\(/,
  /\bHono\b/,
  /CLOUD_SYNC_/,
  /\bsetInterval\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bDate\.now\s*\(/,
  /\brandomUUID\s*\(/,
  /from\s+['"]node:(?:http|https|net|tls)['"]/,
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

describe('canonical offline delivery and orchestration runtime isolation', () => {
  it('has no application route, worker, scheduler, startup, or other runtime caller', () => {
    const runtimeReferences = sourceFiles(SOURCE_ROOT).flatMap((path) => {
      const repoPath = repositoryPath(path);
      if (APPROVED_OFFLINE_MODULES.has(repoPath)) return [];
      const source = readFileSync(path, 'utf8');
      return OFFLINE_REFERENCES
        .filter((reference) => source.includes(reference))
        .map((reference) => `${repoPath}:${reference}`);
    });

    expect(runtimeReferences).toEqual([]);
  });

  it('contains no network, framework, timer, wall-clock, or random-ID runtime primitive', () => {
    for (const path of [
      DELIVERY_MODULE,
      ORCHESTRATOR_MODULE,
      CONSUMER_MODULE,
      NETWORK_DELIVERY_MODULE,
      NETWORK_AUTH_MODULE,
    ]) {
      const source = readFileSync(path, 'utf8');
      const matched = FORBIDDEN_RUNTIME_PATTERNS
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${path}:${pattern.source}`);
      expect(matched).toEqual([]);
    }
  });
});
