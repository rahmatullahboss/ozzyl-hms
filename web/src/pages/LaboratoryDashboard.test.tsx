import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import LaboratoryDashboard from './LaboratoryDashboard';

const labTMap: Record<string, string> = {
  'laboratoryDashboard.emptyQueue': 'No records in this queue.',
  'laboratoryDashboard.notRecorded': 'Not recorded',
  'laboratoryDashboard.na': 'N/A',
  'laboratoryDashboard.ageNA': 'Age N/A',
  'laboratoryDashboard.general': 'General',
  'laboratoryDashboard.pending': 'pending',
  'laboratoryDashboard.yearsShort': 'y',
  'laboratoryDashboard.minShort': 'm',
  'laboratoryDashboard.hourShort': 'h',
  'laboratoryDashboard.ago': 'ago',
  'laboratoryDashboard.justNow': 'just now',
  'laboratoryDashboard.labRecord': 'lab record',
  'laboratoryDashboard.queue': 'Queue',
  'laboratoryDashboard.worklist': 'Worklist',
  'laboratoryDashboard.searchHint': 'Search by patient, patient code, mobile, lab order, or barcode. Scanner input works directly in this search box too.',
  'laboratoryDashboard.allDepartments': 'All Departments',
  'laboratoryDashboard.allPriorities': 'All Priorities',
  'laboratoryDashboard.refresh': 'Refresh',
  'laboratoryDashboard.ordered': 'Ordered',
  'laboratoryDashboard.resultLabel': 'Result',
  'laboratoryDashboard.previous': 'Previous',
  'laboratoryDashboard.sample': 'Sample',
  'laboratoryDashboard.target': 'Target',
  'laboratoryDashboard.draft': 'Draft',
  'laboratoryDashboard.correct': 'Correct',
  'laboratoryDashboard.resultEntry': 'Result Entry',
  'laboratoryDashboard.resultCorrection': 'Result Correction',
  'laboratoryDashboard.clear': 'Clear',
  'laboratoryDashboard.revisedResult': 'Revised Result',
  'laboratoryDashboard.result': 'Result',
  'laboratoryDashboard.refPrefix': 'Ref:',
  'laboratoryDashboard.referenceRange': 'Reference Range',
  'laboratoryDashboard.previousResult': 'Previous Result',
  'laboratoryDashboard.correctionReason': 'Correction Reason',
  'laboratoryDashboard.correctionNotes': 'Correction Notes',
  'laboratoryDashboard.technicianNotes': 'Technician Notes',
  'laboratoryDashboard.saveDraft': 'Save Draft',
  'laboratoryDashboard.saveCorrection': 'Save Correction',
  'laboratoryDashboard.saveResult': 'Save Result',
  'laboratoryDashboard.printReport': 'Print Report',
  'laboratoryDashboard.searchPlaceholder': 'Search {{stage}} queue',
  'laboratoryDashboard.scanPlaceholder': 'Scan order or sample barcode',
  'laboratoryDashboard.showingRecords': 'Showing {{count}} active records',
  'laboratoryDashboard.acknowledgedCount': 'Acknowledged {{count}} time(s)',
  'laboratoryDashboard.tab.overview': 'Overview',
  'laboratoryDashboard.tab.collection': 'Collection',
  'laboratoryDashboard.tab.receiving': 'Receiving',
  'laboratoryDashboard.tab.resultEntry': 'Result Entry',
  'laboratoryDashboard.tab.verification': 'Verification',
  'laboratoryDashboard.tab.validation': 'Validation',
  'laboratoryDashboard.tab.delivery': 'Delivery',
  'laboratoryDashboard.tab.critical': 'Critical',
  'laboratoryDashboard.tab.history': 'History',
  'laboratoryDashboard.hero.system': 'Laboratory Information System',
  'laboratoryDashboard.hero.title': 'Operational LIS Control Room',
  'laboratoryDashboard.priority.stat': 'STAT',
  'laboratoryDashboard.priority.urgent': 'Urgent',
  'laboratoryDashboard.priority.routine': 'Routine',
  'laboratoryDashboard.column.order': 'Order',
  'laboratoryDashboard.column.patient': 'Patient',
  'laboratoryDashboard.column.test': 'Test',
  'laboratoryDashboard.column.status': 'Status',
  'laboratoryDashboard.column.reference': 'Reference',
  'laboratoryDashboard.column.tat': 'TAT',
  'laboratoryDashboard.column.action': 'Action',
  'laboratoryDashboard.action.collect': 'Collect',
  'laboratoryDashboard.action.receive': 'Receive',
  'laboratoryDashboard.action.enterResult': 'Enter Result',
  'laboratoryDashboard.action.verify': 'Verify',
  'laboratoryDashboard.action.validate': 'Validate',
  'laboratoryDashboard.action.deliver': 'Deliver',
  'laboratoryDashboard.criticalQueue': 'Critical Queue',
  'laboratoryDashboard.enterResult': 'Enter result',
  'laboratoryDashboard.selectRowHint': 'Choose a result entry row or a published report to correct it.',
  'laboratoryDashboard.correctionReasonPlaceholder': 'Why is this report being corrected?',
  'laboratoryDashboard.correctionNotesPlaceholder': 'Optional note for revalidation',
  'laboratoryDashboard.entryNotePlaceholder': 'Optional entry note',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.loading': 'Loading…',
  'common.back': 'Back',
  'common.next': 'Next',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: any) => {
      if (labTMap[k]) {
        let str = labTMap[k];
        if (opts?.count !== undefined) str = str.replace('{{count}}', String(opts.count));
        if (opts?.stage !== undefined) str = str.replace('{{stage}}', String(opts.stage));
        return str;
      }
      return opts?.defaultValue ?? k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../components/DashboardLayout', () => ({
  default: ({ children, role }: any) => <div data-testid="layout">{children}</div>,
}));
vi.mock('../components/lab/ResultInput', () => ({
  default: () => <div data-testid="result-input" />,
}));

