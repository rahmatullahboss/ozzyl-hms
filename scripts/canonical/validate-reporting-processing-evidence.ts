import { pathToFileURL } from 'node:url';
import {
  evaluateProtectedReportingProcessingEvidence,
  parseReportingProcessingEvidenceArgs,
} from './reporting-processing-evidence';

function main(): void {
  try {
    const options = parseReportingProcessingEvidenceArgs(process.argv.slice(2));
    const receipt = evaluateProtectedReportingProcessingEvidence(
      options.evidencePath,
      options.authorizationPath,
      process.cwd(),
      options.atUtc,
    );
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    process.exitCode = receipt.shadowFlagReady ? 0 : 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 processing evidence validation failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
