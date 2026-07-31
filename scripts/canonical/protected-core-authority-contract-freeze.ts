import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PROTECTED_CORE_CONCEPT_IDS,
  PROTECTED_CORE_INVENTORY_PATH,
  buildProtectedCoreSurfaceInventory,
  type ProtectedCoreSurfaceInventory,
} from './protected-core-surface-inventory';

export const PROTECTED_CORE_AUTHORITY_CONTRACT_PATH = 'docs/database/protected-core-v1-authority-contracts.json';
export const PROTECTED_CORE_AUTHORITY_CONTRACT_TASK = 'CDB-V1-020-CORE-V1-AUTHORITY-AND-CONTRACT-FREEZE';

const MATRIX_PATH = 'docs/database/canonical-authority-matrix.yaml';
const SOURCE_OF_TRUTH_PATH = 'docs/database/canonical-source-of-truth.yaml';
const METRIC_REGISTRY_PATH = 'docs/database/metric-registry.yaml';
const POLICY_PATH = 'docs/architecture/hms-production-scope-policy.md';
const RUNBOOK_PATH = 'docs/database/canonical-core-v1-production-cutover-runbook.md';

interface AuthorityMatrixSource {
  table: string;
  classification: string;
  disposition: string;
}

interface AuthorityMatrixConcept {
  id: string;
  domain: string;
  fact: string;
  targetAuthority: {
    status: string;
    tables?: string[];
    modules?: string[];
    gap?: string;
  };
  currentSources?: AuthorityMatrixSource[];
  backfill?: { status: string; evidence?: string[] };
  reconciliation?: { status: string; evidence?: string[] };
  cutover?: { status: string; blockers?: string[]; nextAction?: string };
  retirement?: { status: string; action?: string };
}

interface AuthorityMatrix {
  concepts: AuthorityMatrixConcept[];
}

export type AuthorityOwnerKind = 'canonical_tables' | 'governed_external_table' | 'governed_registry';
export type ProviderMode = 'legacy' | 'shadow' | 'canonical' | 'external';

export interface ProtectedCoreConceptContract {
  contractId: string;
  conceptId: string;
  domain: string;
  fact: string;
  authority: {
    ownerId: string;
    ownerKind: AuthorityOwnerKind;
    ownerTables: string[];
    ownerRegistry?: string;
    schemaModules: string[];
    currentSources: AuthorityMatrixSource[];
    duplicateSourceDispositionFrozen: true;
  };
  commandBoundary: {
    implementationStatus: 'existing' | 'contract_only' | 'external_governed';
    modules: string[];
    commandNames: string[];
    transactionBoundary: string;
    idempotencyRule: string;
    auditOutboxRule: string;
  };
  providerBoundary: {
    implementationStatus: 'existing' | 'contract_only' | 'external_governed' | 'governance_only';
    providerKey: string;
    module: string;
    supportedModes: ProviderMode[];
    defaultMode: Exclude<ProviderMode, 'shadow'>;
    rollbackMode: Exclude<ProviderMode, 'shadow'>;
    productionEnabled: false;
    activationRequiresSeparateAuthorization: true;
    rollbackRule: string;
  };
  identityContract: string;
  statusContract: string;
  correctionContract: string;
  moneyContract: {
    unit: 'integer_minor_units' | 'not_applicable';
    equations: string[];
    unexplainedVarianceMinor: 0;
    roundingRule: string;
  };
  reconciliationContract: {
    sourceStatus: string;
    requiredChecks: string[];
    abortConditions: string[];
  };
  compatibilityContract: {
    httpRoutes: string[];
    uiRoutes: string[];
    responseRule: string;
    writeRule: string;
  };
  migrationContract: {
    sourceStatus: string;
    executionRule: string;
    secondPassRule: string;
    identityAmbiguityRule: string;
  };
  retirementContract: {
    sourceStatus: string;
    sourceDispositions: AuthorityMatrixSource[];
    retirementRule: string;
    physicalDeletionRequiresSeparateAuthorization: true;
  };
}

export interface ProtectedCoreAuthorityContractFreeze {
  version: 1;
  task: typeof PROTECTED_CORE_AUTHORITY_CONTRACT_TASK;
  reviewedAt: '2026-07-28';
  branch: 'program/cdb-main-continuous-20260725';
  sourceInventory: typeof PROTECTED_CORE_INVENTORY_PATH;
  sourceDocuments: string[];
  productionAuthorization: {
    repositoryContractFreeze: true;
    productionReadAccess: false;
    productionMutation: false;
    providerActivation: false;
    deploymentOrTrafficChange: false;
    liveLegacyRetirement: false;
  };
  summary: {
    conceptContractCount: number;
    canonicalTableOwnerCount: number;
    governedExternalOwnerCount: number;
    governedRegistryOwnerCount: number;
    existingCommandBoundaryCount: number;
    contractOnlyCommandBoundaryCount: number;
    existingProviderBoundaryCount: number;
    contractOnlyProviderBoundaryCount: number;
    unresolvedDuplicateAuthorityCount: number;
    nonProductionScopeLeakageCount: number;
  };
  concepts: ProtectedCoreConceptContract[];
  unresolvedDuplicateAuthorities: string[];
  nonProductionScopeLeakage: string[];
  globalInvariants: string[];
}

