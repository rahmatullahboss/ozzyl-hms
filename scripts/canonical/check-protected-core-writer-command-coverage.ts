import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROTECTED_CORE_WRITER_COVERAGE_PATH,
  buildProtectedCoreWriterCommandCoverage,
  type ProtectedCoreWriterCommandCoverage,
  validateProtectedCoreWriterCommandCoverage,
} from './protected-core-writer-command-coverage';

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const stored = JSON.parse(readFileSync(join(root, PROTECTED_CORE_WRITER_COVERAGE_PATH), 'utf8')) as ProtectedCoreWriterCommandCoverage;
  const expected = buildProtectedCoreWriterCommandCoverage(root);
  const issues = validateProtectedCoreWriterCommandCoverage(stored, root);
  if (JSON.stringify(stored) !== JSON.stringify(expected)) issues.push('checked-in protected writer command coverage is stale; regenerate it');

  if (issues.length > 0) {
    console.error(`Protected writer command coverage failed with ${issues.length} issue(s):`);
    for (const issue of [...new Set(issues)].sort((a, b) => a.localeCompare(b))) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Protected writer command coverage passed: ${stored.summary.writerCount} writers, `
    + `${stored.summary.commandRequiredWriterCount} command-required, `
    + `${stored.summary.unclassifiedWriterCount} unclassified.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
