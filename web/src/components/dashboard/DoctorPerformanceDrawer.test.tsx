import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DoctorPerformanceDrawer from './DoctorPerformanceDrawer';
import { useApiQuery } from '../../hooks/useApiQuery';
import type {
  DoctorPerformanceDetailsSummary,
  DoctorPerformanceRow,
  ExecutiveDashboardFilters,
} from '../../types/executiveDashboard';

vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));

const doctor: DoctorPerformanceRow = {
  doctorId: 7,
  doctorName: 'Dr. Amina Rahman',
  visits: 4,
  visitCollection: 4000,
  visitCommission: 400,
  tests: 2,
  referredTests: 2,
  discountedTests: 1,
  testGrossAmount: 2400,
  testDiscountAmount: 400,
  testCollection: 1800,
  referrerCommission: 150,
  performerReserveCount: 1,
  performedTests: 1,
  performerReserve: 200,
  testCommission: 350,
  otherCommission: 50,
  earnedCommission: 800,
  doctorWaiver: 150,
  payableCommission: 650,
  paidCommission: 300,
  outstandingCommission: 350,
  totalCommission: 650,
};

const filters: ExecutiveDashboardFilters = {
  preset: 'custom',
  startDate: '2026-07-01',
  endDate: '2026-07-12',
};

const summary: DoctorPerformanceDetailsSummary = {
  visits: 4,
  visitCollection: 4000,
  referredTests: 2,
  discountedTests: 1,
  testGrossAmount: 2400,
  testDiscountAmount: 400,
  testCollection: 1800,
  performedTests: 1,
  performerReserveAmount: 200,
  earnedCommission: 800,
  doctorWaiver: 150,
  payableCommission: 650,
  paidCommission: 300,
  outstandingCommission: 350,
};

const period = { startDate: '2026-07-01', endDate: '2026-07-12', label: '2026-07-01 → 2026-07-12' };

function detailsResponse(path: string) {
  if (path.includes('tab=commissions')) {
    return {
      period,
      doctorId: 7,
      tab: 'commissions',
      summary,
      rows: [{
        id: 3,
        occurredAt: '2026-07-10',
        sourceType: 'lab_test',
        incentiveType: 'prescriber',
        doctorName: 'Dr. Amina Rahman',
        detailName: 'CBC',
        referenceNo: 'INV-2',
        billId: 92,
        commissionRuleId: 77,
        commissionRuleVersion: null,
        grossAmount: 1200,
        discountAmount: 200,
        netBilledAmount: 1000,
        performerReserveAmount: 200,
        commissionBaseAmount: 800,
        rateLabel: '12.50%',
        earnedAmount: 100,
        waiverAmount: 20,
        adjustmentAmount: -5,
        payableAmount: 75,
        paidAmount: 30,
        outstandingAmount: 45,
        settlementNo: 'SET-7',
        waiverReason: 'Patient support',
        reasonCode: 'doctor_waived',
        reasonLabel: 'Doctor waived commission',
        amount: 75,
        status: 'partially_paid',
      }],
      page: 1,
      pageSize: 50,
      totalRows: 1,
      hasNextPage: false,
    };
  }
  if (path.includes('tab=referred-tests') || path.includes('tab=performed-tests')) {
    return {
      period,
      doctorId: 7,
      tab: path.includes('performed-tests') ? 'performed-tests' : 'referred-tests',
      summary,
      rows: [{
        id: 2,
        billId: 92,
        occurredAt: '2026-07-10 10:30:00',
        testName: 'CBC',
        patientName: 'Patient One',
        referringDoctorName: 'Dr. Referrer',
        orderingDoctorName: 'Dr. Clinician',
        orderingClinicianId: 8,
        orderingClinicianName: 'Dr. Clinician',
        enteredByUserId: 77,
        enteredByName: 'Reception User',
        performingDoctorId: 9,
        performingDoctorName: 'Dr. Performer',
        invoiceNo: 'INV-2',
        accessionNo: 'ACC-2',
        status: 'completed',
        grossAmount: 1200,
        discountAmount: 200,
        netBilledAmount: 1000,
        billedAmount: 1000,
        collectedAmount: 800,
        dueAmount: 200,
        performerReserveAmount: 200,
        commissionBaseAmount: 800,
        earnedAmount: 100,
        waiverAmount: 20,
        payableAmount: 80,
        paidAmount: 30,
        outstandingAmount: 50,
        testCommission: 100,
      }],
      page: 1,
      pageSize: 50,
      totalRows: 1,
      hasNextPage: false,
    };
  }
  return {
    period,
    doctorId: 7,
    tab: 'visits',
    summary,
    rows: [{
      id: 'visit-1',
      billId: 92,
      occurredAt: '2026-07-09 09:00:00',
      patientName: 'Patient One',
      invoiceNo: 'INV-1',
      serviceName: 'Consultation',
      billedAmount: 500,
      collectedAmount: 500,
      dueAmount: 0,
      status: 'completed',
    }],
    page: 1,
    pageSize: 50,
    totalRows: 1,
    hasNextPage: false,
  };
}

