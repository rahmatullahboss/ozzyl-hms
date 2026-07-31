import { describe, expect, it } from 'vitest';
import {
  createProductionAllTenantReconciliationExecutionGateway,
  parseAllTenantReconciliationExecutionArgs,
} from '../../scripts/canonical/execute-all-tenant-reconciliation';

const AUTH = '/tmp/protected/authorization.json';
const OUTPUT = '/tmp/protected/execution-receipt.json';

describe('CDB-V1-070C execution CLI', () => {
  it('requires explicit execute, authorization, and output arguments', () => {
    expect(() => parseAllTenantReconciliationExecutionArgs([])).toThrow(/execute/i);
    expect(() => parseAllTenantReconciliationExecutionArgs([
      '--authorization', AUTH,
      '--output', OUTPUT,
    ])).toThrow(/execute/i);
    expect(parseAllTenantReconciliationExecutionArgs([
      '--authorization', AUTH,
      '--output', OUTPUT,
      '--execute',
      '--at-utc', '2026-07-31T03:10:00.000Z',
    ])).toEqual({
      authorizationPath: AUTH,
      outputPath: OUTPUT,
      execute: true,
      atUtc: '2026-07-31T03:10:00.000Z',
    });
    expect(() => parseAllTenantReconciliationExecutionArgs(['--unknown']))
      .toThrow(/unknown argument/i);
  });

  it('writes through one exact remote D1 execute command and reports aggregate meta only', async () => {
    const calls: string[][] = [];
    const gateway = createProductionAllTenantReconciliationExecutionGateway((args) => {
      calls.push(args);
      return {
        status: 0,
        stderr: '',
        stdout: JSON.stringify([{
          success: true,
          results: [],
          meta: { changes: 4, rows_written: 4 },
        }]),
      };
    });

    const result = await gateway.writeMigrationLedger('INSERT INTO d1_migrations(name) SELECT name FROM approved;');

    expect(result).toEqual({ changes: 4, rowsWritten: 4 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      'd1', 'execute', 'hms-super-admin-production-apac',
      '--env', 'production', '--remote', '--json', '--yes',
      '--command', 'INSERT INTO d1_migrations(name) SELECT name FROM approved;',
    ]);
  });

  it('fingerprints the latest Worker deployment assignment independent of list order', async () => {
    const deployments = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        strategy: 'percentage',
        created_on: '2026-07-31T02:00:00.000Z',
        versions: [{ version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', percentage: 100 }],
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        strategy: 'percentage',
        created_on: '2026-07-31T03:00:00.000Z',
        versions: [
          { version_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', percentage: 100 },
          { version_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', percentage: 0 },
        ],
      },
    ];
    const calls: string[][] = [];
    let reversed = false;
    const gateway = createProductionAllTenantReconciliationExecutionGateway((args) => {
      calls.push(args);
      reversed = !reversed;
      return {
        status: 0,
        stderr: '',
        stdout: JSON.stringify(reversed ? deployments : [...deployments].reverse()),
      };
    });

    const first = await gateway.readWorkerDeploymentFingerprint();
    const second = await gateway.readWorkerDeploymentFingerprint();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(calls[0]).toEqual([
      'deployments', 'list', '--name', 'hms-saas-production', '--env', 'production', '--json',
    ]);
  });

  it('rejects unsuccessful or malformed D1 write envelopes', async () => {
    const unsuccessful = createProductionAllTenantReconciliationExecutionGateway(() => ({
      status: 0,
      stderr: '',
      stdout: JSON.stringify([{ success: false, results: [], meta: {} }]),
    }));
    await expect(unsuccessful.writeMigrationLedger('INSERT INTO d1_migrations(name) SELECT 1;'))
      .rejects.toThrow(/unsuccessful/i);

    const commandFailure = createProductionAllTenantReconciliationExecutionGateway(() => ({
      status: 1,
      stderr: 'denied',
      stdout: '',
    }));
    await expect(commandFailure.writeMigrationLedger('INSERT INTO d1_migrations(name) SELECT 1;'))
      .rejects.toThrow(/denied/i);
  });
});