interface ConceptOverride {
  commandStatus: ProtectedCoreConceptContract['commandBoundary']['implementationStatus'];
  commandModules: string[];
  commandNames: string[];
  providerStatus: ProtectedCoreConceptContract['providerBoundary']['implementationStatus'];
  providerKey: string;
  providerModule: string;
  providerModes: ProviderMode[];
  providerDefault: Exclude<ProviderMode, 'shadow'>;
  providerRollback: Exclude<ProviderMode, 'shadow'>;
  identity: string;
  statuses: string;
  correction: string;
}

const COMMAND_TX = 'the source fact, canonical fact, source mapping, idempotency receipt, audit evidence and canonical outbox event must commit in one D1 batch; any failed assertion rolls back the full batch';
const IDEMPOTENCY = 'one tenant-scoped operation key plus canonical request fingerprint; exact replay returns the original result and changed replay is rejected';
const AUDIT_OUTBOX = 'record actor, tenant, operation, source/public IDs and non-PHI evidence hash; create the canonical outbox row in the same transaction as the business fact';
const LEGACY_ROLLBACK = 'immediate rollback selects the reviewed legacy provider without deleting canonical or legacy history and records the exact build, tenant scope and evidence receipt';
const CANONICAL_ROLLBACK = 'immediate rollback restores the last reviewed canonical governance state and blocks further execution without deleting immutable evidence';
const EXTERNAL_ROLLBACK = 'immediate rollback keeps the governed external authority active and disables only the canonical relationship/provider adapter';

