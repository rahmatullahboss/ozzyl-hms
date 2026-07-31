import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  AuthorityReaderAccess,
  AuthorityWriterAccess,
  CanonicalAuthorityAccessRegistry,
} from './canonical-authority-access';

export const PROTECTED_CORE_INVENTORY_PATH = 'docs/database/protected-core-v1-surface-inventory.json';
export const PROTECTED_CORE_TASK = 'CDB-V1-010-PROTECTED-PRODUCTION-CORE-SURFACE-INVENTORY';

const POLICY_PATH = 'docs/architecture/hms-production-scope-policy.md';
const BOARD_PATH = 'docs/architecture/hms-canonical-parallel-execution-board.yaml';
const RUNBOOK_PATH = 'docs/database/canonical-core-v1-production-cutover-runbook.md';
const MATRIX_PATH = 'docs/database/canonical-authority-matrix.yaml';
const ACCESS_REGISTRY_PATH = 'docs/database/canonical-authority-access-registry.yaml';
const API_ROUTER_PATH = 'src/index.ts';
const UI_ROUTER_PATH = 'apps/ozzyl-lifestyle/src/App.tsx';

export type ProtectedCoreSurfaceKind =
  | 'http_route'
  | 'ui_flow'
  | 'writer'
  | 'reader'
  | 'table'
  | 'provider'
  | 'report'
  | 'scheduled_job'
  | 'export'
  | 'shared_dependency';

export interface ProtectedCoreProductionProof {
  status: 'owner_approved_live_scope_repository_evidence';
  evidence: string[];
  note: string;
}

export interface ProtectedCoreSurface {
  id: string;
  kind: ProtectedCoreSurfaceKind;
  domain: string;
  path: string;
  routeMount?: string;
  table?: string;
  conceptIds: string[];
  currentAuthority: string;
  intendedCanonicalAuthority: string;
  productionProof: ProtectedCoreProductionProof;
  identityRule: string;
  moneyRule: string;
  migrationBackfillRequirement: string;
  readPromotionRequirement: string;
  rollbackAction: string;
  retirementGate: string;
}

export interface ProtectedCoreUnknownAccess {
  path: string;
  table: string;
  conceptIds: string[];
  reason: string;
}

export interface ProtectedCoreSurfaceInventory {
  version: 1;
  task: typeof PROTECTED_CORE_TASK;
  reviewedAt: '2026-07-28';
  branch: 'program/cdb-main-continuous-20260725';
  scopePolicy: typeof POLICY_PATH;
  cutoverRunbook: typeof RUNBOOK_PATH;
  sourceDocuments: string[];
  productionAuthorization: {
    repositoryInventory: true;
    productionReadAccess: false;
    productionMutation: false;
    providerActivation: false;
    deploymentOrTrafficChange: false;
    liveLegacyRetirement: false;
  };
  protectedConceptIds: string[];
  summary: {
    surfaceCount: number;
    surfaceKindCounts: Record<ProtectedCoreSurfaceKind, number>;
    protectedWriterCount: number;
    protectedReaderCount: number;
    protectedTableCount: number;
    protectedRouteCount: number;
    protectedUiFlowCount: number;
    unknownWriterCount: number;
    unknownReaderCount: number;
  };
  surfaces: ProtectedCoreSurface[];
  unknownWriters: ProtectedCoreUnknownAccess[];
  unknownReaders: ProtectedCoreUnknownAccess[];
  safetyNotes: string[];
}

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

interface ManualSurfaceDefinition {
  kind: Extract<ProtectedCoreSurfaceKind, 'http_route' | 'ui_flow' | 'report' | 'scheduled_job' | 'export' | 'shared_dependency'>;
  domain: string;
  path: string;
  routeMount?: string;
  conceptIds: string[];
  note: string;
}

/**
 * Exact business-fact boundary approved for Canonical Core V1. Inpatient,
 * diagnostics, pharmacy, inventory, payroll, expense and other development-only
 * concepts are deliberately absent unless they are represented by an explicit
 * protected route definition below.
 */
export const PROTECTED_CORE_CONCEPT_IDS = [
  'schema_migration_governance',
  'source_mapping_issue_reconciliation',
  'canonical_outbox_atomic_assertions',
  'practitioner_identity',
  'practitioner_account_links',
  'encounter_care_episode',
  'service_catalog_pricing',
  'service_request_intent',
  'service_delivery_event',
  'invoice_document',
  'payment_receipt_tender_allocation',
  'patient_deposit_liability',
  'credit_refund_payment_reversal',
  'practitioner_compensation_rule',
  'practitioner_compensation_accrual_adjustment',
  'practitioner_compensation_settlement',
  'cash_custody',
  'user_auth_actor',
  'patient_identity',
  'tenant_patient_linkage',
  'appointment_intent',
  'reporting_metric_read_promotion',
] as const;

