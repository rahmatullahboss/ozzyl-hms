import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseProductionAuthorizationPackageArgs,
  writeProductionAuthorizationPackage,
} from '../../scripts/canonical/prepare-production-authorization-package';

const roots: string[] = [];
const repositoryRoot = process.cwd();
const binding = {
  branch: 'program/cdb-main-continuous-20260725',
  candidateCommit: 'b'.repeat(40),
  buildSha: 'b'.repeat(40),
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function outputPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-060-package-'));
  roots.push(root);
  chmodSync(root, 0o700);
  return join(root, 'package.json');
}

describe('CDB-V1-060 package preparation CLI', () => {
  it('parses output and force while rejecting unknown arguments', () => {
    expect(parseProductionAuthorizationPackageArgs([
      '--output', 'custom.json', '--force',
    ])).toEqual({ outputPath: 'custom.json', force: true });
    expect(parseProductionAuthorizationPackageArgs([])).toEqual({
      outputPath: 'docs/database/cdb-v1-060-production-authorization-package.json',
      force: false,
    });
    expect(() => parseProductionAuthorizationPackageArgs(['--unknown'])).toThrow(/unknown/i);
    expect(() => parseProductionAuthorizationPackageArgs(['--output'])).toThrow(/requires/i);
  });

  it('writes only a validated repository-ready non-executable package', () => {
    const path = outputPath();
    const result = writeProductionAuthorizationPackage({
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
      migrationCount: 19,
      backfillCount: 4,
      providerCount: 9,
      consumerCount: 12,
      sourceTableCount: 9,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
    });
    expect(document.checkpoint).toBe('CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-READY');
  });

  it('refuses overwrite unless force is explicit', () => {
    const path = outputPath();
    writeProductionAuthorizationPackage({
      repositoryRoot,
      outputPath: path,
      force: false,
      ...binding,
    });

    expect(() => writeProductionAuthorizationPackage({
      repositoryRoot,
      outputPath: path,
      force: false,
      ...binding,
    })).toThrow(/already exists/i);
    expect(() => writeProductionAuthorizationPackage({
      repositoryRoot,
      outputPath: path,
      force: true,
      ...binding,
    })).not.toThrow();
  });

  it('rejects a non-program branch before writing', () => {
    const path = outputPath();

    expect(() => writeProductionAuthorizationPackage({
      repositoryRoot,
      outputPath: path,
      force: false,
      ...binding,
      branch: 'main',
    })).toThrow(/branch/i);
  });
});
