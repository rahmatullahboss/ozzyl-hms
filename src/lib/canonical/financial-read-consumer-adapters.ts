import {
  provideDepositRead,
  type DepositReadInput,
  type DepositReadResult,
} from './contracts/deposit-provider';
import {
  provideInvoiceRead,
  type InvoiceReadInput,
  type InvoiceReadResult,
} from './contracts/invoice-provider';
import {
  providePaymentRead,
  type PaymentReadInput,
  type PaymentReadResult,
} from './contracts/payment-provider';
import {
  exactFinancialReadValue,
  financialReadNonNegativeInteger,
  financialReadUtcTimestamp,
  type FinancialReadDatabase,
  type FinancialReadProviderMode,
  type FinancialReadShadowEvidence,
} from './financial-read-provider';

export type FinancialReadConsumerKind =
  | 'billing_detail'
  | 'report'
  | 'dashboard'
  | 'export'
  | 'scheduled_job'
  | 'admin';

export type FinancialReadConsumerProvider = 'invoice' | 'payment' | 'deposit';

export const FINANCIAL_READ_CONSUMER_IDS: Readonly<Record<FinancialReadConsumerKind, string>> = Object.freeze({
  billing_detail: 'cdb040b.billing-detail',
  report: 'cdb040b.report',
  dashboard: 'cdb040b.dashboard',
  export: 'cdb040b.export',
  scheduled_job: 'cdb040b.scheduled-job',
  admin: 'cdb040b.admin',
});

export interface FinancialReadConsumerEvidenceContext {
  tenantId: string;
  consumerKind: FinancialReadConsumerKind;
  observedAtUtc: string;
  elapsedMs: number;
  latencyBudgetMs: number;
  buildSha: string;
}

export interface InvoiceConsumerReadInput extends FinancialReadConsumerEvidenceContext {
  invoiceNumber: string;
}

export interface PaymentConsumerReadInput extends FinancialReadConsumerEvidenceContext {
  receiptNumber: string;
}

export interface DepositConsumerReadInput extends FinancialReadConsumerEvidenceContext {
  depositNumber: string;
}

export interface FinancialReadConsumerDependencies {
  invoice(db: FinancialReadDatabase, input: InvoiceReadInput): Promise<InvoiceReadResult>;
  payment(db: FinancialReadDatabase, input: PaymentReadInput): Promise<PaymentReadResult>;
  deposit(db: FinancialReadDatabase, input: DepositReadInput): Promise<DepositReadResult>;
}

const DEFAULT_DEPENDENCIES: FinancialReadConsumerDependencies = {
  invoice: provideInvoiceRead,
  payment: providePaymentRead,
  deposit: provideDepositRead,
};

interface ConsumerEnvelopeBase {
  consumerKind: FinancialReadConsumerKind;
  consumerId: string;
  mode: FinancialReadProviderMode;
  selectedProvider: 'legacy' | 'canonical';
  shadowEvidence?: FinancialReadShadowEvidence;
  rollbackMode: 'legacy';
}

export interface InvoiceConsumerReadResult extends ConsumerEnvelopeBase, InvoiceReadResult {
  provider: 'invoice';
}

export interface PaymentConsumerReadResult extends ConsumerEnvelopeBase, PaymentReadResult {
  provider: 'payment';
}

export interface DepositConsumerReadResult extends ConsumerEnvelopeBase, DepositReadResult {
  provider: 'deposit';
}

export type FinancialReadConsumerResult =
  | InvoiceConsumerReadResult
  | PaymentConsumerReadResult
  | DepositConsumerReadResult;

function evidenceContext(input: FinancialReadConsumerEvidenceContext) {
  const tenantId = exactFinancialReadValue(input.tenantId, 'tenantId');
  const consumerId = FINANCIAL_READ_CONSUMER_IDS[input.consumerKind];
  if (!consumerId) throw new TypeError(`unsupported financial read consumer kind: ${String(input.consumerKind)}`);
  const observedAtUtc = financialReadUtcTimestamp(input.observedAtUtc, 'observedAtUtc');
  const elapsedMs = financialReadNonNegativeInteger(input.elapsedMs, 'elapsedMs');
  const latencyBudgetMs = financialReadNonNegativeInteger(input.latencyBudgetMs, 'latencyBudgetMs');
  if (latencyBudgetMs <= 0) throw new RangeError('latencyBudgetMs must be positive');
  const buildSha = exactFinancialReadValue(input.buildSha, 'buildSha');
  return { tenantId, consumerId, observedAtUtc, elapsedMs, latencyBudgetMs, buildSha };
}

