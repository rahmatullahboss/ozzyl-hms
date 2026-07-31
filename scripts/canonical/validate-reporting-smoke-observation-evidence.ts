import { pathToFileURL } from 'node:url';
import {
  evaluateProtectedReportingSmokeObservationEvidence,
  parseReportingSmokeObservationEvidenceArgs,
} from './reporting-smoke-observation-evidence';

function main(): void {
  try {
    const options = parseReportingSmokeObservationEvidenceArgs(process.argv.slice(2));
    const receipt = evaluateProtectedReportingSmokeObservationEvidence(
      options.evidencePath,
      options.authorizationPath,
      process.cwd(),
      options.atUtc ?? new Date().toISOString(),
    );
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.evidenceReady || !receipt.authorizationBound) process.exitCode = 2;
  } catch {
    process.stderr.write('CDB-101 reporting smoke/observation evidence validation failed.\n');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
