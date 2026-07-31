import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  AuthorityWriterAccess,
  CanonicalAuthorityAccessRegistry,
  WriterLifecycleStatus,
} from './canonical-authority-access';
import {
  PROTECTED_CORE_AUTHORITY_CONTRACT_PATH,
  buildProtectedCoreAuthorityContractFreeze,
  type ProtectedCoreAuthorityContractFreeze,
  type ProtectedCoreConceptContract,
} from './protected-core-authority-contract-freeze';
import {
  PROTECTED_CORE_INVENTORY_PATH,
  buildProtectedCoreSurfaceInventory,
} from './protected-core-surface-inventory';
import { FINANCIAL_ROUTE_COVERAGE } from '../../src/lib/canonical/financial-route-coverage';

export const PROTECTED_CORE_WRITER_COVERAGE_PATH = 'docs/database/protected-core-v1-writer-command-coverage.json';
export const PROTECTED_CORE_WRITER_COVERAGE_TASK = 'CDB-V1-030A-PROTECTED-WRITER-COMMAND-COVERAGE-BASELINE';

const ACCESS_REGISTRY_PATH = 'docs/database/canonical-authority-access-registry.yaml';
const POLICY_PATH = 'docs/architecture/hms-production-scope-policy.md';
const RUNBOOK_PATH = 'docs/database/canonical-core-v1-production-cutover-runbook.md';

export type ProtectedWriterClassification =
  | 'canonical_command'
  | 'atomic_compatibility'
  | 'external_governed'
  | 'strict_blocked'
  | 'command_required'
  | 'fixture_isolated';

export interface ProtectedWriterCommandCoverageEntry {
  writerId: string;
  path: string;
  table: string;
  operations: string[];
  lifecycleStatus: WriterLifecycleStatus;
  protectedConceptIds: string[];
  classification: ProtectedWriterClassification;
  requiredCommandNames: string[];
  requiredCommandModules: string[];
  implementedCommandModules: string[];
  contractOnlyCommandModules: string[];
  strictBoundaryIds: string[];
  currentTargetCommand: string;
  transactionRule: string;
  idempotencyRule: string;
  auditOutboxRule: string;
  compatibilityRule: string;
  rollbackRule: string;
  nextAction: string;
}

export interface ProtectedWriterImplementationGroup {
  protectedConceptId: string;
  writerIds: string[];
  paths: string[];
  tables: string[];
  requiredCommandNames: string[];
  requiredCommandModules: string[];
}

export interface ProtectedCoreWriterCommandCoverage {
  version: 1;
  task: typeof PROTECTED_CORE_WRITER_COVERAGE_TASK;
  reviewedAt: '2026-07-28';
  branch: 'program/cdb-main-continuous-20260725';
  sourceInventory: typeof PROTECTED_CORE_INVENTORY_PATH;
  sourceAuthorityContract: typeof PROTECTED_CORE_AUTHORITY_CONTRACT_PATH;
  sourceDocuments: string[];
  productionAuthorization: {
    repositoryCoverageBaseline: true;
    productionReadAccess: false;
    productionMutation: false;
    providerActivation: false;
    deploymentOrTrafficChange: false;
    liveLegacyRetirement: false;
  };
  summary: {
    writerCount: number;
    classificationCounts: Record<ProtectedWriterClassification, number>;
    canonicalCommandWriterCount: number;
    atomicCompatibilityWriterCount: number;
    externalGovernedWriterCount: number;
    strictBlockedWriterCount: number;
    commandRequiredWriterCount: number;
    fixtureIsolatedWriterCount: number;
    unclassifiedWriterCount: number;
  };
  programState: {
    commandCoverageComplete: boolean;
    nextCheckpoint: string;
    exitCondition: string;
  };
  writers: ProtectedWriterCommandCoverageEntry[];
  implementationGroups: ProtectedWriterImplementationGroup[];
  unclassifiedWriters: string[];
  invariants: string[];
}

const TRANSACTION_RULE = 'source compatibility fact, Canonical fact, exact source mapping, idempotency receipt, audit evidence and outbox event must succeed in one D1 batch or the complete mutation rolls back';
const IDEMPOTENCY_RULE = 'use one tenant-scoped operation key and stable request fingerprint; exact replay returns the prior result and changed replay fails closed';
const AUDIT_OUTBOX_RULE = 'record actor, tenant, source/public IDs, command name and non-PHI evidence hash; create audit/outbox evidence in the same transaction';
const ROLLBACK_RULE = 'disable strict promotion for the bounded route and immediately restore the reviewed compatibility path without deleting Canonical or legacy history';

interface AtomicCommandRouteIntegration {
  boundary: string;
  path: string;
  table: string;
  requiredTokens: readonly string[];
  evidenceFiles?: readonly {
    path: string;
    requiredTokens: readonly string[];
  }[];
}

