import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hashPassword, isLegacyBcryptHash, verifyPassword } from '../src/lib/password';
import {
  buildAtomicPasswordUpdateSql,
  buildPasswordLookupSql,
  parseMigrationEntries,
  type StaffPasswordMigrationEntry,
} from './lib/staff-password-pbkdf2-migration';

type Args = {
  apply: boolean;
  database: string;
  environment: string;
  input?: string;
  list: boolean;
};

type StaffPasswordRow = {
  id: number;
  tenant_id: number | null;
  email: string | null;
  role: string;
  password_hash: string | null;
  tenant_slug?: string | null;
};

type D1Execution<T> = {
  results?: T[];
  success?: boolean;
  meta?: {
    changes?: number;
  };
};

const DEFAULT_DATABASE = 'hms-super-admin-production-apac';
const DEFAULT_ENVIRONMENT = 'production';

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: argv.includes('--apply'),
    database: DEFAULT_DATABASE,
    environment: DEFAULT_ENVIRONMENT,
    list: argv.includes('--list'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--input' && next) {
      args.input = next;
      index += 1;
    } else if (arg === '--database' && next) {
      args.database = next;
      index += 1;
    } else if (arg === '--env' && next) {
      args.environment = next;
      index += 1;
    }
  }

  if (args.list && args.input) {
    throw new Error('Use either --list or --input, not both');
  }
  if (!args.list && !args.input) {
    throw new Error('Usage: --list OR --input <local-secret.json> [--apply]');
  }
  if (args.apply && args.list) {
    throw new Error('--apply cannot be used with --list');
  }

  return args;
}

function parseWranglerJson<T>(stdout: string): D1Execution<T>[] {
  const candidateStarts = [...stdout.matchAll(/(?:^|\n)\s*\[/g)].map((match) => {
    const index = match.index ?? 0;
    return stdout[index] === '\n' ? index + 1 : index;
  });

  for (const start of candidateStarts) {
    for (let end = stdout.lastIndexOf(']'); end > start; end = stdout.lastIndexOf(']', end - 1)) {
      try {
        const parsed = JSON.parse(stdout.slice(start, end + 1)) as D1Execution<T>[];
        if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
          return parsed;
        }
      } catch {
        // Wrangler may surround JSON with update notices or warnings.
      }
    }
  }

  throw new Error(`Could not parse Wrangler JSON output. Output ended with: ${stdout.slice(-500)}`);
}

function executeD1<T>(args: Args, sql: string): D1Execution<T> {
  const localWrangler = path.join(process.cwd(), 'node_modules', '.bin', 'wrangler');
  const command = existsSync(localWrangler) ? localWrangler : 'pnpm';
  const commandArgs = existsSync(localWrangler)
    ? ['d1', 'execute', args.database, '--env', args.environment, '--remote', '--json', '--command', sql]
    : ['exec', 'wrangler', 'd1', 'execute', args.database, '--env', args.environment, '--remote', '--json', '--command', sql];
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`Wrangler exited with ${result.status}: ${result.stderr || 'No stderr output'}`);
  }

  const first = parseWranglerJson<T>(result.stdout)[0];
  if (!first?.success) {
    throw new Error('D1 command did not report success');
  }
  return first;
}

function listLegacyUsers(args: Args): void {
  const sql = [
    'SELECT u.id, u.tenant_id, u.email, u.role, t.subdomain AS tenant_slug',
    'FROM users u',
    'LEFT JOIN tenants t ON t.id = u.tenant_id',
    "WHERE substr(u.password_hash, 1, 1) = char(36) AND substr(u.password_hash, 2, 2) IN ('2a', '2b')",
    'ORDER BY u.tenant_id, u.id;',
  ].join(' ');
  const rows = executeD1<StaffPasswordRow>(args, sql).results ?? [];

  console.table(rows.map((row) => ({
    userId: row.id,
    tenantId: row.tenant_id,
    tenant: row.tenant_slug ?? '(missing tenant)',
    email: row.email ?? '(no email)',
    role: row.role,
  })));
  console.log(`Legacy bcrypt accounts: ${rows.length}`);
}

function readEntries(inputPath: string): StaffPasswordMigrationEntry[] {
  const resolved = path.resolve(inputPath);
  if (!existsSync(resolved)) {
    throw new Error(`Input file not found: ${resolved}`);
  }
  return parseMigrationEntries(readFileSync(resolved, 'utf8'));
}

async function migrateEntry(args: Args, entry: StaffPasswordMigrationEntry): Promise<'migrated' | 'ready' | 'skipped'> {
  const lookup = executeD1<StaffPasswordRow>(args, buildPasswordLookupSql(entry.userId, entry.tenantId));
  const row = lookup.results?.[0];
  if (!row) {
    throw new Error(`No user found for tenantId ${entry.tenantId}, userId ${entry.userId}`);
  }
  if (!row.password_hash) {
    throw new Error(`User ${entry.userId} has no local password hash`);
  }
  if (row.password_hash.startsWith('pbkdf2:')) {
    console.log(`[skip] tenant ${entry.tenantId}, user ${entry.userId}: already PBKDF2`);
    return 'skipped';
  }
  if (!isLegacyBcryptHash(row.password_hash)) {
    throw new Error(`User ${entry.userId} has an unsupported password hash format`);
  }

  const verified = await verifyPassword(entry.password, row.password_hash);
  if (!verified) {
    throw new Error(`Current password did not match for tenantId ${entry.tenantId}, userId ${entry.userId}`);
  }

  const nextHash = await hashPassword(entry.password);
  if (!args.apply) {
    console.log(`[dry-run] tenant ${entry.tenantId}, user ${entry.userId}: verified and ready`);
    return 'ready';
  }

  const update = executeD1<never>(args, buildAtomicPasswordUpdateSql({
    userId: entry.userId,
    tenantId: entry.tenantId,
    oldHash: row.password_hash,
    newHash: nextHash,
  }));
  if (update.meta?.changes !== 1) {
    throw new Error(`Atomic update changed ${update.meta?.changes ?? 0} rows for user ${entry.userId}`);
  }

  const verification = executeD1<StaffPasswordRow>(args, buildPasswordLookupSql(entry.userId, entry.tenantId));
  if (!verification.results?.[0]?.password_hash?.startsWith('pbkdf2:')) {
    throw new Error(`Post-update verification failed for user ${entry.userId}`);
  }

  console.log(`[migrated] tenant ${entry.tenantId}, user ${entry.userId}`);
  return 'migrated';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    listLegacyUsers(args);
    return;
  }

  if (args.apply && process.env.HMS_CONFIRM_BCRYPT_TO_PBKDF2 === 'YES') {
    console.log('Production write confirmation accepted.');
  } else if (args.apply) {
    throw new Error('Set HMS_CONFIRM_BCRYPT_TO_PBKDF2=YES before using --apply');
  } else {
    console.log('Dry-run mode: no database writes will be performed.');
  }

  const entries = readEntries(args.input!);
  const summary = { failed: 0, migrated: 0, ready: 0, skipped: 0 };

  for (const entry of entries) {
    try {
      const outcome = await migrateEntry(args, entry);
      summary[outcome] += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`[failed] tenant ${entry.tenantId}, user ${entry.userId}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
