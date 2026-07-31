import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCanonicalAuthorityAccessRegistry,
  DEFAULT_ACCESS_REGISTRY_REVIEWED_AT,
  type CanonicalAuthorityAccessRegistry,
} from './canonical-authority-access';

const REGISTRY_PATH = 'docs/database/canonical-authority-access-registry.yaml';

function existingReviewedAt(root: string): string {
  const absolutePath = join(root, REGISTRY_PATH);
  if (!existsSync(absolutePath)) return DEFAULT_ACCESS_REGISTRY_REVIEWED_AT;
  try {
    const registry = JSON.parse(readFileSync(absolutePath, 'utf8')) as CanonicalAuthorityAccessRegistry;
    return registry.reviewedAt || DEFAULT_ACCESS_REGISTRY_REVIEWED_AT;
  } catch {
    return DEFAULT_ACCESS_REGISTRY_REVIEWED_AT;
  }
}

export function generateCanonicalAuthorityAccessRegistry(root: string): CanonicalAuthorityAccessRegistry {
  const exactRoot = resolve(root);
  const registry = buildCanonicalAuthorityAccessRegistry({
    root: exactRoot,
    reviewedAt: existingReviewedAt(exactRoot),
  });
  writeFileSync(join(exactRoot, REGISTRY_PATH), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return registry;
}

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const registry = generateCanonicalAuthorityAccessRegistry(root);
  console.log(
    `Generated canonical authority access registry: ${registry.summary.governedTableCount} governed tables, `
      + `${registry.summary.writerCount} writers, ${registry.summary.readerCount} readers.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
