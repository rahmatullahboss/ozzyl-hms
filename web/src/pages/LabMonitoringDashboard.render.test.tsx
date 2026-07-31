import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LabMonitoringDashboard from './LabMonitoringDashboard';
import { useApiMutation, useApiQuery, useQueryClient } from '../hooks/useApiQuery';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../lib/apiClient', () => ({ api: apiMocks }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('../components/HelpButton', () => ({ default: () => <button type="button">Help</button> }));
vi.mock('../components/WhatsAppButton', () => ({ default: () => <button type="button">WhatsApp</button> }));
vi.mock('../components/HelpPanel', () => ({ default: () => null }));

const invalidateQueries = vi.fn();

function queryData(key: unknown) {
  const normalized = Array.isArray(key) ? key.join('/') : String(key);
  if (normalized.includes('alerts')) return { data: { low_stock: [], expiring: [] }, isLoading: false };
  if (normalized.includes('inventory-policy')) return {
    data: {
      data: {
        lab_inventory_mode: 'soft',
        reagent_consumption_timing: 'billing',
        allow_result_without_stock: true,
        require_test_mapping_for_completion: false,
      },
    },
    isLoading: false,
  };
  if (normalized.includes('mapping-coverage')) return {
    data: {
      data: [],
      status: 'all',
      summary: {
        total_tests: 2,
        mapped_tests: 1,
        missing_tests: 1,
        expected_quantity: 1,
        coverage_percent: 50,
        coverage_target_min: 95,
        qc_failed_usable_lots: 0,
        open_stock_shortage_exceptions: 0,
        strict_mode_ready: false,
      },
    },
    isLoading: false,
  };
  if (normalized.includes('inventory-exceptions')) return { data: { data: [] }, isLoading: false };
  if (normalized.includes('stock-locations')) return { data: { data: [{ id: 1, location_code: 'LAB', location_name: 'Lab Store', location_type: 'store' }] }, isLoading: false };
  if (normalized.includes('mapping-consumables')) return { data: { data: [{ id: 5, code: 'CBC-DIL', name: 'CBC Diluent', category: 'reagent', unit: 'ml', total_stock: 10 }] }, isLoading: false };
  if (normalized.includes('stock-lots')) {
    const lots = [
      { id: 11, consumable_id: 5, consumable_name: 'CBC Diluent', consumable_code: 'CBC-DIL', consumable_unit: 'ml', lot_number: 'LOT-A', expiry_date: '2099-12-31', quantity_available: 10, qc_status: 'passed', ledger_type: 'lab' },
      { id: 12, consumable_id: 6, consumable_name: 'Chemistry Reagent', consumable_code: 'CHEM-R', consumable_unit: 'ml', lot_number: 'LOT-B', expiry_date: '2099-12-31', quantity_available: 7, qc_status: 'not_required', ledger_type: 'lab' },
    ];
    return { data: { data: normalized.endsWith('/5') ? lots.filter(lot => lot.consumable_id === 5) : lots }, isLoading: false };
  }
  if (normalized.includes('lab-tests')) return { data: { tests: [{ id: 101, code: 'CBC', name: 'Complete Blood Count' }] }, isLoading: false };
  if (normalized.includes('usage-rules')) return { data: { data: [] }, isLoading: false };
  if (normalized.includes('reagent-reconciliation')) return { data: { data: [], summary: { tests: 0, ok: 0, missing: 0, exception: 0, consumed_quantity: 0, consumed_cost: 0 }, status: 'all' }, isLoading: false };
  if (normalized.includes('consumables')) return { data: { data: [
    { id: 5, code: 'CBC-DIL', name: 'CBC Diluent', category: 'reagent', unit: 'ml', unit_price: 100, reorder_level: 2, reorder_qty: 10, total_stock: 10, expiring_lots: 0 },
    { id: 6, code: 'CHEM-R', name: 'Chemistry Reagent', category: 'reagent', unit: 'ml', unit_price: 200, reorder_level: 2, reorder_qty: 10, total_stock: 7, expiring_lots: 0 },
  ] }, isLoading: false };
  if (normalized.includes('logs')) return { data: { data: [] }, isLoading: false };
  if (normalized.includes('waste-requests')) return { data: { data: [] }, isLoading: false };
  if (normalized.includes('machines')) return { data: { data: [] }, isLoading: false };
  return { data: undefined, isLoading: false };
}