const OVERRIDES: Record<string, ConceptOverride> = {
  schema_migration_governance: {
    commandStatus: 'existing',
    commandModules: ['scripts/canonical/apply-production-canonical-migrations.ts', 'scripts/canonical/set-production-canonical-flag.ts'],
    commandNames: ['applyProductionCanonicalMigrations', 'setProductionCanonicalFlag'],
    providerStatus: 'governance_only', providerKey: 'canonical_schema_governance_v1', providerModule: 'scripts/canonical/check-schema-governance.ts',
    providerModes: ['canonical'], providerDefault: 'canonical', providerRollback: 'canonical',
    identity: 'migration, backfill, flag and run identity is tenant plus immutable operation ID, migration name/checksum and exact code/build binding',
    statuses: 'migration runs: pending|running|completed|failed|rolled_back; reconciliation and checkpoint states remain immutable evidence',
    correction: 'never edit a completed run; append a superseding run, rollback receipt or corrected feature-flag version',
  },
  source_mapping_issue_reconciliation: {
    commandStatus: 'existing',
    commandModules: ['src/lib/canonical/source-mapping.ts', 'scripts/canonical/baseline-reconciliation.ts'],
    commandNames: ['upsertCanonicalSourceMapping', 'recordCanonicalProcessingIssue', 'recordCanonicalReconciliationRun'],
    providerStatus: 'governance_only', providerKey: 'canonical_source_mapping_provider_v1', providerModule: 'src/lib/canonical/source-mapping.ts',
    providerModes: ['canonical'], providerDefault: 'canonical', providerRollback: 'canonical',
    identity: 'mapping identity is tenant, source system, source entity type, source key and canonical public ID; ambiguity creates a stable issue and never fabricates a mapping',
    statuses: 'mappings: active|retired|rejected; processing issues: open|resolved|waived; reconciliation runs are append-only completed evidence',
    correction: 'retire or supersede a mapping and append a resolution event; never rewrite historical reconciliation evidence',
  },
  canonical_outbox_atomic_assertions: {
    commandStatus: 'existing',
    commandModules: ['src/lib/canonical/command-batch.ts', 'src/lib/canonical/financial-batch-assertion.ts'],
    commandNames: ['executeCanonicalCommandBatch', 'assertCanonicalFinancialBatch'],
    providerStatus: 'governance_only', providerKey: 'canonical_outbox_assertion_provider_v1', providerModule: 'src/lib/canonical/command-batch.ts',
    providerModes: ['canonical'], providerDefault: 'canonical', providerRollback: 'canonical',
    identity: 'outbox identity is tenant plus deterministic event public ID and idempotency key; financial assertions bind to the exact command batch',
    statuses: 'outbox: pending|processing|processed|failed|dead_letter; financial assertions are immutable pass/fail evidence',
    correction: 'append retry, compensation or superseding evidence; do not mutate a processed event or completed assertion',
  },
  practitioner_identity: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/manage-practitioner.ts'],
    commandNames: ['createPractitioner', 'updateOrRetirePractitioner'],
    providerStatus: 'existing', providerKey: 'canonical_practitioner_provider_v1', providerModule: 'src/lib/canonical/practitioner-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'tenant-scoped practitioner public ID plus reviewed source mapping; name, specialty, phone, numeric-ID coincidence and time proximity are forbidden identity evidence',
    statuses: 'active|inactive|unknown; retirement is represented by inactive/retired linkage evidence without deleting practitioner history',
    correction: 'append identifier/specialty/department changes and status events; retire incorrect links rather than replacing historical practitioner identity',
  },
  practitioner_account_links: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/manage-practitioner.ts'],
    commandNames: ['linkOrUnlinkPractitionerUser', 'linkOrUnlinkPractitionerEmployee'],
    providerStatus: 'existing', providerKey: 'canonical_practitioner_provider_v1', providerModule: 'src/lib/canonical/practitioner-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'exact tenant-scoped practitioner public ID and exact governed user/employee ID; one active link per governed cardinality and no name-based linking',
    statuses: 'active|rejected|retired',
    correction: 'retire the incorrect link and append a new reviewed link; users remain external authentication authority',
  },
  encounter_care_episode: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/start-encounter.ts'],
    commandNames: ['startEncounter', 'cancelEncounter', 'completeEncounter', 'replaceEncounterParticipant'],
    providerStatus: 'existing', providerKey: 'canonical_encounter_provider_v1', providerModule: 'src/lib/canonical/encounter-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'tenant encounter public ID with exact patient link, explicit participant roles and explicit appointment/visit source mapping; timestamp proximity is forbidden',
    statuses: 'planned|in_progress|completed|cancelled|entered_in_error',
    correction: 'append cancellation, entered-in-error or addendum evidence; signed history is immutable and never hard-deleted',
  },
  service_catalog_pricing: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/contracts/manage-service-catalog.ts'],
    commandNames: ['upsertCanonicalServiceCatalogItem', 'setCanonicalServicePrice', 'retireCanonicalServicePrice'],
    providerStatus: 'contract_only', providerKey: 'canonical_service_catalog_provider_v1', providerModule: 'src/lib/canonical/contracts/service-catalog-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'one tenant-scoped service public ID and code with typed domain extension links; text labels never create service identity',
    statuses: 'catalog and price versions: active|inactive|retired; price ranges must not overlap for the same scope',
    correction: 'append a new effective-dated price or retire the incorrect version; never overwrite a price used by a posted invoice',
  },
  service_request_intent: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/service-operations.ts'],
    commandNames: ['createServiceRequest', 'cancelServiceRequest'],
    providerStatus: 'contract_only', providerKey: 'canonical_service_request_provider_v1', providerModule: 'src/lib/canonical/contracts/service-request-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'request public ID plus exact patient, encounter, service and requester identities; free-text requests remain processing issues until typed',
    statuses: 'planned|active|partially_fulfilled|fulfilled|cancelled|unknown',
    correction: 'cancel or supersede request intent with immutable lineage; delivered facts are corrected separately',
  },
  service_delivery_event: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/service-operations.ts'],
    commandNames: ['recordServiceEvent', 'cancelServiceEvent'],
    providerStatus: 'contract_only', providerKey: 'canonical_service_event_provider_v1', providerModule: 'src/lib/canonical/contracts/service-event-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'service event public ID plus exact request, encounter, service and typed participant roles; billed state never implies performed state',
    statuses: 'posted|cancelled|reversed',
    correction: 'append cancellation/reversal and replacement events; never mutate a posted delivered-service fact',
  },
  invoice_document: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/issue-invoice.ts', 'src/lib/canonical/commands/cancel-invoice.ts'],
    commandNames: ['issueInvoice', 'cancelUnpaidInvoice'],
    providerStatus: 'existing', providerKey: 'canonical_invoice_provider_v1', providerModule: 'src/lib/canonical/contracts/invoice-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'tenant invoice public ID with immutable typed line public IDs and exact patient/encounter/service links; display bill numbers are not identity',
    statuses: 'draft|posted|cancelled|reversed',
    correction: 'posted invoices are immutable; corrections use credit note, cancellation when legally allowed, reversal or replacement document lineage',
  },
  payment_receipt_tender_allocation: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/collect-payment.ts', 'src/lib/canonical/commands/reverse-payment.ts'],
    commandNames: ['collectPayment', 'reversePayment'],
    providerStatus: 'existing', providerKey: 'canonical_payment_provider_v1', providerModule: 'src/lib/canonical/contracts/payment-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'receipt public ID, tender public ID and immutable allocation public ID with exact invoice linkage; settlement rows do not reconstruct allocation authority',
    statuses: 'receipt: pending|posted|failed|reversed; tender: verifying|captured|failed|reversed; allocation: active|reversed',
    correction: 'append payment reversal and allocation reversal records; never delete or rewrite a posted receipt, tender or allocation',
  },
  patient_deposit_liability: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/apply-deposit.ts', 'src/lib/canonical/commands/allocate-deposit-balance.ts'],
    commandNames: ['recordDeposit', 'applyDeposit', 'applyAvailableDeposits'],
    providerStatus: 'existing', providerKey: 'canonical_deposit_provider_v1', providerModule: 'src/lib/canonical/contracts/deposit-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'deposit public ID tied to exact tenant patient identity and original tender/receipt lineage; invoice linkage occurs only through immutable application IDs',
    statuses: 'deposit: posted|reversed; applications are active or reversed through immutable lineage',
    correction: 'append application reversal, refund or deposit reversal; never reduce liability by mutating prior rows',
  },
  credit_refund_payment_reversal: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/issue-credit-note.ts', 'src/lib/canonical/commands/issue-credit-note-cash-refund.ts', 'src/lib/canonical/commands/reverse-credit-note-cash-refund.ts', 'src/lib/canonical/commands/reverse-payment.ts'],
    commandNames: ['issueCreditNote', 'issueCreditNoteWithCashRefund', 'reverseCreditNoteCashRefund', 'reversePayment'],
    providerStatus: 'contract_only', providerKey: 'canonical_credit_refund_provider_v1', providerModule: 'src/lib/canonical/contracts/credit-refund-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'credit/refund/reversal public IDs with exact original invoice, line, receipt, tender and allocation lineage; approval workflow IDs are not money authority',
    statuses: 'credit documents posted or reversed; cash refunds posted|reversed; payment reversals are append-only terminal facts',
    correction: 'append reversal or replacement credit/refund evidence; mutable deletion or in-place cancellation of financial history is prohibited',
  },
  practitioner_compensation_rule: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/contracts/manage-compensation-rule.ts'],
    commandNames: ['createCompensationRule', 'replaceCompensationRule', 'retireCompensationRule'],
    providerStatus: 'contract_only', providerKey: 'canonical_compensation_rule_provider_v1', providerModule: 'src/lib/canonical/contracts/compensation-rule-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'rule public ID plus exact tenant, practitioner role, service scope, currency and effective date range; overlapping active scopes are prohibited',
    statuses: 'active|inactive|retired',
    correction: 'append a replacement effective-dated rule and retain the immutable rule snapshot referenced by every accrual',
  },
  practitioner_compensation_accrual_adjustment: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/accrue-compensation.ts', 'src/lib/canonical/live-refund-compensation.ts'],
    commandNames: ['accrueCompensation', 'recordCompensationAdjustment', 'reverseCompensationAdjustment'],
    providerStatus: 'existing', providerKey: 'canonical_compensation_accrual_provider_v1', providerModule: 'src/lib/canonical/contracts/compensation-accrual-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'accrual public ID tied to exact invoice line, practitioner role and immutable rule snapshot; refund reservation links to exact credit/refund lineage',
    statuses: 'unassigned|accrued|partially_settled|settled|reversed; refund reservation: held|consumed|disputed|released|written_off',
    correction: 'append signed adjustment or adjustment reversal; never mutate the original accrual amount or referenced rule snapshot',
  },
  practitioner_compensation_settlement: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/finalize-settlement.ts', 'src/lib/canonical/commands/cancel-settlement.ts', 'src/lib/canonical/commands/accrue-compensation.ts'],
    commandNames: ['finalizeSettlement', 'cancelSettlement', 'reverseCompensationSettlement'],
    providerStatus: 'contract_only', providerKey: 'canonical_compensation_settlement_provider_v1', providerModule: 'src/lib/canonical/contracts/compensation-settlement-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'settlement public ID plus exact practitioner, custody source and immutable accrual allocation IDs; payout display numbers are not identity',
    statuses: 'settlement: posted|partially_reversed|reversed; allocations: active|partially_reversed|reversed',
    correction: 'append allocation reversal and settlement reversal evidence; never delete settlement or payout history',
  },
  cash_custody: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/contracts/manage-cash-custody.ts', 'src/lib/canonical/live-cash-custody.ts'],
    commandNames: ['recordCashCustodyMovement', 'reverseCashCustodyMovement', 'closeCashCustodySession'],
    providerStatus: 'contract_only', providerKey: 'canonical_cash_custody_provider_v1', providerModule: 'src/lib/canonical/contracts/cash-custody-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'custody movement public ID tied to exact actor, drawer/account, business date, source fact and direction; cash ledger projections are not authority',
    statuses: 'movements posted or reversed; custody balances are guarded projections derived from immutable movements',
    correction: 'append equal-and-opposite reversal movement and corrected replacement; never mutate prior custody movement amounts',
  },
  user_auth_actor: {
    commandStatus: 'external_governed', commandModules: ['src/routes/tenant/auth.ts', 'src/routes/tenant/users.ts', 'src/routes/tenant/access-control.ts'],
    commandNames: ['authenticateTenantUser', 'assignTenantRole', 'revokeTenantRole'],
    providerStatus: 'external_governed', providerKey: 'governed_users_authority_v1', providerModule: 'src/middleware/auth.ts',
    providerModes: ['external'], providerDefault: 'external', providerRollback: 'external',
    identity: 'governed users.id plus exact tenant membership, role and session purpose; authentication user is not practitioner identity',
    statuses: 'user and access status remain governed by the existing auth/access-control contract; doctor_auth is compatibility only',
    correction: 'append role/access/audit changes and revoke credentials; retain users as external authority and archive duplicate doctor_auth only after linked cutover',
  },
  patient_identity: {
    commandStatus: 'external_governed', commandModules: ['src/routes/tenant/patients.ts', 'src/db/schema/mpi.ts'],
    commandNames: ['upsertGlobalPatientIdentity', 'mergeGlobalPatientIdentity'],
    providerStatus: 'existing', providerKey: 'canonical_patient_identity_provider_v1', providerModule: 'src/lib/canonical/patient-identity-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'global patient public identity remains governed external authority; tenant patient relationships use exact canonical links and duplicate merges require reviewed evidence',
    statuses: 'global identity active/merged/retired semantics remain external; duplicate suspects are workflow documents, not identity authority',
    correction: 'merge or supersede with immutable merge audit; never create a second canonical patient demographics authority',
  },
  tenant_patient_linkage: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/register-or-link-patient.ts'],
    commandNames: ['registerOrLinkPatient'],
    providerStatus: 'existing', providerKey: 'canonical_patient_identity_provider_v1', providerModule: 'src/lib/canonical/patient-identity-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'tenant plus tenant patient source key plus exact global patient public ID; phone, name and timestamp proximity cannot auto-link',
    statuses: 'active|inactive|merged|rejected with immutable relationship events',
    correction: 'retire or supersede the relationship and append an event; retain tenant patient and global identity records',
  },
  appointment_intent: {
    commandStatus: 'existing', commandModules: ['src/lib/canonical/commands/manage-appointment.ts'],
    commandNames: ['createAppointmentIntent', 'transitionAppointmentStatus', 'rescheduleAppointment', 'fulfilAppointment', 'retireAppointmentEncounterLink'],
    providerStatus: 'existing', providerKey: 'canonical_appointment_provider_v1', providerModule: 'src/lib/canonical/appointment-provider.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'appointment public ID with exact patient, practitioner, schedule and source mapping; encounter linkage is explicit and never inferred from time',
    statuses: 'requested|scheduled|confirmed|arrived|checked_in|fulfilled|cancelled|no_show|rescheduled|entered_in_error',
    correction: 'append status event, reschedule lineage or entered-in-error evidence; appointment history and encounter links are immutable',
  },
  reporting_metric_read_promotion: {
    commandStatus: 'contract_only', commandModules: ['docs/database/metric-registry.yaml'],
    commandNames: ['registerProtectedMetricDefinition', 'promoteProtectedMetricProvider', 'rollbackProtectedMetricProvider'],
    providerStatus: 'contract_only', providerKey: 'canonical_reporting_metric_provider_v1', providerModule: 'src/lib/canonical/reporting/common.ts',
    providerModes: ['legacy', 'shadow', 'canonical'], providerDefault: 'legacy', providerRollback: 'legacy',
    identity: 'metric ID, version, tenant scope, business date/time zone, dimensions, numerator, denominator and source authority are explicit registry keys',
    statuses: 'metric definitions: draft|active|retired; provider promotion: legacy|shadow|canonical with exact evidence binding',
    correction: 'append a new metric version or provider decision; never silently change a published metric equation or historical result definition',
  },
};

