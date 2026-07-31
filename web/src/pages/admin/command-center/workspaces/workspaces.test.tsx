import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutiveDashboardFilters } from '../../../../types/executiveDashboard';
import MoneyWorkspace from './MoneyWorkspace';
import DoctorsWorkspace from './DoctorsWorkspace';
import PatientsWorkspace from './PatientsWorkspace';
import IPDWorkspace from './IPDWorkspace';
import DiagnosticsWorkspace from './DiagnosticsWorkspace';
import InventoryWorkspace from './InventoryWorkspace';
import AuditWorkspace from './AuditWorkspace';
import { useApiQuery } from '../../../../hooks/useApiQuery';
import { useExecutiveDashboardAnalytics } from '../../../../hooks/useExecutiveDashboardAnalytics';

vi.mock('../../../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(() => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })),
}));

vi.mock('../../../../hooks/useExecutiveDashboardAnalytics', () => ({
  useExecutiveDashboardAnalytics: vi.fn(() => ({
    doctorPerformance: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
    testPerformance: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
    incomeServices: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
    expenseAnalysis: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
    reagentReconciliation: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
    patientAge: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
  })),
}));

vi.mock('../../../../components/dashboard/DoctorPerformancePanel', () => ({ default: () => <div data-testid="doctor-performance-panel" /> }));
vi.mock('../../../../components/dashboard/DoctorPerformanceDrawer', () => ({
  default: ({ onInvoiceOpen }: { onInvoiceOpen?: (billId: number) => void }) => (
    <div data-testid="doctor-performance-drawer">
      <button type="button" onClick={() => onInvoiceOpen?.(92)}>Open doctor invoice 92</button>
    </div>
  ),
}));
vi.mock('../../../../components/dashboard/AdminKpiInvoiceModal', () => ({
  default: ({ billId, onClose }: { billId: number; onClose: () => void }) => (
    <div role="dialog" aria-label={`Invoice ${billId}`}>
      <button type="button" onClick={onClose}>Close invoice</button>
    </div>
  ),
}));
vi.mock('../../../../components/dashboard/TestPerformancePanel', () => ({ default: () => <div data-testid="test-performance-panel" /> }));
vi.mock('../../../../components/dashboard/TestPerformanceDrawer', () => ({
  default: ({ onInvoiceOpen }: { onInvoiceOpen?: (billId: number) => void }) => (
    <div data-testid="test-performance-drawer">
      <button type="button" onClick={() => onInvoiceOpen?.(93)}>Open test invoice 93</button>
    </div>
  ),
}));
vi.mock('../../../../components/dashboard/IncomeServicePanel', () => ({ default: () => <div data-testid="income-service-panel" /> }));
vi.mock('../../../../components/dashboard/ExpenseAnalysisPanel', () => ({ default: () => <div data-testid="expense-analysis-panel" /> }));
vi.mock('../../../../components/dashboard/ReagentReconciliationPanel', () => ({ default: () => <div data-testid="reagent-reconciliation-panel" /> }));
vi.mock('../../../../components/dashboard/IPDBillingOverview', () => ({
  default: ({ onInvoiceOpen }: { onInvoiceOpen?: (billId: number) => void }) => (
    <div data-testid="ipd-billing-overview">
      <button type="button" onClick={() => onInvoiceOpen?.(94)}>Open IPD invoice 94</button>
    </div>
  ),
}));
vi.mock('../../../../components/dashboard/ExecutiveDuePanel', () => ({ default: () => <div data-testid="executive-due-panel" /> }));
vi.mock('../../widgets/AuditFeedWidget', () => ({ default: () => <div data-testid="audit-feed" /> }));
vi.mock('../../widgets/RevenueTrendChart', () => ({ default: () => <div data-testid="revenue-trend" /> }));
vi.mock('../../widgets/PaymentMethodBreakdown', () => ({ default: () => <div data-testid="payment-method-breakdown" /> }));

