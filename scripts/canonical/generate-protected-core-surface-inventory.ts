import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProtectedCoreSurfaceInventory } from './protected-core-surface-inventory';

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const inventory = generateProtectedCoreSurfaceInventory(root);
  console.log(JSON.stringify({
    task: inventory.task,
    surfaceCount: inventory.summary.surfaceCount,
    protectedRouteCount: inventory.summary.protectedRouteCount,
    protectedUiFlowCount: inventory.summary.protectedUiFlowCount,
    protectedWriterCount: inventory.summary.protectedWriterCount,
    protectedReaderCount: inventory.summary.protectedReaderCount,
    protectedTableCount: inventory.summary.protectedTableCount,
    unknownWriterCount: inventory.summary.unknownWriterCount,
    unknownReaderCount: inventory.summary.unknownReaderCount,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