export async function readInvoiceForConsumer(
  db: FinancialReadDatabase,
  input: InvoiceConsumerReadInput,
  dependencies: FinancialReadConsumerDependencies = DEFAULT_DEPENDENCIES,
): Promise<InvoiceConsumerReadResult> {
  const context = evidenceContext(input);
  const result = await dependencies.invoice(db, {
    ...context,
    invoiceNumber: exactFinancialReadValue(input.invoiceNumber, 'invoiceNumber'),
  });
  return {
    provider: 'invoice',
    consumerKind: input.consumerKind,
    consumerId: context.consumerId,
    rollbackMode: 'legacy',
    ...result,
  };
}

export async function readPaymentForConsumer(
  db: FinancialReadDatabase,
  input: PaymentConsumerReadInput,
  dependencies: FinancialReadConsumerDependencies = DEFAULT_DEPENDENCIES,
): Promise<PaymentConsumerReadResult> {
  const context = evidenceContext(input);
  const result = await dependencies.payment(db, {
    ...context,
    receiptNumber: exactFinancialReadValue(input.receiptNumber, 'receiptNumber'),
  });
  return {
    provider: 'payment',
    consumerKind: input.consumerKind,
    consumerId: context.consumerId,
    rollbackMode: 'legacy',
    ...result,
  };
}

export async function readDepositForConsumer(
  db: FinancialReadDatabase,
  input: DepositConsumerReadInput,
  dependencies: FinancialReadConsumerDependencies = DEFAULT_DEPENDENCIES,
): Promise<DepositConsumerReadResult> {
  const context = evidenceContext(input);
  const result = await dependencies.deposit(db, {
    ...context,
    depositNumber: exactFinancialReadValue(input.depositNumber, 'depositNumber'),
  });
  return {
    provider: 'deposit',
    consumerKind: input.consumerKind,
    consumerId: context.consumerId,
    rollbackMode: 'legacy',
    ...result,
  };
}

export type FinancialReadShadowBatchErrorCode =
  | 'EMPTY_BATCH'
  | 'BATCH_LIMIT_EXCEEDED'
  | 'DUPLICATE_SCOPE'
  | 'PROVIDER_FAILURE'
  | 'SHADOW_MODE_REQUIRED'
  | 'SHADOW_EVIDENCE_MISSING'
  | 'MAPPING_REQUIRED'
  | 'UNEXPLAINED_VARIANCE';

export class FinancialReadShadowBatchError extends Error {
  readonly name = 'FinancialReadShadowBatchError';
  readonly rollbackMode = 'legacy' as const;

