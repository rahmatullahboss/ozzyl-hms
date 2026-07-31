import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_NAME,
  buildReportingCutoverResolutionPlan,
  validateReportingCutoverAuthorization,
  type ReportingCutoverAuthorization,
  type ReportingCutoverResolutionItem,
} from './production-cutover-contract';
import { parseReportingCutoverAuthorizationJson } from './reporting-cutover-authorization-document';

export interface ReportingCutoverOperationsPlan {
  schemaVersion: 1;
  domain: 'reporting';
  executionReady: boolean;
  issueCodes: string[];
  expectedCommandIds: {
    migration: string;
    productionImport: string;
    featureFlag: string;
  };
  commands: {
    readOnly: {
      deploymentList: string[];
      migrationList: string[];
      featureFlagState: string[];
      reportingPreflight: string[];
    };
    guarded: {
      migrationApply: string[];
      productionImport: string[];
      featureFlagShadow: string[];
    };
  };
  resolutionPlan: ReportingCutoverResolutionItem[];
  productionMutationPerformed: false;
  aggregateOnly: true;
}

export function buildReportingCutoverOperationsPlan(
  authorization: ReportingCutoverAuthorization,
  atUtc: string = new Date().toISOString(),
): ReportingCutoverOperationsPlan {
  const validation = validateReportingCutoverAuthorization(authorization, atUtc);
  return {
    schemaVersion: 1,
    domain: 'reporting',
    executionReady: validation.executionReady,
    issueCodes: validation.issues.map((issue) => issue.code),
    expectedCommandIds: validation.expectedCommandIds,
    commands: {
      readOnly: {
        deploymentList: [
          'deployments', 'list', '--env', 'production', '--name', 'hms-saas-production', '--json',
        ],
        migrationList: [
          'd1', 'migrations', 'list', 'DB', '--env', 'production', '--remote',
        ],
        featureFlagState: [
          'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
          '--env', 'production', '--remote', '--json', '--command',
          "SELECT tenant_id, flag_key, domain, mode, is_enabled, version FROM canonical_feature_flags WHERE tenant_id = '100' AND flag_key = 'canonical_reporting_v1' LIMIT 1;",
        ],
        reportingPreflight: [
          'canonical:preflight-reporting', '--planned-tenants', '100', '--canary-tenant', '100',
          '--preparation-authorized', '--max-rollback-ms', '60000',
          '--smoke-plan-id', 'reporting-canary-smoke-v2',
        ],
      },
      guarded: {
        migrationApply: [
          'tsx', 'scripts/canonical/apply-production-canonical-migrations.ts',
          '--authorization', '<authorization-v2.json>',
          '--fk-evidence', '<protected-fk-evidence.json>',
          '--maintenance-recovery-evidence', '<protected-maintenance-recovery-evidence.json>',
          '--worker-build-version-evidence', '<protected-worker-build-version-evidence.json>',
          '--execute',
        ],
        productionImport: [
          'tsx', 'scripts/canonical/import-production-canonical-bundle.ts',
          '--authorization', '<authorization-v2.json>',
          '--fk-evidence', '<protected-fk-evidence.json>',
          '--maintenance-recovery-evidence', '<protected-maintenance-recovery-evidence.json>',
          '--worker-build-version-evidence', '<protected-worker-build-version-evidence.json>',
          '--bundle', '<reviewed-bundle.sql>',
          '--manifest', '<reviewed-import-manifest.json>',
          '--source-export', '<protected-source-export.sql>',
          '--execute',
        ],
        featureFlagShadow: [
          'tsx', 'scripts/canonical/set-production-canonical-flag.ts',
          '--authorization', '<authorization-v2.json>',
          '--fk-evidence', '<protected-fk-evidence.json>',
          '--maintenance-recovery-evidence', '<protected-maintenance-recovery-evidence.json>',
          '--worker-build-version-evidence', '<protected-worker-build-version-evidence.json>',
          '--processing-evidence', '<protected-processing-evidence.json>',
          '--effective-at-utc', '<authorized-effective-at-utc>',
          '--updated-by', '<authorized-operator-public-id>',
          '--execute',
        ],
      },
    },
    resolutionPlan: buildReportingCutoverResolutionPlan(),
    productionMutationPerformed: false,
    aggregateOnly: true,
  };
}

interface CliOptions {
  authorizationPath: string;
  atUtc?: string;
}

export function parseReportingCutoverOperationsArgs(args: string[]): CliOptions {
  let authorizationPath = 'docs/database/migration-runs/production/CDB-101-reporting-authorization-template.json';
  let atUtc: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg === '--authorization') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--authorization requires a path');
      authorizationPath = value;
      index += 1;
    } else if (arg === '--at-utc') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--at-utc requires a UTC timestamp');
      atUtc = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { authorizationPath, atUtc };
}

function main(): void {
  try {
    const options = parseReportingCutoverOperationsArgs(process.argv.slice(2));
    const document = parseReportingCutoverAuthorizationJson(
      readFileSync(resolve(options.authorizationPath), 'utf8'),
    );
    if (!document.documentReady || !document.authorization) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1,
        domain: 'reporting',
        executionReady: false,
        issueCodes: document.issues.map((item) => item.code),
        expectedCommandIds: null,
        commands: null,
        resolutionPlan: buildReportingCutoverResolutionPlan(),
        productionMutationPerformed: false,
        aggregateOnly: true,
      }, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const plan = buildReportingCutoverOperationsPlan(
      document.authorization,
      options.atUtc ?? new Date().toISOString(),
    );
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 operations planning failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
