import { pathToFileURL } from 'node:url';
import {
  evaluateProtectedReportingForeignKeyDispositionEvidence,
  parseReportingForeignKeyDispositionEvidenceArgs,
} from './reporting-fk-disposition-evidence';

function main(): void {
  try {
    const options = parseReportingForeignKeyDispositionEvidenceArgs(process.argv.slice(2));
    const receipt = evaluateProtectedReportingForeignKeyDispositionEvidence(
      options.evidencePath,
      process.cwd(),
      options.atUtc ?? new Date().toISOString(),
    );
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.evidenceReady) process.exitCode = 2;
  } catch {
    process.stderr.write('CDB-101 reporting FK disposition evidence validation failed.\n');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
