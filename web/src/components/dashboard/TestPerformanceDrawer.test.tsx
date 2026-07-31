import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TestPerformanceDrawer from './TestPerformanceDrawer';
import { useApiQuery } from '../../hooks/useApiQuery';
import type { ExecutiveDashboardFilters, TestPerformanceRow } from '../../types/executiveDashboard';

vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));

const testRow: TestPerformanceRow = {
  testId: 396,
  testCode: 'CBC_PLT',
  testName: 'CBC & Platelet Count',
  quantity: 76,
  billed: 27584,
  collected: 26061,
  due: 1523,
  testCommission: 1200,
};

const filters: ExecutiveDashboardFilters = {
  preset: 'custom',
  startDate: '2026-07-01',
  endDate: '2026-07-12',
};

const period = { startDate: '2026-07-01', endDate: '2026-07-12', label: '2026-07-01 → 2026-07-12' };
const summary = {
  quantity: 76,
  billed: 27584,
  collected: 26061,
  due: 1523,
  testCommission: 1200,
  performerReserve: 500,
  referringDoctorCount: 3,
  performingDoctorCount: 2,
};

function responseFor(path: string) {
  if (path.includes('view=performed')) {
    return {
      period,
      testId: 396,
      view: 'performed',
      summary,
      rows: [{
        doctorId: 9,
        doctorName: 'Dr. Performer',
        quantity: 20,
        performerReserve: 500,
        completed: 18,
        pending: 2,
      }],
      page: 1,
      pageSize: 50,
      totalRows: 1,
      hasNextPage: false,
    };
  }

  if (path.includes('view=lines')) {
    return {
      period,
      testId: 396,
      view: 'lines',
      summary,
      rows: [{
        id: 21,
        billId: 92,
        occurredAt: '2026-07-10 10:30:00',
        testName: 'CBC & Platelet Count',
        patientName: 'Patient One',
        quantity: 1,
        referringDoctorId: 7,
        referringDoctorName: 'Dr. Referrer',
        orderingClinicianId: 8,
        orderingClinicianName: 'Dr. Clinician',
        enteredByUserId: 77,
        enteredByName: 'Reception User',
        performingDoctorId: 9,
        performingDoctorName: 'Dr. Performer',
        invoiceNo: 'INV-21',
        status: 'completed',
        grossAmount: 1200,
        discountAmount: 200,
        billedAmount: 1000,
        collectedAmount: 700,
        dueAmount: 300,
        performerReserveAmount: 100,
        testCommission: 70,
      }],
      page: 1,
      pageSize: 50,
      totalRows: 1,
      hasNextPage: false,
    };
  }

  return {
    period,
    testId: 396,
    view: 'referred',
    summary,
    rows: [{
      doctorId: 7,
      doctorName: 'Dr. Referrer',
      quantity: 30,
      billed: 12000,
      collected: 11000,
      due: 1000,
      testCommission: 700,
      discountedQuantity: 5,
      discountAmount: 800,
    }],
    page: 1,
    pageSize: 50,
    totalRows: 1,
    hasNextPage: false,
  };
}

describe('TestPerformanceDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => ({
      data: responseFor(path),
      isLoading: false,
      isError: false,
      isPlaceholderData: false,
    })) as never);
  });

  it('loads details only while a test is open and defaults to referring-doctor grouping', () => {
    const { rerender } = render(
      <TestPerformanceDrawer test={null} filters={filters} queryKeyScope="admin" onClose={vi.fn()} />,
    );
    expect(vi.mocked(useApiQuery).mock.calls[0]?.[2]).toMatchObject({ enabled: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<TestPerformanceDrawer test={testRow} filters={filters} queryKeyScope="admin" onClose={vi.fn()} />);
    const latestCall = vi.mocked(useApiQuery).mock.calls.at(-1);
    expect(latestCall?.[2]).toMatchObject({ enabled: true });
    expect(String(latestCall?.[1])).toContain('/api/dashboard/test-performance/396/details?');
    expect(String(latestCall?.[1])).toContain('view=referred');
    expect(String(latestCall?.[1])).toContain('preset=custom&startDate=2026-07-01&endDate=2026-07-12');
  });

  it('moves focus inside, locks background scrolling, and closes with Escape', () => {
    const onClose = vi.fn();
    render(<TestPerformanceDrawer test={testRow} filters={filters} queryKeyScope="admin" onClose={onClose} />);

    expect(screen.getByRole('button', { name: 'Close test details' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows summary cards and switches between referred, performed, and line evidence', () => {
    render(<TestPerformanceDrawer test={testRow} filters={filters} queryKeyScope="admin" onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'CBC & Platelet Count details' })).toBeInTheDocument();
    for (const tab of ['Referred By', 'Performed By', 'All Test Lines']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument();
    }
    for (const label of [
      'Quantity', 'Billed', 'Collected', 'Due', 'Test Commission',
      'Performer Reserve', 'Referring Doctors', 'Performing Doctors',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    for (const header of [
      'Doctor', 'Quantity', 'Billed', 'Collected', 'Due', 'Test Commission',
      'Discounted Quantity', 'Discount',
    ]) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByText('Dr. Referrer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Performed By' }));
    expect(String(vi.mocked(useApiQuery).mock.calls.at(-1)?.[1])).toContain('view=performed');
    for (const header of ['Doctor', 'Quantity', 'Performer Reserve', 'Completed', 'Pending']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByText('Dr. Performer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'All Test Lines' }));
    expect(String(vi.mocked(useApiQuery).mock.calls.at(-1)?.[1])).toContain('view=lines');
    for (const header of [
      'Time', 'Patient', 'Quantity', 'Referring Doctor', 'Ordering Clinician',
      'Entered By', 'Performing Doctor', 'Invoice', 'Gross', 'Discount', 'Billed',
      'Collected', 'Due', 'Performer Reserve', 'Test Commission', 'Status',
    ]) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByText('Dr. Clinician')).toBeInTheDocument();
    expect(screen.getByText('Reception User')).toBeInTheDocument();
    expect(screen.getByText('INV-21')).toBeInTheDocument();
  });

  it('opens line invoices only when a stable bill ID exists', () => {
    const onInvoiceOpen = vi.fn();
    const { rerender } = render(
      <TestPerformanceDrawer
        test={testRow}
        filters={filters}
        queryKeyScope="admin"
        onClose={vi.fn()}
        onInvoiceOpen={onInvoiceOpen}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'All Test Lines' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice INV-21' }));
    expect(onInvoiceOpen).toHaveBeenCalledWith(92);

    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => {
      const data = responseFor(path);
      if (path.includes('view=lines')) {
        return {
          data: { ...data, rows: (data.rows as Array<Record<string, unknown>>).map((row) => ({ ...row, billId: null })) },
          isLoading: false,
          isError: false,
          isPlaceholderData: false,
        };
      }
      return { data, isLoading: false, isError: false, isPlaceholderData: false };
    }) as never);
    rerender(
      <TestPerformanceDrawer
        test={testRow}
        filters={filters}
        queryKeyScope="admin"
        onClose={vi.fn()}
        onInvoiceOpen={onInvoiceOpen}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Open invoice INV-21' })).not.toBeInTheDocument();
    expect(screen.getByText('INV-21')).toBeInTheDocument();
  });
});
