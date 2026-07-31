import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  inspectProductionIdentity,
  maskIdentifier,
  parseProductionConfig,
  parseRequestedEnvironment,
  toRedactedReport,
  type ReadOnlyCommandRunner,
} from '../../scripts/canonical/inspect-production';

const CONFIG = `
name = "hms-saas"
account_id = "474078d5f990169d7dadf4e1df83214a"
compatibility_flags = ["nodejs_compat"]

[env.staging]
name = "hms-saas-staging"

[[env.staging.d1_databases]]
binding = "DB"
database_name = "hms-super-admin-staging"
database_id = "9e72382e-0d73-49da-90c8-ad5ff6fc5911"

[env.production]
name = "hms-saas-production"

[[env.production.d1_databases]]
binding = "DB"
database_name = "hms-super-admin-production-apac"
database_id = "c68a5360-a2c1-44cc-9e71-f21057bea102"

[[env.production.r2_buckets]]
binding = "UPLOADS"
bucket_name = "hms-uploads-production"
`;

const MANIFEST_DIGEST = 'a'.repeat(64);
const MANIFEST_CHECKSUM = `sha256:${MANIFEST_DIGEST}`;
const MANIFEST_KEY = `system/schema-migrations/${MANIFEST_DIGEST}.json.gz`;
const MANIFEST = gzipSync(
  Buffer.from(
    JSON.stringify({
      version: '2026-07-13T00:00:00.000Z',
      checksum: MANIFEST_CHECKSUM,
      migrations: [
        { filename: '0001_example.sql' },
        { filename: '0002_example.sql' },
      ],
    }),
  ),
);

