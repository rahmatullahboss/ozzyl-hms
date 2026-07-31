import { describe, expect, it } from 'vitest';
import {
  createProductionFinancialStrictGateway,
  parseProductionFinancialStrictArgs,
  type FinancialStrictCommandRunner,
} from '../../scripts/canonical/execute-production-financial-strict-flag';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

function success(results: Array<Record<string, unknown>> = [], meta: Record<string, unknown> = {}) {
  return JSON.stringify([{ success: true, results, meta }]);
}

describe('production financial strict flag gateway', () => {
  it('binds identity, exact 100/0 deployment versions, flag reads, and one-row writes to production', async () => {
    const commands: string[][] = [];
    const runner: FinancialStrictCommandRunner = (args) => {
      commands.push(args);
      if (args[0] === 'd1' && args[1] === 'info') {
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify({ name: CDB101_PRODUCTION_DATABASE_NAME, uuid: CDB101_PRODUCTION_DATABASE_ID }),
        };
      }
      if (args[0] === 'deployments') {
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify([
            { created_on: '2026-07-18T19:00:00Z', versions: [{ version_id: 'old', percentage: 100 }] },
            {
              created_on: '2026-07-18T20:00:00Z',
              versions: [
                { version_id: 'active-worker', percentage: 100 },
                { version_id: 'candidate', percentage: 0 },
              ],
            },
          ]),
        };
      }
      if (args.some((arg) => arg.includes('SELECT tenant_id,flag_key,domain,mode,is_enabled,version,config_json'))) {
        return {
          status: 0,
          stderr: '',
          stdout: success([{
            tenant_id: '100',
            flag_key: 'canonical_financial_dual_write_v1',
            domain: 'financial',
            mode: 'disabled',
            is_enabled: 0,
            version: 2,
            config_json: '{"tenantScope":["100"],"writePolicy":"canonical-only"}',
          }], { changed_db: false, rows_written: 0 }),
        };
      }
      return {
        status: 0,
        stderr: '',
        stdout: success([], { changed_db: true, changes: 1, rows_written: 1 }),
      };
    };

    const gateway = createProductionFinancialStrictGateway(runner);
    await expect(gateway.readDatabaseIdentity()).resolves.toEqual({
      name: CDB101_PRODUCTION_DATABASE_NAME,
      uuid: CDB101_PRODUCTION_DATABASE_ID,
    });
    await expect(gateway.readDeploymentVersions()).resolves.toEqual([
      { versionId: 'active-worker', percentage: 100 },
      { versionId: 'candidate', percentage: 0 },
    ]);
    await expect(gateway.readFlag()).resolves.toHaveLength(1);
    await expect(gateway.writeFlag('UPDATE canonical_feature_flags SET is_enabled=1;')).resolves.toEqual({
      changes: 1,
      rowsWritten: 1,
    });

    expect(commands.some((args) => args.includes('--remote') && args.includes('--env') && args.includes('production'))).toBe(true);
    expect(commands.at(-1)).toContain('--yes');
  });

  it('rejects unsuccessful D1 envelopes', async () => {
    const gateway = createProductionFinancialStrictGateway(() => ({
      status: 0,
      stderr: '',
      stdout: JSON.stringify([{ success: false, results: [] }]),
    }));

    await expect(gateway.readFlag()).rejects.toThrow('unsuccessful envelope');
  });

  it('parses the explicit protected execution contract and keeps execute opt-in', () => {
    expect(parseProductionFinancialStrictArgs([
      '--',
      '--action', 'enable',
      '--evidence', '/tmp/evidence.json',
      '--effective-at-utc', '2026-07-18T20:00:00Z',
      '--approval', 'approved-id',
      '--output', '/tmp/receipt.json',
      '--execute',
    ])).toEqual({
      action: 'enable',
      evidencePath: '/tmp/evidence.json',
      effectiveAtUtc: '2026-07-18T20:00:00Z',
      approval: 'approved-id',
      outputPath: '/tmp/receipt.json',
      execute: true,
    });
  });

  it('rejects unknown actions and duplicate execution switches', () => {
    const common = [
      '--evidence', '/tmp/evidence.json',
      '--effective-at-utc', '2026-07-18T20:00:00Z',
      '--approval', 'approved-id',
      '--output', '/tmp/receipt.json',
    ];
    expect(() => parseProductionFinancialStrictArgs(['--action', 'promote', ...common])).toThrow('enable or disable');
    expect(() => parseProductionFinancialStrictArgs(['--action', 'enable', ...common, '--execute', '--execute']))
      .toThrow('Duplicate argument');
  });
});