const filters: ExecutiveDashboardFilters = {
  preset: '7d',
  startDate: '2026-07-21',
  endDate: '2026-07-27',
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderWorkspace(node: React.ReactNode, initialEntry = '/h/city-hospital/dashboard?range=7d&doctorId=17&testId=396') {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      {node}
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('command center workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Money owns income and expense analysis only', () => {
    renderWorkspace(<MoneyWorkspace filters={filters} />);
    expect(screen.getByTestId('income-service-panel')).toBeInTheDocument();
    expect(screen.getByTestId('expense-analysis-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('doctor-performance-panel')).not.toBeInTheDocument();
    const enabled = vi.mocked(useExecutiveDashboardAnalytics).mock.calls[0][0].enabledPanels;
    expect([...enabled].sort()).toEqual(['expense_source_breakdown', 'income_service_breakdown']);
  });

  it('Doctors owns doctor performance only', () => {
    renderWorkspace(<DoctorsWorkspace filters={filters} />);
    expect(screen.getByTestId('doctor-performance-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('test-performance-panel')).not.toBeInTheDocument();
    const enabled = vi.mocked(useExecutiveDashboardAnalytics).mock.calls[0][0].enabledPanels;
    expect([...enabled]).toEqual(['doctor_performance_table']);
  });

  it('Doctors opens the shared invoice modal from drawer evidence', () => {
    renderWorkspace(<DoctorsWorkspace filters={filters} />);
    expect(screen.queryByRole('dialog', { name: 'Invoice 92' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open doctor invoice 92' }));
    expect(screen.getByRole('dialog', { name: 'Invoice 92' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('invoiceId=92');
    expect(screen.getByTestId('location')).toHaveTextContent('doctorId=17');
    expect(screen.getByTestId('location')).toHaveTextContent('testId=396');
    fireEvent.click(screen.getByRole('button', { name: 'Close invoice' }));
    expect(screen.queryByRole('dialog', { name: 'Invoice 92' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).not.toHaveTextContent('invoiceId=');
    expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
  });

  it('Diagnostics owns test performance and reagent reconciliation', () => {
    renderWorkspace(<DiagnosticsWorkspace filters={filters} />);
    expect(screen.getByTestId('test-performance-panel')).toBeInTheDocument();
    expect(screen.getByTestId('reagent-reconciliation-panel')).toBeInTheDocument();
    const enabled = vi.mocked(useExecutiveDashboardAnalytics).mock.calls[0][0].enabledPanels;
    expect([...enabled].sort()).toEqual(['reagent_reconciliation_table', 'test_volume_table']);
  });

  it('Diagnostics opens test invoices through URL-backed inspector state', () => {
    renderWorkspace(<DiagnosticsWorkspace filters={filters} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open test invoice 93' }));
    expect(screen.getByRole('dialog', { name: 'Invoice 93' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('invoiceId=93');
    expect(screen.getByTestId('location')).toHaveTextContent('testId=396');
  });

  it('IPD owns due and inpatient billing panels', () => {
    renderWorkspace(<IPDWorkspace filters={filters} basePath="/h/city-hospital" />);
    expect(screen.getByTestId('executive-due-panel')).toBeInTheDocument();
    expect(screen.getByTestId('ipd-billing-overview')).toBeInTheDocument();
  });

  it('IPD opens invoice activity through URL-backed inspector state', () => {
    renderWorkspace(<IPDWorkspace filters={filters} basePath="/h/city-hospital" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open IPD invoice 94' }));
    expect(screen.getByRole('dialog', { name: 'Invoice 94' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('invoiceId=94');
    expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
  });

  it('Patients does not call the inactive admin analytics endpoint', () => {
    renderWorkspace(<PatientsWorkspace basePath="/h/city-hospital" filters={filters} onAgeBucketChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Patients' })).toBeInTheDocument();
    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes('/api/admin/analytics/patients'))).toBe(false);
  });

  it('Inventory requests only inventory and radiology KPI metrics', () => {
    renderWorkspace(<InventoryWorkspace filters={filters} />);
    const path = String(vi.mocked(useApiQuery).mock.calls[0][1]);
    expect(path).toContain('/api/dashboard/kpi-summary?');
    expect(path).toContain('inventory_low_stock');
    expect(path).toContain('radiology_out_of_stock');
    expect(path).not.toContain('total_commission');
  });

  it('Audit owns the live audit feed and describes completed evidence paths', () => {
    renderWorkspace(<AuditWorkspace />);
    expect(screen.getByTestId('audit-feed')).toBeInTheDocument();
    expect(screen.getByText(/shared invoice inspector/i)).toBeInTheDocument();
    expect(screen.queryByText(/added in later phases/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('income-service-panel')).not.toBeInTheDocument();
  });
});
