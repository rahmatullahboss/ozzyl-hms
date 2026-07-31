import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('reception due collection workflow source guards', () => {
  it('shows all open due invoices in collect payment instead of only today', () => {
    const source = readFileSync('web/src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('getBillOutstandingAmount(bill);');
    expect(source).toContain("!['paid', 'cancelled', 'refunded', 'draft'].includes");
    expect(source).toContain('buildReceptionDueCollectionDateParam(dueCollectionScope, dueCollectionDate)');
    expect(source).toContain('filterReceptionFlowRowsByQuery');
  });

  it('keeps IPD due discharge as an audited credit-pending workflow', () => {
    const source = readFileSync('web/src/components/reception/DischargeModal.tsx', 'utf8');

    expect(source).toContain("const [creditPanelOpen, setCreditPanelOpen] = useState(false);");
    expect(source).toContain("const [creditReason, setCreditReason] = useState('');");
    expect(source).toContain("const [expectedPaymentDate, setExpectedPaymentDate] = useState('');");
    expect(source).toContain('const [confirmCreditDischarge, setConfirmCreditDischarge] = useState(false);');
    expect(source).toContain("currentIpdPaidAmount = mode === 'settled' ? netPayable : 0");
    expect(source).toContain('paid_amount: currentIpdPaidAmount');
    expect(source).toContain('discharge_mode: mode');
    expect(source).toContain('idempotencyKey: dischargeIdempotencyKeys.current[mode]');
    expect(source).toContain("credit_reason: mode === 'credit_pending' ? creditReason.trim() : undefined");
    expect(source).toContain("expected_payment_date: mode === 'credit_pending' ? expectedPaymentDate : undefined");
    expect(source).toContain("confirm_credit_discharge: mode === 'credit_pending' ? confirmCreditDischarge : undefined");
    expect(source).toContain('Discharge with Due');
  });
});