const ATOMIC_COMMAND_ROUTE_INTEGRATIONS: readonly AtomicCommandRouteIntegration[] = [
  {
    boundary: 'canonical-outbox.refund-commission',
    path: 'src/lib/billing-refund-commission.ts',
    table: 'accounting_posting_events',
    requiredTokens: [
      'applyRefundCommissionImpact',
      'buildRefundCommissionImpactStatements',
      "commandName = 'canonical.refund_commission.impact'",
      'readCanonicalCommandReplay',
      'runCanonicalBatch',
      'prepareFinancialBatchAssertion',
      'prepareClearFinancialBatchAssertions',
      'buildRestoreExecutedRefundCommissionStatements',
      'buildRefundCommissionReservationStatements',
      'buildRestoreRefundCommissionReservationStatements',
      'prepareRefundBatchAssertion',
      'accounting_posting_events',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/executed-refund.ts',
        requiredTokens: [
          'buildRestoreExecutedRefundCommissionStatements',
          'executeStrictFinancialMutation',
          "boundary: 'credit-note.cash-refund.reverse'",
          'reverseCreditNoteCashRefund',
        ],
      },
      {
        path: 'src/lib/billing-refund-dispute.ts',
        requiredTokens: [
          'buildRestoreRefundCommissionReservationStatements',
          'executeStrictFinancialMutation',
          "boundary: 'doctor-compensation.refund-release'",
          'executeLiveRefundCompensationRelease',
        ],
      },
      {
        path: 'test/unit/executed-refund-reversal.test.ts',
        requiredTokens: [
          'restores legacy finance and opens a dispute without a second cash movement',
          'fails closed before mutation when returned cash has no eligible active source session',
        ],
      },
      {
        path: 'test/unit/billing-refund-dispute.test.ts',
        requiredTokens: [
          'cash recovery posts cash-in and settles the dispute exactly once',
          'rolls back the write-off event, outbox claim, and dispute state when a guarded row is stale',
        ],
      },
    ],
  },
  {
    boundary: 'canonical-outbox.refund-dispute',
    path: 'src/lib/billing-refund-dispute.ts',
    table: 'accounting_posting_events',
    requiredTokens: [
      'readCanonicalCommandReplay',
      'runCanonicalBatch',
      "commandName = 'canonical.refund_dispute.writeoff'",
      'prepareFinancialBatchAssertion',
      'prepareClearFinancialBatchAssertions',
      'createSourceEvidenceSha256',
      'accounting_posting_events',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/command-batch.ts',
        requiredTokens: [
          'prepareCanonicalBatch',
          'canonical_outbox_events',
          'requestFingerprint',
          'replayOrConflict',
        ],
      },
      {
        path: 'src/lib/canonical/financial-batch-assertion.ts',
        requiredTokens: [
          'prepareFinancialBatchAssertion',
          'canonical_financial_batch_assertions',
          'CASE WHEN changes() = ? THEN 1 ELSE 0 END',
        ],
      },
      {
        path: 'test/unit/billing-refund-dispute.test.ts',
        requiredTokens: [
          'write-off closes liability through one replay-safe Canonical outbox batch',
          'CanonicalIdempotencyConflictError',
          'rolls back the write-off event, outbox claim, and dispute state when a guarded row is stale',
        ],
      },
    ],
  },
  {
    boundary: 'canonical-outbox.appointment-finalization',
    path: 'src/lib/canonical/appointment-billing-finalization.ts',
    table: 'accounting_posting_events',
    requiredTokens: [
      'prepareAppointmentBillingStrictStatements',
      'prepareFinancialBatchAssertion',
      'prepareClearFinancialBatchAssertions',
      'accounting_posting_events',
      'strictAuthoritativeStatements',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/appointments.ts',
        requiredTokens: [
          'prepareAppointmentBillingLegacyStatements',
          'executeStrictFinancialMutation',
          "boundary: 'appointment.billing.finalize'",
          'issueInvoiceWithFullPayment',
          'issueInvoice',
        ],
      },
      {
        path: 'test/canonical/appointment-billing-finalization.test.ts',
        requiredTokens: [
          'commits the complete bill, payment, appointment, and accounting transition',
          'rolls back all financial rows when appointment status changed concurrently',
        ],
      },
    ],
  },
  {
    boundary: 'canonical-outbox.compensation-accrual',
    path: 'src/lib/canonical/compensation-accrual-route-integration.ts',
    table: 'accounting_posting_events',
    requiredTokens: [
      'doctorCommissionLegacyStatements',
      'prepareFinancialBatchAssertion',
      'prepareClearFinancialBatchAssertions',
      'accounting_posting_events',
      'executeStrictFinancialMutation',
      "boundary: 'doctor-compensation.adjust'",
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/commands/accrue-compensation.ts',
        requiredTokens: [
          'prepareCompensationAdjustment',
          'prepareCanonicalBatch',
          'authoritativeStatements',
          'canonical.compensation.adjust',
        ],
      },
      {
        path: 'test/canonical/compensation-accrual-route-integration.test.ts',
        requiredTokens: [
          'cancels mapped doctor commission with accounting, audit and Canonical adjustment atomically',
          'requires settlement reversal before cancelling paid compensation',
        ],
      },
    ],
  },
  {
    boundary: 'canonical-outbox.gateway-verification',
    path: 'src/lib/canonical/gateway-payment-verification.ts',
    table: 'accounting_posting_events',
    requiredTokens: [
      'prepareGatewayPaymentStrictStatements',
      'prepareFinancialBatchAssertion',
      'prepareClearFinancialBatchAssertions',
      'accounting_posting_events',
      'strictAuthoritativeStatements',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/payments.ts',
        requiredTokens: [
          'prepareGatewayPaymentLegacyStatements',
          'executeStrictFinancialMutation',
          "boundary: 'payment-gateway.verify'",
          'settleGatewayPayment',
        ],
      },
      {
        path: 'src/lib/canonical/commands/settle-gateway-payment.ts',
        requiredTokens: [
          'runCanonicalBatch',
          'canonical.gateway_payment.settle',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/gateway-payment-verification.test.ts',
        requiredTokens: [
          'commits guarded payment, advance, gateway log, and accounting events in strict mode',
          'rolls back every strict write when the gateway log is no longer verifying',
        ],
      },
    ],
  },
  {
    boundary: 'canonical-outbox.executed-refund',
    path: 'src/lib/executed-refund.ts',
    table: 'accounting_posting_events',
    requiredTokens: [
      'prepareExecutedRefundReversalAccountingEvent',
      'prepareRefundBatchAssertion',
      'accounting_posting_events',
      'executeStrictFinancialMutation',
      "boundary: 'credit-note.cash-refund.reverse'",
      'strictAuthoritativeStatements: statements',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/commands/reverse-credit-note-cash-refund.ts',
        requiredTokens: [
          'reverseCreditNoteCashRefund',
          'runCanonicalBatch',
          'authoritativeStatements',
          'canonical.credit_note.cash_refund_reversed',
        ],
      },
      {
        path: 'test/unit/executed-refund-reversal.test.ts',
        requiredTokens: [
          'restores legacy finance and opens a dispute without a second cash movement',
          'credits acknowledged returned cash once and does not open a dispute',
          'fails closed before mutation when returned cash has no eligible active source session',
        ],
      },
    ],
  },
  {
    boundary: 'invoice-document.billing-create-batch',
    path: 'src/lib/billing-create-batch.ts',
    table: 'bills',
    requiredTokens: [
      'prepareBillCreationStrictStatements',
      'strictAuthoritativeStatements',
      'prepareAcceptedServiceRouteBatch',
      'commandIdempotencyKey',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/billing.ts',
        requiredTokens: [
          'buildBillCreationBatch',
          'executeStrictFinancialMutation',
          "boundary: 'billing.create'",
          'issueInvoice',
          'buildLiveInvoiceProjection',
        ],
      },
      {
        path: 'src/lib/canonical/commands/issue-invoice.ts',
        requiredTokens: [
          'canonical.invoice.issue',
          'execution.authoritativeStatements',
          'canonical_invoices',
          'canonical_invoice_lines',
        ],
      },
      {
        path: 'test/unit/billing-create-batch.test.ts',
        requiredTokens: [
          'builds a bill insert and item inserts without explicit transaction statements',
          'attaches an async strict service-acceptance factory without changing legacy enumeration',
        ],
      },
      {
        path: 'test/canonical/strict-financial-mutation.test.ts',
        requiredTokens: [
          "boundary: 'billing.create'",
          'authoritativeStatements',
        ],
      },
    ],
  },
  {
    boundary: 'invoice-document.billing-create-batch',
    path: 'src/lib/billing-create-batch.ts',
    table: 'invoice_items',
    requiredTokens: [
      'prepareBillCreationStrictStatements',
      'strictAuthoritativeStatements',
      'prepareAcceptedServiceRouteBatch',
      'commandIdempotencyKey',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/billing.ts',
        requiredTokens: [
          'buildBillCreationBatch',
          'executeStrictFinancialMutation',
          "boundary: 'billing.create'",
          'issueInvoice',
          'buildLiveInvoiceProjection',
        ],
      },
      {
        path: 'src/lib/canonical/commands/issue-invoice.ts',
        requiredTokens: [
          'canonical.invoice.issue',
          'execution.authoritativeStatements',
          'canonical_invoice_lines',
        ],
      },
      {
        path: 'test/unit/billing-create-batch.test.ts',
        requiredTokens: [
          'scopes invoice-item bill lookup by both tenant and invoice number',
          'attaches an async strict service-acceptance factory without changing legacy enumeration',
        ],
      },
    ],
  },
  {
    boundary: 'invoice-document.appointment-finalization',
    path: 'src/lib/canonical/appointment-billing-finalization.ts',
    table: 'bills',
    requiredTokens: [
      'prepareAppointmentBillingStrictStatements',
      'prepareAppointmentBillingServiceStrictStatements',
      'strictAuthoritativeStatements',
      'prepareAcceptedServiceRouteBatch',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/appointments.ts',
        requiredTokens: [
          'prepareAppointmentBillingLegacyStatements',
          'executeStrictFinancialMutation',
          "boundary: 'appointment.billing.finalize'",
          'issueInvoiceWithFullPayment',
          'issueInvoice',
        ],
      },
      {
        path: 'src/lib/canonical/commands/issue-invoice.ts',
        requiredTokens: [
          'canonical.invoice.issue',
          'execution.authoritativeStatements',
        ],
      },
      {
        path: 'src/lib/canonical/commands/issue-invoice-full-payment.ts',
        requiredTokens: [
          'issueInvoiceWithFullPayment',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/appointment-billing-finalization.test.ts',
        requiredTokens: [
          'commits appointment finance and accepted consultation service evidence in one strict batch',
          'rolls back all financial rows when appointment status changed concurrently',
        ],
      },
    ],
  },
  {
    boundary: 'invoice-document.appointment-finalization',
    path: 'src/lib/canonical/appointment-billing-finalization.ts',
    table: 'invoice_items',
    requiredTokens: [
      'prepareAppointmentBillingStrictStatements',
      'prepareAppointmentBillingServiceStrictStatements',
      'strictAuthoritativeStatements',
      'prepareAcceptedServiceRouteBatch',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/appointments.ts',
        requiredTokens: [
          'prepareAppointmentBillingLegacyStatements',
          'executeStrictFinancialMutation',
          "boundary: 'appointment.billing.finalize'",
          'issueInvoiceWithFullPayment',
          'issueInvoice',
        ],
      },
      {
        path: 'test/canonical/appointment-billing-finalization.test.ts',
        requiredTokens: [
          'commits the complete bill, payment, appointment, and accounting transition',
          'rolls back the bill when a provisional item was already finalized',
        ],
      },
    ],
  },
  {
    boundary: 'invoice-deposit.gateway-verification',
    path: 'src/lib/canonical/gateway-payment-verification.ts',
    table: 'billing_deposits',
    requiredTokens: [
      'prepareGatewayPaymentStrictStatements',
      'strictAuthoritativeStatements',
      'prepareFinancialBatchAssertion',
      'depositAmount',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/payments.ts',
        requiredTokens: [
          'prepareGatewayPaymentLegacyStatements',
          'executeStrictFinancialMutation',
          "boundary: 'payment-gateway.verify'",
          'settleGatewayPayment',
          'buildLiveDepositProjection',
        ],
      },
      {
        path: 'src/lib/canonical/commands/settle-gateway-payment.ts',
        requiredTokens: [
          'settleGatewayPayment',
          'canonical.deposit.recorded',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/gateway-payment-verification.test.ts',
        requiredTokens: [
          'commits guarded payment, advance, gateway log, and accounting events in strict mode',
          'rolls back every strict write when the bill snapshot is stale',
        ],
      },
    ],
  },
  {
    boundary: 'invoice-deposit.gateway-verification',
    path: 'src/lib/canonical/gateway-payment-verification.ts',
    table: 'bills',
    requiredTokens: [
      'prepareGatewayPaymentStrictStatements',
      'strictAuthoritativeStatements',
      'prepareFinancialBatchAssertion',
      'expectedBillStatus',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/payments.ts',
        requiredTokens: [
          'prepareGatewayPaymentLegacyStatements',
          'executeStrictFinancialMutation',
          "boundary: 'payment-gateway.verify'",
          'settleGatewayPayment',
          'buildLivePaymentProjection',
        ],
      },
      {
        path: 'src/lib/canonical/commands/settle-gateway-payment.ts',
        requiredTokens: [
          'settleGatewayPayment',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/gateway-payment-verification.test.ts',
        requiredTokens: [
          'commits guarded payment, advance, gateway log, and accounting events in strict mode',
          'rolls back every strict write when the gateway log is no longer verifying',
        ],
      },
    ],
  },
  {
    boundary: 'invoice-document.executed-refund',
    path: 'src/lib/executed-refund.ts',
    table: 'bills',
    requiredTokens: [
      'reverseExecutedRefund',
      'executeStrictFinancialMutation',
      "boundary: 'credit-note.cash-refund.reverse'",
      'reverseCreditNoteCashRefund',
      'strictAuthoritativeStatements',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/commands/reverse-credit-note-cash-refund.ts',
        requiredTokens: [
          'reverseCreditNoteCashRefund',
          'authoritativeStatements',
          'canonical.credit_note.cash_refund_reversed',
        ],
      },
      {
        path: 'test/unit/executed-refund-reversal.test.ts',
        requiredTokens: [
          'restores legacy finance and opens a dispute without a second cash movement',
          'fails closed before mutation when returned cash has no eligible active source session',
        ],
      },
      {
        path: 'test/canonical/financial-route-coverage.test.ts',
        requiredTokens: [
          "FINANCIAL_ROUTE_COVERAGE['credit-note.cash-refund.reverse']",
          'reverseCreditNoteCashRefund',
        ],
      },
    ],
  },
  {
    boundary: 'invoice-document.payment-void',
    path: 'src/lib/payment-void-execution.ts',
    table: 'bills',
    requiredTokens: [
      'executePaymentVoidReversal',
      'executeStrictFinancialMutation',
      "boundary: 'payment.reverse'",
      'resolveLivePaymentReversalProjection',
      'reversePayment',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/commands/reverse-payment.ts',
        requiredTokens: [
          'reversePayment',
          'execution.authoritativeStatements',
          'canonical.payment.reversed',
        ],
      },
      {
        path: 'test/unit/payment-void-execution.test.ts',
        requiredTokens: [
          'reverses the payment and attributes drawer accountability to the original receiver',
          'places caller-supplied operational statements in the same authoritative batch',
          'blocks reversal when linked doctor compensation is already paid',
        ],
      },
      {
        path: 'test/canonical/financial-route-coverage.test.ts',
        requiredTokens: [
          "FINANCIAL_ROUTE_COVERAGE['payment.reverse']",
          'executePaymentVoidReversal',
        ],
      },
    ],
  },
  {
    boundary: 'service-catalog.route-adapter-compatibility',
    path: 'src/lib/canonical/service-catalog-route-integration.ts',
    table: 'billing_service_items',
    requiredTokens: [
      'applyBillingServiceCatalogMutation',
      'upsertCanonicalServiceCatalogItem',
      'authoritativeStatements',
      'canonical_source_key',
      'identityStatement',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/contracts/manage-service-catalog.ts',
        requiredTokens: [
          'prepareUpsertCanonicalServiceCatalogItem',
          'upsertCanonicalServiceCatalogItem',
          'prepareCanonicalBatch',
        ],
      },
      {
        path: 'test/canonical/service-catalog-route-integration.test.ts',
        requiredTokens: [
          'commits legacy service, default category price, Canonical facts, mappings and outbox in one batch',
          'rolls back legacy compatibility, Canonical facts, mappings and outbox',
        ],
      },
    ],
  },
  {
    boundary: 'service-price.route-adapter-compatibility',
    path: 'src/lib/canonical/service-catalog-route-integration.ts',
    table: 'billing_item_price_category_maps',
    requiredTokens: [
      'applyBillingServiceCategoryPriceMutation',
      'setCanonicalServicePrice',
      'retireCanonicalServicePrice',
      'canonical_source_key',
      'catalogTouchForPriceMutation',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/contracts/manage-service-catalog.ts',
        requiredTokens: [
          'prepareSetCanonicalServicePrice',
          'prepareRetireCanonicalServicePrice',
          'prepareCanonicalBatch',
        ],
      },
      {
        path: 'test/canonical/service-catalog-route-integration.test.ts',
        requiredTokens: [
          'replaces and retires a category price while preserving immutable price history',
          "status: 'retired'",
        ],
      },
    ],
  },
  {
    boundary: 'service-catalog.manage.billing-master',
    path: 'src/routes/tenant/billingMaster.ts',
    table: 'billing_service_items',
    requiredTokens: [
      'applyBillingServiceCatalogMutation',
      'billingServiceCanonicalSourceKey',
      'authoritativeStatements',
      'canonical_source_key',
      'serviceMutationIdempotencyKey',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/contracts/manage-service-catalog.ts',
        requiredTokens: [
          'upsertCanonicalServiceCatalogItem',
          'setCanonicalServicePrice',
          'retireCanonicalServicePrice',
          'prepareCanonicalBatch',
          'canonical_service_catalog_items',
          'canonical_service_prices',
        ],
      },
      {
        path: 'src/lib/canonical/service-catalog-route-integration.ts',
        requiredTokens: [
          'applyBillingServiceCatalogMutation',
          'applyBillingServiceCategoryPriceMutation',
          'authoritativeStatements',
          'billingServiceCanonicalSourceKey',
          'billingPriceMapCanonicalSourceKey',
        ],
      },
      {
        path: 'migrations/0569_service_catalog_route_identity.sql',
        requiredTokens: [
          'billing_service_items',
          'billing_item_price_category_maps',
          'canonical_source_key',
        ],
      },
      {
        path: 'test/canonical/service-catalog-route-integration.test.ts',
        requiredTokens: [
          'commits legacy service, default category price, Canonical facts, mappings and outbox in one batch',
          'replaces and retires a category price while preserving immutable price history',
          'rolls back legacy compatibility, Canonical facts, mappings and outbox',
        ],
      },
    ],
  },
  {
    boundary: 'service-price.manage.billing-master',
    path: 'src/routes/tenant/billingMaster.ts',
    table: 'billing_item_price_category_maps',
    requiredTokens: [
      'applyBillingServiceCatalogMutation',
      'applyBillingServiceCategoryPriceMutation',
      'billingPriceMapCanonicalSourceKey',
      'authoritativeStatements',
      'canonical_source_key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/contracts/manage-service-catalog.ts',
        requiredTokens: ['setCanonicalServicePrice', 'retireCanonicalServicePrice', 'canonical_service_prices'],
      },
      {
        path: 'src/lib/canonical/service-catalog-route-integration.ts',
        requiredTokens: ['applyBillingServiceCategoryPriceMutation', 'priceDefinition', 'laterUtc'],
      },
      {
        path: 'test/canonical/service-catalog-route-integration.test.ts',
        requiredTokens: ['replaces and retires a category price while preserving immutable price history', 'amount_minor', "status: 'retired'"],
      },
    ],
  },
  {
    boundary: 'service-price.manage.price-categories',
    path: 'src/routes/tenant/priceCategories.ts',
    table: 'billing_item_price_category_maps',
    requiredTokens: [
      'applyBillingServiceCategoryPriceMutation',
      'billingPriceMapCanonicalSourceKey',
      'priceRouteIdempotencyKey',
      'authoritativeStatements',
      'canonical_source_key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/service-catalog-route-integration.ts',
        requiredTokens: ['applyBillingServiceCategoryPriceMutation', 'retireCanonicalServicePrice'],
      },
      {
        path: 'test/integration/routes/price-categories-service-pricing.test.ts',
        requiredTokens: [
          'creates a price map through the Canonical service-price boundary',
          'updates a price map through an immutable replacement price version',
          'retires the mapped price when the legacy map is removed',
        ],
      },
    ],
  },
  {
    boundary: 'service-catalog.manage.settings-import',
    path: 'src/routes/tenant/settings-import-export.ts',
    table: 'billing_service_items',
    requiredTokens: [
      'applyBillingServiceCatalogMutation',
      'billingServiceCanonicalSourceKey',
      'settings_service_import_csv',
      'authoritativeStatements',
      'canonical_source_key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/contracts/manage-service-catalog.ts',
        requiredTokens: ['upsertCanonicalServiceCatalogItem', 'canonical_service_catalog_items'],
      },
      {
        path: 'src/lib/canonical/service-catalog-route-integration.ts',
        requiredTokens: ['applyBillingServiceCatalogMutation', 'billingServiceCanonicalSourceKey'],
      },
      {
        path: 'migrations/0569_service_catalog_route_identity.sql',
        requiredTokens: ['uq_billing_service_items_canonical_source_key'],
      },
    ],
  },
  {
    boundary: 'service-price.manage.settings-import',
    path: 'src/routes/tenant/settings-import-export.ts',
    table: 'billing_item_price_category_maps',
    requiredTokens: [
      'applyBillingServiceCatalogMutation',
      'billingPriceMapCanonicalSourceKey',
      'defaultPriceCategoryId',
      'authoritativeStatements',
      'canonical_source_key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/service-catalog-route-integration.ts',
        requiredTokens: ['defaultPriceCategoryId', 'priceDefinition', 'price_category'],
      },
      {
        path: 'migrations/0569_service_catalog_route_identity.sql',
        requiredTokens: ['uq_billing_item_price_category_maps_canonical_source_key'],
      },
      {
        path: 'test/canonical/service-catalog-route-integration.test.ts',
        requiredTokens: ['commits legacy service, default category price, Canonical facts, mappings and outbox in one batch', 'canonical_service_prices'],
      },
    ],
  },
  {
    boundary: 'compensation-rule.manage.doctor',
    path: 'src/routes/tenant/commissions.ts',
    table: 'doctor_commission_rules',
    requiredTokens: [
      'buildDoctorCommissionRuleContext',
      'createRouteCompensationRule',
      'replaceRouteCompensationRule',
      'retireRouteCompensationRule',
      'prepareMasterDataAudit',
    ],
  },
  {
    boundary: 'compensation-rule.manage.diagnostic-performer',
    path: 'src/routes/tenant/billingMaster.ts',
    table: 'diagnostic_performer_payout_rules',
    requiredTokens: [
      'buildDiagnosticPerformerRuleContext',
      'createRouteCompensationRule',
      'replaceRouteCompensationRule',
      'retireRouteCompensationRule',
      'prepareMasterDataAudit',
    ],
  },
  {
    boundary: 'practitioner.manage.doctor-route',
    path: 'src/routes/tenant/doctors.ts',
    table: 'doctors',
    requiredTokens: [
      'buildPractitionerRouteContext',
      'createRoutePractitioner',
      'updateRoutePractitioner',
      'runPractitionerProjectionCompatibility',
      'prepareMasterDataAudit',
      'canonical_source_key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/practitioner-route-integration.ts',
        requiredTokens: [
          "from './commands/manage-practitioner'",
          'createPractitioner',
          'updateOrRetirePractitioner',
          'authoritativeStatements',
          'exactMappedPractitionerPublicId',
        ],
      },
      {
        path: 'src/lib/canonical/commands/manage-practitioner.ts',
        requiredTokens: [
          'canonical.practitioner.create',
          'canonical.practitioner.update',
          'canonical.practitioner.user-link',
          'runCanonicalBatch',
        ],
      },
      {
        path: 'migrations/0563_practitioner_route_identity.sql',
        requiredTokens: [
          'ADD COLUMN canonical_source_key TEXT',
          'uq_doctors_canonical_source_key',
        ],
      },
      {
        path: 'test/canonical/practitioner-route-integration.test.ts',
        requiredTokens: [
          'rolls back every legacy, audit, Canonical, mapping and outbox statement on failure',
          'CanonicalIdempotencyConflictError',
          'link_status',
        ],
      },
    ],
  },
  {
    boundary: 'patient-identity.import-route',
    path: 'src/routes/tenant/settings-import-export.ts',
    table: 'patients',
    requiredTokens: [
      'buildPatientImportRouteContext',
      'createImportedPatient',
      'prepareMasterDataAudit',
      'createSourceEvidenceSha256',
      'canonical_source_key',
      "c.req.header('Idempotency-Key')",
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/patient-import-route-integration.ts',
        requiredTokens: [
          "from './commands/register-or-link-patient'",
          'registerOrLinkPatient',
          'settings_patient_import',
          'authoritativeStatements',
          'COALESCE(MAX(id), 0) + 1',
        ],
      },
      {
        path: 'src/lib/canonical/commands/register-or-link-patient.ts',
        requiredTokens: [
          'canonical.patient-link.register-or-link',
          'CanonicalCommandExecutionOptions',
          'execution.authoritativeStatements',
          'canonical_tenant_patient_links',
          'canonical_source_mappings',
        ],
      },
      {
        path: 'migrations/0564_patient_import_route_identity.sql',
        requiredTokens: [
          'ADD COLUMN canonical_source_key TEXT',
          'uq_patients_canonical_source_key',
        ],
      },
      {
        path: 'test/canonical/patient-import-route-integration.test.ts',
        requiredTokens: [
          'does not silently merge a different import source that happens to share the same name and mobile',
          'CanonicalIdempotencyConflictError',
          'rolls back the patient, relationship, mapping and outbox if audit compatibility fails',
        ],
      },
      {
        path: 'test/integration/routes/settings-hub.test.ts',
        requiredTokens: [
          'commits patient compatibility, audit, Canonical relationship, mapping and outbox in one batch',
          'Idempotency-Key',
          'mockDB.batchCalls',
        ],
      },
    ],
  },
  {
    boundary: 'appointment-intent.doctor-dashboard',
    path: 'src/routes/tenant/doctors.ts',
    table: 'appointments',
    requiredTokens: [
      'buildAppointmentRouteContext',
      'transitionRouteAppointment',
      'rescheduleRouteAppointment',
      'fulfilRouteAppointment',
      'resolveAppointmentRouteEncounter',
      'prepareMasterDataAudit',
      'canonical_source_key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/appointment-route-integration.ts',
        requiredTokens: [
          "from './commands/manage-appointment'",
          'createAppointmentIntent',
          'transitionAppointmentStatus',
          'rescheduleAppointment',
          'fulfilAppointment',
          'authoritativeStatements',
        ],
      },
      {
        path: 'src/lib/canonical/commands/manage-appointment.ts',
        requiredTokens: [
          'canonical.appointment.create',
          'canonical.appointment.transition',
          'canonical.appointment.reschedule',
          'canonical.appointment.fulfil',
          'execution.authoritativeStatements',
        ],
      },
      {
        path: 'migrations/0565_appointment_route_identity.sql',
        requiredTokens: [
          'ADD COLUMN canonical_source_key TEXT',
          'uq_appointments_canonical_source_key',
        ],
      },
      {
        path: 'test/canonical/appointment-route-integration.test.ts',
        requiredTokens: [
          'bootstraps an unmapped appointment',
          'reassigns through immutable reschedule lineage',
          'rolls back legacy, audit, Canonical, mapping and outbox facts',
        ],
      },
    ],
  },
  {
    boundary: 'appointment-intent.queue-sync',
    path: 'src/routes/tenant/queue.ts',
    table: 'appointments',
    requiredTokens: [
      'buildAppointmentRouteContext',
      'fulfilRouteAppointment',
      'transitionRouteAppointment',
      'resolveAppointmentRouteEncounter',
      'prepareMasterDataAudit',
      'authoritativeStatements',
      'canonical_source_key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/appointment-route-integration.ts',
        requiredTokens: [
          'storedCommandName',
          'createAppointmentIntent',
          'fulfilAppointment',
          'transitionAppointmentStatus',
          'authoritativeStatements',
        ],
      },
      {
        path: 'migrations/0565_appointment_route_identity.sql',
        requiredTokens: [
          'ADD COLUMN canonical_source_key TEXT',
          'uq_appointments_canonical_source_key',
        ],
      },
      {
        path: 'test/integration/routes/queue-tokens.test.ts',
        requiredTokens: [
          'canonical_appointments',
          'audit_logs',
          'canonical_outbox_events',
          'mockDB.batchCalls',
        ],
      },
      {
        path: 'test/queue-production-contract.test.ts',
        requiredTokens: [
          'one audited Canonical command boundary',
          'queue_entry_completed',
          'queue_entry_no_show',
        ],
      },
    ],
  },
  {
    boundary: 'appointment-intent.doctor-schedule-extension',
    path: 'src/routes/tenant/doctorSchedules.ts',
    table: 'doctor_schedules',
    requiredTokens: [
      'buildAppointmentScheduleRouteContext',
      'createAppointmentScheduleSourceKey',
      'recordAppointmentScheduleExtension',
      'prepareMasterDataAudit',
      'canonical_source_key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/appointment-schedule-route-integration.ts',
        requiredTokens: [
          'canonical.appointment.schedule-extension.record',
          'appointment_schedule_extension',
          'resolveAppointmentRoutePractitioner',
          'authoritativeStatements',
          'runCanonicalBatch',
        ],
      },
      {
        path: 'migrations/0566_appointment_schedule_route_identity.sql',
        requiredTokens: [
          'ADD COLUMN canonical_source_key TEXT',
          'uq_doctor_schedules_canonical_source_key',
        ],
      },
      {
        path: 'test/canonical/appointment-schedule-route-integration.test.ts',
        requiredTokens: [
          'exact practitioner-linked mapping and outbox atomically',
          'updates then retires the same extension',
          'rolls back legacy schedule, audit, mapping and outbox',
        ],
      },
    ],
  },
  {
    boundary: 'appointment-intent.billing-projection',
    path: 'src/lib/canonical/appointment-billing-finalization.ts',
    table: 'appointments',
    requiredTokens: [
      'prepareAppointmentBillingStrictStatements',
      'prepareAppointmentBillingLegacyStatements',
      'strictAuthoritativeStatements',
      'prepareFinancialBatchAssertion',
      'expectedBillingStatus',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/appointments.ts',
        requiredTokens: [
          'executeStrictFinancialMutation',
          'appointment.billing.finalize',
          'prepareAppointmentBillingLegacyStatements',
        ],
      },
      {
        path: 'src/lib/canonical/strict-financial-boundaries.ts',
        requiredTokens: ['appointment.billing.finalize'],
      },
      {
        path: 'test/canonical/appointment-billing-finalization.test.ts',
        requiredTokens: [
          'rolls back all financial rows when appointment status changed concurrently',
          'expectedBillingStatus',
          'prepareAppointmentBillingStrictStatements',
        ],
      },
    ],
  },
  {
    boundary: 'encounter-care.doctor-signed-record',
    path: 'src/routes/tenant/doctors.ts',
    table: 'encounters',
    requiredTokens: [
      'prepareRouteEncounterCompletionBatch',
      'resolveEncounterRouteContext',
      'encounterCompletion.statements',
      'signedSnapshotSha256',
      'Appointment and visit encounter mappings do not agree',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/encounter-route-integration.ts',
        requiredTokens: [
          'prepareRouteEncounterCompletionBatch',
          'completeRouteEncounter',
          'replaceRouteEncounterParticipant',
          'startRouteEncounter',
          'legacy_visit',
        ],
      },
      {
        path: 'src/lib/canonical/commands/start-encounter.ts',
        requiredTokens: [
          'canonical.encounter.start',
          'canonical.encounter.complete',
          'canonical.encounter.participant.replace',
          'prepareCanonicalBatch',
          'authoritativeStatements',
        ],
      },
      {
        path: 'migrations/0567_encounter_visit_route_identity.sql',
        requiredTokens: [
          'ADD COLUMN canonical_source_key TEXT',
          'uq_visits_canonical_source_key',
        ],
      },
      {
        path: 'test/canonical/encounter-route-integration.test.ts',
        requiredTokens: [
          'creates the legacy visit, audit, encounter, participant, mapping and outbox atomically',
          'prepares composite completion and rolls back every compatibility and Canonical statement',
        ],
      },
    ],
  },
  {
    boundary: 'encounter-care.doctor-visit-completion',
    path: 'src/routes/tenant/doctors.ts',
    table: 'visits',
    requiredTokens: [
      'prepareRouteEncounterCompletionBatch',
      'resolveEncounterRouteContext',
      'encounterCompletion.statements',
      "UPDATE visits",
      "status = 'completed'",
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/encounter-route-integration.ts',
        requiredTokens: [
          'prepareRouteEncounterCompletionBatch',
          'resolveEncounterRouteContext',
          'createSourceEvidenceSha256',
        ],
      },
      {
        path: 'src/lib/canonical/commands/start-encounter.ts',
        requiredTokens: [
          'canonical.encounter.complete',
          "status='completed'",
          'encounter_version=?',
          'canonical_encounter_participants',
        ],
      },
      {
        path: 'test/canonical/start-encounter.test.ts',
        requiredTokens: [
          'completes and signs an encounter with exact replay despite transport-time drift',
          'prepares encounter completion for one outer atomic batch',
        ],
      },
    ],
  },
  {
    boundary: 'encounter-care.queue-visit-lifecycle',
    path: 'src/routes/tenant/queue.ts',
    table: 'visits',
    requiredTokens: [
      'cancelRouteEncounter',
      'completeRouteEncounter',
      'prepareRouteEncounterCompletionBatch',
      'resolveEncounterRouteContext',
      'queueVisitSnapshot',
      'Appointment and visit encounter mappings do not agree',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/encounter-route-integration.ts',
        requiredTokens: [
          'cancelRouteEncounter',
          'completeRouteEncounter',
          'prepareRouteEncounterCompletionBatch',
          'legacy_visit',
        ],
      },
      {
        path: 'src/lib/canonical/commands/start-encounter.ts',
        requiredTokens: [
          'canonical.encounter.cancel',
          'canonical.encounter.complete',
          'prepareCanonicalBatch',
        ],
      },
      {
        path: 'test/queue-production-contract.test.ts',
        requiredTokens: [
          'one audited Canonical command boundary',
          'queue_entry_completed',
        ],
      },
      {
        path: 'test/canonical/encounter-route-integration.test.ts',
        requiredTokens: [
          'prepares composite completion and rolls back every compatibility and Canonical statement',
        ],
      },
    ],
  },
  {
    boundary: 'compensation-accrual.refund-reservation-release',
    path: 'src/lib/billing-refund-commission.ts',
    table: 'doctor_commission_accruals',
    requiredTokens: [
      'buildRefundCommissionReservationStatements',
      'buildRestoreRefundCommissionReservationStatements',
      'prepareRefundBatchAssertion',
      'buildTransitionRefundCommissionReservationStatements',
      'billing_refund_commission_reservations',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/live-refund-compensation.ts',
        requiredTokens: [
          'executeLiveRefundCompensationReservation',
          'executeLiveRefundCompensationRelease',
          "commandName: 'canonical.compensation.refund.reserve'",
          "commandName: 'canonical.compensation.refund.release'",
          'authoritativeStatements',
        ],
      },
      {
        path: 'src/lib/billing-refund-dispute.ts',
        requiredTokens: [
          'executeStrictFinancialMutation',
          'executeLiveRefundCompensationRelease',
          "boundary: 'doctor-compensation.refund-release'",
        ],
      },
      {
        path: 'test/canonical/live-refund-compensation.test.ts',
        requiredTokens: [
          'reserves and releases unpaid commission while preserving effective earned and waiver facts',
          'canonical_compensation_adjustment_reversals',
        ],
      },
    ],
  },
  {
    boundary: 'compensation-accrual.performer-reserve-adapter',
    path: 'src/lib/canonical/compensation-accrual-route-integration.ts',
    table: 'diagnostic_performer_reserves',
    requiredTokens: [
      'cancelPerformerReservesWithCanonicalAdjustment',
      'prepareCompensationAdjustment',
      "boundary: 'doctor-compensation.adjust'",
      'prepareFinancialBatchAssertion',
      'prepareMasterDataAudit',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/commands/accrue-compensation.ts',
        requiredTokens: [
          'prepareCompensationAdjustment',
          'canonical.compensation.adjust',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/compensation-accrual-route-integration.test.ts',
        requiredTokens: [
          'commits guarded legacy cancellation, audit and Canonical adjustment atomically',
          'requires settlement reversal before cancelling paid compensation',
          'selects the first requested reserve units deterministically',
        ],
      },
    ],
  },
  {
    boundary: 'compensation-accrual.doctor-commission-adapter',
    path: 'src/lib/canonical/compensation-accrual-route-integration.ts',
    table: 'doctor_commission_accruals',
    requiredTokens: [
      'cancelDoctorCommissionAccrualsWithCanonicalAdjustment',
      'prepareCompensationAdjustment',
      'accounting_posting_events',
      'prepareFinancialBatchAssertion',
      'prepareMasterDataAudit',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/live-doctor-compensation.ts',
        requiredTokens: [
          'executeLiveDoctorCommissionAccrual',
          'legacy_doctor_commission_accrual',
          "commandName: 'canonical.compensation.accrue.live'",
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/compensation-accrual-route-integration.test.ts',
        requiredTokens: [
          'cancels mapped doctor commission with accounting, audit and Canonical adjustment atomically',
          'canonical_compensation_adjustments',
        ],
      },
    ],
  },
  {
    boundary: 'compensation-accrual.performer-reserve-facade',
    path: 'src/lib/diagnostic-performer-reserve.ts',
    table: 'diagnostic_performer_reserves',
    requiredTokens: [
      'executeLivePerformerReserveAccrual',
      'cancelPerformerReservesWithCanonicalAdjustment',
      'canonical_source_key',
      'cancelUnpaidPerformerReserveQuantities',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/live-performer-reserve.ts',
        requiredTokens: [
          'executeLivePerformerReserveAccrual',
          'legacy_diagnostic_performer_reserve',
          "commandName: 'canonical.compensation.performer-reserve.accrue'",
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/integration/routes/diagnostic-performer-reserves.test.ts',
        requiredTokens: [
          'creates an immutable flat reserve with separate gross, discount, and net authority',
          'creates one reserve statement per invoice quantity unit',
        ],
      },
      {
        path: 'test/canonical/compensation-accrual-route-integration.test.ts',
        requiredTokens: [
          'commits guarded legacy cancellation, audit and Canonical adjustment atomically',
        ],
      },
    ],
  },
  {
    boundary: 'compensation-accrual.commission-approval-settlement-route',
    path: 'src/routes/tenant/commissions.ts',
    table: 'doctor_commission_accruals',
    requiredTokens: [
      'executeLiveCompensationSettlement',
      'prepareFinancialBatchAssertion',
      'prepareMasterDataAudit',
      'approval_transition',
      "status = 'approved'",
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/live-compensation-settlement.ts',
        requiredTokens: [
          'executeLiveCompensationSettlement',
          "commandName: 'canonical.compensation.settle.live'",
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/doctor-commission-routes.test.ts',
        requiredTokens: [
          'lists doctor accruals, approves them, and then marks them as paid',
          'rejects doctor accrual approval when linked bill is not fully paid',
        ],
      },
      {
        path: 'test/canonical/live-compensation-settlement.test.ts',
        requiredTokens: [
          'assigns performer reserves, records deductions, and settles remaining payable atomically',
          'canonical_compensation_settlements',
        ],
      },
    ],
  },
  {
    boundary: 'compensation-settlement.refund-cash-hold-custody',
    path: 'src/lib/billing-refund-cash-hold.ts',
    table: 'cash_drawer_movements',
    requiredTokens: [
      'prepareCreditReturnedExecutedRefundCash',
      'prepareCreditRefundReserveRelease',
      'creditPendingRefundReserveReleasesForSession',
      'INSERT OR IGNORE INTO cash_drawer_movements',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/executed-refund.ts',
        requiredTokens: [
          'prepareCreditReturnedExecutedRefundCash',
          'prepareLiveCashCustodyMovement',
          "boundary: 'credit-note.cash-refund.reverse'",
          'authoritativeStatements',
        ],
      },
      {
        path: 'src/lib/canonical/live-cash-custody.ts',
        requiredTokens: [
          'prepareLiveCashCustodyMovement',
          'executeLiveCashCustodyMovement',
          "boundary: 'cash-custody.movement'",
        ],
      },
      {
        path: 'test/unit/executed-refund-reversal.test.ts',
        requiredTokens: [
          'credits acknowledged returned cash once and does not open a dispute',
        ],
      },
      {
        path: 'test/refund-reserve-release-atomicity.test.ts',
        requiredTokens: [
          'credits an active custody drawer and marks the hold credited',
          'does not credit a closed destination and leaves the released reserve pending',
        ],
      },
    ],
  },
  {
    boundary: 'compensation-settlement.refund-dispute-custody',
    path: 'src/lib/billing-refund-dispute.ts',
    table: 'cash_drawer_movements',
    requiredTokens: [
      'prepareCreateRefundDisputeCashOut',
      'prepareLiveCashCustodyMovement',
      'executeLiveCashCustodyMovement',
      "boundary: 'doctor-compensation.refund-release'",
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/live-cash-custody.ts',
        requiredTokens: [
          'recordCashCustodyMovement',
          "boundary: 'cash-custody.movement'",
        ],
      },
      {
        path: 'test/unit/billing-refund-dispute.test.ts',
        requiredTokens: [
          'opens an executed-refund dispute without creating a second cash-out',
          'cash recovery posts cash-in and settles the dispute exactly once',
        ],
      },
      {
        path: 'test/canonical/manage-cash-custody.test.ts',
        requiredTokens: [
          'commits strict legacy movement, mapping and outbox in one batch',
          'rolls back strict legacy and Canonical custody evidence together',
        ],
      },
    ],
  },
  {
    boundary: 'compensation-settlement.billing-counter-custody',
    path: 'src/routes/tenant/billingCounter.ts',
    table: 'cash_drawer_movements',
    requiredTokens: [
      'executeLiveCashCustodyMovement',
      'prepareMasterDataAudit',
      'legacy_counter_variance_handover',
      "movementType: 'handover'",
      "direction: 'out'",
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/contracts/manage-cash-custody.ts',
        requiredTokens: [
          'prepareRecordCashCustodyMovement',
          'recordCashCustodyMovement',
          'reverseCashCustodyMovement',
          'canonical.cash_custody.movement.record',
          'authoritativeStatements',
        ],
      },
      {
        path: 'src/lib/canonical/accounting-poster.ts',
        requiredTokens: [
          'canonical.cash_custody.movement_recorded',
          'CASH_CUSTODY_MOVEMENT_TYPE_INVALID',
        ],
      },
      {
        path: 'test/canonical/accounting-reconciliation.test.ts',
        requiredTokens: [
          'posts generic cash custody movement types and skips session-close evidence',
        ],
      },
      {
        path: 'test/integration/routes/billing-counter.test.ts',
        requiredTokens: [
          'closes the outgoing session and creates handover while variance review remains pending',
          'operationalCloseCompleted',
        ],
      },
    ],
  },
  {
    boundary: 'compensation-settlement.commission-items',
    path: 'src/routes/tenant/commissions.ts',
    table: 'doctor_commission_settlement_items',
    requiredTokens: [
      'executeLiveCompensationSettlement',
      'doctor_commission_settlement_items',
      'transitionGuard',
      'doctor_canonical_source_key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/live-compensation-settlement.ts',
        requiredTokens: [
          'canonical_compensation_settlement_allocations',
          "commandName: 'canonical.compensation.settle.live'",
          'mappedPractitionerPublicId',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/live-compensation-settlement.test.ts',
        requiredTokens: [
          'assigns performer reserves, records deductions, and settles remaining payable atomically',
          'reuses the exact route practitioner mapping instead of creating a numeric-ID duplicate',
        ],
      },
    ],
  },
  {
    boundary: 'compensation-settlement.commission-header',
    path: 'src/routes/tenant/commissions.ts',
    table: 'doctor_commission_settlements',
    requiredTokens: [
      'executeLiveCompensationSettlement',
      'doctor_commission_settlements',
      'settlementSourceId',
      'doctor_canonical_source_key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/live-compensation-settlement.ts',
        requiredTokens: [
          'canonical_compensation_settlements',
          'canonical_compensation_settlement_allocations',
          'canonical.compensation.settled',
          'practitionerSourcePublicId',
        ],
      },
      {
        path: 'test/doctor-commission-routes.test.ts',
        requiredTokens: [
          'lists doctor accruals, approves them, and then marks them as paid',
        ],
      },
      {
        path: 'test/commission-settlement-accounting.test.ts',
        requiredTokens: [
          'records settlement through the central accounting posting engine',
          'does not post a bulk settlement voucher when selected accruals were already claimed',
        ],
      },
    ],
  },
  {
    boundary: 'cash-custody.counter-session-workflow',
    path: 'src/lib/billing-counter-session.ts',
    table: 'billing_counter_sessions',
    requiredTokens: [
      'autoCloseStaleCounterSessions',
      'billing_refund_cash_holds',
      "COALESCE(variance_approval_status, '') != 'pending'",
      'loadActiveBillingCounterSession',
      'workstation_id',
    ],
    evidenceFiles: [
      {
        path: 'docs/database/protected-core-v1-authority-contracts.json',
        requiredTokens: [
          '"table": "billing_counter_sessions"',
          '"classification": "workflow_document"',
          'Retain workflow state, not fact authority.',
        ],
      },
      {
        path: 'test/unit/billing-counter-session.test.ts',
        requiredTokens: [
          'keeps a stale session active while a refund hold is pending',
          'does not auto-close old active sessions because cash must be reconciled explicitly',
          'preserves the active cash session when rebinding an old workstation heartbeat',
        ],
      },
    ],
  },
  {
    boundary: 'cash-custody.appointment-payment-compatibility',
    path: 'src/lib/canonical/appointment-billing-finalization.ts',
    table: 'emp_cash_transactions',
    requiredTokens: [
      'prepareAppointmentBillingStrictStatements',
      'strictAuthoritativeStatements',
      "'cash_transaction'",
      'paymentReceiptNo',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/appointments.ts',
        requiredTokens: [
          "boundary: 'appointment.billing.finalize'",
          'issueInvoiceWithFullPayment',
          'issueInvoiceWithFullPayment(c.env.DB, projection, execution)',
        ],
      },
      {
        path: 'src/lib/canonical/commands/issue-invoice-full-payment.ts',
        requiredTokens: [
          'canonical.cash_custody.collection_recorded',
          'cashTenderMinor',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/appointment-billing-finalization.test.ts',
        requiredTokens: [
          'commits appointment finance and accepted consultation service evidence in one strict batch',
          'rolls back all financial rows when appointment status changed concurrently',
        ],
      },
    ],
  },
  {
    boundary: 'cash-custody.gateway-noncash-compatibility',
    path: 'src/lib/canonical/gateway-payment-verification.ts',
    table: 'emp_cash_transactions',
    requiredTokens: [
      'NON_CASH_GATEWAYS',
      'prepareGatewayPaymentStrictStatements',
      'strictAuthoritativeStatements',
      "'cash_transaction'",
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/payments.ts',
        requiredTokens: [
          "const VALID_GATEWAYS = ['bkash', 'nagad']",
          "boundary: 'payment-gateway.verify'",
          'settleGatewayPayment',
        ],
      },
      {
        path: 'src/lib/canonical/commands/settle-gateway-payment.ts',
        requiredTokens: [
          'canonical.gateway_payment.settle',
          'authoritativeStatements',
          'canonical.gateway_payment.settled',
        ],
      },
      {
        path: 'test/canonical/gateway-payment-verification.test.ts',
        requiredTokens: [
          'commits guarded payment, advance, gateway log, and accounting events in strict mode',
          'rolls back every strict write when the gateway log is no longer verifying',
        ],
      },
    ],
  },
  {
    boundary: 'cash-custody.cash-ledger-command-bridge',
    path: 'src/lib/cash-ledger-writer.ts',
    table: 'cash_ledger_entries',
    requiredTokens: [
      'prepareLiveCashCustodyMovement',
      'legacy_cash_ledger_entry',
      'cash-ledger-custody:',
      'canonicalBridgeStatements',
      'cashLedgerStatement',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/live-cash-custody.ts',
        requiredTokens: [
          'prepareRecordCashCustodyMovement',
          'recordCashCustodyMovement',
          "boundary: 'cash-custody.movement'",
        ],
      },
      {
        path: 'src/lib/canonical/contracts/manage-cash-custody.ts',
        requiredTokens: [
          'canonical.cash_custody.movement.record',
          'canonical_source_mappings',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/accounting-reconciliation.test.ts',
        requiredTokens: [
          'bridges an explicit cash-ledger shadow write to PHI-free canonical accounting and custody outbox events',
          'rolls back the cash-ledger projection and accounting event when the custody claim conflicts',
          'legacy_cash_ledger_entry',
          'canonical.cash_custody.movement_recorded',
        ],
      },
    ],
  },
  {
    boundary: 'cash-custody.payment-void-compatibility',
    path: 'src/lib/payment-void-execution.ts',
    table: 'emp_cash_transactions',
    requiredTokens: [
      "boundary: 'payment.reverse'",
      'reversePayment',
      "'SalesReturn'",
      'legacyStatements',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/commands/reverse-payment.ts',
        requiredTokens: [
          'canonical.cash_custody.refund_recorded',
          'canonical.payment.reversed',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/unit/payment-void-execution.test.ts',
        requiredTokens: [
          'reverses the payment and attributes drawer accountability to the original receiver',
          'places caller-supplied operational statements in the same authoritative batch',
          'blocks reversal when linked doctor compensation is already paid',
        ],
      },
    ],
  },
  {
    boundary: 'payment-allocation.appointment-payment-compatibility',
    path: 'src/lib/canonical/appointment-billing-finalization.ts',
    table: 'payments',
    requiredTokens: [
      'prepareAppointmentBillingLegacyStatements',
      'paymentReceiptNo',
      'strictAuthoritativeStatements',
      'appointment_billing_service_acceptance',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/appointments.ts',
        requiredTokens: [
          "boundary: 'appointment.billing.finalize'",
          'issueInvoiceWithFullPayment',
          'legacyStatements',
        ],
      },
      {
        path: 'src/lib/canonical/commands/issue-invoice-full-payment.ts',
        requiredTokens: [
          "commandName: 'canonical.invoice.issue_full_payment'",
          'canonical_payment_receipts',
          'canonical_payment_tenders',
          'canonical_payment_allocations',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/appointment-billing-finalization.test.ts',
        requiredTokens: [
          'commits the complete bill, payment, appointment, and accounting transition',
          'rolls back all financial rows when appointment status changed concurrently',
          'rolls back when provisional financial values changed after the route snapshot',
        ],
      },
    ],
  },
  {
    boundary: 'payment-allocation.gateway-log-compatibility',
    path: 'src/lib/canonical/gateway-payment-verification.ts',
    table: 'payment_gateway_logs',
    requiredTokens: [
      'prepareGatewayPaymentLegacyStatements',
      'prepareGatewayPaymentStrictStatements',
      'strictAuthoritativeStatements',
      'NON_CASH_GATEWAYS',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/payments.ts',
        requiredTokens: [
          "boundary: 'payment-gateway.verify'",
          'settleGatewayPayment',
          "const VALID_GATEWAYS = ['bkash', 'nagad']",
        ],
      },
      {
        path: 'src/lib/canonical/commands/settle-gateway-payment.ts',
        requiredTokens: [
          "commandName: 'canonical.gateway_payment.settle'",
          'canonical_payment_receipts',
          'canonical_payment_tenders',
          'canonical_payment_allocations',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/gateway-payment-verification.test.ts',
        requiredTokens: [
          'commits guarded payment, advance, gateway log, and accounting events in strict mode',
          'rolls back every strict write when the bill snapshot is stale',
          'rolls back every strict write when the gateway log is no longer verifying',
        ],
      },
    ],
  },
  {
    boundary: 'payment-allocation.gateway-payment-compatibility',
    path: 'src/lib/canonical/gateway-payment-verification.ts',
    table: 'payments',
    requiredTokens: [
      'prepareGatewayPaymentLegacyStatements',
      'prepareGatewayPaymentStrictStatements',
      'strictAuthoritativeStatements',
      'NON_CASH_GATEWAYS',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/payments.ts',
        requiredTokens: [
          "boundary: 'payment-gateway.verify'",
          'settleGatewayPayment',
          "const VALID_GATEWAYS = ['bkash', 'nagad']",
        ],
      },
      {
        path: 'src/lib/canonical/commands/settle-gateway-payment.ts',
        requiredTokens: [
          "commandName: 'canonical.gateway_payment.settle'",
          'canonical_payment_receipts',
          'canonical_payment_tenders',
          'canonical_payment_allocations',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/gateway-payment-verification.test.ts',
        requiredTokens: [
          'commits guarded payment, advance, gateway log, and accounting events in strict mode',
          'rolls back every strict write when the bill snapshot is stale',
          'rolls back every strict write when the gateway log is no longer verifying',
        ],
      },
    ],
  },
  {
    boundary: 'payment-allocation.payment-void-compatibility',
    path: 'src/lib/payment-void-execution.ts',
    table: 'payments',
    requiredTokens: [
      'executePaymentVoidReversal',
      'reversePayment',
      'legacyStatements',
      'receiptNo',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/commands/reverse-payment.ts',
        requiredTokens: [
          "commandName: 'canonical.payment.reverse'",
          'canonical_payment_receipts',
          'canonical_payment_tenders',
          'canonical_payment_allocations',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/unit/payment-void-execution.test.ts',
        requiredTokens: [
          'reverses the payment and attributes drawer accountability to the original receiver',
          'places caller-supplied operational statements in the same authoritative batch',
          'blocks reversal when linked doctor compensation is already paid',
        ],
      },
    ],
  },
  {
    boundary: 'credit-reversal.refund-cash-hold-workflow',
    path: 'src/lib/billing-refund-cash-hold.ts',
    table: 'billing_refund_cash_holds',
    requiredTokens: [
      'prepareCreateRefundHold',
      'prepareSettleExecutedRefundHold',
      'prepareReleaseRefundHold',
      'billing_refund_cash_holds',
    ],
    evidenceFiles: [
      {
        path: 'docs/database/protected-core-v1-authority-contracts.json',
        requiredTokens: [
          '"table": "billing_refund_cash_holds"',
          '"classification": "workflow_document"',
          'Retain workflow state, not fact authority.',
        ],
      },
      {
        path: 'src/lib/executed-refund.ts',
        requiredTokens: [
          "boundary: 'credit-note.cash-refund.reverse'",
          'reverseCreditNoteCashRefund',
          'prepareSettleExecutedRefundHold',
        ],
      },
      {
        path: 'docs/superpowers/plans/2026-07-22-refund-review-dispute-reconciliation-implementation.md',
        requiredTokens: [
          'Historical release helpers remain for legacy/history and existing released rows.',
        ],
      },
      {
        path: 'test/billing-refund-cash-hold-atomic.test.ts',
        requiredTokens: [
          'rolls back both approval and hold when current available cash is insufficient',
          'rolls back when the counter session closes between precheck and insert',
        ],
      },
      {
        path: 'test/refund-reserve-release-atomicity.test.ts',
        requiredTokens: [
          'does not credit a closed destination and leaves the released reserve pending',
          'does not create a cash credit when the approval was already reviewed',
        ],
      },
    ],
  },
  {
    boundary: 'credit-reversal.refund-dispute-workflow',
    path: 'src/lib/billing-refund-dispute.ts',
    table: 'billing_refund_cash_holds',
    requiredTokens: [
      'prepareMarkRefundHoldDisputed',
      'recoverRefundDispute',
      'completeRefundDisputeWriteoff',
      'billing_refund_cash_holds',
    ],
    evidenceFiles: [
      {
        path: 'docs/database/protected-core-v1-authority-contracts.json',
        requiredTokens: [
          '"table": "billing_refund_cash_holds"',
          '"classification": "workflow_document"',
          'Retain workflow state, not fact authority.',
        ],
      },
      {
        path: 'src/lib/executed-refund.ts',
        requiredTokens: [
          "boundary: 'credit-note.cash-refund.reverse'",
          'reverseCreditNoteCashRefund',
          'cashResolution',
        ],
      },
      {
        path: 'src/lib/canonical/live-refund-compensation.ts',
        requiredTokens: [
          'executeLiveRefundCompensationRelease',
          'canonical.compensation.refund.release',
        ],
      },
      {
        path: 'test/unit/billing-refund-dispute.test.ts',
        requiredTokens: [
          'rejection marks the hold disputed and creates one requester liability',
          'cash recovery posts cash-in and settles the dispute exactly once',
          'write-off closes liability through one replay-safe Canonical outbox batch',
        ],
      },
    ],
  },
  {
    boundary: 'credit-reversal.gateway-income-projection',
    path: 'src/lib/canonical/gateway-payment-verification.ts',
    table: 'income',
    requiredTokens: [
      'NON_CASH_GATEWAYS',
      'prepareGatewayPaymentStrictStatements',
      'strictAuthoritativeStatements',
      'recordAccountingPostingEvent',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/payments.ts',
        requiredTokens: [
          "const VALID_GATEWAYS = ['bkash', 'nagad']",
          "boundary: 'payment-gateway.verify'",
          'settleGatewayPayment',
        ],
      },
      {
        path: 'src/lib/canonical/commands/settle-gateway-payment.ts',
        requiredTokens: [
          "commandName: 'canonical.gateway_payment.settle'",
          'authoritativeStatements',
          'canonical.gateway_payment.settled',
        ],
      },
      {
        path: 'test/canonical/gateway-payment-verification.test.ts',
        requiredTokens: [
          'commits guarded payment, advance, gateway log, and accounting events in strict mode',
          'rolls back every strict write when the bill snapshot is stale',
          'rolls back every strict write when the gateway log is no longer verifying',
        ],
      },
    ],
  },
  {
    boundary: 'credit-reversal.executed-refund-reversal',
    path: 'src/lib/executed-refund.ts',
    table: 'billing_credit_notes',
    requiredTokens: [
      "boundary: 'credit-note.cash-refund.reverse'",
      'reverseCreditNoteCashRefund',
      "SET status = 'reversed'",
      'cashResolution',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/commands/reverse-credit-note-cash-refund.ts',
        requiredTokens: [
          "commandName: 'canonical.credit_note.cash_refund.reverse'",
          'canonical_credit_note_cash_refund_reversals',
          'canonical.credit_note.cash_refund_reversed',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/unit/executed-refund-reversal.test.ts',
        requiredTokens: [
          'restores legacy finance and opens a dispute without a second cash movement',
          'credits acknowledged returned cash once and does not open a dispute',
          'fails closed before mutation when returned cash has no eligible active source session',
        ],
      },
    ],
  },
  {
    boundary: 'credit-reversal.payment-void-income-projection',
    path: 'src/lib/payment-void-execution.ts',
    table: 'income',
    requiredTokens: [
      "boundary: 'payment.reverse'",
      'reversePayment',
      "'SalesReturn'",
      'legacyStatements',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/commands/reverse-payment.ts',
        requiredTokens: [
          "commandName: 'canonical.payment.reverse'",
          'canonical.cash_custody.refund_recorded',
          'canonical.payment.reversed',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/unit/payment-void-execution.test.ts',
        requiredTokens: [
          'reverses the payment and attributes drawer accountability to the original receiver',
          'places caller-supplied operational statements in the same authoritative batch',
          'blocks reversal when linked doctor compensation is already paid',
        ],
      },
    ],
  },
  {
    boundary: 'payment-receipt.gateway-payment-compatibility',
    path: 'src/lib/canonical/gateway-payment-verification.ts',
    table: 'payments',
    requiredTokens: [
      'NON_CASH_GATEWAYS',
      'prepareGatewayPaymentStrictStatements',
      'strictAuthoritativeStatements',
      'external_transaction_id',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/payments.ts',
        requiredTokens: [
          "const VALID_GATEWAYS = ['bkash', 'nagad']",
          "boundary: 'payment-gateway.verify'",
          'settleGatewayPayment',
        ],
      },
      {
        path: 'src/lib/canonical/commands/settle-gateway-payment.ts',
        requiredTokens: [
          "commandName: 'canonical.gateway_payment.settle'",
          'canonical_payment_receipts',
          'canonical_payment_tenders',
          'canonical_payment_allocations',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/canonical/settle-gateway-payment.test.ts',
        requiredTokens: [
          'settles a verified gateway receipt and allocates it to the invoice',
          'replays exactly and rejects a changed request',
          'rolls back caller-supplied authoritative statements when canonical settlement fails',
        ],
      },
      {
        path: 'test/canonical/gateway-payment-verification.test.ts',
        requiredTokens: [
          'commits guarded payment, advance, gateway log, and accounting events in strict mode',
          'rolls back every strict write when the bill snapshot is stale',
        ],
      },
    ],
  },
  {
    boundary: 'payment-receipt.payment-void-compatibility',
    path: 'src/lib/payment-void-execution.ts',
    table: 'payments',
    requiredTokens: [
      "boundary: 'payment.reverse'",
      'reversePayment',
      'reversalExternalId',
      'legacyStatements',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/commands/reverse-payment.ts',
        requiredTokens: [
          "commandName: 'canonical.payment.reverse'",
          'canonical_payment_reversals',
          'canonical_payment_allocations',
          'canonical_payment_tenders',
          'authoritativeStatements',
        ],
      },
      {
        path: 'test/unit/payment-void-execution.test.ts',
        requiredTokens: [
          'reverses the payment and attributes drawer accountability to the original receiver',
          'places caller-supplied operational statements in the same authoritative batch',
          'blocks reversal when linked doctor compensation is already paid',
        ],
      },
    ],
  },
  {
    boundary: 'service-delivery.billing-create',
    path: 'src/lib/billing-create-batch.ts',
    table: 'visit_services',
    requiredTokens: [
      'prepareBillCreationStrictStatements',
      'prepareAcceptedServiceRouteBatch',
      'strictAuthoritativeStatements',
      'canonical_source_key',
      'unitAmountMinor',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/billing.ts',
        requiredTokens: [
          'commandIdempotencyKey',
          'bill-service:',
          'executeStrictFinancialMutation',
        ],
      },
      {
        path: 'src/lib/canonical/service-delivery-route-integration.ts',
        requiredTokens: [
          'prepareAcceptedServiceRouteBatch',
          'prepareProtectedConsultationService',
          'canonical.service_event.cancel',
        ],
      },
      {
        path: 'src/lib/canonical/commands/service-operations.ts',
        requiredTokens: [
          'canonical.service_request.create',
          'canonical.service_event.record',
          "eventType: 'accepted'",
          'prepareCanonicalBatch',
        ],
      },
      {
        path: 'migrations/0568_service_delivery_route_identity.sql',
        requiredTokens: [
          'ALTER TABLE visit_services',
          'uq_visit_services_canonical_source_key',
        ],
      },
      {
        path: 'test/unit/billing-create-batch.test.ts',
        requiredTokens: [
          'attaches an async strict service-acceptance factory',
          'canonical_source_key',
        ],
      },
      {
        path: 'test/canonical/service-delivery-route-integration.test.ts',
        requiredTokens: [
          'prepares one atomic compatibility, request, accepted-event, mapping and outbox batch',
          'rolls back all statements',
        ],
      },
    ],
  },
  {
    boundary: 'service-delivery.appointment-finalization',
    path: 'src/lib/canonical/appointment-billing-finalization.ts',
    table: 'billing_provisional_items',
    requiredTokens: [
      'prepareAppointmentBillingServiceStrictStatements',
      'prepareAcceptedServiceRouteBatch',
      'strictAuthoritativeStatements',
      'canonical_source_key',
      'unitAmountMinor',
    ],
    evidenceFiles: [
      {
        path: 'src/routes/tenant/appointments.ts',
        requiredTokens: [
          'occurredAtUtc: issuedAtUtc',
          'appointment-service:',
          'doctorId: item.doctor_id',
        ],
      },
      {
        path: 'src/lib/canonical/service-delivery-route-integration.ts',
        requiredTokens: [
          'prepareAcceptedServiceRouteBatch',
          'prepareProtectedConsultationService',
        ],
      },
      {
        path: 'src/lib/canonical/commands/service-operations.ts',
        requiredTokens: [
          'planned service acceptance requires one exact active tenant patient link',
          'canonical.service_request.create',
          'canonical.service_event.record',
        ],
      },
      {
        path: 'migrations/0568_service_delivery_route_identity.sql',
        requiredTokens: [
          'ALTER TABLE billing_provisional_items',
          'uq_billing_provisional_items_canonical_source_key',
        ],
      },
      {
        path: 'test/canonical/appointment-billing-finalization.test.ts',
        requiredTokens: [
          'commits appointment finance and accepted consultation service evidence in one strict batch',
          "event_type: 'accepted'",
          'fulfilled_quantity: 0',
        ],
      },
    ],
  },
  {
    boundary: 'service-delivery.provisional-cancellation',
    path: 'src/routes/tenant/billingCancellation.ts',
    table: 'billing_provisional_items',
    requiredTokens: [
      'prepareAcceptedAndCancelledServiceRouteBatch',
      'prepareServiceRouteCancellationBatch',
      'prepareFinancialBatchAssertion',
      'prepareMasterDataAudit',
      'canonical_source_key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/service-delivery-route-integration.ts',
        requiredTokens: [
          'prepareAcceptedAndCancelledServiceRouteBatch',
          'prepareServiceRouteCancellationBatch',
          'service bootstrap cancellation receipt exists without accepted service receipt',
        ],
      },
      {
        path: 'src/lib/canonical/commands/service-operations.ts',
        requiredTokens: [
          'prepareCancelServiceEventOperationBatch',
          'canonical.service_event.cancel',
          'authoritativeStatements',
        ],
      },
      {
        path: 'migrations/0568_service_delivery_route_identity.sql',
        requiredTokens: [
          'ALTER TABLE billing_provisional_items',
          'uq_billing_provisional_items_canonical_source_key',
        ],
      },
      {
        path: 'test/canonical/service-delivery-route-integration.test.ts',
        requiredTokens: [
          'bootstraps an unmapped accepted event then cancels it with compatibility in one batch',
          'cancels the current accepted event with compatibility and audit in the same batch',
        ],
      },
      {
        path: 'test/integration/routes/definitive-round.test.ts',
        requiredTokens: [
          'PUT /provisional/1 — cancel',
          'PUT /provisional/999 — not found',
        ],
      },
    ],
  },
  {
    boundary: 'service-delivery.visit-consultation',
    path: 'src/routes/tenant/visits.ts',
    table: 'visit_services',
    requiredTokens: [
      'prepareAcceptedServiceRouteBatch',
      'prepareProtectedConsultationService',
      'prepareStartRouteEncounterBatch',
      'canonical_source_key',
      'amountMinor',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/service-delivery-route-integration.ts',
        requiredTokens: [
          'prepareAcceptedServiceRouteBatch',
          'preparedEncounter',
          'preparedService',
        ],
      },
      {
        path: 'src/lib/canonical/encounter-route-integration.ts',
        requiredTokens: [
          'prepareStartRouteEncounterBatch',
          'prepareStartEncounterBatch',
        ],
      },
      {
        path: 'migrations/0568_service_delivery_route_identity.sql',
        requiredTokens: [
          'ALTER TABLE visit_services',
          'uq_visit_services_canonical_source_key',
        ],
      },
      {
        path: 'test/canonical/service-delivery-route-integration.test.ts',
        requiredTokens: [
          'accepts exact encounter evidence prepared in the same outer batch',
          'accepts exact protected service evidence prepared in the same outer batch',
        ],
      },
      {
        path: 'test/canonical/encounter-route-integration.test.ts',
        requiredTokens: [
          'prepares route encounter start for composition without executing it',
        ],
      },
    ],
  },
  {
    boundary: 'encounter-care.visit-route',
    path: 'src/routes/tenant/visits.ts',
    table: 'visits',
    requiredTokens: [
      'startRouteEncounter',
      'replaceRouteEncounterParticipant',
      'completeRouteEncounter',
      'resolveEncounterRouteContext',
      'prepareMasterDataAudit',
      'canonical_source_key',
      'Idempotency-Key',
    ],
    evidenceFiles: [
      {
        path: 'src/lib/canonical/encounter-route-integration.ts',
        requiredTokens: [
          'startEncounter',
          'completeEncounter',
          'replaceEncounterParticipant',
          'exactPatientLink',
          'resolveAppointmentRoutePractitioner',
          'authoritativeStatements',
        ],
      },
      {
        path: 'src/lib/canonical/commands/start-encounter.ts',
        requiredTokens: [
          'canonical.encounter.start',
          'canonical.encounter.complete',
          'canonical.encounter.participant.replace',
          'readCanonicalCommandReplay',
          'runCanonicalBatch',
        ],
      },
      {
        path: 'migrations/0567_encounter_visit_route_identity.sql',
        requiredTokens: [
          'ADD COLUMN canonical_source_key TEXT',
          'uq_visits_canonical_source_key',
        ],
      },
      {
        path: 'test/canonical/encounter-route-integration.test.ts',
        requiredTokens: [
          'creates the legacy visit, audit, encounter, participant, mapping and outbox atomically',
          'replaces the treating participant then completes the encounter with replay/conflict guards',
          'rolls back every compatibility and Canonical statement',
        ],
      },
      {
        path: 'test/integration/routes/visit-checkin.test.ts',
        requiredTokens: [
          'rejects direct visit creation when the role cannot write appointments',
          'INSERT\\s+INTO\\s+"?visits"?',
        ],
      },
    ],
  },
];

