import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProtectedCoreAuthorityContractFreeze } from './protected-core-authority-contract-freeze';

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const freeze = generateProtectedCoreAuthorityContractFreeze(root);
  console.log(JSON.stringify({
    task: freeze.task,
    conceptContractCount: freeze.summary.conceptContractCount,
    canonicalTableOwnerCount: freeze.summary.canonicalTableOwnerCount,
    governedExternalOwnerCount: freeze.summary.governedExternalOwnerCount,
    governedRegistryOwnerCount: freeze.summary.governedRegistryOwnerCount,
    existingCommandBoundaryCount: freeze.summary.existingCommandBoundaryCount,
    contractOnlyCommandBoundaryCount: freeze.summary.contractOnlyCommandBoundaryCount,
    existingProviderBoundaryCount: freeze.summary.existingProviderBoundaryCount,
    contractOnlyProviderBoundaryCount: freeze.summary.contractOnlyProviderBoundaryCount,
    unresolvedDuplicateAuthorityCount: freeze.summary.unresolvedDuplicateAuthorityCount,
    nonProductionScopeLeakageCount: freeze.summary.nonProductionScopeLeakageCount,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
