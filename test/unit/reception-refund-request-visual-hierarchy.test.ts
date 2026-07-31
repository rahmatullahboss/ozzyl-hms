import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'web/src/components/reception/ReceptionPatientDrawer.tsx'),
  'utf8',
);

describe('reception refund request visual hierarchy', () => {
  it('renders three accessible, visually distinct refund mode cards', () => {
    expect(source).toContain('<RefundModeCard');
    expect(source).toContain('mode="full"');
    expect(source).toContain('mode="partial"');
    expect(source).toContain('mode="amount"');
    expect(source).toContain('data-refund-mode={mode}');
    expect(source).toContain('aria-pressed={selected}');
    expect(source).toContain("tone=\"amber\"");
    expect(source).toContain("tone=\"blue\"");
    expect(source).toContain("tone=\"violet\"");
    expect(source).toContain('sm:grid-cols-3');
  });

  it('shows differentiated cash metrics and keeps contextual controls', () => {
    expect(source).toContain('metric="expected"');
    expect(source).toContain('metric="held"');
    expect(source).toContain('metric="available"');
    expect(source).toContain('data-cash-metric={metric}');
    expect(source).toContain("tone=\"emerald\"");
    expect(source).toContain("refundMode === 'amount'");
    expect(source).toContain("refundMode !== 'amount'");
    expect(source).toContain('manual-refund-amount');
  });

  it('explains the payment void consequence before submission', () => {
    expect(source).toContain('patientDrawer.paymentVoidConsequence');
    expect(source).toContain("actionMode === 'paymentCorrectionRequest'");
    expect(source).toContain('reconciles affected commission and financial records');
  });
});