const FINANCE_EQUATIONS: Record<string, string[]> = {
  service_catalog_pricing: [
    'price_minor is an integer and belongs to exactly one currency and effective scope',
    'posted_invoice_line_price_minor = immutable price snapshot used at posting time',
  ],
  invoice_document: [
    'invoice_net_minor = gross_minor - discount_minor + tax_minor',
    'invoice_paid_minor = sum(successful_allocation_minor) - sum(reversed_allocation_minor)',
    'invoice_due_minor = invoice_net_minor - invoice_paid_minor - applied_credit_minor',
  ],
  payment_receipt_tender_allocation: [
    'receipt_amount_minor = sum(captured_tender_minor)',
    'receipt_unallocated_minor = receipt_amount_minor - sum(successful_allocation_minor)',
    'sum(successful_allocation_minor) <= receipt_amount_minor',
  ],
  patient_deposit_liability: [
    'deposit_available_minor = deposited_minor - applied_minor - refunded_minor + reversed_refund_minor',
    'sum(active_deposit_application_minor) <= deposit_available_minor before the application',
  ],
  credit_refund_payment_reversal: [
    'credit_total_minor = sum(credit_line_minor)',
    'net_refund_minor = refund_minor - refund_reversal_minor',
    'refunded_minor <= eligible_original_tender_minor + separately approved cash_refund_minor',
  ],
  practitioner_compensation_rule: [
    'calculated_compensation_minor = rule_snapshot(base_minor, percentage_basis_points, fixed_minor, caps_minor)',
  ],
  practitioner_compensation_accrual_adjustment: [
    'accrual_balance_minor = original_accrual_minor + adjustment_minor - reversed_adjustment_minor - settled_allocation_minor',
    'refund_reservation_minor <= refundable_accrual_balance_minor',
  ],
  practitioner_compensation_settlement: [
    'settlement_unallocated_minor = settlement_total_minor - sum(settlement_allocation_minor)',
    'sum(active_settlement_allocation_minor) <= eligible_accrual_balance_minor',
  ],
  cash_custody: [
    'custody_balance_minor = opening_minor + inflow_minor - outflow_minor',
    'closing_variance_minor = counted_minor - custody_balance_minor',
  ],
  reporting_metric_read_promotion: [
    'canonical_metric_total_minor - legacy_metric_total_minor = 0 before promotion',
  ],
};