function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function accessKey(path: string, table: string): string {
  return `${path}\u0000${table}`;
}

function writerId(writer: AuthorityWriterAccess, protectedConceptIds: string[]): string {
  const value = [writer.path, writer.table, writer.operations.join(','), protectedConceptIds.join(',')].join('|');
  return `pcwcc_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function commandContractsForConcepts(
  freeze: ProtectedCoreAuthorityContractFreeze,
  conceptIds: string[],
): ProtectedCoreConceptContract[] {
  const byId = new Map(freeze.concepts.map((contract) => [contract.conceptId, contract]));
  return conceptIds.map((id) => byId.get(id)).filter((contract): contract is ProtectedCoreConceptContract => Boolean(contract));
}

function strictBoundariesForPath(root: string, path: string, table: string): string[] {
  const financialBoundaries = Object.values(FINANCIAL_ROUTE_COVERAGE)
    .filter((coverage) => coverage.status === 'integrated' && coverage.routeFile === path)
    .map((coverage) => coverage.boundary);
  const commandBoundaries = ATOMIC_COMMAND_ROUTE_INTEGRATIONS
    .filter((integration) => integration.path === path && integration.table === table)
    .filter((integration) => {
      const absolute = join(root, integration.path);
      if (!existsSync(absolute)) return false;
      const source = readFileSync(absolute, 'utf8');
      if (!integration.requiredTokens.every((token) => source.includes(token))) return false;
      return (integration.evidenceFiles ?? []).every((evidence) => {
        const evidencePath = join(root, evidence.path);
        if (!existsSync(evidencePath)) return false;
        const evidenceSource = readFileSync(evidencePath, 'utf8');
        return evidence.requiredTokens.every((token) => evidenceSource.includes(token));
      });
    })
    .map((integration) => integration.boundary);
  return uniqueSorted([...financialBoundaries, ...commandBoundaries]);
}

function isExternalOwnerWrite(writer: AuthorityWriterAccess, contracts: ProtectedCoreConceptContract[]): boolean {
  const externalTables = new Set(contracts
    .filter((contract) => contract.authority.ownerKind === 'governed_external_table')
    .flatMap((contract) => contract.authority.ownerTables));
  return externalTables.has(writer.table);
}

function classifyWriter(
  writer: AuthorityWriterAccess,
  contracts: ProtectedCoreConceptContract[],
  strictBoundaryIds: string[],
): ProtectedWriterClassification {
  if (writer.lifecycleStatus === 'protected_fixture') return 'fixture_isolated';
  if (writer.lifecycleStatus === 'blocked_in_canonical_mode' || writer.lifecycleStatus === 'retirement_candidate') return 'strict_blocked';
  if (isExternalOwnerWrite(writer, contracts)) return 'external_governed';
  if (writer.lifecycleStatus === 'canonical_authority') return 'canonical_command';
  if (strictBoundaryIds.length > 0) return 'atomic_compatibility';
  if (writer.lifecycleStatus === 'canonical_compatibility') return 'command_required';
  if (writer.lifecycleStatus === 'legacy_authority') return 'command_required';
  if (writer.lifecycleStatus === 'migration_backfill') return 'strict_blocked';
  return 'command_required';
}

function compatibilityRule(classification: ProtectedWriterClassification): string {
  if (classification === 'canonical_command') return 'Canonical authority is retained only behind the frozen command boundary; direct ad-hoc writes are prohibited';
  if (classification === 'atomic_compatibility') return 'legacy-compatible response and projection writes are allowed only when atomic with the Canonical command and guarded by the registered strict boundary';
  if (classification === 'external_governed') return 'retain the governed external authority and write Canonical relationship/audit evidence without creating a duplicate person authority';
  if (classification === 'strict_blocked') return 'strict Canonical mode must block this writer until an approved command replacement and rollback proof exist';
  if (classification === 'fixture_isolated') return 'keep this protected fixture isolated from production runtime and remove it only after repository-reference review';
  return 'current write remains classified but is not command-complete; implement and integrate the frozen command before strict promotion';
}

function nextAction(classification: ProtectedWriterClassification, commandNames: string[]): string {
  if (classification === 'canonical_command') return `retain and test the frozen command boundary: ${commandNames.join(', ')}`;
  if (classification === 'atomic_compatibility') return `preserve current HTTP behaviour and verify atomic compatibility plus Canonical command replay: ${commandNames.join(', ')}`;
  if (classification === 'external_governed') return `retain external authority and require exact relationship/audit commands: ${commandNames.join(', ')}`;
  if (classification === 'strict_blocked') return `keep blocked until one of the frozen commands is integrated: ${commandNames.join(', ')}`;
  if (classification === 'fixture_isolated') return 'keep outside production runtime and prove no protected route imports the fixture';
  return `implement or route this writer through: ${commandNames.join(', ')}`;
}

function buildWriterEntry(
  root: string,
  writer: AuthorityWriterAccess,
  protectedConceptIds: string[],
  freeze: ProtectedCoreAuthorityContractFreeze,
): ProtectedWriterCommandCoverageEntry {
  const contracts = commandContractsForConcepts(freeze, protectedConceptIds);
  const requiredCommandNames = uniqueSorted(contracts.flatMap((contract) => contract.commandBoundary.commandNames));
  const requiredCommandModules = uniqueSorted(contracts.flatMap((contract) => contract.commandBoundary.modules));
  const implementedCommandModules = uniqueSorted(contracts
    .filter((contract) => contract.commandBoundary.implementationStatus === 'existing' || contract.commandBoundary.implementationStatus === 'external_governed')
    .flatMap((contract) => contract.commandBoundary.modules));
  const contractOnlyCommandModules = uniqueSorted(contracts
    .filter((contract) => contract.commandBoundary.implementationStatus === 'contract_only')
    .flatMap((contract) => contract.commandBoundary.modules));
  const strictBoundaryIds = strictBoundariesForPath(root, writer.path, writer.table);
  const classification = classifyWriter(writer, contracts, strictBoundaryIds);
  return {
    writerId: writerId(writer, protectedConceptIds),
    path: writer.path,
    table: writer.table,
    operations: uniqueSorted(writer.operations),
    lifecycleStatus: writer.lifecycleStatus,
    protectedConceptIds,
    classification,
    requiredCommandNames,
    requiredCommandModules,
    implementedCommandModules,
    contractOnlyCommandModules,
    strictBoundaryIds,
    currentTargetCommand: writer.targetCommand,
    transactionRule: TRANSACTION_RULE,
    idempotencyRule: IDEMPOTENCY_RULE,
    auditOutboxRule: AUDIT_OUTBOX_RULE,
    compatibilityRule: compatibilityRule(classification),
    rollbackRule: ROLLBACK_RULE,
    nextAction: nextAction(classification, requiredCommandNames),
  };
}

function classificationCounts(writers: ProtectedWriterCommandCoverageEntry[]): Record<ProtectedWriterClassification, number> {
  const counts: Record<ProtectedWriterClassification, number> = {
    canonical_command: 0,
    atomic_compatibility: 0,
    external_governed: 0,
    strict_blocked: 0,
    command_required: 0,
    fixture_isolated: 0,
  };
  for (const writer of writers) counts[writer.classification] += 1;
  return counts;
}

function implementationGroups(writers: ProtectedWriterCommandCoverageEntry[]): ProtectedWriterImplementationGroup[] {
  const required = writers.filter((writer) => writer.classification === 'command_required' || writer.classification === 'strict_blocked');
  const conceptIds = uniqueSorted(required.flatMap((writer) => writer.protectedConceptIds));
  return conceptIds.map((conceptId) => {
    const entries = required.filter((writer) => writer.protectedConceptIds.includes(conceptId));
    return {
      protectedConceptId: conceptId,
      writerIds: uniqueSorted(entries.map((writer) => writer.writerId)),
      paths: uniqueSorted(entries.map((writer) => writer.path)),
      tables: uniqueSorted(entries.map((writer) => writer.table)),
      requiredCommandNames: uniqueSorted(entries.flatMap((writer) => writer.requiredCommandNames)),
      requiredCommandModules: uniqueSorted(entries.flatMap((writer) => writer.requiredCommandModules)),
    };
  });
}

export function buildProtectedCoreWriterCommandCoverage(rootInput: string): ProtectedCoreWriterCommandCoverage {
  const root = resolve(rootInput);
  const inventory = buildProtectedCoreSurfaceInventory(root);
  const freeze = buildProtectedCoreAuthorityContractFreeze(root);
  const accessRegistry = readJson<CanonicalAuthorityAccessRegistry>(root, ACCESS_REGISTRY_PATH);
  const protectedConceptSet = new Set(freeze.concepts.map((contract) => contract.conceptId));
  const accessByKey = new Map(accessRegistry.writers.map((writer) => [accessKey(writer.path, writer.table), writer]));

  const unclassifiedWriters: string[] = [];
  const writers = inventory.surfaces
    .filter((surface) => surface.kind === 'writer' && surface.table)
    .map((surface) => {
      const access = accessByKey.get(accessKey(surface.path, surface.table!));
      if (!access) {
        unclassifiedWriters.push(`${surface.path}:${surface.table}:missing-access-registry-entry`);
        return null;
      }
      const protectedConceptIds = uniqueSorted(access.conceptIds.filter((id) => protectedConceptSet.has(id)));
      if (protectedConceptIds.length === 0) {
        unclassifiedWriters.push(`${surface.path}:${surface.table}:no-protected-concept`);
        return null;
      }
      const entry = buildWriterEntry(root, access, protectedConceptIds, freeze);
      if (entry.requiredCommandNames.length === 0) {
        unclassifiedWriters.push(`${surface.path}:${surface.table}:no-frozen-command`);
      }
      return entry;
    })
    .filter((entry): entry is ProtectedWriterCommandCoverageEntry => Boolean(entry))
    .sort((a, b) => a.path.localeCompare(b.path) || a.table.localeCompare(b.table) || a.writerId.localeCompare(b.writerId));

  const counts = classificationCounts(writers);
  const groupedImplementations = implementationGroups(writers);
  const commandCoverageComplete = counts.command_required === 0
    && counts.strict_blocked === 0
    && unclassifiedWriters.length === 0
    && groupedImplementations.length === 0;
  return {
    version: 1,
    task: PROTECTED_CORE_WRITER_COVERAGE_TASK,
    reviewedAt: '2026-07-28',
    branch: 'program/cdb-main-continuous-20260725',
    sourceInventory: PROTECTED_CORE_INVENTORY_PATH,
    sourceAuthorityContract: PROTECTED_CORE_AUTHORITY_CONTRACT_PATH,
    sourceDocuments: [
      POLICY_PATH,
      RUNBOOK_PATH,
      PROTECTED_CORE_INVENTORY_PATH,
      PROTECTED_CORE_AUTHORITY_CONTRACT_PATH,
      ACCESS_REGISTRY_PATH,
      'src/lib/canonical/financial-route-coverage.ts',
      'src/lib/canonical/strict-financial-boundaries.ts',
      'src/lib/canonical/compensation-rule-route-integration.ts',
      'src/lib/canonical/practitioner-route-integration.ts',
      'migrations/0563_practitioner_route_identity.sql',
      'test/canonical/practitioner-route-integration.test.ts',
      'src/lib/canonical/patient-import-route-integration.ts',
      'migrations/0564_patient_import_route_identity.sql',
      'test/canonical/patient-import-route-integration.test.ts',
      'test/integration/routes/settings-hub.test.ts',
    ],
    productionAuthorization: {
      repositoryCoverageBaseline: true,
      productionReadAccess: false,
      productionMutation: false,
      providerActivation: false,
      deploymentOrTrafficChange: false,
      liveLegacyRetirement: false,
    },
    summary: {
      writerCount: writers.length,
      classificationCounts: counts,
      canonicalCommandWriterCount: counts.canonical_command,
      atomicCompatibilityWriterCount: counts.atomic_compatibility,
      externalGovernedWriterCount: counts.external_governed,
      strictBlockedWriterCount: counts.strict_blocked,
      commandRequiredWriterCount: counts.command_required,
      fixtureIsolatedWriterCount: counts.fixture_isolated,
      unclassifiedWriterCount: unclassifiedWriters.length,
    },
    programState: {
      commandCoverageComplete,
      nextCheckpoint: commandCoverageComplete
        ? 'CDB-V1-040-CANONICAL-READ-PROVIDERS-AND-SHADOW-COMPARISON'
        : 'CDB-V1-030-PROTECTED-COMMAND-IMPLEMENTATION-AND-ROUTE-INTEGRATION',
      exitCondition: 'all command_required and strict_blocked protected writers become canonical_command, atomic_compatibility or external_governed with replay, concurrency, tenant-isolation, rollback and exact money evidence',
    },
    writers,
    implementationGroups: groupedImplementations,
    unclassifiedWriters: uniqueSorted(unclassifiedWriters),
    invariants: [
      'a protected writer must resolve to at least one frozen Core V1 concept and command name',
      'Canonical authority writes occur only through the frozen command boundary',
      'legacy compatibility writes are accepted only when atomic with the Canonical fact under a registered strict boundary',
      'governed users and global patient identity remain external authorities and do not become duplicate Canonical person tables',
      'protected fixtures remain isolated from production runtime',
      'all command-required writers remain fail-closed for strict promotion until implementation and route integration pass',
      'all money is integer minor units with zero unexplained variance',
      'production access, mutation, activation, deployment, traffic change and retirement remain unauthorized',
    ],
  };
}

export function validateProtectedCoreWriterCommandCoverage(
  coverage: ProtectedCoreWriterCommandCoverage,
  rootInput: string,
): string[] {
  const root = resolve(rootInput);
  const issues: string[] = [];
  if (coverage.task !== PROTECTED_CORE_WRITER_COVERAGE_TASK) issues.push('task identifier mismatch');
  const expectedWriterCount = buildProtectedCoreSurfaceInventory(root).summary.protectedWriterCount;
  if (coverage.writers.length !== expectedWriterCount) {
    issues.push(`protected writer count mismatch: expected ${expectedWriterCount}, found ${coverage.writers.length}`);
  }
  if (coverage.unclassifiedWriters.length > 0 || coverage.summary.unclassifiedWriterCount > 0) issues.push('unclassified protected writers remain');
  if (coverage.productionAuthorization.productionReadAccess) issues.push('production read access must remain false');
  if (coverage.productionAuthorization.productionMutation) issues.push('production mutation must remain false');
  if (coverage.productionAuthorization.providerActivation) issues.push('provider activation must remain false');
  if (coverage.productionAuthorization.deploymentOrTrafficChange) issues.push('deployment or traffic change must remain false');
  if (coverage.productionAuthorization.liveLegacyRetirement) issues.push('live legacy retirement must remain false');
  const expectedCoverageComplete = coverage.summary.commandRequiredWriterCount === 0
    && coverage.summary.strictBlockedWriterCount === 0
    && coverage.summary.unclassifiedWriterCount === 0
    && coverage.implementationGroups.length === 0;
  if (coverage.programState.commandCoverageComplete !== expectedCoverageComplete) {
    issues.push('command coverage completion state mismatch');
  }
  if (coverage.programState.commandCoverageComplete
    && coverage.programState.nextCheckpoint !== 'CDB-V1-040-CANONICAL-READ-PROVIDERS-AND-SHADOW-COMPARISON') {
    issues.push('completed command coverage must route to CDB-V1-040');
  }

  for (const source of coverage.sourceDocuments) if (!existsSync(join(root, source))) issues.push(`missing source document: ${source}`);

  const ids = new Set<string>();
  for (const writer of coverage.writers) {
    if (ids.has(writer.writerId)) issues.push(`duplicate writer ID: ${writer.writerId}`);
    ids.add(writer.writerId);
    if (!existsSync(join(root, writer.path))) issues.push(`writer path missing: ${writer.path}`);
    if (writer.protectedConceptIds.length === 0) issues.push(`writer has no protected concept: ${writer.writerId}`);
    if (writer.requiredCommandNames.length === 0) issues.push(`writer has no frozen command: ${writer.writerId}`);
    if (!writer.transactionRule.includes('one D1 batch')) issues.push(`writer transaction rule is incomplete: ${writer.writerId}`);
    if (writer.classification === 'atomic_compatibility' && writer.strictBoundaryIds.length === 0) issues.push(`atomic compatibility writer has no strict boundary: ${writer.writerId}`);
    if (writer.classification === 'fixture_isolated' && writer.lifecycleStatus !== 'protected_fixture') issues.push(`fixture classification mismatch: ${writer.writerId}`);
    if (writer.classification === 'canonical_command' && writer.lifecycleStatus !== 'canonical_authority') issues.push(`canonical classification mismatch: ${writer.writerId}`);
  }

  const counts = classificationCounts(coverage.writers);
  for (const [classification, count] of Object.entries(counts) as [ProtectedWriterClassification, number][]) {
    if (coverage.summary.classificationCounts[classification] !== count) issues.push(`classification count mismatch: ${classification}`);
  }
  if (coverage.summary.writerCount !== coverage.writers.length) issues.push('writer total mismatch');
  if (coverage.summary.commandRequiredWriterCount !== counts.command_required) issues.push('command-required count mismatch');
  if (coverage.summary.fixtureIsolatedWriterCount !== counts.fixture_isolated) issues.push('fixture count mismatch');
  return uniqueSorted(issues);
}

export function generateProtectedCoreWriterCommandCoverage(rootInput: string): ProtectedCoreWriterCommandCoverage {
  const root = resolve(rootInput);
  const coverage = buildProtectedCoreWriterCommandCoverage(root);
  const issues = validateProtectedCoreWriterCommandCoverage(coverage, root);
  if (issues.length > 0) throw new Error(`Protected writer command coverage failed:\n- ${issues.join('\n- ')}`);
  writeFileSync(join(root, PROTECTED_CORE_WRITER_COVERAGE_PATH), `${JSON.stringify(coverage, null, 2)}\n`, 'utf8');
  return coverage;
}
