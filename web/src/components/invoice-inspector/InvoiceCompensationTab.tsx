import CommissionCalculationBridge from '../dashboard/CommissionCalculationBridge';
import type { DoctorCommissionDetailRow } from '../../types/executiveDashboard';
import type { InvoiceInspectorCompensation } from '../../types/invoiceInspector';

function bridgeRow(row: InvoiceInspectorCompensation, index: number): DoctorCommissionDetailRow {
  return {
    id: typeof row.id === 'number' ? row.id : index + 1,
    billId: null,
    occurredAt: 'Invoice compensation',
    sourceType: row.sourceType,
    incentiveType: row.incentiveType ?? null,
    doctorName: row.doctorName ?? 'Doctor not recorded',
    detailName: row.doctorName ?? 'Doctor compensation',
    referenceNo: row.settlementNo ?? null,
    grossAmount: row.grossAmount,
    discountAmount: row.discountAmount,
    netBilledAmount: Math.max(0, row.grossAmount - row.discountAmount),
    performerReserveAmount: row.performerReserveAmount,
    commissionBaseAmount: row.eligibleBaseAmount,
    rateLabel: row.rateLabel ?? null,
    commissionRuleId: row.ruleId ?? null,
    commissionRuleVersion: row.ruleVersion ?? null,
    earnedAmount: row.earnedAmount,
    waiverAmount: row.waiverAmount,
    adjustmentAmount: row.adjustmentAmount,
    payableAmount: row.payableAmount,
    paidAmount: row.paidAmount,
    outstandingAmount: row.outstandingAmount,
    settlementNo: row.settlementNo ?? null,
    waiverReason: null,
    reasonCode: row.reasonCode as DoctorCommissionDetailRow['reasonCode'],
    reasonLabel: row.reasonLabel ?? undefined,
    amount: row.payableAmount,
    status: row.status,
  };
}

export default function InvoiceCompensationTab({ compensation }: { compensation: InvoiceInspectorCompensation[] }) {
  if (compensation.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">No doctor compensation rows were found.</p>;
  return <div className="space-y-3">{compensation.map((row, index) => <CommissionCalculationBridge key={row.id} row={bridgeRow(row, index)} />)}</div>;
}