const NON_PRODUCTION_PATH_PATTERNS = [
  /(?:^|\/)(?:lab|radiology|pharmacy|inventory|procurement|emergency|ot|nursing|insurance|payroll|ipd)(?:\/|[-_.])/i,
  /patient-mobile/i,
];

function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function contractId(conceptId: string, ownerId: string): string {
  return `pcacf_${createHash('sha256').update(`${conceptId}|${ownerId}`).digest('hex').slice(0, 24)}`;
}

function rollbackRule(mode: Exclude<ProviderMode, 'shadow'>): string {
  if (mode === 'external') return EXTERNAL_ROLLBACK;
  if (mode === 'canonical') return CANONICAL_ROLLBACK;
  return LEGACY_ROLLBACK;
}

function buildAuthority(concept: AuthorityMatrixConcept) {
  if (concept.id === 'user_auth_actor' || concept.id === 'patient_identity') {
    const ownerTables = uniqueSorted(concept.targetAuthority.tables ?? []);
    return {
      ownerId: `external:${ownerTables.join('+')}`,
      ownerKind: 'governed_external_table' as const,
      ownerTables,
      schemaModules: uniqueSorted(concept.targetAuthority.modules ?? []),
      currentSources: [...(concept.currentSources ?? [])].sort((a, b) => a.table.localeCompare(b.table)),
      duplicateSourceDispositionFrozen: true as const,
    };
  }
  if (concept.id === 'reporting_metric_read_promotion') {
    return {
      ownerId: 'registry:protected-core-metrics',
      ownerKind: 'governed_registry' as const,
      ownerTables: [],
      ownerRegistry: METRIC_REGISTRY_PATH,
      schemaModules: [METRIC_REGISTRY_PATH, 'src/lib/canonical/reporting/common.ts'],
      currentSources: [...(concept.currentSources ?? [])].sort((a, b) => a.table.localeCompare(b.table)),
      duplicateSourceDispositionFrozen: true as const,
    };
  }
  const ownerTables = uniqueSorted(concept.targetAuthority.tables ?? []);
  return {
    ownerId: `canonical:${ownerTables.join('+')}`,
    ownerKind: 'canonical_tables' as const,
    ownerTables,
    schemaModules: uniqueSorted((concept.targetAuthority.modules ?? []).filter((path) => path.includes('/schema/'))),
    currentSources: [...(concept.currentSources ?? [])].sort((a, b) => a.table.localeCompare(b.table)),
    duplicateSourceDispositionFrozen: true as const,
  };
}

