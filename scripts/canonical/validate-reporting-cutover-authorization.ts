import { pathToFileURL } from 'node:url';
import {
  evaluateProtectedReportingCutoverAuthorization,
  parseReportingAuthorizationValidatorArgs,
} from './reporting-cutover-authorization-document';

function main(): void {
  try {
    const options = parseReportingAuthorizationValidatorArgs(process.argv.slice(2));
    const receipt = evaluateProtectedReportingCutoverAuthorization(
      options.authorizationPath,
      process.cwd(),
      options.atUtc ?? new Date().toISOString(),
    );
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.executionReady) process.exitCode = 2;
  } catch {
    process.stderr.write('CDB-101 reporting authorization validation failed.\n');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
