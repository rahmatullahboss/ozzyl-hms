import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROTECTED_CORE_INVENTORY_PATH,
  buildProtectedCoreSurfaceInventory,
  type ProtectedCoreSurfaceInventory,
  validateProtectedCoreSurfaceInventory,
} from './protected-core-surface-inventory';

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const stored = JSON.parse(readFileSync(join(root, PROTECTED_CORE_INVENTORY_PATH), 'utf8')) as ProtectedCoreSurfaceInventory;
  const expected = buildProtectedCoreSurfaceInventory(root);
  const issues = validateProtectedCoreSurfaceInventory(stored, root);
  if (JSON.stringify(stored) !== JSON.stringify(expected)) issues.push('checked-in protected-core inventory is stale; regenerate it');
  if (issues.length > 0) {
    console.error(`Protected Core V1 surface inventory failed with ${issues.length} issue(s):`);
    for (const issue of [...new Set(issues)].sort((a, b) => a.localeCompare(b))) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Protected Core V1 surface inventory passed: ${stored.summary.surfaceCount} surfaces, `
    + `${stored.summary.protectedWriterCount} writers, ${stored.summary.protectedReaderCount} readers, `
    + `${stored.summary.unknownWriterCount + stored.summary.unknownReaderCount} unknown assignments.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