function routesForConcept(inventory: ProtectedCoreSurfaceInventory, conceptId: string, kind: 'http_route' | 'ui_flow'): string[] {
  return uniqueSorted(inventory.surfaces
    .filter((surface) => surface.kind === kind && surface.conceptIds.includes(conceptId) && surface.routeMount)
    .map((surface) => surface.routeMount!));
}

function moneyContract(conceptId: string): ProtectedCoreConceptContract['moneyContract'] {
  const equations = FINANCE_EQUATIONS[conceptId] ?? [];
  return {
    unit: equations.length > 0 ? 'integer_minor_units' : 'not_applicable',
    equations,
    unexplainedVarianceMinor: 0,
    roundingRule: equations.length > 0
      ? 'no floating-point storage or comparison; percentage calculations use integer basis points and a named deterministic rounding rule before persistence'
      : 'this concept must not create an independent money value or infer one from presentation data',
  };
}

function reconciliationChecks(conceptId: string, money: ProtectedCoreConceptContract['moneyContract']): string[] {
  const base = [
    'source row count and canonical mapping count reconcile for the bounded tenant/snapshot',
    'all tenant, public-ID and foreign-key scopes are valid',
    'second pass creates zero new business rows',
  ];
  if (money.unit === 'integer_minor_units') base.push(...money.equations.map((equation) => `prove ${equation}`));
  if (['patient_identity', 'tenant_patient_linkage', 'practitioner_identity', 'practitioner_account_links', 'appointment_intent', 'encounter_care_episode'].includes(conceptId)) {
    base.push('ambiguous identity mappings remain stable processing issues and are not counted as successful mappings');
  }
  return base;
}

function buildConceptContract(
  concept: AuthorityMatrixConcept,
  inventory: ProtectedCoreSurfaceInventory,
): ProtectedCoreConceptContract {
  const override = OVERRIDES[concept.id];
  if (!override) throw new Error(`Missing Core V1 contract override for ${concept.id}`);
  const authority = buildAuthority(concept);
  const money = moneyContract(concept.id);
  const httpRoutes = routesForConcept(inventory, concept.id, 'http_route');
  const uiRoutes = routesForConcept(inventory, concept.id, 'ui_flow');
  return {
    contractId: contractId(concept.id, authority.ownerId),
    conceptId: concept.id,
    domain: concept.domain,
    fact: concept.fact,
    authority,
    commandBoundary: {
      implementationStatus: override.commandStatus,
      modules: uniqueSorted(override.commandModules),
      commandNames: uniqueSorted(override.commandNames),
      transactionBoundary: COMMAND_TX,
      idempotencyRule: IDEMPOTENCY,
      auditOutboxRule: AUDIT_OUTBOX,
    },
    providerBoundary: {
      implementationStatus: override.providerStatus,
      providerKey: override.providerKey,
      module: override.providerModule,
      supportedModes: override.providerModes,
      defaultMode: override.providerDefault,
      rollbackMode: override.providerRollback,
      productionEnabled: false,
      activationRequiresSeparateAuthorization: true,
      rollbackRule: rollbackRule(override.providerRollback),
    },
    identityContract: override.identity,
    statusContract: override.statuses,
    correctionContract: override.correction,
    moneyContract: money,
    reconciliationContract: {
      sourceStatus: concept.reconciliation?.status ?? 'not_recorded',
      requiredChecks: reconciliationChecks(concept.id, money),
      abortConditions: [
        'any unexplained money variance is non-zero',
        'any identity mapping is inferred from name, phone, numeric-ID coincidence or timestamp proximity',
        'any tenant-scope or foreign-key violation exists',
        'the second pass creates any new business row',
        'the exact build, snapshot, provider mode or rollback target is not bound to the evidence',
      ],
    },
    compatibilityContract: {
      httpRoutes,
      uiRoutes,
      responseRule: 'preserve the reviewed HTTP status, response envelope, public identifiers, money units and permission failures until a separately versioned contract is approved',
      writeRule: 'legacy-compatible responses may remain, but every promoted mutation must cross the frozen command boundary and must not create a second authority',
    },
    migrationContract: {
      sourceStatus: concept.backfill?.status ?? 'not_recorded',
      executionRule: 'production execution is prohibited here; future clone/production work must be tenant-bounded, resumable, idempotent, checkpointed and bound to an exact source snapshot and commit',
      secondPassRule: 'a completed second pass must create zero new business rows and preserve the source snapshot unchanged',
      identityAmbiguityRule: 'ambiguous rows become deterministic non-PHI processing issues; no heuristic identity or money repair is allowed',
    },
    retirementContract: {
      sourceStatus: concept.retirement?.status ?? 'blocked',
      sourceDispositions: [...(concept.currentSources ?? [])].sort((a, b) => a.table.localeCompare(b.table)),
      retirementRule: concept.retirement?.action ?? 'retirement remains blocked until canonical read/write promotion, observation and rollback evidence pass',
      physicalDeletionRequiresSeparateAuthorization: true,
    },
  };
}

