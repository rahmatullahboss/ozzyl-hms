import { pathToFileURL } from 'node:url';
import {
  evaluateProtectedReportingWorkerBuildVersionEvidence,
  parseReportingWorkerBuildVersionEvidenceArgs,
} from './reporting-worker-build-version-evidence';

function main(): void {
  try {
    const options = parseReportingWorkerBuildVersionEvidenceArgs(process.argv.slice(2));
    const receipt = evaluateProtectedReportingWorkerBuildVersionEvidence(
      options.evidencePath,
      process.cwd(),
      options.atUtc ?? new Date().toISOString(),
    );
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.evidenceReady) process.exitCode = 2;
  } catch {
    process.stderr.write('CDB-101 reporting Worker build/version evidence validation failed.\n');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
