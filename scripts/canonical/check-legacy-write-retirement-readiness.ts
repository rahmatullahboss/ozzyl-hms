import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type RetirementReasonCode =
  | 'PRODUCTION_CUTOVER_INCOMPLETE'
  | 'CANONICAL_READ_PROMOTION_INCOMPLETE'
  | 'OBSERVATION_INCOMPLETE'
  | 'ROLLBACK_EVIDENCE_NOT_FRESH'
  | 'OWNER_AUTHORIZATION_MISSING'
  | 'LEGACY_AUTHORITY_RETIREMENT_NOT_APPROVED'
  | 'COMPATIBILITY_ADAPTER_RETIREMENT_NOT_APPROVED'
  | 'FIXTURE_RETIREMENT_NOT_APPROVED';

type DirectWriteLifecycleStatus =
  | 'legacy_authority'
  | 'canonical_compatibility'
  | 'protected_fixture';

interface LegacyTableEntry {
  name: string;
}

interface DirectWriteAllowance {
  path: string;
  table: string;
  owner: string;
  removalPhase: string;
  reason: string;
  lifecycleStatus: DirectWriteLifecycleStatus;
  retirementBlocker: string;
  retirementTask: string;
  reviewedAtUtc: string;
}

interface LegacyRegistry {
  tables: LegacyTableEntry[];
  directWriteAllowlist: DirectWriteAllowance[];
}

interface RetirementDomainGate {
  id: string;
  retirementScope?: 'write' | 'read';
  tables: string[];
  productionCutoverComplete: boolean;
  canonicalReadPromotionComplete: boolean;
  observationComplete: boolean;
  rollbackEvidenceFresh: boolean;
  ownerAuthorizationPresent: boolean;
  legacyAuthorityRetirementApproved: boolean;
  compatibilityAdapterRetirementApproved: boolean;
  fixtureRetirementApproved: boolean;
  blocker: string;
  evidenceReferences: string[];
}

interface RetirementGateDocument {
  version: number;
  reviewedAtUtc: string;
  retirementTask: string;
  domains: RetirementDomainGate[];
}

