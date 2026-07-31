import type {
  FinancialReconciliationEnvelope,
  ReconciliationResult,
} from '../../../packages/shared/src/dashboard';
import { getDb } from '../../db';
import { buildFinancialReconciliation } from '../../lib/dashboard/reconciliation';
import type { Env } from '../../types';

export interface FinancialBreakdownSource {
  label: string;
  amount: number;
  count: number;
  direction?: 'in' | 'out';
}

export interface FinancialBreakdown {
  total: number;
  totalRows: number;
  sources: FinancialBreakdownSource[];
  rows: unknown[];
}

export interface FinancialCollectionSplit {
  currentInvoiceCollection: number;
  priorDueCollection: number;
  totalCollection: number;
  nonCashCollection: number;
  transactionCount: number;
}

export interface DoctorLiabilityTotals {
  earned: number;
  waiver: number;
  payable: number;
  paid: number;
  outstanding: number;
  rowCount: number;
  providerMode?: ReconciliationResult['providerMode'];
}

export interface FinancialControlSourceLoaders {
  recognizedIncome: () => Promise<FinancialBreakdown>;
  approvedExpensePaid: () => Promise<FinancialBreakdown>;
  operatingResult: () => Promise<FinancialBreakdown>;
  depositReceipts: () => Promise<FinancialBreakdown>;
  collectionSplit: () => Promise<FinancialCollectionSplit>;
  cashMovement: () => Promise<FinancialBreakdown>;
  drawerCash: () => Promise<FinancialBreakdown>;
  doctorLiability: () => Promise<DoctorLiabilityTotals>;
}

export interface FinancialControlPeriod {
  startDate: string;
  endDate: string;
  label: string;
}

export interface FinancialControlResponse {
  reportKey: 'admin_financial_control';
  reportVersion: '1.0.0';
  generatedAt: string;
  timezone: 'Asia/Dhaka';
  currencyCode: 'BDT';
  moneyUnit: 'major';
  period: FinancialControlPeriod;
  businessPerformance: {
    recognizedIncome: number;
    approvedExpensePaid: number;
    operatingResult: number;
    depositReceipts: number;
    depositTreatment: 'liability_not_revenue';
    reconciliation: FinancialReconciliationEnvelope;
  };
  collectionFlow: {
    currentInvoiceCollection: number;
    priorDueCollection: number;
    totalCollection: number;
    depositReceipts: number;
    depositIncludedInTotalCollection: false;
    transactionCount: number;
    reconciliation: FinancialReconciliationEnvelope;
  };
  cashCustody: {
    physicalCashIn: number;
    physicalCashOut: number;
    netCashMovement: number;
    nonCashCollection: number;
    currentDrawerBalance: number;
    currentDrawerTemporalMode: 'current_state';
    reconciliation: FinancialReconciliationEnvelope;
  };
  doctorLiability: DoctorLiabilityTotals & {
    reconciliation: FinancialReconciliationEnvelope;
  };
}

export interface AssembleFinancialControlInput {
  period: FinancialControlPeriod;
  generatedAt?: string;
  loaders: FinancialControlSourceLoaders;
}

function roundMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