export function buildProtectedCoreAuthorityContractFreeze(rootInput: string): ProtectedCoreAuthorityContractFreeze {
  const root = resolve(rootInput);
  const matrix = readJson<AuthorityMatrix>(root, MATRIX_PATH);
  const inventory = buildProtectedCoreSurfaceInventory(root);
  const conceptMap = new Map(matrix.concepts.map((concept) => [concept.id, concept]));
  const missing = PROTECTED_CORE_CONCEPT_IDS.filter((id) => !conceptMap.has(id));
  if (missing.length > 0) throw new Error(`Protected Core V1 concepts missing from authority matrix: ${missing.join(', ')}`);

  const concepts = PROTECTED_CORE_CONCEPT_IDS
    .map((id) => buildConceptContract(conceptMap.get(id)!, inventory))
    .sort((a, b) => a.conceptId.localeCompare(b.conceptId));

  const tableOwners = new Map<string, string[]>();
  for (const contract of concepts) {
    for (const table of contract.authority.ownerTables) {
      const owners = tableOwners.get(table) ?? [];
      owners.push(contract.conceptId);
      tableOwners.set(table, owners);
    }
  }
  const unresolvedDuplicateAuthorities = [...tableOwners.entries()]
    .filter(([, owners]) => new Set(owners).size > 1)
    .map(([table, owners]) => `${table}:${uniqueSorted(owners).join(',')}`)
    .sort((a, b) => a.localeCompare(b));

  const protectedRoutePaths = inventory.surfaces
    .filter((surface) => surface.kind === 'http_route' || surface.kind === 'ui_flow')
    .map((surface) => surface.path);
  const nonProductionScopeLeakage = uniqueSorted(protectedRoutePaths.filter((path) =>
    NON_PRODUCTION_PATH_PATTERNS.some((pattern) => pattern.test(path))));

  return {
    version: 1,
    task: PROTECTED_CORE_AUTHORITY_CONTRACT_TASK,
    reviewedAt: '2026-07-28',
    branch: 'program/cdb-main-continuous-20260725',
    sourceInventory: PROTECTED_CORE_INVENTORY_PATH,
    sourceDocuments: [POLICY_PATH, RUNBOOK_PATH, PROTECTED_CORE_INVENTORY_PATH, MATRIX_PATH, SOURCE_OF_TRUTH_PATH, METRIC_REGISTRY_PATH],
    productionAuthorization: {
      repositoryContractFreeze: true,
      productionReadAccess: false,
      productionMutation: false,
      providerActivation: false,
      deploymentOrTrafficChange: false,
      liveLegacyRetirement: false,
    },
    summary: {
      conceptContractCount: concepts.length,
      canonicalTableOwnerCount: concepts.filter((contract) => contract.authority.ownerKind === 'canonical_tables').length,
      governedExternalOwnerCount: concepts.filter((contract) => contract.authority.ownerKind === 'governed_external_table').length,
      governedRegistryOwnerCount: concepts.filter((contract) => contract.authority.ownerKind === 'governed_registry').length,
      existingCommandBoundaryCount: concepts.filter((contract) => contract.commandBoundary.implementationStatus === 'existing').length,
      contractOnlyCommandBoundaryCount: concepts.filter((contract) => contract.commandBoundary.implementationStatus === 'contract_only').length,
      existingProviderBoundaryCount: concepts.filter((contract) => contract.providerBoundary.implementationStatus === 'existing').length,
      contractOnlyProviderBoundaryCount: concepts.filter((contract) => contract.providerBoundary.implementationStatus === 'contract_only').length,
      unresolvedDuplicateAuthorityCount: unresolvedDuplicateAuthorities.length,
      nonProductionScopeLeakageCount: nonProductionScopeLeakage.length,
    },
    concepts,
    unresolvedDuplicateAuthorities,
    nonProductionScopeLeakage,
    globalInvariants: [
      'one protected business fact has exactly one frozen Canonical, governed external or governed registry owner boundary',
      'users and global patient identity remain governed external authorities; no duplicate canonical person table may be introduced',
      'all financial storage and comparison uses integer minor units and requires zero unexplained variance',
      'all identity mappings require exact reviewed evidence; names, phone numbers, timestamps and numeric-ID coincidence are prohibited',
      'posted financial facts, signed clinical history, mappings, audit and reconciliation evidence are corrected by append-only reversal, replacement or supersession',
      'every provider remains production-disabled and defaults to the current reviewed authority until separately authorized promotion',
      'every provider has an immediate rollback mode that preserves both legacy and canonical history',
      'production access, mutation, deployment, traffic change, provider activation and live legacy retirement are not authorized by this contract freeze',
    ],
  };
}

