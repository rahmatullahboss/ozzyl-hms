import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardKpiConfigurator from './DashboardKpiConfigurator';
import { useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { useAuth } from '../../hooks/useAuth';
import type { ExecutiveDashboardKpiConfigItem } from '../../hooks/useExecutiveDashboardKpis';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }));

const items: ExecutiveDashboardKpiConfigItem[] = [
  { metricKey: 'accounting_income', section: 'management', kind: 'card', enabled: true, position: 0, label: 'Total Collection', labelOverride: null },
  { metricKey: 'doctor_performance_table', section: 'doctor_performance', kind: 'panel', enabled: true, position: 10, label: 'Doctor Performance', labelOverride: null },
  { metricKey: 'test_volume_table', section: 'test_performance', kind: 'panel', enabled: true, position: 20, label: 'Test Performance', labelOverride: null },
  { metricKey: 'income_service_breakdown', section: 'income_analysis', kind: 'panel', enabled: true, position: 30, label: 'Income by Service', labelOverride: null },
  { metricKey: 'expense_source_breakdown', section: 'expense_analysis', kind: 'panel', enabled: true, position: 40, label: 'Expense Analysis', labelOverride: null },
  { metricKey: 'drawer_cash', section: 'cash_control', kind: 'card', enabled: true, position: 52, label: 'Available Drawer Cash', labelOverride: null },
  { metricKey: 'pending_approvals', section: 'approvals', kind: 'card', enabled: true, position: 55, label: 'Pending Approvals', labelOverride: null },
  { metricKey: 'inventory_low_stock', section: 'inventory', kind: 'card', enabled: true, position: 71, label: 'Low-stock SKUs', labelOverride: null },
  { metricKey: 'lab_reagent_low_stock', section: 'lab_reagent', kind: 'card', enabled: true, position: 82, label: 'Low-stock Reagents', labelOverride: null },
  { metricKey: 'reagent_reconciliation_table', section: 'lab_reagent', kind: 'panel', enabled: true, position: 89, label: 'Reagent Reconciliation', labelOverride: null },
  { metricKey: 'radiology_low_stock', section: 'radiology_stock', kind: 'card', enabled: true, position: 92, label: 'Low-stock Radiology Items', labelOverride: null },
];

describe('DashboardKpiConfigurator', () => {
  const mutate = vi.fn();
  const invalidateQueries = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQueryClient).mockReturnValue({ invalidateQueries } as never);
    vi.mocked(useApiMutation).mockReturnValue({ mutate, isPending: false, isError: false } as never);
  });

  it('is hidden from roles that cannot edit dashboard configuration', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, token: 'token', user: { userId: 1, tenantId: 'tenant-1', role: 'accountant' } } as never);
    render(<DashboardKpiConfigurator items={items} queryKeyScope="admin" />);
    expect(screen.queryByRole('button', { name: 'Customize dashboard KPI cards' })).not.toBeInTheDocument();
  });

  it('moves focus into the configurator, closes with Escape, and restores the trigger', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, token: 'token', user: { userId: 1, tenantId: 'tenant-1', role: 'hospital_admin' } } as never);
    render(<DashboardKpiConfigurator items={items} queryKeyScope="admin" />);
    const trigger = screen.getByRole('button', { name: 'Customize dashboard KPI cards' });
    trigger.focus();

    fireEvent.click(trigger);

    expect(screen.getByRole('button', { name: 'Close dashboard customization' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Customize dashboard KPI cards' })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
  });

  it('groups cards and panels into every monitoring section and keeps section switches scoped to children', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, token: 'token', user: { userId: 1, tenantId: 'tenant-1', role: 'hospital_admin' } } as never);
    render(<DashboardKpiConfigurator items={items} queryKeyScope="admin" />);

    fireEvent.click(screen.getByRole('button', { name: 'Customize dashboard KPI cards' }));
    for (const title of [
      'Management',
      'Doctor Performance',
      'Test Performance',
      'Income Analysis',
      'Expense Analysis',
      'Cash Control',
      'Approvals',
      'Inventory Control',
      'Laboratory Reagent Control',
      'Radiology / X-ray Stock',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByText('Card')).toHaveLength(6);
    expect(screen.getAllByText('Panel')).toHaveLength(5);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Income Analysis section' }));
    expect(screen.getByRole('checkbox', { name: 'Show income_service_breakdown' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Show accounting_income' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save dashboard' }));
    expect(mutate).toHaveBeenCalledWith({
      items: expect.arrayContaining([
        { metricKey: 'income_service_breakdown', enabled: false, position: 30, labelOverride: null },
        { metricKey: 'accounting_income', enabled: true, position: 0, labelOverride: null },
        { metricKey: 'reagent_reconciliation_table', enabled: true, position: 89, labelOverride: null },
      ]),
    });
  }, 10_000);

  it('sends only whitelisted presentation fields for an authorized editor', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, token: 'token', user: { userId: 1, tenantId: 'tenant-1', role: 'hospital_admin' } } as never);
    render(<DashboardKpiConfigurator items={items} queryKeyScope="admin" />);

    fireEvent.click(screen.getByRole('button', { name: 'Customize dashboard KPI cards' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show drawer_cash' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Label for accounting_income' }), { target: { value: 'Daily Collection' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Order for accounting_income' }), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save dashboard' }));

    expect(mutate).toHaveBeenCalledWith({
      items: [
        { metricKey: 'accounting_income', enabled: true, position: 4, labelOverride: 'Daily Collection' },
        { metricKey: 'doctor_performance_table', enabled: true, position: 10, labelOverride: null },
        { metricKey: 'test_volume_table', enabled: true, position: 20, labelOverride: null },
        { metricKey: 'income_service_breakdown', enabled: true, position: 30, labelOverride: null },
        { metricKey: 'expense_source_breakdown', enabled: true, position: 40, labelOverride: null },
        { metricKey: 'drawer_cash', enabled: false, position: 52, labelOverride: null },
        { metricKey: 'pending_approvals', enabled: true, position: 55, labelOverride: null },
        { metricKey: 'inventory_low_stock', enabled: true, position: 71, labelOverride: null },
        { metricKey: 'lab_reagent_low_stock', enabled: true, position: 82, labelOverride: null },
        { metricKey: 'reagent_reconciliation_table', enabled: true, position: 89, labelOverride: null },
        { metricKey: 'radiology_low_stock', enabled: true, position: 92, labelOverride: null },
      ],
    });
    const payload = mutate.mock.calls[0]?.[0];
    expect(JSON.stringify(payload)).not.toContain('formula');
    expect(JSON.stringify(payload)).not.toContain('sql');
    expect(JSON.stringify(payload)).not.toContain('section');
    expect(JSON.stringify(payload)).not.toContain('kind');
  });
});
