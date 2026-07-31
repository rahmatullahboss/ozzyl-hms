import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomReportBuilder from './CustomReportBuilder';

const crTMap: Record<string, string> = {
  'customReportBuilder.title': 'Custom Report Builder',
  'customReportBuilder.chooseModule': 'Choose Module',
  'customReportBuilder.chooseColumns': 'Choose Columns',
  'customReportBuilder.addFilters': 'Add Filters',
  'customReportBuilder.previewExport': 'Preview & Export',
  'customReportBuilder.columnsAvailable_one': '{{count}} column available',
  'customReportBuilder.columnsAvailable_other': '{{count}} columns available',
  'customReportBuilder.back': 'Back',
  'customReportBuilder.next': 'Next',
  'customReportBuilder.all': 'All',
  'customReportBuilder.moduleLabel': 'Module',
  'customReportBuilder.columnsLabel': 'Columns',
  'customReportBuilder.previewPlaceholder': 'Preview will appear here after backend API is connected',
  'customReportBuilder.exportPdf': 'Export PDF',
  'customReportBuilder.exportExcel': 'Export Excel',
  'customReportBuilder.saveTemplate': 'Save Template',
  'customReportBuilder.step.module': 'Module',
  'customReportBuilder.step.columns': 'Columns',
  'customReportBuilder.step.filters': 'Filters',
  'customReportBuilder.step.preview': 'Preview',
  'customReportBuilder.module.billing': 'Billing',
  'customReportBuilder.module.patients': 'Patients',
  'customReportBuilder.module.lab': 'Lab',
  'customReportBuilder.module.pharmacy': 'Pharmacy',
  'customReportBuilder.module.ipd': 'IPD',
  'customReportBuilder.module.expenses': 'Expenses',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.loading': 'Loading…',
  'common.back': 'Back',
  'common.next': 'Next',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: any) => {
      if (crTMap[k]) {
        let str = crTMap[k];
        if (opts?.count !== undefined) str = str.replace('{{count}}', String(opts.count));
        return str;
      }
      return opts?.defaultValue ?? k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'city-hospital' }),
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('CustomReportBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    render(<CustomReportBuilder />);
    expect(screen.getByText('Custom Report Builder')).toBeInTheDocument();
  });

  it('renders step 1 — module selection', () => {
    render(<CustomReportBuilder />);
    expect(screen.getByText('Choose Module')).toBeInTheDocument();
    expect(screen.getByText('Billing')).toBeInTheDocument();
    expect(screen.getByText('Patients')).toBeInTheDocument();
    expect(screen.getByText('Lab')).toBeInTheDocument();
    expect(screen.getByText('Pharmacy')).toBeInTheDocument();
    expect(screen.getByText('IPD')).toBeInTheDocument();
    expect(screen.getByText('Expenses')).toBeInTheDocument();
  });

  it('selects a module and moves to step 2', () => {
    render(<CustomReportBuilder />);
    fireEvent.click(screen.getByText('Billing'));
    expect(screen.getByText('Choose Columns')).toBeInTheDocument();
  });

  it('renders column checkboxes for selected module', () => {
    render(<CustomReportBuilder />);
    fireEvent.click(screen.getByText('Billing'));
    expect(screen.getByText('Invoice Number')).toBeInTheDocument();
    expect(screen.getByText('Patient Name')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
  });

  it('selects columns and moves to step 3', () => {
    render(<CustomReportBuilder />);
    fireEvent.click(screen.getByText('Billing'));
    fireEvent.click(screen.getByText('Invoice Number'));
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Add Filters')).toBeInTheDocument();
  });

  it('renders filter options in step 3', () => {
    render(<CustomReportBuilder />);
    fireEvent.click(screen.getByText('Billing'));
    fireEvent.click(screen.getByText('Invoice Number'));
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Date Range')).toBeInTheDocument();
    expect(screen.getByText('Department')).toBeInTheDocument();
    expect(screen.getByText('Amount Range')).toBeInTheDocument();
  });

  it('moves to preview step', () => {
    render(<CustomReportBuilder />);
    fireEvent.click(screen.getByText('Billing'));
    fireEvent.click(screen.getByText('Invoice Number'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Preview & Export')).toBeInTheDocument();
  });

  it('can go back to previous step', () => {
    render(<CustomReportBuilder />);
    fireEvent.click(screen.getByText('Billing'));
    fireEvent.click(screen.getByText('Invoice Number'));
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Choose Columns')).toBeInTheDocument();
  });
});
