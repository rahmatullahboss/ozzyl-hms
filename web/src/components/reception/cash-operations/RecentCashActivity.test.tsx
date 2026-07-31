import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import RecentCashActivity, { buildCashActivityReportHtml, buildPrintableRows, formatReportDescription, formatReportReference, formatReportTime } from './RecentCashActivity';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('RecentCashActivity', () => {
  it('keeps report row time at stored local wall-clock time', () => {
    expect(formatReportTime('2026-06-24 15:22:15')).toBe('3:22 PM');
    expect(formatReportTime('2026-06-24T22:23:36')).toBe('10:23 PM');
  });

  it('uses invoice number instead of receipt number in printable patient payment rows', () => {
    const row = {
      id: 'transaction-171',
      source: 'transaction',
      createdAt: '2026-06-22 09:31:00',
      actorName: 'Cashier',
      movementType: 'cash_in',
      referenceType: 'bill',
      referenceId: 171,
      invoiceNo: 'INV-000171',
      referenceNo: 'INV-000171',
      amount: 1200,
      description: 'Billing counter payment RCP-000171',
    };

    expect(formatReportReference(row)).toBe('INV-000171');
    expect(formatReportDescription(row)).toBe('Test');
  });

  it('shows cash custody transfer details and standardized 12-hour timestamp', () => {
    render(
      <RecentCashActivity
        activity={[
          {
            id: 'movement-21',
            source: 'movement',
            createdAt: '2026-06-19 22:23:36',
            actorName: 'Safaoat Ullah',
            movementType: 'cash_drop',
            referenceType: 'cash_custody_transfer',
            referenceId: 2,
            amount: 18450,
            description: 'Drawer custody to Dr. Nazmus Sakib',
            transferNo: 'CCT-8-c1a1eef7-4f45-487d-a586-9e14cf8d7f4a',
            transferStatus: 'pending',
            transferByName: 'Safaoat Ullah',
            transferToName: 'Dr. Nazmus Sakib',
            custodyLabel: 'Dr. Nazmus Sakib (hospital_admin)',
            dueAmount: 18450,
            receivedAmount: 0,
          },
        ]}
      />,
    );

    expect(screen.getByText(/Drawer custody to Dr\. Nazmus Sakib/)).toBeInTheDocument();
    expect(screen.getByText(/Cash Transfer · 19-06-2026, 10:23 PM/)).toBeInTheDocument();
    expect(screen.getByText(/Transfer CCT-8-c1a1eef7-4f45-487d-a586-9e14cf8d7f4a/)).toBeInTheDocument();
    expect(screen.getByText(/Status: pending/)).toBeInTheDocument();
    expect(screen.getByText(/From Safaoat Ullah to Dr\. Nazmus Sakib/)).toBeInTheDocument();
    expect(screen.getByText(/Due ৳18,450\.00/)).toBeInTheDocument();
  });


  it('does not count counter opening cash as Cash In in printable statements', () => {
    const rows = buildPrintableRows([
      {
        id: 'counter_session-10',
        source: 'counter_session',
        createdAt: '2026-06-22 08:00:00',
        actorName: 'Cashier',
        movementType: 'cash_in',
        referenceType: 'counter_opening',
        referenceId: 10,
        amount: 5850,
        description: 'Reception opening cash',
      },
      {
        id: 'transaction-1',
        source: 'transaction',
        createdAt: '2026-06-22 09:00:00',
        actorName: 'Cashier',
        movementType: 'cash_in',
        referenceType: 'bill',
        referenceId: 1,
        amount: 40000,
        description: 'Patient collection',
      },
    ], 5850);

    expect(rows[0]).toMatchObject({ typeLabel: 'Opening Cash', cashIn: 0, cashOut: 0, runningBalance: 5850 });
    expect(rows[1]).toMatchObject({ cashIn: 40000, runningBalance: 45850 });

    const html = buildCashActivityReportHtml({
      rows,
      allRows: rows,
      hospitalName: 'Demo Hospital',
      generatedBy: 'Cashier',
      scope: 'all',
      from: '2026-06-22',
      to: '2026-06-22',
      includeSummary: true,
      includeRunningBalance: true,
      includeSignatures: false,
      orientation: 'portrait',
      pageSize: 'a5',
      periodOpeningBalance: 5850,
    });

    expect(html).toContain('Opening Cash');
    expect(html).toContain('৳5,850.00');
    expect(html).toContain('৳40,000.00');
    expect(html).not.toContain('<span>Cash In</span><strong class="in">৳45,850.00</strong>');
  });


  it('uses a scoped net summary for doctor payout print statements', () => {
    const html = buildCashActivityReportHtml({
      rows: [
        {
          id: 'movement-9',
          source: 'movement',
          createdAt: '2026-06-22 10:00:00',
          actorName: 'Cashier',
          movementType: 'cash_out',
          referenceType: 'doctor_commission_settlement',
          referenceId: 9,
          amount: 500,
          description: 'Doctor payout',
          category: 'doctorPayouts',
          typeLabel: 'Doctor Payout',
          cashIn: 0,
          cashOut: 500,
          runningBalance: 1500,
        },
      ],
      allRows: [],
      hospitalName: 'Demo Hospital',
      generatedBy: 'Cashier',
      scope: 'doctorPayouts',
      from: '2026-06-22',
      to: '2026-06-22',
      includeSummary: true,
      includeRunningBalance: true,
      includeSignatures: false,
      orientation: 'portrait',
      pageSize: 'a5',
      periodOpeningBalance: 2000,
    });

    expect(html).toContain('Net Amount');
    expect(html).not.toContain('Opening Cash');
    expect(html).not.toContain('Closing Balance');
  });

});