const activityResponse = {
  period,
  doctorId: 7,
  rows: [{
    eventId: 'commission:3',
    eventType: 'commission_accrued',
    occurredAt: '2026-07-10 14:00:00',
    sourceType: 'doctor_commission_accrual',
    sourceId: '3',
    doctorId: 7,
    billId: 92,
    invoiceNo: 'INV-2',
    patientId: 41,
    patientName: 'Patient One',
    patientIdentityRedacted: false,
    title: 'CBC commission',
    amount: 75,
    status: 'accrued',
    reasonCode: 'doctor_waived',
  }],
  page: 1,
  pageSize: 50,
  totalRows: 1,
  hasNextPage: false,
};

function queryResult(path: string) {
  return {
    data: path.includes('/activity?') ? activityResponse : detailsResponse(path),
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
  };
}

describe('DoctorPerformanceDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => queryResult(path)) as never);
  });

  it('renders the six responsive evidence tabs with Summary selected by default', () => {
    render(<DoctorPerformanceDrawer doctor={doctor} filters={filters} queryKeyScope="admin" onClose={vi.fn()} />);
    for (const tab of ['Summary', 'Activity', 'Visits', 'Referred Tests', 'Performed Tests', 'Compensation']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument();
    }
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Complete selected-period summary')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('loads Activity only after the Activity tab is selected', () => {
    render(<DoctorPerformanceDrawer doctor={doctor} filters={filters} queryKeyScope="admin" onClose={vi.fn()} />);
    const activityCallsBefore = vi.mocked(useApiQuery).mock.calls.filter((call) => String(call[1]).includes('/activity?'));
    expect(activityCallsBefore.at(-1)?.[2]).toMatchObject({ enabled: false });

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    const activityCallsAfter = vi.mocked(useApiQuery).mock.calls.filter((call) => String(call[1]).includes('/activity?'));
    expect(activityCallsAfter.at(-1)?.[2]).toMatchObject({ enabled: true });
    expect(String(activityCallsAfter.at(-1)?.[1])).toContain('doctorId=7');
    expect(screen.getByText('CBC commission')).toBeInTheDocument();
  });

  it('renders stacked compensation bridges and forwards invoice evidence', () => {
    const onInvoiceOpen = vi.fn();
    render(
      <DoctorPerformanceDrawer
        doctor={doctor}
        filters={filters}
        queryKeyScope="admin"
        onClose={vi.fn()}
        onInvoiceOpen={onInvoiceOpen}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Compensation' }));
    expect(screen.getByText('Historical rule version not recorded')).toBeInTheDocument();
    expect(screen.getByText('Doctor waived commission')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice INV-2' }));
    expect(onInvoiceOpen).toHaveBeenCalledWith(92);
  });

  it('forwards the same stable bill ID from visits, tests, activity, and compensation', () => {
    const onInvoiceOpen = vi.fn();
    render(
      <DoctorPerformanceDrawer
        doctor={doctor}
        filters={filters}
        queryKeyScope="admin"
        onClose={vi.fn()}
        onInvoiceOpen={onInvoiceOpen}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Visits' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice INV-1' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Referred Tests' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice INV-2' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Performed Tests' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice INV-2' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice INV-2' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Compensation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice INV-2' }));

    expect(onInvoiceOpen).toHaveBeenCalledTimes(5);
    expect(onInvoiceOpen.mock.calls).toEqual([[92], [92], [92], [92], [92]]);
  });

  it('does not render placeholder evidence from a previously opened doctor', () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => ({
      ...queryResult(path),
      isError: !path.includes('/activity?'),
      isPlaceholderData: !path.includes('/activity?'),
    })) as never);
    render(<DoctorPerformanceDrawer doctor={doctor} filters={filters} queryKeyScope="admin" onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load doctor details.');
    expect(screen.queryByText('Complete selected-period summary')).not.toBeInTheDocument();
  });

  it('closes with Escape and restores focus to the previous element', () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    trigger.textContent = 'Open doctor';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <DoctorPerformanceDrawer doctor={doctor} filters={filters} queryKeyScope="admin" onClose={onClose} />,
    );
    expect(screen.getByRole('button', { name: 'Close doctor details' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