import { useApiQuery, useApiMutation } from '../hooks/useApiQuery';

const mockUseApiQuery = useApiQuery as ReturnType<typeof vi.fn>;
const mockUseApiMutation = useApiMutation as ReturnType<typeof vi.fn>;

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const baseDashboardData = {
  generated_at: new Date().toISOString(),
  summary: {
    today_total_lab_orders: 10,
    pending_sample_collection: 2,
    sample_collected: 3,
    in_progress_tests: 2,
    pending_result_entry: 1,
    pending_validation: 1,
    pending_delivery: 1,
    critical_alerts: 0,
    rejected_samples: 0,
    delayed_tat: 0,
  },
  queues: {
    pending_sample_collection: [],
    pending_result_entry: [],
    pending_approval: [],
    critical_alerts: [],
    rejected_samples: [],
    delayed_tat: [],
  },
  low_stock_reagents: 0,
};

function makeWorklistItem(overrides: Partial<any> = {}) {
  return {
    item_id: 1,
    order_id: 100,
    patient_id: 10,
    patient_name: 'John Doe',
    order_no: 'LAB-001',
    ordered_at: new Date(Date.now() - 15 * 60000).toISOString(),
    status: 'pending',
    test_name: 'CBC',
    next_action: 'collect',
    priority: null,
    ...overrides,
  };
}

