import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import KpiBreakdownDrawer, { type KpiBreakdownData, type KpiBreakdownRow } from './KpiBreakdownDrawer';

const labels = {
  close: 'Close source breakdown',
  sources: 'Sources',
  details: 'Details',
  noRows: 'No source rows found',
};

function renderDrawer(rows: KpiBreakdownRow[], onRowClick = vi.fn()) {
  const data: KpiBreakdownData = {
    metric: 'total_discount',
    title: 'Discount given',
    total: 3500,
    period: { startDate: '2026-06-25', endDate: '2026-06-25', label: '2026-06-25' },
    sources: [{ label: 'Safaoat Ullah', amount: 3500, count: 1 }],
    rows,
  };

  render(
    <KpiBreakdownDrawer
      title="Discount given source breakdown"
      data={data}
      labels={labels}
      onClose={() => {}}
      onRowClick={onRowClick}
    />,
  );

  return onRowClick;
}

describe('KpiBreakdownDrawer', () => {
  it('moves focus inside, locks background scrolling, and closes with Escape', () => {
    const onClose = vi.fn();
    const data: KpiBreakdownData = {
      metric: 'total_discount',
      title: 'Discount given',
      total: 0,
      period: { startDate: '2026-06-25', endDate: '2026-06-25', label: '2026-06-25' },
      sources: [],
      rows: [],
    };

    render(
      <KpiBreakdownDrawer
        title="Discount given source breakdown"
        data={data}
        labels={labels}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('button', { name: 'Close source breakdown' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders Bangladesh-local stored timestamps without adding another timezone offset', () => {
    renderDrawer([
      {
        id: 'discount-1',
        occurredAt: '2026-06-25 03:02:00',
        sourceType: 'discount',
        sourceLabel: 'manual discount',
        referenceNo: 'BILL-5573',
        amount: 3500,
        status: 'applied',
      },
    ]);

    expect(screen.getByText(/25-06-2026.*03:02/i)).toBeInTheDocument();
    expect(screen.queryByText(/09:02/i)).not.toBeInTheDocument();
  });

  it('shows bill monetary columns, including zero discount and zero due, instead of blank dashes', () => {
    renderDrawer([
      {
        id: 'bill-1',
        occurredAt: '2026-06-25 10:30:00',
        sourceType: 'bill',
        sourceLabel: 'mdDashboard.kpi.cashMovementSourceVisit',
        referenceNo: 'INV-1',
        amount: 1200,
        status: 'paid',
        billId: 1,
        invoiceNo: 'INV-1',
        patientName: 'Rahim Uddin',
        serviceNames: 'Doctor visit bill',
        grossAmount: 1200,
        discountAmount: 0,
        paidAmount: 1200,
        dueAmount: 0,
      },
    ]);

    expect(screen.getAllByText('৳1,200').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('৳0').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Doctor visit bill')).toBeInTheDocument();
  });

  it('renders inventory stock metadata with quantity and unit instead of financial columns', () => {
    const data: KpiBreakdownData = {
      metric: 'inventory_stock_skus',
      title: 'Active Stock SKUs',
      total: 1,
      valueType: 'count',
      period: { startDate: '2026-07-12', endDate: '2026-07-12', label: '2026-07-12' },
      sources: [{ label: 'Active stock SKUs', amount: 1, count: 1 }],
      rows: [{
        id: 'inventory-item-10',
        occurredAt: '2026-07-12',
        sourceType: 'inventory_stock',
        sourceLabel: 'CBC Reagent',
        referenceNo: 'CBC-REAG',
        amount: 45,
        status: 'available',
        itemName: 'CBC Reagent',
        itemCode: 'CBC-REAG',
        unitName: 'test',
        availableQuantity: 45,
        reorderLevel: 20,
        storeName: 'Main Store',
        batchNo: 'LOT-1',
        expiryDate: '2026-12-31',
        qcStatus: 'accepted',
      }],
    };

    render(
      <KpiBreakdownDrawer
        title="Inventory source breakdown"
        data={data}
        labels={labels}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Item' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Stock / Usage' })).toBeInTheDocument();
    expect(screen.getByText('CBC Reagent')).toBeInTheDocument();
    expect(screen.getByText('CBC-REAG')).toBeInTheDocument();
    expect(screen.getByText('45 test')).toBeInTheDocument();
    expect(screen.getByText('20 test')).toBeInTheDocument();
    expect(screen.getByText('Main Store')).toBeInTheDocument();
    expect(screen.getByText('LOT-1')).toBeInTheDocument();
    expect(screen.getByText('31-12-2026')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Gross' })).not.toBeInTheDocument();
  });

  it('shows item-wise reagent usage without adding incompatible units', () => {
    const data: KpiBreakdownData = {
      metric: 'lab_reagent_consumed',
      title: 'Reagents Used (SKUs)',
      total: 2,
      valueType: 'count',
      period: { startDate: '2026-07-12', endDate: '2026-07-12', label: '2026-07-12' },
      sources: [{ label: 'Reagent SKUs used', amount: 2, count: 2 }],
      rows: [
        {
          id: 'usage-1',
          occurredAt: '2026-07-12 10:00:00',
          sourceType: 'lab_reagent_consumption',
          sourceLabel: 'CBC Reagent',
          referenceNo: 'CBC-R',
          amount: 5,
          status: 'consumed',
          itemName: 'CBC Reagent',
          itemCode: 'CBC-R',
          unitName: 'test',
          consumedQuantity: 5,
        },
        {
          id: 'usage-2',
          occurredAt: '2026-07-12 11:00:00',
          sourceType: 'lab_reagent_consumption',
          sourceLabel: 'Slide Stain',
          referenceNo: 'STAIN',
          amount: 3,
          status: 'consumed',
          itemName: 'Slide Stain',
          itemCode: 'STAIN',
          unitName: 'ml',
          consumedQuantity: 3,
        },
      ],
    };

    render(
      <KpiBreakdownDrawer
        title="Reagent usage breakdown"
        data={data}
        labels={labels}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('5 test used')).toBeInTheDocument();
    expect(screen.getByText('3 ml used')).toBeInTheDocument();
    expect(screen.queryByText('8')).not.toBeInTheDocument();
  });

  it('does not expose non-invoice ledger rows as invoice actions', () => {
    const onRowClick = renderDrawer([
      {
        id: 'deposit-10',
        occurredAt: '2026-07-10 11:00:00',
        sourceType: 'deposit_collection',
        sourceLabel: 'bKash',
        referenceNo: 'DEP-10',
        amount: 300,
        status: 'posted',
        billId: null,
        invoiceNo: 'DEP-10',
        patientName: 'Deposit Patient',
        patientCode: 'P-DEP',
        paymentMethod: 'bkash',
        serviceNames: 'Patient deposit / advance receipt',
      },
    ]);

    expect(screen.queryByRole('button', { name: /Open invoice DEP-10/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('DEP-10'));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('opens a commission doctor source as an accessible invoice drilldown', () => {
    const onSourceClick = vi.fn();
    const onClearSourceFilter = vi.fn();
    const data: KpiBreakdownData = {
      metric: 'test_commission',
      title: 'Test Commission',
      total: 4775,
      period: { startDate: '2026-07-23', endDate: '2026-07-23', label: '2026-07-23' },
      sources: [{ label: 'Dr. Example Four', amount: 4775, count: 13, key: '17', doctorId: 17 }],
      rows: [],
    };

    render(
      <KpiBreakdownDrawer
        title="Test Commission"
        data={data}
        labels={labels}
        onClose={() => {}}
        onSourceClick={onSourceClick}
        onClearSourceFilter={onClearSourceFilter}
      />,
    );

    const sourceButton = screen.getByRole('button', { name: /View invoices for Dr\. Md\. Mehedi Hasan/i });
    expect(screen.getByText('View invoices →')).toBeInTheDocument();
    fireEvent.click(sourceButton);
    expect(onSourceClick).toHaveBeenCalledWith(expect.objectContaining({ key: '17', doctorId: 17 }));

    fireEvent.click(screen.getByRole('button', { name: /Show all doctors/i }));
    expect(onClearSourceFilter).toHaveBeenCalledTimes(1);
  });

  it('shows discount reference and patient context and opens the invoice row', () => {
    const onRowClick = renderDrawer([
      {
        id: 'discount-1',
        occurredAt: '2026-06-25 03:02:00',
        sourceType: 'discount',
        sourceLabel: 'manual discount',
        referenceNo: 'BILL-5573',
        amount: 3500,
        status: 'applied',
        billId: 5573,
        invoiceNo: 'BILL-5573',
        patientName: 'Rahim Uddin',
        patientCode: 'P-001',
        discountReference: 'Safaoat Ullah',
        serviceNames: 'CBC, X-Ray',
        itemCount: 2,
      },
    ]);

    expect(screen.getAllByText('Safaoat Ullah').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Rahim Uddin/)).toBeInTheDocument();
    expect(screen.getByText(/CBC, X-Ray/)).toBeInTheDocument();
    expect(screen.getByText('Top source')).toBeInTheDocument();
    expect(screen.getByText(/Discount applied on active bills/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Open invoice BILL-5573/i }));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ billId: 5573, invoiceNo: 'BILL-5573' }));
  });
});
