import type { InvoicePaymentLedgerEntry } from '../../components/invoice/types';

interface PaymentLedgerSource {
  id: number | string;
  amount: number;
  receipt_no?: string | null;
  payment_method?: string | null;
  date?: string | null;
  created_at?: string | null;
}

interface DepositAllocationLedgerSource {
  id: number | string;
  amount: number;
  deposit_receipt_no?: string | null;
  payment_method?: string | null;
  deposited_at?: string | null;
}

interface BuildInvoicePaymentLedgerInput {
  payments: ReadonlyArray<PaymentLedgerSource>;
  depositAllocations: ReadonlyArray<DepositAllocationLedgerSource>;
  isFullySettled: boolean;
}

function isPositiveFiniteAmount(value: unknown): boolean {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
}

function normalizeTimestamp(value: string | null | undefined, naiveZone: 'utc' | 'dhaka'): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';

  const normalized = trimmed.replace(' ', 'T');
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) return normalized;

  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? `${normalized}T00:00:00`
    : normalized;
  return `${withTime}${naiveZone === 'utc' ? 'Z' : '+06:00'}`;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function formatInvoiceLedgerDateTime(value: string, locale = 'en-GB'): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const datePart = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Dhaka',
  }).format(parsed);
  const timePart = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Dhaka',
  }).format(parsed);

  return `${datePart}, ${timePart}`;
}

export function buildInvoicePaymentLedger({
  payments,
  depositAllocations,
  isFullySettled,
}: BuildInvoicePaymentLedgerInput): InvoicePaymentLedgerEntry[] {
  const entries: InvoicePaymentLedgerEntry[] = [
    ...depositAllocations
      .filter((entry) => isPositiveFiniteAmount(entry.amount))
      .map((entry) => ({
        id: `deposit-${entry.id}`,
        kind: 'deposit' as const,
        amount: Number(entry.amount),
        paymentMethod: entry.payment_method ?? null,
        reference: entry.deposit_receipt_no ?? null,
        createdAt: normalizeTimestamp(entry.deposited_at, 'utc'),
        isDischargeSettlement: false,
      })),
    ...payments
      .filter((entry) => isPositiveFiniteAmount(entry.amount))
      .map((entry) => ({
        id: `payment-${entry.id}`,
        kind: 'payment' as const,
        amount: Number(entry.amount),
        paymentMethod: entry.payment_method ?? null,
        reference: entry.receipt_no ?? null,
        createdAt: entry.date
          ? normalizeTimestamp(entry.date, 'dhaka')
          : normalizeTimestamp(entry.created_at, 'utc'),
        isDischargeSettlement: false,
      })),
  ].sort((left, right) => {
    const timeDifference = timestamp(left.createdAt) - timestamp(right.createdAt);
    return timeDifference || left.id.localeCompare(right.id, undefined, { numeric: true });
  });

  if (isFullySettled) {
    const latestPayment = [...entries].reverse().find((entry) => entry.kind === 'payment');
    if (latestPayment) latestPayment.isDischargeSettlement = true;
  }

  return entries;
}