export function validateProtectedCoreAuthorityContractFreeze(
  freeze: ProtectedCoreAuthorityContractFreeze,
  rootInput: string,
): string[] {
  const root = resolve(rootInput);
  const issues: string[] = [];
  if (freeze.task !== PROTECTED_CORE_AUTHORITY_CONTRACT_TASK) issues.push('task identifier mismatch');
  if (freeze.concepts.length !== PROTECTED_CORE_CONCEPT_IDS.length) issues.push('protected concept contract count mismatch');
  if (freeze.productionAuthorization.productionReadAccess) issues.push('production read access must remain false');
  if (freeze.productionAuthorization.productionMutation) issues.push('production mutation must remain false');
  if (freeze.productionAuthorization.providerActivation) issues.push('provider activation must remain false');
  if (freeze.productionAuthorization.deploymentOrTrafficChange) issues.push('deployment or traffic change must remain false');
  if (freeze.productionAuthorization.liveLegacyRetirement) issues.push('live legacy retirement must remain false');
  if (freeze.unresolvedDuplicateAuthorities.length > 0) issues.push('unresolved duplicate authority remains');
  if (freeze.nonProductionScopeLeakage.length > 0) issues.push('non-production scope leakage remains');

  for (const source of freeze.sourceDocuments) {
    if (!existsSync(join(root, source))) issues.push(`missing source document: ${source}`);
  }

  const ids = new Set<string>();
  const conceptIds = new Set<string>();
  for (const contract of freeze.concepts) {
    if (ids.has(contract.contractId)) issues.push(`duplicate contract ID: ${contract.contractId}`);
    ids.add(contract.contractId);
    if (conceptIds.has(contract.conceptId)) issues.push(`duplicate concept contract: ${contract.conceptId}`);
    conceptIds.add(contract.conceptId);
    if (!contract.authority.ownerId) issues.push(`missing owner ID: ${contract.conceptId}`);
    if (contract.authority.ownerKind === 'canonical_tables' && contract.authority.ownerTables.length === 0) {
      issues.push(`canonical owner has no tables: ${contract.conceptId}`);
    }
    if (contract.authority.ownerKind === 'governed_external_table' && contract.authority.ownerTables.length !== 1) {
      issues.push(`external owner must have exactly one table: ${contract.conceptId}`);
    }
    if (contract.authority.ownerKind === 'governed_registry' && !contract.authority.ownerRegistry) {
      issues.push(`registry owner missing registry path: ${contract.conceptId}`);
    }
    if (contract.commandBoundary.commandNames.length === 0) issues.push(`missing command names: ${contract.conceptId}`);
    if (contract.commandBoundary.implementationStatus === 'existing') {
      for (const module of contract.commandBoundary.modules) {
        if (!existsSync(join(root, module))) issues.push(`existing command module missing: ${contract.conceptId}:${module}`);
      }
    }
    if (contract.providerBoundary.implementationStatus === 'existing' || contract.providerBoundary.implementationStatus === 'governance_only') {
      if (!existsSync(join(root, contract.providerBoundary.module))) {
        issues.push(`existing provider module missing: ${contract.conceptId}:${contract.providerBoundary.module}`);
      }
    }
    if (contract.providerBoundary.productionEnabled) issues.push(`provider unexpectedly enabled: ${contract.conceptId}`);
    if (!contract.providerBoundary.activationRequiresSeparateAuthorization) issues.push(`provider activation not gated: ${contract.conceptId}`);
    if (!contract.identityContract || !contract.statusContract || !contract.correctionContract) issues.push(`incomplete fact contract: ${contract.conceptId}`);
    if (contract.moneyContract.unit === 'integer_minor_units' && contract.moneyContract.equations.length === 0) issues.push(`money contract has no equations: ${contract.conceptId}`);
    if (contract.moneyContract.unexplainedVarianceMinor !== 0) issues.push(`money variance is not zero: ${contract.conceptId}`);
    if (!contract.migrationContract.secondPassRule.includes('zero new business rows')) issues.push(`second-pass rule incomplete: ${contract.conceptId}`);
    if (!contract.retirementContract.physicalDeletionRequiresSeparateAuthorization) issues.push(`destructive retirement not separately gated: ${contract.conceptId}`);
  }

  for (const id of PROTECTED_CORE_CONCEPT_IDS) {
    if (!conceptIds.has(id)) issues.push(`missing protected concept contract: ${id}`);
  }
  return uniqueSorted(issues);
}

export function generateProtectedCoreAuthorityContractFreeze(rootInput: string): ProtectedCoreAuthorityContractFreeze {
  const root = resolve(rootInput);
  const freeze = buildProtectedCoreAuthorityContractFreeze(root);
  const issues = validateProtectedCoreAuthorityContractFreeze(freeze, root);
  if (issues.length > 0) throw new Error(`Core V1 authority contract validation failed:\n- ${issues.join('\n- ')}`);
  writeFileSync(join(root, PROTECTED_CORE_AUTHORITY_CONTRACT_PATH), `${JSON.stringify(freeze, null, 2)}\n`, 'utf8');
  return freeze;
}
