import { resolve } from 'node:path';
import {
  buildProtectedCloneRehearsalPlan,
  evaluateProtectedCloneRehearsalAuthorization,
  loadProtectedCloneRehearsalAuthorization,
} from './protected-clone-rehearsal-authorization';

interface CliOptions {
  authorizationPath: string;
  atUtc: string;
}

function parseArgs(argv: string[]): CliOptions {
  let authorizationPath = '';
  let atUtc = new Date().toISOString();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--authorization') {
      authorizationPath = value ?? '';
      index += 1;
    } else if (arg === '--at-utc') {
      atUtc = value ?? '';
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!authorizationPath) throw new Error('--authorization is required');
  if (!atUtc) throw new Error('--at-utc cannot be empty');
  return { authorizationPath, atUtc };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const repositoryRoot = process.cwd();
  const authorizationPath = resolve(options.authorizationPath);
  const result = loadProtectedCloneRehearsalAuthorization(
    authorizationPath,
    repositoryRoot,
    options.atUtc,
  );
  const receipt = evaluateProtectedCloneRehearsalAuthorization(
    authorizationPath,
    repositoryRoot,
    options.atUtc,
  );
  const output = {
    receipt,
    issues: result.issues,
    plan: result.executionReady ? buildProtectedCloneRehearsalPlan(result) : null,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!result.executionReady) process.exitCode = 1;
}

main();