export async function assembleFinancialControl(
  input: AssembleFinancialControlInput,
): Promise<FinancialControlResponse> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const [income, expense, result, deposits, collection, cash, drawer, doctor] = await Promise.all([
    input.loaders.recognizedIncome(),
    input.loaders.approvedExpensePaid(),
    input.loaders.operatingResult(),
    input.loaders.depositReceipts(),
    input.loaders.collectionSplit(),
    input.loaders.cashMovement(),
    input.loaders.drawerCash(),
    input.loaders.doctorLiability(),
  ]);

  const recognizedIncome = roundMoney(income.total);
  const approvedExpensePaid = roundMoney(expense.total);
  const operatingResult = roundMoney(result.total);
  const depositReceipts = roundMoney(deposits.total);
  const currentInvoiceCollection = roundMoney(collection.currentInvoiceCollection);
  const priorDueCollection = roundMoney(collection.priorDueCollection);
  const totalCollection = roundMoney(collection.totalCollection);
  const nonCashCollection = roundMoney(collection.nonCashCollection);
  const positiveCash = cash.sources
    .filter((source) => source.direction !== 'out' && Number(source.amount) > 0)
    .reduce((sum, source) => sum + Number(source.amount), 0);
  const negativeCash = cash.sources
    .filter((source) => source.direction === 'out' || Number(source.amount) < 0)
    .reduce((sum, source) => sum + Math.abs(Number(source.amount)), 0);
  const physicalCashIn = roundMoney(positiveCash);
  const physicalCashOut = roundMoney(negativeCash);
  const netCashMovement = roundMoney(cash.total);
  const currentDrawerBalance = roundMoney(drawer.total);
  const earned = roundMoney(doctor.earned);
  const waiver = roundMoney(doctor.waiver);
  const payable = roundMoney(doctor.payable);
  const paid = roundMoney(doctor.paid);
  const outstanding = roundMoney(doctor.outstanding);
  const doctorWarnings: string[] = [];
  if (Math.abs((earned - waiver) - payable) >= 0.01) {
    doctorWarnings.push('Earned commission less waiver does not equal payable commission.');
  }

  return {
    reportKey: 'admin_financial_control',
    reportVersion: '1.0.0',
    generatedAt,
    timezone: 'Asia/Dhaka',
    currencyCode: 'BDT',
    moneyUnit: 'major',
    period: input.period,
    businessPerformance: {
      recognizedIncome,
      approvedExpensePaid,
      operatingResult,
      depositReceipts,
      depositTreatment: 'liability_not_revenue',
      reconciliation: buildFinancialReconciliation({
        summaryTotal: operatingResult,
        detailTotal: roundMoney(recognizedIncome - approvedExpensePaid),
        detailRowCount: Math.max(0, Number(income.totalRows) + Number(expense.totalRows)),
        detailGrain: 'recognized income sources minus paid expense sources',
        checkedAt: generatedAt,
        providerMode: 'legacy',
      }),
    },
    collectionFlow: {
      currentInvoiceCollection,
      priorDueCollection,
      totalCollection,
      depositReceipts,
      depositIncludedInTotalCollection: false,
      transactionCount: Math.max(0, Math.trunc(Number(collection.transactionCount) || 0)),
      reconciliation: buildFinancialReconciliation({
        summaryTotal: totalCollection,
        detailTotal: roundMoney(currentInvoiceCollection + priorDueCollection),
        detailRowCount: Math.max(0, Math.trunc(Number(collection.transactionCount) || 0)),
        detailGrain: 'one operational payment grouped by current invoice or prior due',
        checkedAt: generatedAt,
        providerMode: 'legacy',
      }),
    },
    cashCustody: {
      physicalCashIn,
      physicalCashOut,
      netCashMovement,
      nonCashCollection,
      currentDrawerBalance,
      currentDrawerTemporalMode: 'current_state',
      reconciliation: buildFinancialReconciliation({
        summaryTotal: netCashMovement,
        detailTotal: roundMoney(physicalCashIn - physicalCashOut),
        detailRowCount: Math.max(0, Math.trunc(Number(cash.totalRows) || 0)),
        detailGrain: 'one physical cash movement source',
        checkedAt: generatedAt,
        providerMode: 'legacy',
      }),
    },
    doctorLiability: {
      earned,
      waiver,
      payable,
      paid,
      outstanding,
      rowCount: Math.max(0, Math.trunc(Number(doctor.rowCount) || 0)),
      providerMode: doctor.providerMode,
      reconciliation: buildFinancialReconciliation({
        summaryTotal: outstanding,
        detailTotal: roundMoney(payable - paid),
        detailRowCount: Math.max(0, Math.trunc(Number(doctor.rowCount) || 0)),
        detailGrain: 'one doctor compensation balance',
        checkedAt: generatedAt,
        providerMode: doctor.providerMode,
        warnings: doctorWarnings,
      }),
    },
  };
}

function localReportDate(expression: string): string {
  return `CASE
    WHEN ${expression} IS NULL THEN NULL
    WHEN ${expression} LIKE '%Z' OR ${expression} LIKE '%+00:00' OR ${expression} LIKE '%-00:00'
      THEN date(${expression}, '+6 hours')
    ELSE date(${expression})
  END`;
}

export async function loadFinancialCollectionSplit(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  startDate: string;
  endDate: string;
}): Promise<FinancialCollectionSplit> {
  const db = getDb(args.dbBinding);
  const row = await db.$client.prepare(`
    SELECT
      ROUND(COALESCE(SUM(CASE
        WHEN COALESCE(p.payment_type, 'current') = 'due'
          OR (b.id IS NOT NULL AND ${localReportDate('b.created_at')} < date(?))
        THEN 0 ELSE p.amount END), 0), 2) AS current_invoice_collection,
      ROUND(COALESCE(SUM(CASE
        WHEN COALESCE(p.payment_type, 'current') = 'due'
          OR (b.id IS NOT NULL AND ${localReportDate('b.created_at')} < date(?))
        THEN p.amount ELSE 0 END), 0), 2) AS prior_due_collection,
      ROUND(COALESCE(SUM(p.amount), 0), 2) AS total_collection,
      ROUND(COALESCE(SUM(CASE
        WHEN LOWER(TRIM(COALESCE(p.payment_method, 'cash'))) = 'cash' THEN 0 ELSE p.amount END
      ), 0), 2) AS non_cash_collection,
      COUNT(*) AS transaction_count
    FROM payments p
    LEFT JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
    WHERE p.tenant_id = ?
      AND ${localReportDate('COALESCE(p.date, p.created_at)')} >= date(?)
      AND ${localReportDate('COALESCE(p.date, p.created_at)')} <= date(?)
  `).bind(args.startDate, args.startDate, args.tenantId, args.startDate, args.endDate)
    .first<Record<string, unknown>>();

  return {
    currentInvoiceCollection: roundMoney(row?.current_invoice_collection),
    priorDueCollection: roundMoney(row?.prior_due_collection),
    totalCollection: roundMoney(row?.total_collection),
    nonCashCollection: roundMoney(row?.non_cash_collection),
    transactionCount: Math.max(0, Math.trunc(Number(row?.transaction_count ?? 0))),
  };
}