describe('LaboratoryDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it('exports a valid React component', async () => {
    const mod = await import('./LaboratoryDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('renders overview tab by default', () => {
    mockUseApiQuery.mockReturnValue({ data: baseDashboardData, isLoading: false });
    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    expect(screen.getByText('Operational LIS Control Room')).toBeInTheDocument();
  });

  it('shows STAT badge for stat priority items', () => {
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      if (path.includes('/worklists')) {
        return {
          data: {
            stage: 'collection',
            items: [makeWorklistItem({ priority: 'stat' })],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Collection'));

    const table = screen.getByRole('table');
    const statBadges = within(table).getAllByText('STAT');
    const badge = statBadges.find((el) => el.tagName !== 'OPTION');
    expect(badge).toBeDefined();
    expect(badge!.className).toContain('bg-red-600');
    expect(badge!.className).toContain('text-white');
  });

  it('shows URGENT badge for urgent priority items', () => {
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      if (path.includes('/worklists')) {
        return {
          data: {
            stage: 'collection',
            items: [makeWorklistItem({ priority: 'urgent' })],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Collection'));

    const table = screen.getByRole('table');
    const urgentBadges = within(table).getAllByText('URGENT');
    const badge = urgentBadges.find((el) => el.tagName !== 'OPTION');
    expect(badge).toBeDefined();
    expect(badge!.className).toContain('bg-amber-500');
    expect(badge!.className).toContain('text-white');
  });

  it('does not show priority badge for routine items', () => {
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      if (path.includes('/worklists')) {
        return {
          data: {
            stage: 'collection',
            items: [makeWorklistItem({ priority: 'routine' })],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Collection'));

    const table = screen.getByRole('table');
    const statInTable = within(table).queryByText('STAT');
    const urgentInTable = within(table).queryByText('URGENT');
    const asapInTable = within(table).queryByText('ASAP');
    expect(statInTable).not.toBeInTheDocument();
    expect(urgentInTable).not.toBeInTheDocument();
    expect(asapInTable).not.toBeInTheDocument();
  });

  it('shows elapsed time for items', () => {
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      if (path.includes('/worklists')) {
        return {
          data: {
            stage: 'collection',
            items: [makeWorklistItem({ ordered_at: new Date(Date.now() - 15 * 60000).toISOString() })],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Collection'));

    expect(screen.getByText(/Ordered \d+m ago/)).toBeInTheDocument();
  });

  it('shows elapsed time in hours and minutes for older items', () => {
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      if (path.includes('/worklists')) {
        return {
          data: {
            stage: 'collection',
            items: [makeWorklistItem({ ordered_at: new Date(Date.now() - 90 * 60000).toISOString() })],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Collection'));

    expect(screen.getByText(/Ordered 1h 30m ago/)).toBeInTheDocument();
  });

  it('renders priority filter dropdown', () => {
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      if (path.includes('/departments')) return { data: [], isLoading: false };
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      return { data: null, isLoading: false };
    });
    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Collection'));

    expect(screen.getByText('All Priorities')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'STAT' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Urgent' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ASAP' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Routine' })).toBeInTheDocument();
  });

  it('includes priority parameter in worklist URL when filter is selected', () => {
    const capturedPaths: string[] = [];
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      capturedPaths.push(path);
      if (path.includes('/departments')) return { data: [], isLoading: false };
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      if (path.includes('/worklists')) {
        return {
          data: {
            stage: 'collection',
            items: [makeWorklistItem()],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Collection'));

    const selects = screen.getAllByRole('combobox');
    const prioritySelect = selects.find((s) => within(s).queryByText('All Priorities'));
    fireEvent.change(prioritySelect!, { target: { value: 'stat' } });

    const worklistPaths = capturedPaths.filter((p) => p.includes('/worklists'));
    const lastWorklistPath = worklistPaths[worklistPaths.length - 1];
    expect(lastWorklistPath).toContain('priority=stat');
  });

  it('does not include priority parameter when "All Priorities" is selected', () => {
    const capturedPaths: string[] = [];
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      capturedPaths.push(path);
      if (path.includes('/departments')) return { data: [], isLoading: false };
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      if (path.includes('/worklists')) {
        return {
          data: {
            stage: 'collection',
            items: [makeWorklistItem()],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Collection'));

    const selects = screen.getAllByRole('combobox');
    const prioritySelect = selects.find((s) => within(s).queryByText('All Priorities'));
    fireEvent.change(prioritySelect!, { target: { value: '' } });

    const worklistPaths = capturedPaths.filter((p) => p.includes('/worklists'));
    const lastWorklistPath = worklistPaths[worklistPaths.length - 1];
    expect(lastWorklistPath).not.toContain('priority=');
  });

  it('renders department filter dropdown', () => {
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      if (path.includes('/departments')) {
        return {
          data: {
            departments: [
              { id: 1, department_name: 'Hematology' },
              { id: 2, department_name: 'Biochemistry' },
              { id: 3, department_name: 'Serology' },
            ],
          },
          isLoading: false,
        };
      }
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Collection'));

    const selects = screen.getAllByRole('combobox');
    const departmentSelect = selects.find((s) => within(s).queryByText('All Departments'));
    expect(departmentSelect).toBeDefined();
    expect(within(departmentSelect!).getByText('Hematology')).toBeInTheDocument();
    expect(within(departmentSelect!).getByText('Biochemistry')).toBeInTheDocument();
    expect(within(departmentSelect!).getByText('Serology')).toBeInTheDocument();
  });

  it('includes department_id parameter in worklist URL when department is selected', () => {
    const capturedPaths: string[] = [];
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      capturedPaths.push(path);
      if (path.includes('/departments')) {
        return {
          data: {
            departments: [
              { id: 1, department_name: 'Hematology' },
              { id: 2, department_name: 'Biochemistry' },
            ],
          },
          isLoading: false,
        };
      }
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      if (path.includes('/worklists')) {
        return {
          data: {
            stage: 'collection',
            items: [makeWorklistItem()],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Collection'));

    const selects = screen.getAllByRole('combobox');
    const departmentSelect = selects.find((s) => within(s).queryByText('All Departments'));
    fireEvent.change(departmentSelect!, { target: { value: '1' } });

    const worklistPaths = capturedPaths.filter((p) => p.includes('/worklists'));
    const lastWorklistPath = worklistPaths[worklistPaths.length - 1];
    expect(lastWorklistPath).toContain('department_id=1');
  });

  it('does not include department_id parameter when "All Departments" is selected', () => {
    const capturedPaths: string[] = [];
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      capturedPaths.push(path);
      if (path.includes('/departments')) {
        return {
          data: {
            departments: [
              { id: 1, department_name: 'Hematology' },
              { id: 2, department_name: 'Biochemistry' },
            ],
          },
          isLoading: false,
        };
      }
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      if (path.includes('/worklists')) {
        return {
          data: {
            stage: 'collection',
            items: [makeWorklistItem()],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Collection'));

    const selects = screen.getAllByRole('combobox');
    const departmentSelect = selects.find((s) => within(s).queryByText('All Departments'));
    fireEvent.change(departmentSelect!, { target: { value: '' } });

    const worklistPaths = capturedPaths.filter((p) => p.includes('/worklists'));
    const lastWorklistPath = worklistPaths[worklistPaths.length - 1];
    expect(lastWorklistPath).not.toContain('department_id=');
  });

  it('shows Draft badge for items with draft result_status', () => {
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      if (path.includes('/worklists')) {
        return {
          data: {
            stage: 'result_entry',
            items: [makeWorklistItem({
              status: 'received',
              result_status: 'draft',
              is_draft: 1,
              result: '12.5',
              next_action: 'enter_result',
            })],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Result Entry'));

    const draftBadges = screen.getAllByText('Draft');
    expect(draftBadges.length).toBeGreaterThan(0);
    expect(draftBadges[0].className).toContain('amber');
  });

  it('does not show Draft badge for items without draft result_status', () => {
    mockUseApiQuery.mockImplementation((_key: any, path: string) => {
      if (path.includes('/dashboard')) return { data: baseDashboardData, isLoading: false };
      if (path.includes('/worklists')) {
        return {
          data: {
            stage: 'result_entry',
            items: [makeWorklistItem({
              status: 'received',
              result_status: 'pending',
              is_draft: 0,
              next_action: 'enter_result',
            })],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<LaboratoryDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Result Entry'));

    const table = screen.getByRole('table');
    const draftBadges = within(table).queryAllByText('Draft');
    expect(draftBadges.length).toBe(0);
  });
});