describe('production D1 inspection contract', () => {
  it('parses only the explicit production binding and detects staging isolation', () => {
    const config = parseProductionConfig(CONFIG, MANIFEST_KEY);

    expect(config).toEqual({
      environment: 'production',
      workerName: 'hms-saas-production',
      binding: 'DB',
      databaseName: 'hms-super-admin-production-apac',
      databaseId: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
      accountId: '474078d5f990169d7dadf4e1df83214a',
      manifestBucket: 'hms-uploads-production',
      manifestKey: MANIFEST_KEY,
    });
  });

  it('rejects a missing environment value', () => {
    expect(() => parseRequestedEnvironment(['--env'])).toThrow(/requires a value/i);
  });

  it.each(['staging', 'local_server', 'development'])(
    'rejects non-production environment %s',
    (environment) => {
      expect(() => parseRequestedEnvironment(['--env', environment])).toThrow(
        /production-only/i,
      );
    },
  );

  it('rejects a production binding that aliases staging', () => {
    const unsafeConfig = CONFIG.replace(
      'c68a5360-a2c1-44cc-9e71-f21057bea102',
      '9e72382e-0d73-49da-90c8-ad5ff6fc5911',
    );

    expect(() => parseProductionConfig(unsafeConfig, MANIFEST_KEY)).toThrow(
      /must differ from staging/i,
    );
  });

  it('masks account identifiers without exposing the full value', () => {
    expect(maskIdentifier('474078d5f990169d7dadf4e1df83214a')).toBe(
      '4740…214a',
    );
  });

  it('uses only read-only Wrangler commands and verifies account, D1, and manifest identity', async () => {
    const calls: string[][] = [];
    const runner: ReadOnlyCommandRunner = async (args) => {
      calls.push(args);
      const command = args.join(' ');

      if (command === 'whoami --json') {
        return {
          stdout: Buffer.from(
            JSON.stringify({
              loggedIn: true,
              email: 'operator@example.test',
              accounts: [
                {
                  id: '474078d5f990169d7dadf4e1df83214a',
                  name: 'Production account',
                },
              ],
            }),
          ),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        };
      }

      if (command === 'd1 list --json') {
        return {
          stdout: Buffer.from(
            `${JSON.stringify([
              {
                uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
                name: 'hms-super-admin-production-apac',
              },
            ])}\nWrangler update available`,
          ),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        };
      }

      if (
        command ===
        'd1 info hms-super-admin-production-apac --json'
      ) {
        return {
          stdout: Buffer.from(
            `Wrangler update available\n${JSON.stringify({
              uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
              name: 'hms-super-admin-production-apac',
              num_tables: 779,
              running_in_region: 'APAC',
              database_size: 33521664,
            })}`,
          ),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        };
      }

      if (
        command ===
        `r2 object get hms-uploads-production/${MANIFEST_KEY} --pipe --remote --env production`
      ) {
        return {
          stdout: Buffer.concat([
            Buffer.from('Wrangler update available\n'),
            MANIFEST,
          ]),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    };

    const result = await inspectProductionIdentity({
      configText: CONFIG,
      manifestKey: MANIFEST_KEY,
      runner,
    });

    expect(result).toMatchObject({
      environment: 'production',
      binding: 'DB',
      databaseName: 'hms-super-admin-production-apac',
      databaseId: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
      databaseRegion: 'APAC',
      databaseTableCount: 779,
      databaseSizeBytes: 33521664,
      accountIdMasked: '4740…214a',
      accountMatched: true,
      remoteDatabaseMatched: true,
      manifestObjectFound: true,
      manifestObjectSha256: createHash('sha256').update(MANIFEST).digest('hex'),
      manifestChecksum: MANIFEST_CHECKSUM,
      manifestChecksumMatched: true,
      manifestMigrationCount: 2,
    });

    expect(calls).toEqual([
      ['whoami', '--json'],
      ['d1', 'list', '--json'],
      ['d1', 'info', 'hms-super-admin-production-apac', '--json'],
      [
        'r2',
        'object',
        'get',
        `hms-uploads-production/${MANIFEST_KEY}`,
        '--pipe',
        '--remote',
        '--env',
        'production',
      ],
    ]);

    const allTokens = calls.flat().map((token) => token.toLowerCase());
    expect(allTokens).not.toContain('execute');
    expect(allTokens).not.toContain('export');
    expect(allTokens).not.toContain('deploy');
    expect(allTokens).not.toContain('put');
    expect(allTokens).not.toContain('delete');
    expect(allTokens).not.toContain('create');
  });

  it('exposes the production-only inspection command through package scripts', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['canonical:inspect-production']).toBe(
      'tsx scripts/canonical/inspect-production.ts --env production',
    );
  });

  it('produces a report without the full account id or operator email', async () => {
    const runner: ReadOnlyCommandRunner = async (args) => {
      if (args[0] === 'whoami') {
        return {
          stdout: Buffer.from(
            JSON.stringify({
              loggedIn: true,
              email: 'operator@example.test',
              accounts: [
                {
                  id: '474078d5f990169d7dadf4e1df83214a',
                  name: 'Production account',
                },
              ],
            }),
          ),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        };
      }
      if (args[0] === 'd1' && args[1] === 'list') {
        return {
          stdout: Buffer.from(
            JSON.stringify([
              {
                uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
                name: 'hms-super-admin-production-apac',
              },
            ]),
          ),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        };
      }
      if (args[0] === 'd1' && args[1] === 'info') {
        return {
          stdout: Buffer.from(
            JSON.stringify({
              uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
              name: 'hms-super-admin-production-apac',
              num_tables: 779,
              running_in_region: 'APAC',
              database_size: 33521664,
            }),
          ),
          stderr: Buffer.alloc(0),
          exitCode: 0,
        };
      }
      return {
        stdout: Buffer.concat([
          Buffer.from('Wrangler update available\n'),
          MANIFEST,
        ]),
        stderr: Buffer.alloc(0),
        exitCode: 0,
      };
    };

    const result = await inspectProductionIdentity({
      configText: CONFIG,
      manifestKey: MANIFEST_KEY,
      runner,
    });
    const report = JSON.stringify(toRedactedReport(result));

    expect(report).not.toContain('474078d5f990169d7dadf4e1df83214a');
    expect(report).not.toContain('operator@example.test');
    expect(report).toContain('4740…214a');
    expect(report).toContain('c68a5360-a2c1-44cc-9e71-f21057bea102');
  });
});