export interface LegacyWriteRetirementReadiness {
  allowanceCount: number;
  eligibleAllowanceCount: number;
  blockedAllowanceCount: number;
  byDomain: Record<string, { total: number; eligible: number; blocked: number }>;
  byLifecycleStatus: Record<string, number>;
  eligibleScopes: string[];
  blockedScopes: Array<{
    scope: string;
    domain: string;
    reasons: RetirementReasonCode[];
  }>;
}

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const LIFECYCLE_STATUSES = new Set<DirectWriteLifecycleStatus>([
  'legacy_authority',
  'canonical_compatibility',
  'protected_fixture',
]);
const BOOLEAN_GATE_KEYS = [
  'productionCutoverComplete',
  'canonicalReadPromotionComplete',
  'observationComplete',
  'rollbackEvidenceFresh',
  'ownerAuthorizationPresent',
  'legacyAuthorityRetirementApproved',
  'compatibilityAdapterRetirementApproved',
  'fixtureRetirementApproved',
] as const;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseJsonFile<T>(path: string, label: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sortedCounts(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function validateRegistry(registry: LegacyRegistry): void {
  if (!registry || !Array.isArray(registry.tables) || !Array.isArray(registry.directWriteAllowlist)) {
    throw new Error('Invalid direct-write retirement evidence: registry arrays are required.');
  }
  const tableNames = new Set<string>();
  for (const table of registry.tables) {
    if (!table || !nonEmpty(table.name) || tableNames.has(table.name.toLowerCase())) {
      throw new Error('Invalid direct-write retirement evidence: table names must be unique and non-empty.');
    }
    tableNames.add(table.name.toLowerCase());
  }

  const scopes = new Set<string>();
  for (const allowance of registry.directWriteAllowlist) {
    const scope = `${allowance?.path ?? ''}\u0000${allowance?.table?.toLowerCase?.() ?? ''}`;
    const invalid = !allowance
      || !nonEmpty(allowance.path)
      || !nonEmpty(allowance.table)
      || !tableNames.has(allowance.table.toLowerCase())
      || !nonEmpty(allowance.owner)
      || !nonEmpty(allowance.removalPhase)
      || !nonEmpty(allowance.reason)
      || !nonEmpty(allowance.lifecycleStatus)
      || !LIFECYCLE_STATUSES.has(allowance.lifecycleStatus)
      || !nonEmpty(allowance.retirementBlocker)
      || allowance.retirementTask !== 'CDB-105B'
      || !UTC_TIMESTAMP_PATTERN.test(allowance.reviewedAtUtc)
      || scopes.has(scope);
    if (invalid) {
      throw new Error(`Invalid direct-write retirement evidence for ${allowance?.path ?? '<path>'}:${allowance?.table ?? '<table>'}.`);
    }
    scopes.add(scope);
  }
}

function validateGateDocument(
  registry: LegacyRegistry,
  document: RetirementGateDocument,
): Map<string, RetirementDomainGate> {
  if (!document
    || document.version !== 1
    || !UTC_TIMESTAMP_PATTERN.test(document.reviewedAtUtc)
    || document.retirementTask !== 'CDB-105B'
    || !Array.isArray(document.domains)
    || document.domains.length === 0) {
    throw new Error('Invalid legacy-write retirement gate document metadata.');
  }

  const domainIds = new Set<string>();
  const tableDomains = new Map<string, RetirementDomainGate[]>();
  for (const domain of document.domains) {
    const invalid = !domain
      || !nonEmpty(domain.id)
      || domainIds.has(domain.id)
      || (domain.retirementScope !== undefined && !['write', 'read'].includes(domain.retirementScope))
      || !Array.isArray(domain.tables)
      || domain.tables.length === 0
      || !Array.isArray(domain.evidenceReferences)
      || domain.evidenceReferences.some((reference) => !nonEmpty(reference))
      || BOOLEAN_GATE_KEYS.some((key) => typeof domain[key] !== 'boolean');
    if (invalid) throw new Error(`Invalid legacy-write retirement domain gate: ${domain?.id ?? '<domain>'}.`);
    domainIds.add(domain.id);

    const localTables = new Set<string>();
    for (const table of domain.tables) {
      const key = table.toLowerCase();
      if (!nonEmpty(table) || localTables.has(key)) {
        throw new Error(`Invalid legacy-write retirement domain table mapping: ${domain.id}.`);
      }
      localTables.add(key);
      if (domain.retirementScope !== 'read') {
        const mapped = tableDomains.get(key) ?? [];
        mapped.push(domain);
        tableDomains.set(key, mapped);
      }
    }
  }

  const registeredTables = new Set(registry.tables.map((table) => table.name.toLowerCase()));
  for (const [table] of tableDomains) {
    if (!registeredTables.has(table)) {
      throw new Error(`Unknown legacy table in retirement domain mapping: ${table}.`);
    }
  }

  const exactMapping = new Map<string, RetirementDomainGate>();
  for (const table of registeredTables) {
    const mapped = tableDomains.get(table) ?? [];
    if (mapped.length !== 1) {
      throw new Error(`Registered table ${table} must map to exactly one retirement domain.`);
    }
    exactMapping.set(table, mapped[0]);
  }

  return exactMapping;
}

function reasonsFor(
  allowance: DirectWriteAllowance,
  domain: RetirementDomainGate,
): RetirementReasonCode[] {
  const reasons: RetirementReasonCode[] = [];
  if (!domain.productionCutoverComplete) reasons.push('PRODUCTION_CUTOVER_INCOMPLETE');
  if (!domain.canonicalReadPromotionComplete) reasons.push('CANONICAL_READ_PROMOTION_INCOMPLETE');
  if (!domain.observationComplete) reasons.push('OBSERVATION_INCOMPLETE');
  if (!domain.rollbackEvidenceFresh) reasons.push('ROLLBACK_EVIDENCE_NOT_FRESH');
  if (!domain.ownerAuthorizationPresent) reasons.push('OWNER_AUTHORIZATION_MISSING');

  if (allowance.lifecycleStatus === 'legacy_authority' && !domain.legacyAuthorityRetirementApproved) {
    reasons.push('LEGACY_AUTHORITY_RETIREMENT_NOT_APPROVED');
  } else if (allowance.lifecycleStatus === 'canonical_compatibility' && !domain.compatibilityAdapterRetirementApproved) {
    reasons.push('COMPATIBILITY_ADAPTER_RETIREMENT_NOT_APPROVED');
  } else if (allowance.lifecycleStatus === 'protected_fixture' && !domain.fixtureRetirementApproved) {
    reasons.push('FIXTURE_RETIREMENT_NOT_APPROVED');
  }
  return reasons;
}

export function buildLegacyWriteRetirementReadiness(root: string): LegacyWriteRetirementReadiness {
  const resolvedRoot = resolve(root);
  const registry = parseJsonFile<LegacyRegistry>(
    join(resolvedRoot, 'docs/database/legacy-table-disposition.yaml'),
    'direct-write retirement registry',
  );
  const gateDocument = parseJsonFile<RetirementGateDocument>(
    join(resolvedRoot, 'docs/database/legacy-write-retirement-gates.yaml'),
    'legacy-write retirement gate document',
  );
  validateRegistry(registry);
  const tableDomain = validateGateDocument(registry, gateDocument);

  const eligibleScopes: string[] = [];
  const blockedScopes: LegacyWriteRetirementReadiness['blockedScopes'] = [];
  const domainCounts = new Map<string, { total: number; eligible: number; blocked: number }>();

  for (const allowance of registry.directWriteAllowlist) {
    const domain = tableDomain.get(allowance.table.toLowerCase());
    if (!domain) throw new Error(`No retirement domain for ${allowance.table}.`);
    const scope = `${allowance.path}:${allowance.table}`;
    const reasons = reasonsFor(allowance, domain);
    const counts = domainCounts.get(domain.id) ?? { total: 0, eligible: 0, blocked: 0 };
    counts.total += 1;
    if (reasons.length === 0) {
      counts.eligible += 1;
      eligibleScopes.push(scope);
    } else {
      counts.blocked += 1;
      blockedScopes.push({ scope, domain: domain.id, reasons });
    }
    domainCounts.set(domain.id, counts);
  }

  for (const domain of gateDocument.domains) {
    if (domain.retirementScope === 'read') continue;
    const counts = domainCounts.get(domain.id) ?? { total: 0, eligible: 0, blocked: 0 };
    const hasBlockedAllowance = counts.blocked > 0;
    if (hasBlockedAllowance && !nonEmpty(domain.blocker)) {
      throw new Error(`Blocked retirement domain ${domain.id} requires a non-empty blocker.`);
    }
    if (!hasBlockedAllowance && domain.blocker.trim().length > 0) {
      throw new Error(`Eligible retirement domain ${domain.id} must not retain a blocker.`);
    }
  }

  eligibleScopes.sort((left, right) => left.localeCompare(right));
  blockedScopes.sort((left, right) => left.scope.localeCompare(right.scope));
  const byDomain = Object.fromEntries(
    [...domainCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    allowanceCount: registry.directWriteAllowlist.length,
    eligibleAllowanceCount: eligibleScopes.length,
    blockedAllowanceCount: blockedScopes.length,
    byDomain,
    byLifecycleStatus: sortedCounts(registry.directWriteAllowlist.map((entry) => entry.lifecycleStatus)),
    eligibleScopes,
    blockedScopes,
  };
}

function main(): void {
  const root = resolve(process.argv[2] ?? process.cwd());
  process.stdout.write(`${JSON.stringify(buildLegacyWriteRetirementReadiness(root), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
