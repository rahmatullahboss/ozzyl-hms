import { executeProtectedCloneRehearsal } from './protected-clone-rehearsal-execution';
import { createLocalProtectedCloneDependencies } from './protected-clone-local-rehearsal';

interface Arguments {
  authorization: string;
  source: string;
  backup: string;
  target: string;
  evidence: string;
  atUtc: string;
}

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--') continue;
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`);
    values.set(key, value);
    index += 1;
  }
  const required = ['--authorization', '--source', '--backup', '--target', '--evidence', '--at-utc'] as const;
  for (const key of required) {
    if (!values.has(key)) throw new Error(`missing required argument ${key}`);
  }
  return {
    authorization: values.get('--authorization')!,
    source: values.get('--source')!,
    backup: values.get('--backup')!,
    target: values.get('--target')!,
    evidence: values.get('--evidence')!,
    atUtc: values.get('--at-utc')!,
  };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const receipt = await executeProtectedCloneRehearsal({
    authorizationPath: args.authorization,
    repositoryRoot: process.cwd(),
    sourceSnapshotPath: args.source,
    rollbackBackupPath: args.backup,
    targetClonePath: args.target,
    detailedEvidencePath: args.evidence,
    nowUtc: args.atUtc,
  }, createLocalProtectedCloneDependencies());
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({
    checkpoint: 'CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL',
    status: 'failed',
    error: message,
    productionMutationPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
});
