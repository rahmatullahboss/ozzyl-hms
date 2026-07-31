import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  validateProductionAllTenantProviderShadowScope,
  type ProviderShadowScopeCommandRunner,
} from '../../scripts/canonical/validate-production-all-tenant-provider-shadow-scope';
import { ALL_TENANT_PROVIDER_SHADOW_FLAGS } from '../../scripts/canonical/set-production-all-tenant-provider-shadow';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function protectedOutput(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cdb-provider-shadow-'));
  chmodSync(directory, 0o700);
  directories.push(directory);
  return join(directory, 'scope.json');
}

function runner(rows: Array<Record<string, unknown>>): {
  execute: ProviderShadowScopeCommandRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    execute(args) {
      calls.push(args);
      if (args[0] === 'd1' && args[1] === 'info') {
        return {
          stdout: JSON.stringify({
            name: 'hms-super-admin-production-apac',
            uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
          }),
          stderr: '',
          exitCode: 0,
        };
      }
      return {
        stdout: JSON.stringify([{
          success: true,
          results: rows,
          meta: { changed_db: false, rows_written: 0 },
        }]),
        stderr: '',
        exitCode: 0,
      };
    },
  };
}

describe('production all-tenant provider shadow scope validator', () => {
  it('collects aggregate-only provider evidence and writes a protected receipt', () => {
    const rows = ALL_TENANT_PROVIDER_SHADOW_FLAGS.map((flag) => ({
      flag_key: flag.flagKey,
      expected_tenant_count: 4,
      shadow_enabled_count: 4,
      missing_count: 0,
      non_shadow_count: 0,
    }));
    const gateway = runner(rows);
    const output = protectedOutput();

    const receipt = validateProductionAllTenantProviderShadowScope({
      output,
      repositoryRoot: process.cwd(),
      execute: gateway.execute,
    });

    expect(receipt.activationReady).toBe(true);
    expect(receipt.providerCount).toBe(9);
    expect(receipt.activeTenantCount).toBe(4);
    expect(receipt.productionMutationPerformed).toBe(false);
    expect(receipt.rowsWritten).toBe(0);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(receipt);
    expect(gateway.calls).toHaveLength(2);
    expect(gateway.calls[0]).toEqual([
      'd1', 'info', 'hms-super-admin-production-apac', '--env', 'production', '--json',
    ]);
    expect(gateway.calls[1]).toEqual(expect.arrayContaining([
      'd1', 'execute', 'hms-super-admin-production-apac', '--env', 'production', '--remote', '--json', '--command',
    ]));
    expect(gateway.calls[1]).not.toContain('--yes');
  });

  it('fails closed when D1 reports a write or the database identity is wrong', () => {
    const output = protectedOutput();
    const mutating: ProviderShadowScopeCommandRunner = (args) => {
      if (args[1] === 'info') {
        return {
          stdout: JSON.stringify({
            name: 'hms-super-admin-production-apac',
            uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
          }),
          stderr: '',
          exitCode: 0,
        };
      }
      return {
        stdout: JSON.stringify([{ success: true, results: [], meta: { changed_db: true, rows_written: 1 } }]),
        stderr: '',
        exitCode: 0,
      };
    };
    expect(() => validateProductionAllTenantProviderShadowScope({
      output,
      repositoryRoot: process.cwd(),
      execute: mutating,
    })).toThrow(/read-only/i);

    const wrongIdentity: ProviderShadowScopeCommandRunner = () => ({
      stdout: JSON.stringify({ name: 'other', uuid: 'wrong' }),
      stderr: '',
      exitCode: 0,
    });
    expect(() => validateProductionAllTenantProviderShadowScope({
      output: protectedOutput(),
      repositoryRoot: process.cwd(),
      execute: wrongIdentity,
    })).toThrow(/identity/i);
  });
});
