import type { D1Database } from '@cloudflare/workers-types';
import { calculateAdmissionPackageBilling, loadBedChargePolicy } from './bed-charges';

export type IpdSettledBill = {
  id: number;
  invoice_no: string | null;
  created_at: string | null;
  total: number;
  paid: number;
  deposit_deducted: number;
  due: number;
  status: string | null;
};

export type IpdAdmissionBillingSnapshot = {
  admissionId: number;
  patientId: number;
  items: Record<string, unknown>[];
  bedCharges: {
    segments: Record<string, unknown>[];
    bed_total: number;
  };
  settledBills: IpdSettledBill[];
  summary: {
    admission_id: number;
    patient_id: number;
    provisional_total: number;
    package_total: number;
    bed_total: number;
    running_total: number;
    grand_total: number;
    settled_total: number;
    settled_cash_paid: number;
    settled_deposit_used: number;
    deposit_total: number;
    deposit_used: number;
    deposit_refunded: number;
    deposit_balance: number;
    net_payable: number;
    refund_available: number;
    current_balance: number;
  };
};

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

export async function loadIpdAdmissionBillingSnapshot(
  db: D1Database,
  tenantId: string,
  admissionId: number,
): Promise<IpdAdmissionBillingSnapshot | null> {
  const admission = await db.prepare(
    'SELECT id, patient_id, package_id FROM admissions WHERE id = ? AND tenant_id = ? LIMIT 1',
  ).bind(admissionId, tenantId).first<{ id: number; patient_id: number; package_id: number | null }>();

  if (!admission?.patient_id) return null;

  const [{ results: items }, { results: bedInfos }, deposit, { results: settledBills }, packageInfo] = await Promise.all([
    db.prepare(`
      SELECT *
      FROM billing_provisional_items
      WHERE tenant_id = ?
        AND admission_id = ?
        AND bill_status = 'provisional'
        AND is_active = 1
      ORDER BY created_at ASC
    `).bind(tenantId, admissionId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT *
      FROM patient_bed_infos
      WHERE tenant_id = ?
        AND admission_id = ?
        AND is_billed = 0
      ORDER BY started_on ASC
    `).bind(tenantId, admissionId).all<Record<string, unknown>>(),
    db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) as total_deposits,
        COALESCE(SUM(CASE WHEN transaction_type = 'refund' THEN amount ELSE 0 END), 0) as total_refunds,
        COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0) as total_adjustments
      FROM billing_deposits
      WHERE tenant_id = ?
        AND patient_id = ?
        AND is_active = 1
    `).bind(tenantId, admission.patient_id).first<{ total_deposits: number; total_refunds: number; total_adjustments: number }>(),
    db.prepare(`
      SELECT
        b.id,
        b.invoice_no,
        b.created_at,
        COALESCE(b.total, 0) as total,
        COALESCE(b.paid, 0) as paid,
        COALESCE(b.due, 0) as due,
        b.status,
        COALESCE((
          SELECT SUM(d.amount)
          FROM billing_deposits d
          WHERE d.tenant_id = b.tenant_id
            AND d.reference_bill_id = b.id
            AND d.transaction_type = 'adjustment'
            AND d.is_active = 1
        ), 0) as deposit_deducted
      FROM bills b
      WHERE b.tenant_id = ?
        AND COALESCE(b.status, '') != 'cancelled'
        AND (
          EXISTS (
            SELECT 1
            FROM billing_provisional_items pi
            WHERE pi.tenant_id = b.tenant_id
              AND pi.admission_id = ?
              AND pi.billed_bill_id = b.id
              AND pi.bill_status IN ('finalized', 'billed')
              AND pi.is_active = 1
          )
          OR EXISTS (
            SELECT 1
            FROM patient_bed_infos pbi
            WHERE pbi.tenant_id = b.tenant_id
              AND pbi.admission_id = ?
              AND pbi.billed_bill_id = b.id
              AND pbi.is_billed = 1
          )
        )
      ORDER BY b.created_at DESC, b.id DESC
    `).bind(tenantId, admissionId, admissionId).all<IpdSettledBill>(),
    admission.package_id
      ? db.prepare(`
        SELECT id, total_price, included_bed_days, extra_bed_rate, package_type
        FROM billing_packages
        WHERE id = ? AND tenant_id = ?
      `).bind(admission.package_id, tenantId).first<{
        id: number;
        total_price: number;
        included_bed_days: number;
        extra_bed_rate: number;
        package_type: string;
      }>()
      : Promise.resolve(null),
  ]);

  const provisionalTotal = roundMoney(items.reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0));
  const bedChargePolicy = await loadBedChargePolicy(db, tenantId);
  const admissionBilling = calculateAdmissionPackageBilling({
    packageInfo: packageInfo ? {
      totalPrice: Number(packageInfo.total_price ?? 0),
      packageType: packageInfo.package_type,
      includedBedDays: Number(packageInfo.included_bed_days ?? 0),
      extraBedRate: Number(packageInfo.extra_bed_rate ?? 0),
    } : null,
    provisionalTotal,
    bedChargePolicy,
    beds: bedInfos.map((bed) => ({
      id: bed.id as number | string | null,
      ratePerDay: Number(bed.rate_per_day || 0),
      startedOn: String(bed.started_on ?? ''),
      endedOn: bed.ended_on ? String(bed.ended_on) : undefined,
      data: bed,
    })),
  });
  const bedTotal = roundMoney(admissionBilling.bedTotal);
  const packageTotal = roundMoney(admissionBilling.packageTotal);
  const runningTotal = roundMoney(admissionBilling.grandTotal);
  const depositTotal = roundMoney(Number(deposit?.total_deposits ?? 0));
  const depositRefunded = roundMoney(Number(deposit?.total_refunds ?? 0));
  const depositUsed = roundMoney(Number(deposit?.total_adjustments ?? 0));
  const depositBalance = roundMoney(depositTotal - depositRefunded - depositUsed);
  const settledTotal = roundMoney(settledBills.reduce((sum, bill) => sum + Number(bill.total ?? 0), 0));
  const settledCashPaid = roundMoney(settledBills.reduce((sum, bill) => sum + Number(bill.paid ?? 0), 0));
  const settledDepositUsed = roundMoney(settledBills.reduce((sum, bill) => sum + Number(bill.deposit_deducted ?? 0), 0));
  const currentBalance = roundMoney(depositBalance - runningTotal);

  return {
    admissionId,
    patientId: Number(admission.patient_id),
    items,
    bedCharges: {
      segments: admissionBilling.bedChargeSegments,
      bed_total: bedTotal,
    },
    settledBills,
    summary: {
      admission_id: admissionId,
      patient_id: Number(admission.patient_id),
      provisional_total: provisionalTotal,
      package_total: packageTotal,
      bed_total: bedTotal,
      running_total: runningTotal,
      grand_total: runningTotal,
      settled_total: settledTotal,
      settled_cash_paid: settledCashPaid,
      settled_deposit_used: settledDepositUsed,
      deposit_total: depositTotal,
      deposit_used: depositUsed,
      deposit_refunded: depositRefunded,
      deposit_balance: depositBalance,
      net_payable: Math.max(0, -currentBalance),
      refund_available: Math.max(0, currentBalance),
      current_balance: currentBalance,
    },
  };
}