  constructor(
    readonly code: FinancialReadShadowBatchErrorCode,
    message: string,
    readonly varianceIds: string[] = [],
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export interface FinancialReadShadowBatchRecord {
  provider: FinancialReadConsumerProvider;
  consumerKind: FinancialReadConsumerKind;
  sourcePublicId: string;
  elapsedMs: number;
}

export interface FinancialReadShadowBatchInput {
  tenantId: string;
  observedAtUtc: string;
  latencyBudgetMs: number;
  buildSha: string;
  records: readonly FinancialReadShadowBatchRecord[];
}

export interface FinancialReadShadowBatchRow {
  provider: FinancialReadConsumerProvider;
  consumerKind: FinancialReadConsumerKind;
  consumerId: string;
  sourcePublicId: string;
  sourceRowKey: string;
  canonicalRowKey: string;
  elapsedMs: number;
  latencyBudgetMs: number;
  varianceIds: string[];
  rollbackMode: 'legacy';
}

export interface FinancialReadShadowBatchResult {
  checkpoint: 'CDB-V1-040B';
  tenantId: string;
  buildSha: string;
  observedAtUtc: string;
  recordCount: number;
  parity: true;
  varianceIds: [];
  rollbackMode: 'legacy';
  rows: FinancialReadShadowBatchRow[];
}

function recordScope(record: FinancialReadShadowBatchRecord): string {
  return JSON.stringify([
    record.provider,
    record.consumerKind,
    exactFinancialReadValue(record.sourcePublicId, 'sourcePublicId'),
  ]);
}

async function executeShadowRecord(
  db: FinancialReadDatabase,
  tenantId: string,
  observedAtUtc: string,
  latencyBudgetMs: number,
  buildSha: string,
  record: FinancialReadShadowBatchRecord,
  dependencies: FinancialReadConsumerDependencies,
): Promise<FinancialReadConsumerResult> {
  const common = {
    tenantId,
    consumerKind: record.consumerKind,
    observedAtUtc,
    elapsedMs: financialReadNonNegativeInteger(record.elapsedMs, 'record.elapsedMs'),
    latencyBudgetMs,
    buildSha,
  };
  switch (record.provider) {
    case 'invoice':
      return readInvoiceForConsumer(db, {
        ...common,
        invoiceNumber: exactFinancialReadValue(record.sourcePublicId, 'sourcePublicId'),
      }, dependencies);
    case 'payment':
      return readPaymentForConsumer(db, {
        ...common,
        receiptNumber: exactFinancialReadValue(record.sourcePublicId, 'sourcePublicId'),
      }, dependencies);
    case 'deposit':
      return readDepositForConsumer(db, {
        ...common,
        depositNumber: exactFinancialReadValue(record.sourcePublicId, 'sourcePublicId'),
      }, dependencies);
  }
}

function assertCleanShadowResult(
  record: FinancialReadShadowBatchRecord,
  result: FinancialReadConsumerResult,
): FinancialReadShadowEvidence & { canonicalRowKey: string } {
  if (result.mode !== 'shadow' || result.selectedProvider !== 'legacy') {
    throw new FinancialReadShadowBatchError(
      'SHADOW_MODE_REQUIRED',
      `${record.provider}:${record.sourcePublicId} must run in shadow mode with legacy selected`,
    );
  }
  const evidence = result.shadowEvidence;
  if (!evidence) {
    throw new FinancialReadShadowBatchError(
      'SHADOW_EVIDENCE_MISSING',
      `${record.provider}:${record.sourcePublicId} did not produce shadow evidence`,
    );
  }
  if (evidence.canonicalRowKey == null) {
    throw new FinancialReadShadowBatchError(
      'MAPPING_REQUIRED',
      `${record.provider}:${record.sourcePublicId} has no exact Canonical row mapping`,
      [...evidence.varianceIds],
    );
  }
  if (!evidence.parity || evidence.criticalUnexplainedVarianceCount !== 0 || evidence.varianceIds.length !== 0) {
    throw new FinancialReadShadowBatchError(
      'UNEXPLAINED_VARIANCE',
      `${record.provider}:${record.sourcePublicId} produced unexplained shadow variance`,
      [...evidence.varianceIds],
    );
  }
  return { ...evidence, canonicalRowKey: evidence.canonicalRowKey };
}

export async function runFinancialReadShadowBatch(
  db: FinancialReadDatabase,
  input: FinancialReadShadowBatchInput,
  dependencies: FinancialReadConsumerDependencies = DEFAULT_DEPENDENCIES,
): Promise<FinancialReadShadowBatchResult> {
  const tenantId = exactFinancialReadValue(input.tenantId, 'tenantId');
  const observedAtUtc = financialReadUtcTimestamp(input.observedAtUtc, 'observedAtUtc');
  const buildSha = exactFinancialReadValue(input.buildSha, 'buildSha');
  const latencyBudgetMs = financialReadNonNegativeInteger(input.latencyBudgetMs, 'latencyBudgetMs');
  if (latencyBudgetMs <= 0) throw new RangeError('latencyBudgetMs must be positive');
  if (input.records.length === 0) {
    throw new FinancialReadShadowBatchError('EMPTY_BATCH', 'financial shadow batch requires at least one record');
  }
  if (input.records.length > 100) {
    throw new FinancialReadShadowBatchError('BATCH_LIMIT_EXCEEDED', 'financial shadow batch is limited to 100 records');
  }

  const scopes = new Set<string>();
  for (const record of input.records) {
    const scope = recordScope(record);
    if (scopes.has(scope)) {
      throw new FinancialReadShadowBatchError('DUPLICATE_SCOPE', `duplicate financial shadow scope ${scope}`);
    }
    scopes.add(scope);
  }

  const rows: FinancialReadShadowBatchRow[] = [];
  for (const record of input.records) {
    let result: FinancialReadConsumerResult;
    try {
      result = await executeShadowRecord(
        db,
        tenantId,
        observedAtUtc,
        latencyBudgetMs,
        buildSha,
        record,
        dependencies,
      );
    } catch (error) {
      if (error instanceof FinancialReadShadowBatchError) throw error;
      throw new FinancialReadShadowBatchError(
        'PROVIDER_FAILURE',
        `${record.provider}:${record.sourcePublicId} failed closed before shadow batch completion`,
        [],
        error,
      );
    }
    const evidence = assertCleanShadowResult(record, result);
    rows.push({
      provider: record.provider,
      consumerKind: record.consumerKind,
      consumerId: result.consumerId,
      sourcePublicId: exactFinancialReadValue(record.sourcePublicId, 'sourcePublicId'),
      sourceRowKey: evidence.sourceRowKey,
      canonicalRowKey: evidence.canonicalRowKey,
      elapsedMs: evidence.elapsedMs,
      latencyBudgetMs: evidence.latencyBudgetMs,
      varianceIds: [],
      rollbackMode: 'legacy',
    });
  }

  return {
    checkpoint: 'CDB-V1-040B',
    tenantId,
    buildSha,
    observedAtUtc,
    recordCount: rows.length,
    parity: true,
    varianceIds: [],
    rollbackMode: 'legacy',
    rows,
  };
}
