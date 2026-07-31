import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImportExportSettings from './ImportExportSettings';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ slug: 'city-hospital' }) };
});

const mockInvalidateQueries = vi.fn();
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { useApiMutation } from '../hooks/useApiQuery';

describe('ImportExportSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('renders the page title', () => {
    render(<ImportExportSettings role="hospital_admin" />);
    expect(screen.getByText('Import / Export')).toBeInTheDocument();
  });

  it('renders all import sections', () => {
    render(<ImportExportSettings role="hospital_admin" />);
    expect(screen.getByText('Import Data')).toBeInTheDocument();
    expect(screen.getByText('Export Data')).toBeInTheDocument();
  });

  // ── Import Section ──────────────────────────────────────────────────────────

  it('shows import options for different data types', () => {
    render(<ImportExportSettings role="hospital_admin" />);
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('Medicines')).toBeInTheDocument();
    // Patients appears in both import and export, check at least one exists
    expect(screen.getAllByText('Patients').length).toBeGreaterThanOrEqual(1);
  });

  it('shows download sample format buttons', () => {
    render(<ImportExportSettings role="hospital_admin" />);
    expect(screen.getAllByRole('button', { name: /Sample/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('shows file upload area for each import type', () => {
    render(<ImportExportSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/Upload Services/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Upload Medicines/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Upload Patients/i)).toBeInTheDocument();
  });

  // ── Export Section ──────────────────────────────────────────────────────────

  it('shows export options for different data types', () => {
    render(<ImportExportSettings role="hospital_admin" />);
    expect(screen.getAllByText('Patients').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Billing')).toBeInTheDocument();
    expect(screen.getByText('Lab Reports')).toBeInTheDocument();
  });

  it('shows export format dropdown', () => {
    render(<ImportExportSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/Export Format/i)).toBeInTheDocument();
  });

  it('shows export buttons', () => {
    render(<ImportExportSettings role="hospital_admin" />);
    expect(screen.getByRole('button', { name: /Export Patients/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export Billing/i })).toBeInTheDocument();
  });

  // ── File Upload ─────────────────────────────────────────────────────────────

  it('handles file selection', async () => {
    const user = userEvent.setup();
    render(<ImportExportSettings role="hospital_admin" />);

    const file = new File(['test'], 'services.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const input = screen.getByLabelText(/Upload Services/i);
    await user.upload(input, file);

    expect(input.files?.[0]).toBe(file);
    expect(input.files?.item(0)?.name).toBe('services.xlsx');
  });

  // ── Loading State ───────────────────────────────────────────────────────────

  it('shows import button', () => {
    render(<ImportExportSettings role="hospital_admin" />);
    expect(screen.getByRole('button', { name: /Import Services/i })).toBeInTheDocument();
  });
});
