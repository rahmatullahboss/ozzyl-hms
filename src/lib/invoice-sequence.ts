import { getNextSequence } from './sequence';

export type InvoiceSeriesKind = 'appointment' | 'diagnostic' | 'ipd' | 'pharmacy' | 'generic';

const SERIES_CODES: Record<InvoiceSeriesKind, string> = {
  appointment: 'A',
  diagnostic: 'D',
  ipd: 'I',
  pharmacy: 'PH',
  generic: 'G',
};

export interface BillSeriesSignals {
  testBill?: number | null;
  doctorVisitBill?: number | null;
  admissionBill?: number | null;
  operationBill?: number | null;
  medicineBill?: number | null;
}

function invoiceYear(issuedAt = new Date()): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
  }).format(issuedAt);
  return Number(formatted);
}

function hasAmount(value: number | null | undefined): boolean {
  return Number(value ?? 0) > 0;
}

export function resolveBillInvoiceSeries(signals: BillSeriesSignals): InvoiceSeriesKind {
  const hasTest = hasAmount(signals.testBill);
  const hasDoctorVisit = hasAmount(signals.doctorVisitBill);
  const hasAdmission = hasAmount(signals.admissionBill);
  const hasOperation = hasAmount(signals.operationBill);
  const hasMedicine = hasAmount(signals.medicineBill);
  const hasIpd = hasAdmission || hasOperation;

  if (hasIpd) return 'ipd';
  if (hasTest && !hasDoctorVisit && !hasMedicine) return 'diagnostic';
  if (hasDoctorVisit && !hasTest && !hasMedicine) return 'appointment';
  if (hasMedicine && !hasTest && !hasDoctorVisit) return 'pharmacy';
  return 'generic';
}

export function getInvoiceSeriesConfig(kind: InvoiceSeriesKind, issuedAt = new Date()) {
  const year = invoiceYear(issuedAt);
  return {
    counterType: `invoice_${kind}_${year}`,
    prefix: `INV-${SERIES_CODES[kind]}-${year}`,
  };
}

export async function getNextInvoiceNumber(
  db: D1Database,
  tenantId: string,
  kind: InvoiceSeriesKind,
  issuedAt = new Date(),
): Promise<string> {
  const config = getInvoiceSeriesConfig(kind, issuedAt);
  return getNextSequence(db, tenantId, config.counterType, config.prefix);
}

export async function getNextBillInvoiceNumber(
  db: D1Database,
  tenantId: string,
  signals: BillSeriesSignals,
  issuedAt = new Date(),
): Promise<string> {
  return getNextInvoiceNumber(db, tenantId, resolveBillInvoiceSeries(signals), issuedAt);
}
