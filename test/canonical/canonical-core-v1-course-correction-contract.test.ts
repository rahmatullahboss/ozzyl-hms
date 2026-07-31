import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = {
  policy: 'docs/architecture/hms-production-scope-policy.md',
  control: 'docs/architecture/canonical-program-control-center.md',
  board: 'docs/architecture/hms-canonical-parallel-execution-board.yaml',
  rewrite: 'docs/architecture/non-production-canonical-rewrite-playbook.md',
  runbook: 'docs/database/canonical-core-v1-production-cutover-runbook.md',
  tracker: 'task-progress.yaml',
  matrix: 'docs/database/canonical-authority-matrix.yaml',
  retirement: 'docs/database/legacy-write-retirement-gates.yaml',
  handoff: '.ai-bridge/current-plan.md',
  inventory: 'docs/database/protected-core-v1-surface-inventory.json',
  inventoryAudit: 'docs/database/audits/2026-07-28-protected-production-core-surface-inventory.md',
  authorityContract: 'docs/database/protected-core-v1-authority-contracts.json',
  authorityContractAudit: 'docs/database/audits/2026-07-28-core-v1-authority-contract-freeze.md',
  writerCoverage: 'docs/database/protected-core-v1-writer-command-coverage.json',
  writerCoverageAudit: 'docs/database/audits/2026-07-28-protected-writer-command-coverage-baseline.md',
  compensationRuleAudit: 'docs/database/audits/2026-07-28-compensation-rule-command-implementation.md',
  compensationRuleRouteAudit: 'docs/database/audits/2026-07-28-compensation-rule-route-integration.md',
  practitionerRouteAudit: 'docs/database/audits/2026-07-28-practitioner-route-integration.md',
  patientImportRouteAudit: 'docs/database/audits/2026-07-28-patient-import-identity-route-integration.md',
  appointmentIntentRouteAudit: 'docs/database/audits/2026-07-29-appointment-intent-route-integration.md',
  encounterCareRouteAudit: 'docs/database/audits/2026-07-29-encounter-care-episode-route-integration.md',
  serviceDeliveryRouteAudit: 'docs/database/audits/2026-07-29-service-delivery-event-route-integration.md',
  compensationAccrualAdjustmentAudit: 'docs/database/audits/2026-07-29-practitioner-compensation-accrual-adjustment-integration.md',
  compensationSettlementCashCustodyAudit: 'docs/database/audits/2026-07-29-practitioner-compensation-settlement-cash-custody-integration.md',
  cashCustodyWriterAudit: 'docs/database/audits/2026-07-29-cash-custody-writer-integration.md',
  creditRefundPaymentReversalAudit: 'docs/database/audits/2026-07-29-credit-refund-payment-reversal-integration.md',
  paymentReceiptTenderAllocationAudit: 'docs/database/audits/2026-07-29-payment-receipt-tender-allocation-integration.md',
  serviceCatalogPricingAudit: 'docs/database/audits/2026-07-29-service-catalog-pricing-integration.md',
  invoiceDepositReportingAudit: 'docs/database/audits/2026-07-29-invoice-deposit-reporting-integration.md',
  canonicalOutboxAudit: 'docs/database/audits/2026-07-29-canonical-outbox-atomic-assertion-integration.md',
  financialReadProviderAudit: 'docs/database/audits/2026-07-29-financial-read-provider-foundation.md',
};

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Canonical Core V1 course correction contract', () => {
  it('creates the owner-approved policy, parallel board, rewrite playbook and cutover runbook', () => {
    for (const path of Object.values(files)) expect(existsSync(path)).toBe(true);

    const policy = read(files.policy);
    for (const text of [
      'Canonical Core V1',
      'CDB-127E',
      'CDB-128A Operation Theatre` is deferred',
      'Every workflow outside the protected core may be substantially refactored or fully rewritten canonical-first',
      'multiple user-launched agents',
      'Local sync remains disabled/deferred',
    ]) expect(policy).toContain(text);
  });

  it('records production authorization package readiness and routes execution to the exact authorization gate', () => {
    const tracker = read(files.tracker);
    const control = read(files.control);
    const matrix = read(files.matrix);
    const handoff = read(files.handoff);
    const inventory = read(files.inventory);
    const authorityContract = read(files.authorityContract);
    const writerCoverage = read(files.writerCoverage);

    for (const text of [
      'CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-READY',
      'CDB-V1-070-STAGED-PRODUCTION-CUTOVER-EXACT-AUTHORIZATION-REQUIRED',
      'docs/database/cdb-v1-060-production-authorization-package.json',
      'docs/database/audits/2026-07-30-production-authorization-package-preparation.md',
      '35e299d9f',
    ]) {
      expect(tracker).toContain(text);
      expect(control).toContain(text);
      expect(handoff).toContain(text);
    }

    expect(tracker).toContain('command_required: 0');
    expect(tracker).toContain('atomic_compatibility: 110');
    expect(tracker).toContain('implementation_groups: 0');
    expect(tracker).toContain('full_command_coverage_complete: true');
    expect(tracker).toContain('existing_provider_boundaries: 10');
    expect(tracker).toContain('contract_only_provider_boundaries: 8');
    expect(tracker).toContain('unclassified: 0');
    expect(control).toContain('235 writers');
    expect(control).toContain('GET /api/reception/patients/:id/context');
    expect(control).toContain('GET /api/commissions/doctor-accruals');
    expect(control).toContain('six passed reconciliation rows');
    expect(handoff).toContain('packageReady=true');
    expect(handoff).toContain('executionReady=false');
    expect(handoff).toContain('Candidate implementation binding: `35e299d9ff2dc1781084dacd6d0f431816b0007c`');
    expect(inventory).toContain('"protectedWriterCount": 235');
    expect(inventory).toContain('"protectedReaderCount": 522');
    expect(inventory).toContain('"protectedTableCount": 85');
    expect(inventory).toContain('"unknownWriterCount": 0');
    expect(inventory).toContain('"unknownReaderCount": 0');
    expect(authorityContract).toContain('"existingCommandBoundaryCount": 19');
    expect(authorityContract).toContain('"contractOnlyCommandBoundaryCount": 1');
    expect(authorityContract).toContain('"existingProviderBoundaryCount": 10');
    expect(authorityContract).toContain('"contractOnlyProviderBoundaryCount": 8');
    expect(authorityContract).toContain('"unresolvedDuplicateAuthorityCount": 0');
    expect(writerCoverage).toContain('"canonicalCommandWriterCount": 118');
    expect(writerCoverage).toContain('"atomicCompatibilityWriterCount": 110');
    expect(writerCoverage).toContain('"commandRequiredWriterCount": 0');
    expect(writerCoverage).toContain('"unclassifiedWriterCount": 0');
    expect(writerCoverage).toContain('"commandCoverageComplete": true');
    expect(writerCoverage).toContain('"nextCheckpoint": "CDB-V1-040-CANONICAL-READ-PROVIDERS-AND-SHADOW-COMPARISON"');

    expect(matrix).toContain('"protectedCoreTransitionPrimary": true');
    expect(matrix).toContain('"broadAuthorityExpansionFrozenAfter": "CDB-127E"');
    expect(matrix).toContain('"nonProductionMode": "canonical_only_greenfield_parallel"');
  });

  it('defines isolated parallel ownership and serial integration for shared files', () => {
    const board = read(files.board);
    for (const text of [
      'recommended_max_implementation_workers: 4',
      'required_integration_review_agent: 1',
      'one_agent_per_bounded_context: true',
      'one_branch_and_worktree_per_agent: true',
      'shared_file_changes_serialized: true',
      'worker_self_merge_allowed: false',
      'required_before_worker_creates_migration: true',
      'CORE_V1:',
      'INVENTORY:',
      'PATIENT_MOBILE:',
      'FULL_MM:',
      'ADDITIONAL_DOMAIN_REWRITE:',
      'current_checkpoint: CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-AUTHORIZATION-CONTRACT-READY',
      'next_task: CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-EXACT-AUTHORIZATION-REQUIRED',
      'task: CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-EXACT-AUTHORIZATION-REQUIRED',
      'final_task: INV-MM-121',
      'next_task: serial_integration_review_against_updated_main',
      'current_gate: MM-070',
      'claimed_domain: operation_theatre',
      'filename: 0562_canonical_operation_theatre.sql',
    ]) expect(board).toContain(text);
  });

  it('separates non-production greenfield completion from production activation', () => {
    const rewrite = read(files.rewrite);
    for (const text of [
      'canonical-only greenfield rewrite',
      'Do not build these merely for unused legacy parity',
      'production tenant backfill from unused module tables',
      'long-running dual-write mode',
      'one worker agent owns one bounded context',
      'migration number must be reserved',
      'Development completion does not activate production',
    ]) expect(rewrite).toContain(text);
  });

  it('keeps production cutover, rollback and retirement fail closed', () => {
    const runbook = read(files.runbook);
    const retirement = read(files.retirement);

    for (const text of [
      'CDB-V1-010 — Protected production-core surface inventory',
      'CDB-V1-050 — Protected-clone migration, backfill and rollback rehearsal',
      'CDB-V1-060 — Production authorization package',
      'CDB-V1-070 — Staged production cutover',
      'CDB-V1-080 — Legacy writer and reader retirement',
      'Unexplained reconciliation variance must be zero',
      'Legacy retirement is not immediate deletion',
    ]) expect(runbook).toContain(text);

    expect(retirement).toContain('"destructiveRemovalSeparateAuthorization": true');
    expect(retirement).toContain('"productionCutoverComplete": false');
    expect(retirement).toContain('"ownerAuthorizationPresent": false');
  });
});
