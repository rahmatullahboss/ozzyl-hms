import type {
  CanonicalBatchDatabase,
  CanonicalCommandExecutionOptions,
  CanonicalCommandResult,
} from './command-batch';
import { applyDeposit, type ApplyDepositResult } from './commands/apply-deposit';
import { collectPayment, type CollectPaymentResult, type PaymentTenderType } from './commands/collect-payment';
import { issueInvoice, type IssueInvoiceResult } from './commands/issue-invoice';
import {
  buildLiveDepositApplicationProjection,
  buildLiveInvoiceProjection,
  buildLivePaymentProjection,
  type LiveLegacyInvoiceLine,
} from './live-financial-projection';
import type { DecimalAmount } from './money';
import { toMinorUnits } from './money';

interface AvailableDepositRow {
  deposit_public_id: string;
  available_minor: number;
}

interface ExistingDepositApplicationSummary {
  application_count: number;
  applied_minor: number;
}

export interface BillingCounterCanonicalPayment {
  receiptNo: string;
  amount: DecimalAmount;
  paymentMethod: string;
  receivedAtUtc?: string;
  collectorId?: number | null;
  counterId?: number | null;
  counterSessionId?: number | null;
  externalTransactionId?: string | null;
}

export interface BillingCounterCanonicalDepositApplication {
  applicationNo: string;
  amount: DecimalAmount;
  appliedAtUtc: string;
}

export interface BillingCounterCanonicalSettlementInput {
  tenantId: string;
  patientId: number;
  invoiceNo: string;
  issuedAtUtc: string;
  items: readonly LiveLegacyInvoiceLine[];
  discount?: DecimalAmount;
  taxTotal?: DecimalAmount;
  payment?: BillingCounterCanonicalPayment | null;
  depositApplication?: BillingCounterCanonicalDepositApplication | null;
}

export interface BillingCounterCanonicalSettlementResult {
  invoice: CanonicalCommandResult<IssueInvoiceResult>;
  payment: CanonicalCommandResult<CollectPaymentResult> | null;
  depositApplications: CanonicalCommandResult<ApplyDepositResult>[];
  depositAppliedMinor: number;
}

export class CanonicalDepositCoverageError extends Error {
  readonly code = 'CANONICAL_DEPOSIT_COVERAGE_INSUFFICIENT';

  constructor() {
    super('Canonical deposits do not cover the requested billing deduction');
    this.name = 'CanonicalDepositCoverageError';
  }
}

function normalizePaymentMethod(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'other';
}

function paymentTenderType(value: string): PaymentTenderType {
  const method = normalizePaymentMethod(value);
  if (method === 'cash' || method === 'cash_payment') return 'cash';
  if (method.includes('card') || method.includes('visa') || method.includes('master')) return 'card';
  if (
    method.includes('bkash')
    || method.includes('nagad')
    || method.includes('rocket')
    || method.includes('mobile')
    || method.includes('wallet')
  ) return 'mobile_wallet';
  if (method.includes('bank')) return 'bank_transfer';
  if (method.includes('gateway') || method.includes('online')) return 'gateway';
  return 'other';
}

function minorToDecimal(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError('minor amount must be a non-negative safe integer');
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

async function existingDepositApplications(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    invoicePublicId: string;
    applicationNo: string;
  },
): Promise<ExistingDepositApplicationSummary> {
  return (await db.prepare(`
    SELECT
      COUNT(*) AS application_count,
      COALESCE(SUM(a.amount_minor), 0) AS applied_minor
    FROM canonical_deposit_applications a
    JOIN canonical_source_mappings m
      ON m.tenant_id = a.tenant_id
     AND m.entity_type = 'deposit_application'
     AND m.canonical_public_id = a.application_public_id
     AND m.mapping_status = 'mapped'
    WHERE a.tenant_id = ?
      AND a.invoice_public_id = ?
      AND m.source_type = 'legacy_live_deposit'
      AND substr(m.source_public_id, 1, length(?)) = ?
      AND substr(m.source_public_id, length(?) + 1, 1) = ':'
  `).bind(
    input.tenantId,
    input.invoicePublicId,
    input.applicationNo,
    input.applicationNo,
    input.applicationNo,
  ).first<ExistingDepositApplicationSummary>()) ?? {
    application_count: 0,
    applied_minor: 0,
  };
}

