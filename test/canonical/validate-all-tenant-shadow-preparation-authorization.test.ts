import { describe, expect, it } from 'vitest';
import {
  buildAllTenantShadowPreparationAuthorizationValidationOutput,
  parseAllTenantShadowPreparationAuthorizationValidationArgs,
} from '../../scripts/canonical/validate-all-tenant-shadow-preparation-authorization';

describe('CDB-V1-070B protected preparation authorization validator CLI', () => {
  it('parses the protected authorization path and optional evaluation time', () => {
    expect(parseAllTenantShadowPreparationAuthorizationValidationArgs([
      '--authorization', '/protected/authorization.json',
      '--at-utc', '2026-07-30T06:30:00.000Z',
    ])).toEqual({
      authorizationPath: '/protected/authorization.json',
      atUtc: '2026-07-30T06:30:00.000Z',
    });
    expect(() => parseAllTenantShadowPreparationAuthorizationValidationArgs([])).toThrow(/authorization/i);
    expect(() => parseAllTenantShadowPreparationAuthorizationValidationArgs(['--unknown'])).toThrow(/unknown/i);
    expect(() => parseAllTenantShadowPreparationAuthorizationValidationArgs(['--authorization'])).toThrow(/requires/i);
  });

  it('builds a sanitized blocked receipt without exposing protected content', () => {
    const output = buildAllTenantShadowPreparationAuthorizationValidationOutput({
      documentReady: true,
      authorizationReady: false,
      issues: [{ code: 'CDBV1070B_AUTHORIZATION_SCOPE_INVALID', gate: 'scope' }],
      authorization: null,
    });

    expect(output).toEqual({
      receipt: {
        checkpoint: 'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-CAPTURE',
        documentReady: true,
        authorizationReady: false,
        issueCount: 1,
        tenantCount: 0,
        routeCount: 0,
        candidateTrafficPercentage: 0,
        previousTrafficPercentage: 0,
        aggregateOnly: true,
        networkRequestPerformed: false,
        productionReadPerformed: false,
        productionMutationPerformed: false,
        workerVersionUploadPerformed: false,
        trafficChanged: false,
      },
      issues: [{ code: 'CDBV1070B_AUTHORIZATION_SCOPE_INVALID', gate: 'scope' }],
      plan: null,
    });
  });
});
