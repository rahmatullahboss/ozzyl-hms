import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CDB_V1_070A_BRANCH } from '../../scripts/canonical/all-tenant-shadow-execution-package';
import {
  parseAllTenantShadowExecutionPackageArgs,
  resolveLocalAllTenantShadowPackageBinding,
  writeAllTenantShadowExecutionPackage,
} from '../../scripts/canonical/prepare-all-tenant-shadow-execution-package';

const roots: string[] = [];
const repositoryRoot = process.cwd();

function outputPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-070a-package-'));
  roots.push(root);
  chmodSync(root, 0o700);
  return join(root, 'package.json');
}

function currentBranch(): string {
  return execFileSync('git', ['branch', '--show-current'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
}

function authorizedBinding() {
  return {
    ...resolveLocalAllTenantShadowPackageBinding(repositoryRoot),
    branch: CDB_V1_070A_BRANCH,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-V1-070A package preparation CLI', () => {
  it('parses output and force while rejecting unknown arguments', () => {
    expect(parseAllTenantShadowExecutionPackageArgs([
      '--output', 'custom.json', '--force',
    ])).toEqual({ outputPath: 'custom.json', force: true });
    expect(parseAllTenantShadowExecutionPackageArgs([])).toEqual({
      outputPath: 'docs/database/cdb-v1-070-all-tenant-shadow-execution-package.json',
      force: false,
    });
    expect(() => parseAllTenantShadowExecutionPackageArgs(['--unknown'])).toThrow(/unknown/i);
    expect(() => parseAllTenantShadowExecutionPackageArgs(['--output'])).toThrow(/requires/i);
  });

  it('resolves the current program branch and exact local HEAD without network access', () => {
    const binding = resolveLocalAllTenantShadowPackageBinding(repositoryRoot);
    expect(binding.branch).toBe(currentBranch());
    expect(binding.preparationCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(binding.buildSha).toBe(binding.preparationCommit);
  });

  it('writes only a validated repository-ready non-executable package', () => {
    const path = outputPath();
    const binding = authorizedBinding();
    const result = writeAllTenantShadowExecutionPackage({
      repositoryRoot,
      outputPath: path,
      force: false,
      ...binding,
    });
    const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

    expect(result.packagePath).toBe(path);
    expect(result.evaluation).toMatchObject({
      packageReady: true,
      executionReady: false,
      issues: [],
      tenantCount: 4,
      migrationCount: 29,
      backfillCount: 4,
      providerCount: 9,
      expectedProviderFlagRowCount: 36,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
    });
    expect(document.checkpoint).toBe(
      'CDB-V1-070A-ALL-TENANT-SHADOW-EXECUTION-AUTHORIZATION-CONTRACT-READY',
    );
  });

  it('refuses overwrite unless force is explicit', () => {
    const path = outputPath();
    const binding = authorizedBinding();
    writeAllTenantShadowExecutionPackage({
      repositoryRoot,
      outputPath: path,
      force: false,
      ...binding,
    });

    expect(() => writeAllTenantShadowExecutionPackage({
      repositoryRoot,
      outputPath: path,
      force: false,
      ...binding,
    })).toThrow(/already exists/i);
    expect(() => writeAllTenantShadowExecutionPackage({
      repositoryRoot,
      outputPath: path,
      force: true,
      ...binding,
    })).not.toThrow();
  });

  it('rejects a non-program branch before writing', () => {
    const path = outputPath();
    const binding = resolveLocalAllTenantShadowPackageBinding(repositoryRoot);

    expect(() => writeAllTenantShadowExecutionPackage({
      repositoryRoot,
      outputPath: path,
      force: false,
      ...binding,
      branch: 'main',
    })).toThrow(/branch/i);
  });
});