async function applyDepositDeduction(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    patientId: number;
    invoicePublicId: string;
    application: BillingCounterCanonicalDepositApplication;
  },
): Promise<{
  results: CanonicalCommandResult<ApplyDepositResult>[];
  appliedMinor: number;
}> {
  const requestedMinor = Number(toMinorUnits(input.application.amount));
  if (requestedMinor <= 0) return { results: [], appliedMinor: 0 };

  const existing = await existingDepositApplications(db, {
    tenantId: input.tenantId,
    invoicePublicId: input.invoicePublicId,
    applicationNo: input.application.applicationNo,
  });
  const alreadyAppliedMinor = Number(existing.applied_minor ?? 0);
  if (!Number.isSafeInteger(alreadyAppliedMinor) || alreadyAppliedMinor < 0 || alreadyAppliedMinor > requestedMinor) {
    throw new Error('Canonical deposit application replay state is inconsistent');
  }

  let remainingMinor = requestedMinor - alreadyAppliedMinor;
  let applicationIndex = Number(existing.application_count ?? 0) + 1;
  const results: CanonicalCommandResult<ApplyDepositResult>[] = [];

  while (remainingMinor > 0) {
    const deposit = await db.prepare(`
      SELECT deposit_public_id, available_minor
      FROM canonical_deposits
      WHERE tenant_id = ?
        AND legacy_patient_id = ?
        AND currency_code = 'BDT'
        AND status = 'posted'
        AND available_minor > 0
      ORDER BY received_at_utc ASC, deposit_public_id ASC
      LIMIT 1
    `).bind(input.tenantId, input.patientId).first<AvailableDepositRow>();
    if (!deposit) throw new CanonicalDepositCoverageError();

    const availableMinor = Number(deposit.available_minor);
    if (!Number.isSafeInteger(availableMinor) || availableMinor <= 0) {
      throw new Error('Canonical deposit available balance is invalid');
    }
    const allocationMinor = Math.min(remainingMinor, availableMinor);
    const applicationNo = `${input.application.applicationNo}:${applicationIndex}`;
    const projection = await buildLiveDepositApplicationProjection({
      tenantId: input.tenantId,
      applicationNo,
      depositPublicId: deposit.deposit_public_id,
      invoicePublicId: input.invoicePublicId,
      amount: minorToDecimal(allocationMinor),
      appliedAtUtc: input.application.appliedAtUtc,
    });
    results.push(await applyDeposit(db, projection));
    remainingMinor -= allocationMinor;
    applicationIndex += 1;
  }

  return { results, appliedMinor: requestedMinor };
}

export async function projectBillingCounterSettlement(
  db: CanonicalBatchDatabase,
  input: BillingCounterCanonicalSettlementInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<BillingCounterCanonicalSettlementResult> {
  if (
    execution.authoritativeStatements
    && ((input.payment && Number(toMinorUnits(input.payment.amount)) > 0)
      || (input.depositApplication && Number(toMinorUnits(input.depositApplication.amount)) > 0))
  ) {
    throw new Error('Paid or deposit-settled billing-counter invoices require non-blocking canonical shadow mode');
  }

  const invoiceProjection = await buildLiveInvoiceProjection({
    tenantId: input.tenantId,
    patientId: input.patientId,
    invoiceNo: input.invoiceNo,
    currencyCode: 'BDT',
    issuedAtUtc: input.issuedAtUtc,
    items: input.items,
    discount: input.discount,
    taxTotal: input.taxTotal,
  });
  const invoice = await issueInvoice(db, invoiceProjection, execution);

  const deposit = input.depositApplication
    ? await applyDepositDeduction(db, {
      tenantId: input.tenantId,
      patientId: input.patientId,
      invoicePublicId: invoiceProjection.invoicePublicId,
      application: input.depositApplication,
    })
    : { results: [], appliedMinor: 0 };

  let payment: CanonicalCommandResult<CollectPaymentResult> | null = null;
  if (input.payment && Number(toMinorUnits(input.payment.amount)) > 0) {
    const tenderType = paymentTenderType(input.payment.paymentMethod);
    const paymentProjection = await buildLivePaymentProjection({
      tenantId: input.tenantId,
      patientId: input.patientId,
      paymentNo: input.payment.receiptNo,
      receiptNo: input.payment.receiptNo,
      currencyCode: 'BDT',
      receivedAtUtc: input.payment.receivedAtUtc ?? input.issuedAtUtc,
      amount: input.payment.amount,
      tenderType,
      methodCode: normalizePaymentMethod(input.payment.paymentMethod),
      status: 'captured',
      allocations: [{
        sourceAllocationId: `invoice:${input.invoiceNo}`,
        invoicePublicId: invoiceProjection.invoicePublicId,
        amount: input.payment.amount,
      }],
      collectorId: input.payment.collectorId ?? null,
      counterId: input.payment.counterId ?? null,
      counterSessionId: input.payment.counterSessionId ?? null,
      externalTransactionId: input.payment.externalTransactionId ?? null,
    });
    payment = await collectPayment(db, paymentProjection);
  }

  return {
    invoice,
    payment,
    depositApplications: deposit.results,
    depositAppliedMinor: deposit.appliedMinor,
  };
}
