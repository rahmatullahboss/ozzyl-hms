import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type IdentityEpisodeProviderCoverageRegistry,
  validateIdentityEpisodeProviderCoverageRegistry,
} from './identity-episode-provider-coverage';

const REGISTRY_PATH = 'docs/database/canonical-identity-episode-provider-coverage-registry.json';

export function checkIdentityEpisodeProviderCoverage(rootInput: string): string[] {
  const root = resolve(rootInput);
  const absolute = join(root, REGISTRY_PATH);
  if (!existsSync(absolute)) return [`coverage registry is missing: ${REGISTRY_PATH}`];
  let registry: IdentityEpisodeProviderCoverageRegistry;
  try {
    registry = JSON.parse(readFileSync(absolute, 'utf8')) as IdentityEpisodeProviderCoverageRegistry;
  } catch {
    return ['coverage registry is not valid JSON'];
  }
  return validateIdentityEpisodeProviderCoverageRegistry(registry, root);
}

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const issues = checkIdentityEpisodeProviderCoverage(root);
  if (issues.length > 0) {
    console.error(`Identity/episode provider coverage failed with ${issues.length} issue(s):`);
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log('Identity/episode provider coverage passed with 0 issues.');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
