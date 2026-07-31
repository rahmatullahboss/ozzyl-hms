import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminDashboardOverviewResponse } from '../../../../../packages/shared/src/dashboard';
import AdminCommandCenter from './AdminCommandCenter';

vi.mock('../../../components/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock('./components/ActionCenterSummaryPanel', () => ({ default: () => <section data-testid="action-center-summary-panel" /> }));
vi.mock('./workspaces/MoneyWorkspace', () => ({ default: () => <section><h2 data-command-center-workspace-heading tabIndex={-1}>Money</h2></section> }));
vi.mock('./workspaces/DoctorsWorkspace', () => ({
  default: ({ doctorId, onDoctorIdChange }: { doctorId?: number; onDoctorIdChange?: (doctorId: number | null) => void }) => (
    <section>
      <h2 data-command-center-workspace-heading tabIndex={-1}>Doctors</h2>
      <output data-testid="selected-doctor-id">{doctorId ?? 'none'}</output>
      <button type="button" onClick={() => onDoctorIdChange?.(17)}>Open doctor 17</button>
    </section>
  ),
}));
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
  filters: {
    preset: 'today',
    startDate: '2026-07-27',
    endDate: '2026-07-27',
    rolePreset: 'hospital_admin',
  },
  health: {
    state: 'healthy',
    completeDomains: ['financial'],
    partialDomains: [],
    unavailableDomains: [],
    staleDomains: [],
    unreconciledDomains: [],
    warnings: [],
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderCommandCenter(
  entry = '/h/city-hospital/dashboard',
  props: Partial<ComponentProps<typeof AdminCommandCenter>> = {},
) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AdminCommandCenter overview={overview} {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('AdminCommandCenter', () => {
  it('renders Overview for the default dashboard URL', () => {
    renderCommandCenter();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Doctors' })).not.toBeInTheDocument();
  });

  it('renders only the selected Doctors workspace', () => {
    renderCommandCenter('/h/city-hospital/dashboard?tab=doctors&range=7d');
    expect(screen.getByRole('heading', { name: 'Doctors' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Money' })).not.toBeInTheDocument();
  });

  it('updates the URL without dropping period filters', () => {
    renderCommandCenter('/h/city-hospital/dashboard?tab=overview&range=7d&from=2026-07-21&to=2026-07-27');
    fireEvent.click(screen.getByRole('tab', { name: 'Money' }));
    expect(screen.getByTestId('location')).toHaveTextContent('tab=money');
    expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
    expect(screen.getByTestId('location')).toHaveTextContent('from=2026-07-21');
    expect(screen.getByTestId('location')).toHaveTextContent('to=2026-07-27');
    expect(screen.getByRole('heading', { name: 'Money' })).toBeInTheDocument();
  });

  it('deep-links a selected doctor without dropping period filters', () => {
    renderCommandCenter('/h/city-hospital/dashboard?tab=doctors&range=7d&from=2026-07-21&to=2026-07-27');
    fireEvent.click(screen.getByRole('button', { name: 'Open doctor 17' }));
    expect(screen.getByTestId('location')).toHaveTextContent('tab=doctors');
    expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
    expect(screen.getByTestId('location')).toHaveTextContent('from=2026-07-21');
    expect(screen.getByTestId('location')).toHaveTextContent('to=2026-07-27');
    expect(screen.getByTestId('location')).toHaveTextContent('doctorId=17');
    expect(screen.getByTestId('selected-doctor-id')).toHaveTextContent('17');
  });

  it('changes the reporting period from visible range controls', () => {
    renderCommandCenter('/h/city-hospital/dashboard?tab=money&range=custom&from=2026-07-01&to=2026-07-15&invoiceId=44');

    fireEvent.click(screen.getByRole('tab', { name: 'Last 7 Days' }));

    expect(screen.getByTestId('location')).toHaveTextContent('tab=money');
    expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
    expect(screen.getByTestId('location')).not.toHaveTextContent('from=');
    expect(screen.getByTestId('location')).not.toHaveTextContent('to=');
    expect(screen.getByTestId('location')).not.toHaveTextContent('invoiceId=');
  });

  it('refreshes command-center queries from the visible refresh control', () => {
    const onRefresh = vi.fn();
    renderCommandCenter('/h/city-hospital/dashboard', { onRefresh });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('supports arrow-key workspace navigation', async () => {
    renderCommandCenter();
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    overviewTab.focus();
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Money' })).toHaveFocus());
  });

  it('keeps every workspace control visibly labeled', () => {
    renderCommandCenter();
    for (const label of ['Overview', 'Money', 'Doctors', 'Patients', 'IPD', 'Diagnostics', 'Inventory', 'Audit']) {
      expect(screen.getByRole('tab', { name: label })).toBeVisible();
    }
  });

  it('shows the selected period and a distinct live/current-state notice', () => {
    renderCommandCenter('/h/city-hospital/dashboard?range=custom&from=2026-07-21&to=2026-07-27');
    expect(screen.getByText('2026-07-21 – 2026-07-27')).toBeInTheDocument();
    expect(screen.getByText('Live/current state widgets are labeled separately')).toBeInTheDocument();
  });
});
