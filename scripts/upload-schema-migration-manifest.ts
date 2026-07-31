import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS_R2_KEY } from '../src/data/schema-migrations.generated';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ARTIFACT_PATH = join(ROOT, '.generated', 'schema-migrations', 'manifest.json.gz');

const bucketByEnv: Record<string, string> = {
  production: 'hms-uploads-production',
  staging: 'hms-uploads-staging',
};

const env = process.argv[2] ?? 'production';
const bucket = bucketByEnv[env];

if (!bucket) {
  throw new Error(`Unsupported environment for schema manifest upload: ${env}`);
}

if (!existsSync(ARTIFACT_PATH)) {
  throw new Error(`Schema migration manifest artifact is missing. Run pnpm build:migrations first: ${ARTIFACT_PATH}`);
}

const objectPath = `${bucket}/${MIGRATIONS_R2_KEY}`;
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'r2',
    'object',
    'put',
    objectPath,
    '--file',
    ARTIFACT_PATH,
    '--content-type',
    'application/gzip',
    '--env',
    env,
    '--remote',
    '--force',
  ],
  {
    cwd: ROOT,
    stdio: 'inherit',
  },
);

if (result.status !== 0) {
  throw new Error(`Failed to upload schema migration manifest to R2 (${objectPath})`);
}