function renderPage(mode: 'lab-monitoring' | 'reagent-control') {
  return render(
    <MemoryRouter initialEntries={[`/h/demo/${mode}`]}>
      <Routes>
        <Route path="/h/:slug/:page" element={<LabMonitoringDashboard mode={mode} role="hospital_admin" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LabMonitoringDashboard dedicated reagent-control shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockImplementation((key: unknown) => queryData(key) as any);
    vi.mocked(useApiMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
    vi.mocked(useQueryClient).mockReturnValue({ invalidateQueries } as any);
  });

  it('opens on the simple overview with four primary sections', () => {
    renderPage('reagent-control');

    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Test Recipes' })).toBeInTheDocument();
    expect(screen.getByText('Safe rollout is active')).toBeInTheDocument();
    expect(screen.queryByTestId('reagent-starter-command-center')).not.toBeInTheDocument();
    expect(screen.queryByText('LIS go-live readiness')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reagent control mode')).not.toBeInTheDocument();
    expect(apiMocks.put).not.toHaveBeenCalled();
  });

  it('keeps recipe and policy complexity behind separate disclosures', () => {
    renderPage('reagent-control');

    fireEvent.click(screen.getByRole('tab', { name: 'Test Recipes' }));
    expect(screen.getByLabelText('Lab test')).toBeInTheDocument();
    expect(screen.getByLabelText('Reagent or consumable')).toBeInTheDocument();
    expect(screen.queryByText('Bulk recipe import')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reagent control mode')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }));
    expect(screen.getByRole('heading', { name: 'Advanced reagent settings' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Reagent control mode')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Automation policy controls' }));
    expect(screen.getByLabelText('Reagent control mode')).toBeInTheDocument();
  });

  it('keeps the full custom reagent catalog reachable from advanced tools', () => {
    renderPage('reagent-control');

    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }));
    expect(screen.getByRole('link', { name: 'Open full lab monitoring' })).toHaveAttribute('href', '/h/demo/lab/monitoring');
    expect(screen.getByRole('link', { name: 'Open machine settings' })).toHaveAttribute('href', '/h/demo/lab-machines');
    fireEvent.click(screen.getByRole('button', { name: 'Manage reagent catalog' }));

    expect(screen.getByRole('heading', { name: 'Reagent & consumable catalog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to stock' })).toBeInTheDocument();
    expect(screen.getByText('addConsumable')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reagent Stock' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to stock' }));
    expect(screen.getByRole('heading', { name: 'Reagent Stock' })).toBeInTheDocument();
  });

  it('shows all stock lots by default and uses the reagent selector as a filter', () => {
    renderPage('reagent-control');

    fireEvent.click(screen.getByRole('tab', { name: 'Stock' }));

    expect(screen.getByText('Lot LOT-A')).toBeInTheDocument();
    expect(screen.getByText('Lot LOT-B')).toBeInTheDocument();

    const initialStockLotsCall = vi.mocked(useApiQuery).mock.calls.find(call =>
      Array.isArray(call[0]) && call[0].join('/') === 'laboratory/lab-monitoring/stock-lots/all',
    );
    expect(initialStockLotsCall).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Stock reagent or consumable'), { target: { value: '5' } });

    expect(screen.getByText('Lot LOT-A')).toBeInTheDocument();
    expect(screen.queryByText('Lot LOT-B')).not.toBeInTheDocument();
  });

  it('keeps rare stock operations collapsed until requested', () => {
    renderPage('reagent-control');

    fireEvent.click(screen.getByRole('tab', { name: 'Stock' }));
    expect(screen.getByRole('button', { name: 'Add stock' })).toBeInTheDocument();
    expect(screen.getByLabelText('Stock reagent or consumable')).toBeInTheDocument();
    expect(screen.queryByText('Stock locations')).not.toBeInTheDocument();
    expect(screen.queryByText('Open vial / onboard expiry')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Stock setup & advanced actions/ }));
    expect(screen.getByText('Stock locations')).toBeInTheDocument();
    expect(screen.getByText('Open vial / onboard expiry')).toBeInTheDocument();
  });

  it('passes section-specific enabled flags to heavy queries', () => {
    renderPage('reagent-control');

    const calls = vi.mocked(useApiQuery).mock.calls;
    const optionFor = (fragment: string) => calls.find(call => Array.isArray(call[0]) && call[0].join('/').includes(fragment))?.[2] as { enabled?: boolean } | undefined;

    expect(optionFor('daily-summary')?.enabled).toBe(false);
    expect(optionFor('lab-tests')?.enabled).toBe(false);
    expect(optionFor('usage-rules')?.enabled).toBe(false);
    expect(optionFor('reagent-reconciliation')?.enabled).toBe(false);
    expect(optionFor('logs')?.enabled).toBe(false);
  });

  it('keeps the generic lab-monitoring command center backward compatible', () => {
    renderPage('lab-monitoring');

    expect(screen.getByTestId('reagent-starter-command-center')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Reagent control sections' })).not.toBeInTheDocument();
  });
});
