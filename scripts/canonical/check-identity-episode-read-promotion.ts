import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateIdentityEpisodeReadPromotionReadiness,
  type IdentityEpisodeReadinessResult,
} from './check-identity-episode-read-promotion-readiness';

export interface IdentityEpisodeReadPromotionCheckInput {
  root: string;
}

export interface IdentityEpisodeReadPromotionCheckResult extends IdentityEpisodeReadinessResult {
  checkpoint: 'CDB-113F';
  legacyRetirementReady: false;
  blockers: string[];
  safety: {
    productionMutationAuthorized: false;
    productionMutationPerformed: false;
    providerFlagsChanged: false;
    routeCutoverPerformed: false;
    legacyRetirementAuthorized: false;
  };
}

/** Compatibility wrapper. The readiness implementation is authoritative. */
export function checkIdentityEpisodeReadPromotion(
  input: IdentityEpisodeReadPromotionCheckInput,
): IdentityEpisodeReadPromotionCheckResult {
  const readiness = evaluateIdentityEpisodeReadPromotionReadiness(input.root);
  return {
    ...readiness,
    checkpoint: 'CDB-113F',
    legacyRetirementReady: false,
    blockers: [
      'PRODUCTION_OBSERVATION_ABSENT',
      'OWNER_AUTHORIZATION_ABSENT',
      'PROVIDER_FLAGS_DISABLED',
      'ROUTE_CUTOVER_NOT_AUTHORIZED',
      'LEGACY_RETIREMENT_BLOCKED',
    ],
    safety: {
      productionMutationAuthorized: false,
      productionMutationPerformed: false,
      providerFlagsChanged: false,
      routeCutoverPerformed: false,
      legacyRetirementAuthorized: false,
    },
  };
}

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const result = checkIdentityEpisodeReadPromotion({ root });
  console.log(JSON.stringify(result, null, 2));
  if (!result.localReady) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
