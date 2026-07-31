import { pathToFileURL } from 'node:url';
import {
  evaluateProtectedReportingMaintenanceRecoveryEvidence,
  parseReportingMaintenanceRecoveryEvidenceArgs,
} from './reporting-maintenance-recovery-evidence';

function main(): void {
  try {
    const options = parseReportingMaintenanceRecoveryEvidenceArgs(process.argv.slice(2));
    const receipt = evaluateProtectedReportingMaintenanceRecoveryEvidence(
      options.evidencePath,
      process.cwd(),
      options.atUtc ?? new Date().toISOString(),
    );
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.evidenceReady) process.exitCode = 2;
  } catch {
    process.stderr.write('CDB-101 reporting maintenance and recovery evidence validation failed.\n');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
