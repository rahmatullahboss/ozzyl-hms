import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CDB_V1_070B_BRANCH } from '../../scripts/canonical/all-tenant-shadow-preparation-package';
import {
  parseAllTenantShadowPreparationPackageArgs,
  resolveLocalAllTenantShadowPreparationPackageBinding,
  writeAllTenantShadowPreparationPackage,
} from '../../scripts/canonical/prepare-all-tenant-shadow-preparation-package';

const roots: string[] = [];
const repositoryRoot = process.cwd();

function outputPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-070b-package-'));
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
    ...resolveLocalAllTenantShadowPreparationPackageBinding(repositoryRoot),
    branch: CDB_V1_070B_BRANCH,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-V1-070B preparation package CLI', () => {
  it('parses output and force while rejecting unknown arguments', () => {
    expect(parseAllTenantShadowPreparationPackageArgs([
      '--output', 'custom.json', '--force',
    ])).toEqual({ outputPath: 'custom.json', force: true });
    expect(parseAllTenantShadowPreparationPackageArgs([])).toEqual({
      outputPath: 'docs/database/cdb-v1-070b-all-tenant-shadow-preparation-package.json',
      force: false,
    });
    expect(() => parseAllTenantShadowPreparationPackageArgs(['--unknown'])).toThrow(/unknown/i);
    expect(() => parseAllTenantShadowPreparationPackageArgs(['--output'])).toThrow(/requires/i);
  });

  it('resolves the current program branch and exact local HEAD without network access', () => {
    const binding = resolveLocalAllTenantShadowPreparationPackageBinding(repositoryRoot);
    expect(binding.branch).toBe(currentBranch());
    expect(binding.preparationCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(binding.buildSha).toBe(binding.preparationCommit);
  });

  it('writes only a validated repository-ready and non-executable preparation package', () => {
    const path = outputPath();
    const binding = authorizedBinding();
    const result = writeAllTenantShadowPreparationPackage({
      repositoryRoot,
      outputPath: path,
      force: false,
      ...binding,
    });
    const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

    expect(result.packagePath).toBe(path);
    expect(result.evaluation).toMatchObject({
      packageReady: true,
      authorizationReady: false,
      executionReady: false,
      issues: [],
      tenantCount: 4,
      commandCount: 6,
      migrationManifestCount: 504,
      expectedPendingMigrationCount: 29,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      workerVersionUploadPerformed: false,
      trafficChanged: false,
    });
    expect(document.checkpoint).toBe(
      'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-AUTHORIZATION-CONTRACT-READY',
    );
  });

  it('refuses overwrite unless force is explicit', () => {
    const path = outputPath();
    const binding = authorizedBinding();
    writeAllTenantShadowPreparationPackage({
      repositoryRoot,
      outputPath: path,
      force: false,
      ...binding,
    });

    expect(() => writeAllTenantShadowPreparationPackage({
      repositoryRoot,
      outputPath: path,
      force: false,
      ...binding,
    })).toThrow(/already exists/i);
    expect(() => writeAllTenantShadowPreparationPackage({
      repositoryRoot,
      outputPath: path,
      force: true,
      ...binding,
    })).not.toThrow();
  });

  it('rejects a non-program branch before writing', () => {
    const path = outputPath();
    const binding = resolveLocalAllTenantShadowPreparationPackageBinding(repositoryRoot);

    expect(() => writeAllTenantShadowPreparationPackage({
      repositoryRoot,
      outputPath: path,
      force: false,
      ...binding,
      branch: 'main',
    })).toThrow(/branch/i);
  });
});
