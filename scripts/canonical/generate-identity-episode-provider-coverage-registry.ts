import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIdentityEpisodeProviderCoverageRegistry } from './identity-episode-provider-coverage';

const OUTPUT_PATH = 'docs/database/canonical-identity-episode-provider-coverage-registry.json';

export function generateIdentityEpisodeProviderCoverageRegistry(rootInput: string) {
  const root = resolve(rootInput);
  const registry = buildIdentityEpisodeProviderCoverageRegistry(root);
  writeFileSync(join(root, OUTPUT_PATH), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return registry;
}

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const registry = generateIdentityEpisodeProviderCoverageRegistry(root);
  console.log(
    `Generated identity/episode provider coverage: ${registry.summary.eligibleReaderPairs} readers, `
      + `${registry.summary.uniquePaths} paths, ${registry.summary.uniqueTables} tables, `
      + `${registry.summary.unknownProviderAssignments} unknown.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
