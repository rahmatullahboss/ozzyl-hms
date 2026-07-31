import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROTECTED_CORE_AUTHORITY_CONTRACT_PATH,
  buildProtectedCoreAuthorityContractFreeze,
  type ProtectedCoreAuthorityContractFreeze,
  validateProtectedCoreAuthorityContractFreeze,
} from './protected-core-authority-contract-freeze';

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const stored = JSON.parse(readFileSync(join(root, PROTECTED_CORE_AUTHORITY_CONTRACT_PATH), 'utf8')) as ProtectedCoreAuthorityContractFreeze;
  const expected = buildProtectedCoreAuthorityContractFreeze(root);
  const issues = validateProtectedCoreAuthorityContractFreeze(stored, root);
  if (JSON.stringify(stored) !== JSON.stringify(expected)) issues.push('checked-in Core V1 authority contract is stale; regenerate it');

  if (issues.length > 0) {
    console.error(`Core V1 authority contract freeze failed with ${issues.length} issue(s):`);
    for (const issue of [...new Set(issues)].sort((a, b) => a.localeCompare(b))) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Core V1 authority contract freeze passed: ${stored.summary.conceptContractCount} concepts, `
    + `${stored.summary.unresolvedDuplicateAuthorityCount} duplicate authorities, `
    + `${stored.summary.nonProductionScopeLeakageCount} scope leaks.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
