import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProtectedCoreWriterCommandCoverage } from './protected-core-writer-command-coverage';

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const coverage = generateProtectedCoreWriterCommandCoverage(root);
  console.log(JSON.stringify({
    task: coverage.task,
    writerCount: coverage.summary.writerCount,
    canonicalCommandWriterCount: coverage.summary.canonicalCommandWriterCount,
    atomicCompatibilityWriterCount: coverage.summary.atomicCompatibilityWriterCount,
    externalGovernedWriterCount: coverage.summary.externalGovernedWriterCount,
    strictBlockedWriterCount: coverage.summary.strictBlockedWriterCount,
    commandRequiredWriterCount: coverage.summary.commandRequiredWriterCount,
    fixtureIsolatedWriterCount: coverage.summary.fixtureIsolatedWriterCount,
    unclassifiedWriterCount: coverage.summary.unclassifiedWriterCount,
    implementationGroupCount: coverage.implementationGroups.length,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
