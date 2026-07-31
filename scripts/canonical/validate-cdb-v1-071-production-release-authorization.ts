import { pathToFileURL } from 'node:url';
import { prepareProtectedCdbV1071Authorization } from './cdb-v1-071-production-release-authorization';

export function parseCdbV1071AuthorizationArgs(args: string[]): { authorizationPath: string } {
  const filtered = args.filter((arg) => arg !== '--');
  const index = filtered.indexOf('--authorization');
  const authorizationPath = index >= 0 ? filtered[index + 1] : undefined;
  if (!authorizationPath || authorizationPath.startsWith('--')) {
    throw new Error('--authorization requires a protected JSON file path');
  }
  if (filtered.length !== 2 || index !== 0) {
    throw new Error('Only --authorization <path> is accepted');
  }
  return { authorizationPath };
}

function main(): void {
  try {
    const { authorizationPath } = parseCdbV1071AuthorizationArgs(process.argv.slice(2));
    const result = prepareProtectedCdbV1071Authorization(
      authorizationPath,
      process.cwd(),
      new Date().toISOString(),
    );
    process.stdout.write(`${JSON.stringify(result.receipt, null, 2)}\n`);
    if (!result.receipt.executionReady) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
