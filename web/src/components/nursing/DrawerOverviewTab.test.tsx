import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerOverviewTab from './DrawerOverviewTab';
import type { BedGridItem } from './WardBedGrid';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
  }),
}));

const mockMarData = { data: [] };
const mockOrdersData = { data: [] };
const mockInvestigationData = { data: [] };

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: (queryKey: unknown[], path: string) => {
    if (path.includes('mar/schedule')) return { data: mockMarData, isLoading: false };
    if (path.includes('medication-orders')) return { data: mockOrdersData, isLoading: false };
    if (path.includes('investigation-results')) return { data: mockInvestigationData, isLoading: false };
    return { data: undefined, isLoading: false };
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'test-hospital' }),
  useNavigate: () => mockNavigate,
}));

function makeBed(overrides: Partial<BedGridItem> = {}): BedGridItem {
  return {
    bed_id: 1,
    ward_name: 'ICU',
    bed_number: 'B1',
    bed_type: 'standard',
    bed_status: 'occupied',
    patient_id: 100,
    admission_id: 50,
    patient_name: 'John Doe',
    patient_code: 'P-001',
    blood_group: 'A+',
    doctor_name: 'Dr. Smith',
    statusColor: 'stable',
    provisional_diagnosis: 'Pneumonia',
    ...overrides,
  };
}

describe('DrawerOverviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DrawerOverviewTab');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('renders diagnosis from admission data', () => {
    render(<DrawerOverviewTab bed={makeBed({ provisional_diagnosis: 'Acute Bronchitis' })} />);
    expect(screen.getByTestId('overview-diagnosis')).toBeInTheDocument();
    expect(screen.getByText('Acute Bronchitis')).toBeInTheDocument();
  });

  it('renders consultant doctor from bed data', () => {
    render(<DrawerOverviewTab bed={makeBed({ doctor_name: 'Dr. Johnson' })} />);
    expect(screen.getByTestId('overview-doctor')).toBeInTheDocument();
    expect(screen.getByText('Dr. Johnson')).toBeInTheDocument();
  });

  it('renders admission date', () => {
    render(<DrawerOverviewTab bed={makeBed()} />);
    expect(screen.getByTestId('overview-admission-date')).toBeInTheDocument();
  });

  it('renders admission duration in days', () => {
    render(<DrawerOverviewTab bed={makeBed()} />);
    expect(screen.getByTestId('overview-admission-duration')).toBeInTheDocument();
  });

  it('renders allergies count from bed data', () => {
    render(<DrawerOverviewTab bed={makeBed({ allergy_count: 3 })} />);
    expect(screen.getByTestId('overview-allergies')).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('shows no allergies message when count is 0', () => {
    render(<DrawerOverviewTab bed={makeBed({ allergy_count: 0 })} />);
    expect(screen.getByTestId('overview-allergies')).toBeInTheDocument();
    expect(screen.getByText(/none/i)).toBeInTheDocument();
  });

  it('renders current medications section', () => {
    render(<DrawerOverviewTab bed={makeBed()} />);
    expect(screen.getByTestId('overview-medications')).toBeInTheDocument();
  });

  it('renders pending orders section', () => {
    render(<DrawerOverviewTab bed={makeBed()} />);
    expect(screen.getByTestId('overview-pending-orders')).toBeInTheDocument();
  });

  it('renders pending lab reports section', () => {
    render(<DrawerOverviewTab bed={makeBed()} />);
    expect(screen.getByTestId('overview-pending-labs')).toBeInTheDocument();
  });

  it('renders quick action buttons', () => {
    render(<DrawerOverviewTab bed={makeBed()} />);
    expect(screen.getByTestId('quick-action-vitals')).toBeInTheDocument();
    expect(screen.getByTestId('quick-action-medicine')).toBeInTheDocument();
    expect(screen.getByTestId('quick-action-note')).toBeInTheDocument();
  });

  it('renders diet status section', () => {
    render(<DrawerOverviewTab bed={makeBed()} />);
    expect(screen.getByTestId('overview-diet')).toBeInTheDocument();
  });

  it('renders NPO badge in diet section when npo is true', () => {
    render(<DrawerOverviewTab bed={makeBed({ npo: true })} />);
    expect(screen.getByText(/NPO/i)).toBeInTheDocument();
  });

  it('renders diagnosis as "Not specified" when provisional_diagnosis is missing', () => {
    render(<DrawerOverviewTab bed={makeBed({ provisional_diagnosis: undefined })} />);
    expect(screen.getByText(/not specified/i)).toBeInTheDocument();
  });

  it('renders "Not assigned" when doctor_name is missing', () => {
    render(<DrawerOverviewTab bed={makeBed({ doctor_name: undefined })} />);
    expect(screen.getByText(/not assigned/i)).toBeInTheDocument();
  });

  it('renders regular diet when npo is false', () => {
    render(<DrawerOverviewTab bed={makeBed({ npo: false })} />);
    expect(screen.getByText(/regular diet/i)).toBeInTheDocument();
  });

  it('navigates to vitals tab when Add Vitals clicked', () => {
    render(<DrawerOverviewTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('quick-action-vitals'));
    expect(mockNavigate).toHaveBeenCalledWith('/h/test-hospital/nursing?tab=vitals&patient=100');
  });

  it('navigates to MAR tab when Give Medicine clicked', () => {
    render(<DrawerOverviewTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('quick-action-medicine'));
    expect(mockNavigate).toHaveBeenCalledWith('/h/test-hospital/nursing?tab=mar&patient=100');
  });

  it('navigates to notes tab when Add Note clicked', () => {
    render(<DrawerOverviewTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('quick-action-note'));
    expect(mockNavigate).toHaveBeenCalledWith('/h/test-hospital/nursing?tab=notes&patient=100');
  });

  it('renders admission date as "Admitted" when admission_id exists', () => {
    render(<DrawerOverviewTab bed={makeBed({ admission_id: 50 })} />);
    expect(screen.getByText(/admitted/i)).toBeInTheDocument();
  });

  it('renders admission date as dash when admission_id is missing', () => {
    render(<DrawerOverviewTab bed={makeBed({ admission_id: undefined })} />);
    expect(screen.getByTestId('overview-admission-date')).toHaveTextContent('—');
  });

  it('renders overview tab container', () => {
    render(<DrawerOverviewTab bed={makeBed()} />);
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  });

  it('shows regular diet text when npo is undefined', () => {
    render(<DrawerOverviewTab bed={makeBed({ npo: undefined })} />);
    expect(screen.getByText(/regular diet/i)).toBeInTheDocument();
  });
});
