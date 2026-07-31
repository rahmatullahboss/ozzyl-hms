import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExecutiveControlKpis from './ExecutiveControlKpis';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { language: 'en' } }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../hooks/useExecutiveDashboardKpis', () => ({
  executiveDashboardMetricValueType: () => 'money',
  useExecutiveDashboardKpis: () => ({
    configQuery: { isLoading: false },
    allItems: [{ metricKey: 'ot_income', section: 'management', enabled: true, position: 0, label: 'OT / Procedure Collection', labelOverride: null }],
    managementItems: [{ metricKey: 'ot_income', section: 'management', enabled: true, position: 0, label: 'OT / Procedure Collection', labelOverride: null }],
    cashControlItems: [],
    panelItems: [],
    doctorPerformancePanels: [],
    testPerformancePanels: [],
    incomeAnalysisPanels: [],
    expenseAnalysisPanels: [],
    labReagentPanels: [],
    sections: [],
    queries: {
      ot_income: {
        data: { metric: 'ot_income', title: 'OT / Procedure Collection', total: 900, valueType: 'money', period: { startDate: '2026-07-01', endDate: '2026-07-10', label: 'period' }, sources: [], rows: [] },
        isLoading: false,
        isError: false,
      },
    },
  }),
}));
vi.mock('../../hooks/useExecutiveDashboardAnalytics', () => ({
  useExecutiveDashboardAnalytics: () => {
    const query = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    return {
      doctorPerformance: query,
      testPerformance: query,
      incomeServices: query,
      expenseAnalysis: query,
      reagentReconciliation: query,
    };
  },
}));
vi.mock('./KPICard', () => ({
  default: ({ title, onClick, testId }: { title: string; onClick?: () => void; testId?: string }) => (
    <button type="button" data-testid={testId} onClick={onClick}>{title}</button>
  ),
}));
vi.mock('./DashboardKpiConfigurator', () => ({ default: () => null }));
vi.mock('./DoctorPerformancePanel', () => ({ default: () => null }));
vi.mock('./DoctorPerformanceDrawer', () => ({ default: () => null }));
vi.mock('./TestPerformancePanel', () => ({ default: () => null }));
vi.mock('./TestPerformanceDrawer', () => ({ default: () => null }));
vi.mock('./IncomeServicePanel', () => ({ default: () => null }));
vi.mock('./ExpenseAnalysisPanel', () => ({ default: () => null }));
vi.mock('./ReagentReconciliationPanel', () => ({ default: () => null }));
vi.mock('./KpiBreakdownDrawer', () => ({
  default: ({ title, data, onRowClick, onClose }: { title: string; data?: { rows?: Array<Record<string, unknown>> }; onRowClick?: (row: Record<string, unknown>) => void; onClose: () => void }) => (
    <div role="dialog" aria-label={title}>
      {(data?.rows ?? []).map((row) => (
        <button key={String(row.id)} type="button" onClick={() => onRowClick?.(row)}>Open invoice {String(row.invoiceNo)}</button>
      ))}
      <button type="button" onClick={onClose}>Close</button>
    </div>
  ),
}));
vi.mock('./AdminKpiInvoiceModal', () => ({
  default: ({ billId, onClose }: { billId: number; onClose: () => void }) => (
    <div role="dialog" aria-label={`Invoice ${billId}`} data-testid="executive-invoice-modal">
      {billId}
      <button type="button" onClick={onClose}>Close invoice</button>
    </div>
  ),
}));

const filters = { preset: 'custom' as const, startDate: '2026-07-01', endDate: '2026-07-10' };
const otBreakdown = {
  metric: 'ot_income',
  title: 'OT / Procedure Collection',
  total: 900,
  valueType: 'money',
  period: { startDate: '2026-07-01', endDate: '2026-07-10', label: 'period' },
  sources: [{ label: 'OT', amount: 900, count: 1 }],
  rows: [{
    id: 'ot-payment-1',
    occurredAt: '2026-07-10 12:00:00',
    sourceType: 'payment',
    sourceLabel: 'OT',
    referenceNo: 'RCP-1',
    amount: 900,
    status: 'paid',
    billId: 6548,
    invoiceNo: 'OT-6548',
    patientName: 'Patient A',
    patientCode: 'P-1',
    serviceNames: 'OT package',
    grossAmount: 1000,
    discountAmount: 100,
    paidAmount: 900,
    dueAmount: 0,
  }],
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderControl(scope: 'md' | 'director') {
  return render(
    <MemoryRouter initialEntries={['/h/demo/dashboard?range=custom&from=2026-07-01&to=2026-07-10']}>
      <ExecutiveControlKpis
        queryKeyScope={scope}
        querySuffix="?preset=custom&startDate=2026-07-01&endDate=2026-07-10"
        filters={filters}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe.each(['md', 'director'] as const)('ExecutiveControlKpis invoice drilldown for %s', (scope) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string, options?: { enabled?: boolean }) => {
      if (options?.enabled === false) return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
      if (url.includes('metric=ot_income')) return { data: otBreakdown, isLoading: false, isError: false, refetch: vi.fn() };
      if (url.includes('metric=radiology_income')) return { data: { ...otBreakdown, metric: 'radiology_income', title: 'Radiology / Imaging Collection', rows: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      if (url.includes('metric=cash_movement')) return {
        data: {
          ...otBreakdown,
          metric: 'cash_movement',
          sources: [{ label: 'mdDashboard.kpi.cashMovementSourceRadiology', amount: 500, count: 1 }],
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
      return { data: {}, isLoading: false, isError: false, refetch: vi.fn() };
    }) as never);
  });

  it('routes radiology cash sources to the dedicated radiology metric', async () => {
    renderControl(scope);

    fireEvent.click(screen.getByRole('button', { name: /Radiology \/ imaging collection/i }));

    await waitFor(() => {
      expect(vi.mocked(useApiQuery).mock.calls.some((call) => {
        const url = String(call[1]);
        return url.includes('metric=radiology_income')
          && url.includes('startDate=2026-07-01')
          && url.includes('endDate=2026-07-10');
      })).toBe(true);
    });
  });

  it('opens the exact bill-backed invoice from the selected-period KPI row', async () => {
    renderControl(scope);

    fireEvent.click(screen.getByTestId('kpi-ot-income'));

    await waitFor(() => {
      expect(vi.mocked(useApiQuery).mock.calls.some((call) => {
        const url = String(call[1]);
        return url.includes('metric=ot_income') && url.includes('startDate=2026-07-01') && url.includes('endDate=2026-07-10');
      })).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open invoice OT-6548' }));
    expect(screen.getByTestId('executive-invoice-modal')).toHaveTextContent('6548');
    expect(screen.getByTestId('location')).toHaveTextContent('invoiceId=6548');
    expect(screen.getByTestId('location')).toHaveTextContent('range=custom');
    expect(screen.getByTestId('location')).toHaveTextContent('from=2026-07-01');
    expect(screen.getByTestId('location')).toHaveTextContent('to=2026-07-10');
    fireEvent.click(screen.getByRole('button', { name: 'Close invoice' }));
    expect(screen.getByTestId('location')).not.toHaveTextContent('invoiceId=');
    expect(screen.getByTestId('location')).toHaveTextContent('range=custom');
  });
});