const HTTP_ROUTES: ManualSurfaceDefinition[] = [
  { kind: 'http_route', domain: 'identity', path: 'src/routes/tenant/auth.ts', routeMount: '/api/auth', conceptIds: ['user_auth_actor'], note: 'Tenant staff authentication required by every protected route.' },
  { kind: 'http_route', domain: 'identity', path: 'src/routes/tenant/patients.ts', routeMount: '/api/patients', conceptIds: ['patient_identity', 'tenant_patient_linkage'], note: 'Reception patient registration and lookup.' },
  { kind: 'http_route', domain: 'identity', path: 'src/routes/tenant/patientHospitalLinks.ts', routeMount: '/api/v1/patients/link-hospital', conceptIds: ['patient_identity', 'tenant_patient_linkage'], note: 'Explicit patient-to-hospital linkage.' },
  { kind: 'http_route', domain: 'reception', path: 'src/routes/tenant/appointments-with-paid-context.ts', routeMount: '/api/appointments', conceptIds: ['appointment_intent', 'patient_identity', 'practitioner_identity', 'invoice_document', 'payment_receipt_tender_allocation'], note: 'Appointment, paid context and check-in entry point.' },
  { kind: 'http_route', domain: 'reception', path: 'src/routes/tenant/queue.ts', routeMount: '/api/queue', conceptIds: ['appointment_intent', 'encounter_care_episode', 'patient_identity', 'practitioner_identity'], note: 'Reception queue operations.' },
  { kind: 'http_route', domain: 'reception', path: 'src/routes/tenant/visits.ts', routeMount: '/api/visits', conceptIds: ['encounter_care_episode', 'patient_identity', 'practitioner_identity'], note: 'Visit workflow.' },
  { kind: 'http_route', domain: 'reception', path: 'src/routes/tenant/reception.ts', routeMount: '/api/reception', conceptIds: ['patient_identity', 'appointment_intent', 'encounter_care_episode', 'invoice_document', 'payment_receipt_tender_allocation'], note: 'Reception orchestration.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/billing.ts', routeMount: '/api/billing', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation', 'service_catalog_pricing'], note: 'Primary billing and invoice workflow.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/billingCounter.ts', routeMount: '/api/billing-counter', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation', 'cash_custody'], note: 'Counter collection workflow.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/payments.ts', routeMount: '/api/payments', conceptIds: ['payment_receipt_tender_allocation', 'invoice_document'], note: 'Payment and allocation workflow.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/deposits.ts', routeMount: '/api/deposits', conceptIds: ['patient_deposit_liability', 'payment_receipt_tender_allocation'], note: 'Patient deposit liability workflow.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/creditNotes.ts', routeMount: '/api/credit-notes', conceptIds: ['credit_refund_payment_reversal', 'invoice_document', 'payment_receipt_tender_allocation'], note: 'Credit-note and refund workflow.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/settlements.ts', routeMount: '/api/settlements', conceptIds: ['payment_receipt_tender_allocation', 'cash_custody', 'practitioner_compensation_settlement'], note: 'Collection and compensation settlement.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/billingCancellation.ts', routeMount: '/api/billing-cancellation', conceptIds: ['invoice_document', 'credit_refund_payment_reversal'], note: 'Invoice cancellation and reversal.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/billingHandover.ts', routeMount: '/api/billing-handover', conceptIds: ['payment_receipt_tender_allocation', 'cash_custody'], note: 'Cash handover workflow.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/billingMaster.ts', routeMount: '/api/billing-master', conceptIds: ['service_catalog_pricing', 'invoice_document'], note: 'Service and billing master configuration.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/billingProvisional.ts', routeMount: '/api/billing-provisional', conceptIds: ['invoice_document', 'service_delivery_event'], note: 'Provisional billing compatibility workflow.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/billingCreditStatus.ts', routeMount: '/api/billing-credit-status', conceptIds: ['invoice_document', 'credit_refund_payment_reversal'], note: 'Protected credit-state reader.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/billingAging.ts', routeMount: '/api/billing-aging', conceptIds: ['invoice_document', 'reporting_metric_read_promotion'], note: 'Invoice aging reader.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/commissions.ts', routeMount: '/api/commissions', conceptIds: ['practitioner_compensation_rule', 'practitioner_compensation_accrual_adjustment', 'practitioner_compensation_settlement'], note: 'Doctor commission rules and balances.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/payment-methods.ts', routeMount: '/api/payment-methods', conceptIds: ['payment_receipt_tender_allocation'], note: 'Tender configuration.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/cash-book.ts', routeMount: '/api/cash-book', conceptIds: ['cash_custody', 'payment_receipt_tender_allocation'], note: 'Cash-book reader.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/cashOperations.ts', routeMount: '/api/cash-operations', conceptIds: ['cash_custody', 'payment_receipt_tender_allocation'], note: 'Cash custody operations.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/cashLedger.ts', routeMount: '/api/cash-ledger', conceptIds: ['cash_custody', 'payment_receipt_tender_allocation'], note: 'Immutable cash ledger surface.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/due-aging.ts', routeMount: '/api/due-aging', conceptIds: ['invoice_document', 'reporting_metric_read_promotion'], note: 'Due aging reader.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/approvals.ts', routeMount: '/api/approvals', conceptIds: ['credit_refund_payment_reversal', 'cash_custody', 'user_auth_actor'], note: 'Protected financial approval boundary.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/refundDisputes.ts', routeMount: '/api/refund-disputes', conceptIds: ['credit_refund_payment_reversal', 'cash_custody'], note: 'Refund dispute and recovery.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/actionCenter.ts', routeMount: '/api/action-center', conceptIds: ['credit_refund_payment_reversal', 'invoice_document', 'cash_custody'], note: 'Operational action center for protected financial exceptions.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/bill-versions.ts', routeMount: '/api/bill-versions', conceptIds: ['invoice_document'], note: 'Immutable bill version evidence.' },
  { kind: 'http_route', domain: 'finance', path: 'src/routes/tenant/shift-closing.ts', routeMount: '/api/shift-closing', conceptIds: ['cash_custody', 'payment_receipt_tender_allocation'], note: 'Counter shift close.' },
  { kind: 'http_route', domain: 'practitioner', path: 'src/routes/tenant/doctors.ts', routeMount: '/api/doctors', conceptIds: ['practitioner_identity', 'practitioner_account_links', 'practitioner_compensation_rule'], note: 'Doctor setup required by Reception and commission.' },
  { kind: 'http_route', domain: 'practitioner', path: 'src/routes/tenant/doctorSchedules.ts', routeMount: '/api/doctor-schedules', conceptIds: ['practitioner_identity', 'appointment_intent'], note: 'Doctor availability used by appointment booking.' },
  { kind: 'http_route', domain: 'configuration', path: 'src/routes/tenant/departments.ts', routeMount: '/api/departments', conceptIds: ['practitioner_identity', 'service_catalog_pricing'], note: 'Department master.' },
  { kind: 'http_route', domain: 'configuration', path: 'src/routes/tenant/tests.ts', routeMount: '/api/tests', conceptIds: ['service_catalog_pricing'], note: 'Service/test master used by Reception billing.' },
  { kind: 'http_route', domain: 'configuration', path: 'src/routes/tenant/priceCategories.ts', routeMount: '/api/price-categories', conceptIds: ['service_catalog_pricing'], note: 'Effective price category configuration.' },
  { kind: 'http_route', domain: 'configuration', path: 'src/routes/tenant/settings.ts', routeMount: '/api/settings', conceptIds: ['user_auth_actor', 'service_catalog_pricing'], note: 'Hospital and tenant configuration.' },
  { kind: 'http_route', domain: 'identity', path: 'src/routes/tenant/users.ts', routeMount: '/api/users', conceptIds: ['user_auth_actor', 'practitioner_account_links'], note: 'Protected staff user administration.' },
  { kind: 'http_route', domain: 'authorization', path: 'src/routes/tenant/permissions.ts', routeMount: '/api/permissions', conceptIds: ['user_auth_actor'], note: 'Permission catalog and assignment.' },
  { kind: 'http_route', domain: 'authorization', path: 'src/routes/tenant/access-control.ts', routeMount: '/api/access-control', conceptIds: ['user_auth_actor'], note: 'Role and access management.' },
  { kind: 'http_route', domain: 'audit', path: 'src/routes/tenant/audit.ts', routeMount: '/api/audit', conceptIds: ['user_auth_actor', 'canonical_outbox_atomic_assertions'], note: 'Protected audit evidence reader.' },
  { kind: 'http_route', domain: 'reporting', path: 'src/routes/tenant/dailyCollection.ts', routeMount: '/api/reports/daily-collection', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation', 'practitioner_compensation_accrual_adjustment', 'reporting_metric_read_promotion'], note: 'Daily collection report.' },
  { kind: 'http_route', domain: 'reporting', path: 'src/routes/tenant/shiftHandoverReport.ts', routeMount: '/api/reports/shift-handover', conceptIds: ['payment_receipt_tender_allocation', 'cash_custody', 'reporting_metric_read_promotion'], note: 'Shift handover report.' },
  { kind: 'http_route', domain: 'reporting', path: 'src/routes/tenant/billingReports.ts', routeMount: '/api/billing-reports', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation', 'reporting_metric_read_promotion'], note: 'Billing report family.' },
  { kind: 'http_route', domain: 'export', path: 'src/routes/tenant/pdf.ts', routeMount: '/api/pdf', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation'], note: 'Invoice and receipt PDF generation.' },
];

const UI_FLOWS: ManualSurfaceDefinition[] = [
  { kind: 'ui_flow', domain: 'authorization', path: UI_ROUTER_PATH, routeMount: '/h/:slug/access-control', conceptIds: ['user_auth_actor'], note: 'Role management UI.' },
  { kind: 'ui_flow', domain: 'identity', path: UI_ROUTER_PATH, routeMount: '/h/:slug/patients', conceptIds: ['patient_identity', 'tenant_patient_linkage'], note: 'Hospital-admin patient list.' },
  { kind: 'ui_flow', domain: 'identity', path: UI_ROUTER_PATH, routeMount: '/h/:slug/patients/new', conceptIds: ['patient_identity', 'tenant_patient_linkage'], note: 'Hospital-admin registration.' },
  { kind: 'ui_flow', domain: 'finance', path: UI_ROUTER_PATH, routeMount: '/h/:slug/billing', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation'], note: 'Billing dashboard.' },
  { kind: 'ui_flow', domain: 'finance', path: UI_ROUTER_PATH, routeMount: '/h/:slug/billing/:billId/print', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation'], note: 'Invoice print.' },
  { kind: 'ui_flow', domain: 'finance', path: UI_ROUTER_PATH, routeMount: '/h/:slug/commissions', conceptIds: ['practitioner_compensation_rule', 'practitioner_compensation_accrual_adjustment', 'practitioner_compensation_settlement'], note: 'Commission management.' },
  { kind: 'ui_flow', domain: 'configuration', path: UI_ROUTER_PATH, routeMount: '/h/:slug/test-catalog', conceptIds: ['service_catalog_pricing'], note: 'Service/test catalog.' },
  { kind: 'ui_flow', domain: 'configuration', path: UI_ROUTER_PATH, routeMount: '/h/:slug/settings', conceptIds: ['user_auth_actor', 'service_catalog_pricing'], note: 'Hospital settings.' },
  { kind: 'ui_flow', domain: 'reception', path: UI_ROUTER_PATH, routeMount: '/h/:slug/appointments', conceptIds: ['appointment_intent', 'patient_identity', 'practitioner_identity'], note: 'Hospital-admin appointment scheduler.' },
  { kind: 'ui_flow', domain: 'reception', path: UI_ROUTER_PATH, routeMount: '/h/:slug/queue-management', conceptIds: ['appointment_intent', 'encounter_care_episode'], note: 'Hospital-admin queue management.' },
  { kind: 'ui_flow', domain: 'finance', path: UI_ROUTER_PATH, routeMount: '/h/:slug/deposits', conceptIds: ['patient_deposit_liability', 'payment_receipt_tender_allocation'], note: 'Deposit UI.' },
  { kind: 'ui_flow', domain: 'finance', path: UI_ROUTER_PATH, routeMount: '/h/:slug/credit-notes', conceptIds: ['credit_refund_payment_reversal', 'invoice_document'], note: 'Credit note UI.' },
  { kind: 'ui_flow', domain: 'finance', path: UI_ROUTER_PATH, routeMount: '/h/:slug/settlements', conceptIds: ['payment_receipt_tender_allocation', 'cash_custody'], note: 'Settlement UI.' },
  { kind: 'ui_flow', domain: 'finance', path: UI_ROUTER_PATH, routeMount: '/h/:slug/billing-handover', conceptIds: ['payment_receipt_tender_allocation', 'cash_custody'], note: 'Billing handover UI.' },
  { kind: 'ui_flow', domain: 'finance', path: UI_ROUTER_PATH, routeMount: '/h/:slug/billing-cancellation', conceptIds: ['invoice_document', 'credit_refund_payment_reversal'], note: 'Cancellation UI.' },
  { kind: 'ui_flow', domain: 'finance', path: UI_ROUTER_PATH, routeMount: '/h/:slug/payments', conceptIds: ['payment_receipt_tender_allocation', 'invoice_document'], note: 'Payment UI.' },
  { kind: 'ui_flow', domain: 'finance', path: UI_ROUTER_PATH, routeMount: '/h/:slug/billing-master', conceptIds: ['service_catalog_pricing', 'invoice_document'], note: 'Billing master UI.' },
  { kind: 'ui_flow', domain: 'finance', path: UI_ROUTER_PATH, routeMount: '/h/:slug/billing-provisional', conceptIds: ['invoice_document', 'service_delivery_event'], note: 'Provisional billing UI.' },
  { kind: 'ui_flow', domain: 'audit', path: UI_ROUTER_PATH, routeMount: '/h/:slug/audit', conceptIds: ['user_auth_actor', 'canonical_outbox_atomic_assertions'], note: 'Audit UI.' },
  { kind: 'ui_flow', domain: 'audit', path: UI_ROUTER_PATH, routeMount: '/h/:slug/system-audit', conceptIds: ['user_auth_actor', 'canonical_outbox_atomic_assertions'], note: 'System audit UI.' },
  { kind: 'ui_flow', domain: 'reception', path: UI_ROUTER_PATH, routeMount: '/h/:slug/reception/dashboard', conceptIds: ['patient_identity', 'appointment_intent', 'encounter_care_episode', 'invoice_document', 'payment_receipt_tender_allocation'], note: 'Reception dashboard.' },
  { kind: 'ui_flow', domain: 'reception', path: UI_ROUTER_PATH, routeMount: '/h/:slug/reception/patients', conceptIds: ['patient_identity', 'tenant_patient_linkage'], note: 'Reception patient list.' },
  { kind: 'ui_flow', domain: 'reception', path: UI_ROUTER_PATH, routeMount: '/h/:slug/reception/patients/new', conceptIds: ['patient_identity', 'tenant_patient_linkage'], note: 'Reception registration.' },
  { kind: 'ui_flow', domain: 'reception', path: UI_ROUTER_PATH, routeMount: '/h/:slug/reception/patients/:id', conceptIds: ['patient_identity', 'tenant_patient_linkage'], note: 'Reception patient detail.' },
  { kind: 'ui_flow', domain: 'reception', path: UI_ROUTER_PATH, routeMount: '/h/:slug/reception/billing', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation'], note: 'Reception billing.' },
  { kind: 'ui_flow', domain: 'reception', path: UI_ROUTER_PATH, routeMount: '/h/:slug/reception/billing/:billId/print', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation'], note: 'Reception invoice print.' },
  { kind: 'ui_flow', domain: 'reception', path: UI_ROUTER_PATH, routeMount: '/h/:slug/reception/appointments', conceptIds: ['appointment_intent', 'patient_identity', 'practitioner_identity'], note: 'Reception appointments.' },
  { kind: 'ui_flow', domain: 'reception', path: UI_ROUTER_PATH, routeMount: '/h/:slug/reception/queue', conceptIds: ['appointment_intent', 'encounter_care_episode'], note: 'Reception queue.' },
];

const SPECIAL_SURFACES: ManualSurfaceDefinition[] = [
  { kind: 'report', domain: 'reporting', path: 'src/routes/tenant/dailyCollection.ts', routeMount: '/api/reports/daily-collection', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation', 'practitioner_compensation_accrual_adjustment', 'reporting_metric_read_promotion'], note: 'Daily collection operational and executive totals.' },
  { kind: 'report', domain: 'reporting', path: 'src/routes/tenant/shiftHandoverReport.ts', routeMount: '/api/reports/shift-handover', conceptIds: ['payment_receipt_tender_allocation', 'cash_custody', 'reporting_metric_read_promotion'], note: 'Shift handover totals.' },
  { kind: 'report', domain: 'reporting', path: 'src/routes/tenant/billingReports.ts', routeMount: '/api/billing-reports', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation', 'reporting_metric_read_promotion'], note: 'Billing report family.' },
  { kind: 'report', domain: 'reporting', path: 'src/routes/tenant/billingAging.ts', routeMount: '/api/billing-aging', conceptIds: ['invoice_document', 'reporting_metric_read_promotion'], note: 'Billing aging.' },
  { kind: 'report', domain: 'reporting', path: 'src/routes/tenant/due-aging.ts', routeMount: '/api/due-aging', conceptIds: ['invoice_document', 'reporting_metric_read_promotion'], note: 'Due aging.' },
  { kind: 'report', domain: 'reporting', path: 'src/routes/tenant/reportAppointment.ts', routeMount: '/api/reports/appointment', conceptIds: ['appointment_intent', 'patient_identity', 'practitioner_identity', 'reporting_metric_read_promotion'], note: 'Appointment report.' },
  { kind: 'scheduled_job', domain: 'reception', path: 'src/scheduled.ts', routeMount: 'cron:0 0 * * *#sendAppointmentReminders', conceptIds: ['appointment_intent', 'patient_identity', 'practitioner_identity'], note: 'Tomorrow appointment reminder job; unrelated scheduled jobs are outside this protected surface.' },
  { kind: 'export', domain: 'configuration', path: 'src/routes/tenant/settings-import-export.ts', routeMount: '/api/settings/export', conceptIds: ['user_auth_actor', 'service_catalog_pricing'], note: 'Hospital configuration export/import evidence.' },
  { kind: 'export', domain: 'finance', path: 'src/routes/tenant/dailyCollection.ts', routeMount: '/api/reports/daily-collection#pdf', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation', 'reporting_metric_read_promotion'], note: 'Daily collection PDF/export.' },
  { kind: 'export', domain: 'finance', path: 'src/routes/tenant/pdf.ts', routeMount: '/api/pdf', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation'], note: 'Invoice and receipt PDF export.' },
  { kind: 'shared_dependency', domain: 'routing', path: API_ROUTER_PATH, conceptIds: ['user_auth_actor'], note: 'Tenant route registration and middleware ordering.' },
  { kind: 'shared_dependency', domain: 'tenant', path: 'src/middleware/tenant.ts', conceptIds: ['user_auth_actor'], note: 'Tenant resolution and isolation.' },
  { kind: 'shared_dependency', domain: 'authorization', path: 'src/middleware/auth.ts', conceptIds: ['user_auth_actor'], note: 'Authenticated actor boundary.' },
  { kind: 'shared_dependency', domain: 'authorization', path: 'src/lib/route-permissions.ts', conceptIds: ['user_auth_actor'], note: 'Central route permission mapping.' },
  { kind: 'shared_dependency', domain: 'audit', path: 'src/middleware/audit.ts', conceptIds: ['user_auth_actor', 'canonical_outbox_atomic_assertions'], note: 'Automatic protected-route audit.' },
  { kind: 'shared_dependency', domain: 'finance', path: 'src/middleware/canonical-only-financial-guard.ts', conceptIds: ['invoice_document', 'payment_receipt_tender_allocation', 'credit_refund_payment_reversal'], note: 'Fail-closed financial authority guard.' },
  { kind: 'shared_dependency', domain: 'governance', path: 'src/lib/canonical/idempotency.ts', conceptIds: ['canonical_outbox_atomic_assertions'], note: 'Stable idempotency and payload fingerprints.' },
  { kind: 'shared_dependency', domain: 'database', path: 'src/db/index.ts', conceptIds: ['schema_migration_governance'], note: 'D1 transaction/database boundary.' },
];

const PROTECTED_RUNTIME_SUPPORT_PATTERNS = [
  /^src\/lib\/canonical\/(?:commands\/)?(?:.*patient|.*practitioner|.*appointment|.*encounter|.*service|.*invoice|.*payment|.*financial|.*compensation|.*reporting)/i,
  /^src\/lib\/(?:billing|cash|executed-refund|doctor-compensation|diagnostic-performer-reserve|patient-reference|patient-registration|patient-live-visit|appointment|reception|invoice|payment|settlement|refund)/i,
  /^src\/services\/actionCenter\/(?:collections|exceptions)/i,
  /^src\/middleware\/(?:auth|tenant|audit|canonical-only-financial-guard)/i,
  /^src\/lib\/route-permissions\.ts$/,
  /^src\/index\.ts$/,
];

const NON_PROTECTED_RUNTIME_PATH_PATTERNS = [
  /^src\/lib\/canonical\/patient-chart-(?:lab|radiology)-billing\.ts$/i,
];

const FINANCIAL_CONCEPT_IDS = new Set([
  'service_catalog_pricing',
  'invoice_document',
  'payment_receipt_tender_allocation',
  'patient_deposit_liability',
  'credit_refund_payment_reversal',
  'practitioner_compensation_rule',
  'practitioner_compensation_accrual_adjustment',
  'practitioner_compensation_settlement',
  'cash_custody',
  'reporting_metric_read_promotion',
]);

function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function surfaceId(surface: Omit<ProtectedCoreSurface, 'id'>): string {
  const key = [surface.kind, surface.path, surface.routeMount ?? '', surface.table ?? '', surface.conceptIds.join(',')].join('|');
  return `pcsi_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

function makeSurface(surface: Omit<ProtectedCoreSurface, 'id'>): ProtectedCoreSurface {
  return { id: surfaceId(surface), ...surface };
}

function conceptsFor(ids: string[], conceptMap: Map<string, AuthorityMatrixConcept>): AuthorityMatrixConcept[] {
  return ids.map((id) => conceptMap.get(id)).filter((concept): concept is AuthorityMatrixConcept => Boolean(concept));
}

function currentAuthority(ids: string[], conceptMap: Map<string, AuthorityMatrixConcept>, table?: string): string {
  const concepts = conceptsFor(ids, conceptMap);
  if (table) {
    const source = concepts.flatMap((concept) => concept.currentSources ?? []).find((item) => item.table === table);
    if (source) return `${source.classification}:${source.table}`;
    if (concepts.some((concept) => concept.targetAuthority.tables?.includes(table))) return `canonical_authority:${table}`;
    return `governed_table:${table}`;
  }
  const sources = uniqueSorted(concepts.flatMap((concept) => (concept.currentSources ?? []).map((source) => `${source.classification}:${source.table}`)));
  return sources.length > 0 ? sources.join(' | ') : 'repository-governed compatibility surface; exact current table resolved by route/access entry';
}

function intendedAuthority(ids: string[], conceptMap: Map<string, AuthorityMatrixConcept>, explicit?: string): string {
  if (explicit && explicit.trim().length > 0) return explicit;
  const targets = uniqueSorted(conceptsFor(ids, conceptMap).flatMap((concept) => concept.targetAuthority.tables ?? []));
  return targets.length > 0 ? targets.join(' | ') : 'Canonical Core V1 command/provider contract to be frozen at CDB-V1-020';
}

function identityRule(ids: string[]): string {
  const concepts = new Set(ids);
  const rules: string[] = ['tenant identity must match the authenticated tenant on every read and mutation'];
  if (concepts.has('patient_identity') || concepts.has('tenant_patient_linkage')) {
    rules.push('patient linkage requires an exact reviewed source mapping or public ID; name, phone, timestamp proximity and numeric-ID coincidence are prohibited');
  }
  if (concepts.has('practitioner_identity') || concepts.has('practitioner_account_links')) {
    rules.push('practitioner linkage requires the exact tenant-scoped practitioner public ID and reviewed user/employee mapping');
  }
  if (concepts.has('appointment_intent')) {
    rules.push('appointment identity requires its exact tenant-scoped source key/public ID plus exact patient and practitioner mappings');
  }
  if (concepts.has('encounter_care_episode') || concepts.has('service_delivery_event')) {
    rules.push('encounter/visit identity requires an explicit source mapping and must not be inferred from time proximity');
  }
  return rules.join('; ');
}

function moneyRule(ids: string[]): string {
  if (!ids.some((id) => FINANCIAL_CONCEPT_IDS.has(id))) {
    return 'not applicable to this surface; it must not create, copy or derive an independent monetary authority';
  }
  return 'all amounts use integer minor units; invoice net = gross - discount + tax, allocated <= receipt amount, paid = successful allocations, due = invoice net - paid - applied credit, refunds/reversals and doctor commission balances reconcile exactly with zero unexplained variance';
}

function migrationRequirement(ids: string[], conceptMap: Map<string, AuthorityMatrixConcept>): string {
  const statuses = uniqueSorted(conceptsFor(ids, conceptMap).map((concept) => `${concept.id}:${concept.backfill?.status ?? 'not_recorded'}`));
  return `repository implementation only; production migration/backfill is prohibited until CDB-V1-060 authorization; protected-clone work must be tenant-bounded, resumable, idempotent and second-pass stable; current matrix: ${statuses.join(', ') || 'no recorded backfill status'}`;
}

function readPromotionRequirement(kind: ProtectedCoreSurfaceKind, ids: string[]): string {
  const target = kind === 'reader' || kind === 'report' || kind === 'export' || kind === 'ui_flow' || kind === 'provider'
    ? 'this read surface'
    : 'all readers downstream of this surface';
  return `${target} remains on the current provider until Canonical shadow comparison proves exact row identity/status and zero unexplained minor-unit variance where financial; promotion is separately gated and must preserve immediate provider rollback (${ids.join(', ')})`;
}

function rollbackAction(): string {
  return 'disable the bounded Canonical provider/strict flag and restore the reviewed legacy compatibility route without deleting Canonical or legacy history; bind rollback to the exact commit, build, tenant scope and reconciliation receipt';
}

function retirementGate(ids: string[], conceptMap: Map<string, AuthorityMatrixConcept>): string {
  const gates = uniqueSorted(conceptsFor(ids, conceptMap).map((concept) => `${concept.id}:${concept.retirement?.action ?? 'retirement remains blocked'}`));
  return `CDB-V1-080 only after command coverage, shadow parity, canonical read/write promotion, observation and rollback proof; physical deletion requires separate destructive authorization; matrix: ${gates.join(' | ') || 'retirement remains blocked'}`;
}

function productionProof(path: string, note: string, extraEvidence: string[] = []): ProtectedCoreProductionProof {
  return {
    status: 'owner_approved_live_scope_repository_evidence',
    evidence: uniqueSorted([POLICY_PATH, RUNBOOK_PATH, path, ...extraEvidence]),
    note: `${note} This is repository and owner-policy evidence only; no production database or traffic was accessed.`
  };
}

function manualSurface(definition: ManualSurfaceDefinition, conceptMap: Map<string, AuthorityMatrixConcept>): ProtectedCoreSurface {
  return makeSurface({
    kind: definition.kind,
    domain: definition.domain,
    path: definition.path,
    routeMount: definition.routeMount,
    conceptIds: uniqueSorted(definition.conceptIds),
    currentAuthority: currentAuthority(definition.conceptIds, conceptMap),
    intendedCanonicalAuthority: intendedAuthority(definition.conceptIds, conceptMap),
    productionProof: productionProof(
      definition.path,
      definition.note,
      definition.kind === 'http_route' ? [API_ROUTER_PATH] : definition.kind === 'ui_flow' ? [UI_ROUTER_PATH] : [],
    ),
    identityRule: identityRule(definition.conceptIds),
    moneyRule: moneyRule(definition.conceptIds),
    migrationBackfillRequirement: migrationRequirement(definition.conceptIds, conceptMap),
    readPromotionRequirement: readPromotionRequirement(definition.kind, definition.conceptIds),
    rollbackAction: rollbackAction(),
    retirementGate: retirementGate(definition.conceptIds, conceptMap),
  });
}

function hasProtectedConcept(ids: string[], protectedConceptIds: Set<string>): boolean {
  return ids.some((id) => protectedConceptIds.has(id));
}

function isProtectedRuntimeAccessPath(path: string, explicitPaths: Set<string>): boolean {
  if (explicitPaths.has(path)) return true;
  if (NON_PROTECTED_RUNTIME_PATH_PATTERNS.some((pattern) => pattern.test(path))) return false;
  return PROTECTED_RUNTIME_SUPPORT_PATTERNS.some((pattern) => pattern.test(path));
}

function writerUnknown(writer: AuthorityWriterAccess, protectedConceptIds: Set<string>): ProtectedCoreUnknownAccess | null {
  if (!hasProtectedConcept(writer.conceptIds, protectedConceptIds)) {
    return { path: writer.path, table: writer.table, conceptIds: writer.conceptIds, reason: 'writer has no protected Core V1 concept assignment' };
  }
  if (!writer.owner || !writer.lifecycleStatus || !writer.targetCommand || writer.targetCommand === 'unassigned') {
    return { path: writer.path, table: writer.table, conceptIds: writer.conceptIds, reason: 'writer authority, owner or target command is unclassified' };
  }
  return null;
}

function readerUnknown(reader: AuthorityReaderAccess, protectedConceptIds: Set<string>): ProtectedCoreUnknownAccess | null {
  if (!hasProtectedConcept(reader.conceptIds, protectedConceptIds)) {
    return { path: reader.path, table: reader.table, conceptIds: reader.conceptIds, reason: 'reader has no protected Core V1 concept assignment' };
  }
  if (!reader.owner || !reader.providerStatus || !reader.targetProvider || reader.targetProvider === 'unassigned') {
    return { path: reader.path, table: reader.table, conceptIds: reader.conceptIds, reason: 'reader authority, owner or target provider is unclassified' };
  }
  return null;
}

function writerSurface(writer: AuthorityWriterAccess, conceptMap: Map<string, AuthorityMatrixConcept>): ProtectedCoreSurface {
  const ids = uniqueSorted(writer.conceptIds);
  return makeSurface({
    kind: 'writer',
    domain: uniqueSorted(writer.domains).join('+') || 'shared',
    path: writer.path,
    table: writer.table,
    conceptIds: ids,
    currentAuthority: `${writer.lifecycleStatus}:${writer.table}; owner=${writer.owner}`,
    intendedCanonicalAuthority: intendedAuthority(ids, conceptMap, writer.targetCommand),
    productionProof: productionProof(writer.path, `Direct or indirect protected writer detected by ${ACCESS_REGISTRY_PATH}.`, [ACCESS_REGISTRY_PATH]),
    identityRule: identityRule(ids),
    moneyRule: moneyRule(ids),
    migrationBackfillRequirement: migrationRequirement(ids, conceptMap),
    readPromotionRequirement: readPromotionRequirement('writer', ids),
    rollbackAction: rollbackAction(),
    retirementGate: `${writer.retirementBlocker}; ${retirementGate(ids, conceptMap)}`,
  });
}

function readerSurface(reader: AuthorityReaderAccess, conceptMap: Map<string, AuthorityMatrixConcept>): ProtectedCoreSurface {
  const ids = uniqueSorted(reader.conceptIds);
  return makeSurface({
    kind: 'reader',
    domain: uniqueSorted(reader.domains).join('+') || 'shared',
    path: reader.path,
    table: reader.table,
    conceptIds: ids,
    currentAuthority: `${reader.providerStatus}:${reader.table}; owner=${reader.owner}`,
    intendedCanonicalAuthority: intendedAuthority(ids, conceptMap, reader.targetProvider),
    productionProof: productionProof(reader.path, `Protected operational/reporting reader detected by ${ACCESS_REGISTRY_PATH}.`, [ACCESS_REGISTRY_PATH]),
    identityRule: identityRule(ids),
    moneyRule: moneyRule(ids),
    migrationBackfillRequirement: migrationRequirement(ids, conceptMap),
    readPromotionRequirement: readPromotionRequirement('reader', ids),
    rollbackAction: rollbackAction(),
    retirementGate: `${reader.retirementBlocker}; ${retirementGate(ids, conceptMap)}`,
  });
}

function tableSurface(table: string, conceptIds: string[], conceptMap: Map<string, AuthorityMatrixConcept>): ProtectedCoreSurface {
  const ids = uniqueSorted(conceptIds);
  return makeSurface({
    kind: 'table',
    domain: uniqueSorted(conceptsFor(ids, conceptMap).map((concept) => concept.domain)).join('+') || 'shared',
    path: MATRIX_PATH,
    table,
    conceptIds: ids,
    currentAuthority: currentAuthority(ids, conceptMap, table),
    intendedCanonicalAuthority: intendedAuthority(ids, conceptMap),
    productionProof: productionProof(MATRIX_PATH, `Table is reached by at least one classified protected runtime writer or reader.`, [ACCESS_REGISTRY_PATH]),
    identityRule: identityRule(ids),
    moneyRule: moneyRule(ids),
    migrationBackfillRequirement: migrationRequirement(ids, conceptMap),
    readPromotionRequirement: readPromotionRequirement('table', ids),
    rollbackAction: rollbackAction(),
    retirementGate: retirementGate(ids, conceptMap),
  });
}

function providerSurface(concept: AuthorityMatrixConcept): ProtectedCoreSurface {
  const ids = [concept.id];
  const providerPath = (concept.targetAuthority.modules ?? []).find((path) => /provider/i.test(path)) ?? MATRIX_PATH;
  const providerStatus = providerPath === MATRIX_PATH ? 'provider contract not yet implemented' : `provider module:${providerPath}`;
  return makeSurface({
    kind: 'provider',
    domain: concept.domain,
    path: providerPath,
    conceptIds: ids,
    currentAuthority: currentAuthority(ids, new Map([[concept.id, concept]])),
    intendedCanonicalAuthority: `${providerStatus}; canonical tables=${(concept.targetAuthority.tables ?? []).join(', ') || 'to be frozen at CDB-V1-020'}`,
    productionProof: productionProof(providerPath, `Target provider inventory for live protected fact: ${concept.fact}.`, [MATRIX_PATH]),
    identityRule: identityRule(ids),
    moneyRule: moneyRule(ids),
    migrationBackfillRequirement: migrationRequirement(ids, new Map([[concept.id, concept]])),
    readPromotionRequirement: readPromotionRequirement('provider', ids),
    rollbackAction: rollbackAction(),
    retirementGate: retirementGate(ids, new Map([[concept.id, concept]])),
  });
}

function kindCounts(surfaces: ProtectedCoreSurface[]): Record<ProtectedCoreSurfaceKind, number> {
  const counts: Record<ProtectedCoreSurfaceKind, number> = {
    http_route: 0,
    ui_flow: 0,
    writer: 0,
    reader: 0,
    table: 0,
    provider: 0,
    report: 0,
    scheduled_job: 0,
    export: 0,
    shared_dependency: 0,
  };
  for (const surface of surfaces) counts[surface.kind] += 1;
  return counts;
}

export function buildProtectedCoreSurfaceInventory(rootInput: string): ProtectedCoreSurfaceInventory {
  const root = resolve(rootInput);
  const matrix = readJson<AuthorityMatrix>(root, MATRIX_PATH);
  const accessRegistry = readJson<CanonicalAuthorityAccessRegistry>(root, ACCESS_REGISTRY_PATH);
  const protectedConceptIds = new Set<string>(PROTECTED_CORE_CONCEPT_IDS);
  const conceptMap = new Map(matrix.concepts.map((concept) => [concept.id, concept]));
  const missingConcepts = [...protectedConceptIds].filter((id) => !conceptMap.has(id));
  if (missingConcepts.length > 0) throw new Error(`Protected Core V1 concepts missing from matrix: ${missingConcepts.join(', ')}`);

  const manualDefinitions = [...HTTP_ROUTES, ...UI_FLOWS, ...SPECIAL_SURFACES];
  const explicitPaths = new Set(manualDefinitions.map((definition) => definition.path));
  const protectedWriters = accessRegistry.writers.filter((writer) =>
    writer.path.startsWith('src/')
    && hasProtectedConcept(writer.conceptIds, protectedConceptIds)
    && isProtectedRuntimeAccessPath(writer.path, explicitPaths),
  );
  const protectedReaders = accessRegistry.readers.filter((reader) =>
    reader.path.startsWith('src/')
    && hasProtectedConcept(reader.conceptIds, protectedConceptIds)
    && isProtectedRuntimeAccessPath(reader.path, explicitPaths),
  );

  const unknownWriters = protectedWriters
    .map((writer) => writerUnknown(writer, protectedConceptIds))
    .filter((unknown): unknown is ProtectedCoreUnknownAccess => Boolean(unknown));
  const unknownReaders = protectedReaders
    .map((reader) => readerUnknown(reader, protectedConceptIds))
    .filter((unknown): unknown is ProtectedCoreUnknownAccess => Boolean(unknown));

  const tableConcepts = new Map<string, Set<string>>();
  for (const access of [...protectedWriters, ...protectedReaders]) {
    const ids = tableConcepts.get(access.table) ?? new Set<string>();
    for (const id of access.conceptIds) if (protectedConceptIds.has(id)) ids.add(id);
    tableConcepts.set(access.table, ids);
  }

  const surfaces = [
    ...manualDefinitions.map((definition) => manualSurface(definition, conceptMap)),
    ...protectedWriters.map((writer) => writerSurface(writer, conceptMap)),
    ...protectedReaders.map((reader) => readerSurface(reader, conceptMap)),
    ...[...tableConcepts.entries()].map(([table, ids]) => tableSurface(table, [...ids], conceptMap)),
    ...[...protectedConceptIds].map((id) => providerSurface(conceptMap.get(id)!)),
  ].sort((left, right) =>
    left.kind.localeCompare(right.kind)
    || left.path.localeCompare(right.path)
    || (left.routeMount ?? '').localeCompare(right.routeMount ?? '')
    || (left.table ?? '').localeCompare(right.table ?? '')
    || left.id.localeCompare(right.id),
  );

  const counts = kindCounts(surfaces);
  return {
    version: 1,
    task: PROTECTED_CORE_TASK,
    reviewedAt: '2026-07-28',
    branch: 'program/cdb-main-continuous-20260725',
    scopePolicy: POLICY_PATH,
    cutoverRunbook: RUNBOOK_PATH,
    sourceDocuments: [POLICY_PATH, BOARD_PATH, RUNBOOK_PATH, MATRIX_PATH, ACCESS_REGISTRY_PATH, API_ROUTER_PATH, UI_ROUTER_PATH],
    productionAuthorization: {
      repositoryInventory: true,
      productionReadAccess: false,
      productionMutation: false,
      providerActivation: false,
      deploymentOrTrafficChange: false,
      liveLegacyRetirement: false,
    },
    protectedConceptIds: [...protectedConceptIds].sort((a, b) => a.localeCompare(b)),
    summary: {
      surfaceCount: surfaces.length,
      surfaceKindCounts: counts,
      protectedWriterCount: protectedWriters.length,
      protectedReaderCount: protectedReaders.length,
      protectedTableCount: counts.table,
      protectedRouteCount: counts.http_route,
      protectedUiFlowCount: counts.ui_flow,
      unknownWriterCount: unknownWriters.length,
      unknownReaderCount: unknownReaders.length,
    },
    surfaces,
    unknownWriters,
    unknownReaders,
    safetyNotes: [
      'Inventory evidence is repository-local and owner-policy based; no production database, runtime, traffic or secret was accessed.',
      'A route being mounted in the repository does not authorize provider activation, migration, deployment or cutover.',
      'Non-production domain surfaces are excluded unless an explicit protected-core dependency is recorded in the route definitions.',
      'Unknown protected-core writer and reader counts must remain zero before CDB-V1-020 contract freeze.',
      'Money reconciliation uses integer minor units and requires zero unexplained variance.',
      'Names, phone numbers, timestamp proximity and numeric-ID coincidence are never sufficient identity evidence.',
    ],
  };
}

export function validateProtectedCoreSurfaceInventory(
  inventory: ProtectedCoreSurfaceInventory,
  rootInput: string,
): string[] {
  const root = resolve(rootInput);
  const issues: string[] = [];
  if (inventory.task !== PROTECTED_CORE_TASK) issues.push('task identifier mismatch');
  if (inventory.productionAuthorization.productionReadAccess) issues.push('production read access must remain false');
  if (inventory.productionAuthorization.productionMutation) issues.push('production mutation must remain false');
  if (inventory.productionAuthorization.providerActivation) issues.push('provider activation must remain false');
  if (inventory.productionAuthorization.deploymentOrTrafficChange) issues.push('deployment or traffic change must remain false');
  if (inventory.productionAuthorization.liveLegacyRetirement) issues.push('live legacy retirement must remain false');
  if (inventory.unknownWriters.length !== 0 || inventory.summary.unknownWriterCount !== 0) issues.push('unknown protected writer assignments remain');
  if (inventory.unknownReaders.length !== 0 || inventory.summary.unknownReaderCount !== 0) issues.push('unknown protected reader assignments remain');

  const ids = new Set<string>();
  for (const source of inventory.sourceDocuments) {
    if (!existsSync(join(root, source))) issues.push(`missing source document: ${source}`);
  }
  for (const surface of inventory.surfaces) {
    if (ids.has(surface.id)) issues.push(`duplicate surface id: ${surface.id}`);
    ids.add(surface.id);
    if (!existsSync(join(root, surface.path))) issues.push(`surface path does not exist: ${surface.path}`);
    if (surface.conceptIds.length === 0) issues.push(`surface has no concept assignment: ${surface.id}`);
    if (!surface.currentAuthority.trim()) issues.push(`surface has no current authority: ${surface.id}`);
    if (!surface.intendedCanonicalAuthority.trim()) issues.push(`surface has no intended authority: ${surface.id}`);
    if (!surface.identityRule.trim()) issues.push(`surface has no identity rule: ${surface.id}`);
    if (!surface.moneyRule.trim()) issues.push(`surface has no money rule: ${surface.id}`);
    if (!surface.migrationBackfillRequirement.trim()) issues.push(`surface has no migration rule: ${surface.id}`);
    if (!surface.readPromotionRequirement.trim()) issues.push(`surface has no read-promotion rule: ${surface.id}`);
    if (!surface.rollbackAction.trim()) issues.push(`surface has no rollback action: ${surface.id}`);
    if (!surface.retirementGate.trim()) issues.push(`surface has no retirement gate: ${surface.id}`);
    for (const evidence of surface.productionProof.evidence) {
      if (!existsSync(join(root, evidence))) issues.push(`surface evidence does not exist: ${surface.id}:${evidence}`);
    }
  }

  const apiRouter = readFileSync(join(root, API_ROUTER_PATH), 'utf8');
  for (const surface of inventory.surfaces.filter((item) => item.kind === 'http_route')) {
    if (surface.routeMount && !apiRouter.includes(`'${surface.routeMount}'`)) {
      issues.push(`HTTP route mount is not registered in src/index.ts: ${surface.routeMount}`);
    }
  }

  const counts = kindCounts(inventory.surfaces);
  for (const [kind, count] of Object.entries(counts) as [ProtectedCoreSurfaceKind, number][]) {
    if (inventory.summary.surfaceKindCounts[kind] !== count) issues.push(`surface count mismatch for ${kind}`);
  }
  if (inventory.summary.surfaceCount !== inventory.surfaces.length) issues.push('surface total mismatch');
  if (inventory.summary.protectedWriterCount !== counts.writer) issues.push('writer count mismatch');
  if (inventory.summary.protectedReaderCount !== counts.reader) issues.push('reader count mismatch');
  if (inventory.summary.protectedTableCount !== counts.table) issues.push('table count mismatch');
  if (inventory.summary.protectedRouteCount !== counts.http_route) issues.push('route count mismatch');
  if (inventory.summary.protectedUiFlowCount !== counts.ui_flow) issues.push('UI flow count mismatch');
  return uniqueSorted(issues);
}

export function generateProtectedCoreSurfaceInventory(rootInput: string): ProtectedCoreSurfaceInventory {
  const root = resolve(rootInput);
  const inventory = buildProtectedCoreSurfaceInventory(root);
  const issues = validateProtectedCoreSurfaceInventory(inventory, root);
  if (issues.length > 0) throw new Error(`Protected Core V1 inventory validation failed:\n- ${issues.join('\n- ')}`);
  writeFileSync(join(root, PROTECTED_CORE_INVENTORY_PATH), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  return inventory;
}
