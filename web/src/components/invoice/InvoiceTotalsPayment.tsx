import type { CSSProperties, ReactNode } from 'react';
import { WalletCards } from 'lucide-react';
import type { InvoicePaymentLedgerEntry } from './types';

interface InvoiceTotalsPaymentProps {
  identifier: ReactNode;
  subtotal: number;
  discount: number;
  discountReason?: string | null;
  discountByName?: string | null;
  approvedByName?: string | null;
  tax: number;
  total: number;
  paid: number;
  depositAdjusted: number;
  outstanding: number;
  status: string;
  money: (amount: number) => string;
  paymentMethodLabel?: string | null;
  paymentLedger?: InvoicePaymentLedgerEntry[];
  formatLedgerDateTime?: (value: string) => string;
  labels: {
    paymentMethod: string;
    subtotal: string;
    discount: string;
    discountReason: string;
    discountReference: string;
    approvedBy: string;
    tax: string;
    totalAmount: string;
    paid: string;
    depositAdjusted: string;
    due: string;
    paidStatus: string;
    partialStatus: string;
    unpaidStatus: string;
    unpaidAmount: string;
    paymentHistory: string;
    paymentReceived: string;
    dischargeSettlement: string;
    ledgerDepositAdjusted: string;
    receipt: string;
  };
}

export default function InvoiceTotalsPayment({
  identifier,
  subtotal,
  discount,
  discountReason,
  discountByName,
  approvedByName,
  tax,
  total,
  paid,
  depositAdjusted,
  outstanding,
  status,
  money,
  paymentMethodLabel,
  paymentLedger,
  formatLedgerDateTime,
  labels,
}: InvoiceTotalsPaymentProps) {
  const isPaid = outstanding <= 0 && (status === 'paid' || paid >= total);
  const isPartial = outstanding > 0 && paid > 0;
  const statusTitle = isPaid
    ? labels.paidStatus
    : isPartial
      ? labels.partialStatus
      : labels.unpaidStatus;
  const hasLedger = Boolean(paymentLedger?.length);
  const formatEntryDate = (value: string) => {
    if (!value) return '';
    try {
      return formatLedgerDateTime?.(value) ?? value;
    } catch {
      return value;
    }
  };

  const financialsStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 52%)',
    gridTemplateAreas: '"payment totals"',
    alignItems: 'end',
    gap: '16px',
    marginTop: 'auto',
    paddingTop: '12px',
  };

  const paymentBoxStyle: CSSProperties = {
    gridArea: 'payment',
    width: '100%',
    maxWidth: '100%',
    minHeight: '58px',
    alignSelf: 'end',
    flexWrap: 'wrap',
  };

  const totalsBoxStyle: CSSProperties = {
    gridArea: 'totals',
    width: '100%',
    margin: 0,
    alignSelf: 'end',
  };

  return (
    <section className="invoice-financials" style={financialsStyle}>
      <div className={`invoice-payment-compact ${hasLedger ? 'has-ledger ' : ''}${isPaid ? 'is-paid' : isPartial ? 'is-partial' : 'is-due'}`} style={paymentBoxStyle}>
        {hasLedger ? (
          <div className="invoice-payment-ledger" data-testid="invoice-payment-ledger">
            <div className="invoice-payment-ledger-header">
              <div>
                <WalletCards aria-hidden="true" />
                <strong>{labels.paymentHistory}</strong>
              </div>
              <span className="invoice-payment-ledger-status">{statusTitle}</span>
            </div>

            <div className="invoice-payment-ledger-list">
              {paymentLedger!.map((entry) => {
                const entryLabel = entry.kind === 'deposit'
                  ? labels.ledgerDepositAdjusted
                  : entry.isDischargeSettlement
                    ? labels.dischargeSettlement
                    : labels.paymentReceived;
                const metadata = [
                  formatEntryDate(entry.createdAt),
                  entry.paymentMethod,
                  entry.reference ? `${labels.receipt}: ${entry.reference}` : null,
                ].filter(Boolean);

                return (
                  <div className="invoice-payment-ledger-row" key={entry.id}>
                    <div className="invoice-payment-ledger-description">
                      <strong>{entryLabel}</strong>
                      {metadata.length > 0 && <span>{metadata.join(' · ')}</span>}
                    </div>
                    <strong className="invoice-payment-ledger-amount">{money(entry.amount)}</strong>
                  </div>
                );
              })}
            </div>

            <div className="invoice-large-identifier">{identifier}</div>
          </div>
        ) : (
          <>
            <div className="invoice-payment-compact-status">
              <WalletCards aria-hidden="true" />
              <strong>{statusTitle}</strong>
            </div>
            {paymentMethodLabel && (
              <div><span>{labels.paymentMethod}</span><strong>{paymentMethodLabel}</strong></div>
            )}
            {outstanding > 0 && (
              <div className="invoice-payment-compact-due">
                <span>{labels.unpaidAmount}</span>
                <strong>{money(outstanding)}</strong>
              </div>
            )}
            <div className="invoice-large-identifier">{identifier}</div>
          </>
        )}
      </div>

      <div className="invoice-totals" style={totalsBoxStyle}>
        <div className="invoice-subtotal-row"><span>{labels.subtotal}</span><strong>{money(subtotal)}</strong></div>
        {discount > 0 && <div><span>{labels.discount}</span><strong>- {money(discount)}</strong></div>}
        {discount > 0 && discountReason && <div className="invoice-subrow"><span>{labels.discountReason}</span><strong>{discountReason}</strong></div>}
        {discount > 0 && discountByName && <div className="invoice-subrow"><span>{labels.discountReference}</span><strong>{discountByName}</strong></div>}
        {discount > 0 && approvedByName && <div className="invoice-subrow"><span>{labels.approvedBy}</span><strong>{approvedByName}</strong></div>}
        {tax > 0 && <div><span>{labels.tax}</span><strong>{money(tax)}</strong></div>}
        <div className="invoice-grand-total"><span>{labels.totalAmount}</span><strong>{money(total)}</strong></div>
        <div><span>{labels.paid}</span><strong>{money(paid)}</strong></div>
        {depositAdjusted > 0 && <div><span>{labels.depositAdjusted}</span><strong>{money(depositAdjusted)}</strong></div>}
        {outstanding > 0 && <div className="invoice-due-total"><span>{labels.due}</span><strong>{money(outstanding)}</strong></div>}
      </div>
    </section>
  );
}
