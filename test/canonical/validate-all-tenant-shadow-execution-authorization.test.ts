import { describe, expect, it } from 'vitest';
import {
  buildAllTenantShadowAuthorizationValidationOutput,
  parseAllTenantShadowAuthorizationValidationArgs,
} from '../../scripts/canonical/validate-all-tenant-shadow-execution-authorization';

describe('CDB-V1-070 protected authorization validator CLI', () => {
  it('parses the protected authorization path and optional evaluation time', () => {
    expect(parseAllTenantShadowAuthorizationValidationArgs([
      '--authorization', '/protected/authorization.json',
      '--at-utc', '2026-07-30T05:50:00.000Z',
    ])).toEqual({
      authorizationPath: '/protected/authorization.json',
      atUtc: '2026-07-30T05:50:00.000Z',
    });
    expect(() => parseAllTenantShadowAuthorizationValidationArgs([])).toThrow(/authorization/i);
    expect(() => parseAllTenantShadowAuthorizationValidationArgs(['--unknown'])).toThrow(/unknown/i);
  });

  it('builds a sanitized blocked receipt without exposing authorization content', () => {
    const output = buildAllTenantShadowAuthorizationValidationOutput({
      documentReady: true,
      executionReady: false,
      issues: [{ code: 'CDBV1070_AUTHORIZATION_SCOPE_INVALID', gate: 'scope' }],
      authorization: null,
    });

    expect(output).toEqual({
      receipt: {
        checkpoint: 'CDB-V1-070-ALL-TENANT-LEGACY-PRIMARY-SHADOW-EXECUTION',
        documentReady: true,
        executionReady: false,
        issueCount: 1,
        tenantCount: 0,
        migrationCount: 0,
        backfillCount: 0,
        providerCount: 0,
        expectedProviderFlagRowCount: 0,
        aggregateOnly: true,
        networkRequestPerformed: false,
        productionReadPerformed: false,
        productionMutationPerformed: false,
      },
      issues: [{ code: 'CDBV1070_AUTHORIZATION_SCOPE_INVALID', gate: 'scope' }],
      plan: null,
    });
  });
});
