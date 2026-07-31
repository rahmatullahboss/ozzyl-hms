import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminDashboardOverviewResponse } from '../../../../../packages/shared/src/dashboard';
import AdminCommandCenter from './AdminCommandCenter';

vi.mock('../../../components/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock('./components/ActionCenterSummaryPanel', () => ({ default: () => <section data-testid="action-center-summary-panel" /> }));
vi.mock('./workspaces/MoneyWorkspace', () => ({
  default: () => <section data-testid="workspace-money"><h2 data-command-center-workspace-heading tabIndex={-1}>Money</h2></section>,
}));
vi.mock('./workspaces/DoctorsWorkspace', () => ({ default: () => <section><h2 data-command-center-workspace-heading tabIndex={-1}>Doctors</h2></section> }));
vi.mock('./workspaces/PatientsWorkspace', () => ({ default: () => <section><h2 data-command-center-workspace-heading tabIndex={-1}>Patients</h2></section> }));
vi.mock('./workspaces/IPDWorkspace', () => ({ default: () => <section><h2 data-command-center-workspace-heading tabIndex={-1}>IPD</h2></section> }));
vi.mock('./workspaces/DiagnosticsWorkspace', () => ({ default: () => <section><h2 data-command-center-workspace-heading tabIndex={-1}>Diagnostics</h2></section> }));
vi.mock('./workspaces/InventoryWorkspace', () => ({ default: () => <section><h2 data-command-center-workspace-heading tabIndex={-1}>Inventory</h2></section> }));
vi.mock('./workspaces/AuditWorkspace', () => ({ default: () => <section><h2 data-command-center-workspace-heading tabIndex={-1}>Audit</h2></section> }));

const overview: AdminDashboardOverviewResponse = {
  reportKey: 'admin_control_center',
  reportVersion: '2.0.0',
  generatedAt: '2026-07-27T12:00:00.000Z',
  timezone: 'Asia/Dhaka',
  currencyCode: 'BDT',
  moneyUnit: 'major',
  filters: { preset: 'today', startDate: '2026-07-27', endDate: '2026-07-27', rolePreset: 'hospital_admin' },
  health: {
    state: 'healthy', completeDomains: [], partialDomains: [], unavailableDomains: [], staleDomains: [], unreconciledDomains: [], warnings: [],
  },
  primaryMetrics: [],
  operations: null,
  domainHealth: [],
  permissions: {
    financialOverviewVisible: true,
    patientIdentifiersVisible: false,
    commissionDetailsVisible: true,
    auditDetailsVisible: true,
    exportAllowed: false,
    actionManagementAllowed: true,
  },
};

function renderPage(entry = '/h/city-hospital/dashboard') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AdminCommandCenter overview={overview} />
    </MemoryRouter>,
  );
}

describe('AdminCommandCenter accessibility', () => {
  it('links every tab to the active tabpanel with accessible ids', () => {
    renderPage();
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    const panel = screen.getByRole('tabpanel', { name: 'Overview' });

    expect(overviewTab).toHaveAttribute('id', 'command-center-tab-overview');
    expect(overviewTab).toHaveAttribute('aria-controls', 'command-center-panel-overview');
    expect(panel).toHaveAttribute('id', 'command-center-panel-overview');
    expect(panel).toHaveAttribute('aria-labelledby', 'command-center-tab-overview');
  });

  it('moves focus to the selected workspace heading after keyboard tab change', async () => {
    renderPage();
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    overviewTab.focus();
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Money' })).toHaveFocus());
  });

  it('does not move focus into the panel for pointer selection', () => {
    renderPage();
    const moneyTab = screen.getByRole('tab', { name: 'Money' });
    fireEvent.click(moneyTab);
    expect(screen.getByRole('heading', { name: 'Money' })).not.toHaveFocus();
  });

  it('contains page-level horizontal overflow and supports reduced motion', () => {
    renderPage();
    expect(screen.getByTestId('admin-command-center')).toHaveClass('min-w-0', 'overflow-x-hidden');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('motion-reduce:transition-none');
    }
  });

  it('keeps all workspace controls text-labeled with 44px targets', () => {
    renderPage();
    for (const label of ['Overview', 'Money', 'Doctors', 'Patients', 'IPD', 'Diagnostics', 'Inventory', 'Audit']) {
      const tab = screen.getByRole('tab', { name: label });
      expect(tab).toHaveClass('min-h-11');
      expect(tab.textContent?.trim()).toContain(label);
    }
  });
});
