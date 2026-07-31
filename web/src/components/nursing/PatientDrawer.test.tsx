import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import PatientDrawer from './PatientDrawer';
import type { BedGridItem } from './WardBedGrid';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
  }),
}));

vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'test-hospital' }),
}));

vi.mock('./DrawerOverviewTab', () => ({ default: () => <div data-testid="overview-tab" /> }));
vi.mock('./DrawerVitalsTab', () => ({ default: () => <div data-testid="vitals-tab" /> }));
vi.mock('./DrawerMARTab', () => ({ default: () => <div data-testid="mar-tab" /> }));
vi.mock('./DrawerOrdersTab', () => ({ default: () => <div data-testid="orders-tab" /> }));
vi.mock('./DrawerServicesTab', () => ({ default: () => <div data-testid="services-tab" /> }));

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
    ...overrides,
  };
}

describe('PatientDrawer', () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
  });

  it('exports a valid React component', async () => {
    const mod = await import('./PatientDrawer');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('does not render when bed is null', () => {
    const { container } = render(<PatientDrawer bed={null} onClose={onClose} />);
    expect(container.innerHTML).toBe('');
  });

  it('does not render when bed.patient_id is undefined', () => {
    const { container } = render(<PatientDrawer bed={makeBed({ patient_id: undefined })} onClose={onClose} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders patient header', () => {
    render(<PatientDrawer bed={makeBed()} onClose={onClose} />);
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText(/ICU — B1/)).toBeInTheDocument();
    expect(screen.getByText(/P-001/)).toBeInTheDocument();
    expect(screen.getByText(/A\+/)).toBeInTheDocument();
    expect(screen.getByText('Dr. Smith')).toBeInTheDocument();
  });

  it('shows critical banner when admission_status is critical', () => {
    render(<PatientDrawer bed={makeBed({ admission_status: 'critical' })} onClose={onClose} />);
    expect(screen.getByTestId('critical-banner')).toBeInTheDocument();
    expect(screen.getByText(/Critical Patient/)).toBeInTheDocument();
  });

  it('does NOT show critical banner for non-critical', () => {
    render(<PatientDrawer bed={makeBed({ admission_status: 'stable' })} onClose={onClose} />);
    expect(screen.queryByTestId('critical-banner')).not.toBeInTheDocument();
  });

  it('renders all 5 tab buttons including overview', () => {
    render(<PatientDrawer bed={makeBed()} onClose={onClose} />);
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('tab-vitals')).toBeInTheDocument();
    expect(screen.getByTestId('tab-mar')).toBeInTheDocument();
    expect(screen.getByTestId('tab-orders')).toBeInTheDocument();
    expect(screen.getByTestId('tab-services')).toBeInTheDocument();
  });

  it('defaults to overview tab', () => {
    render(<PatientDrawer bed={makeBed()} onClose={onClose} />);
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  });

  it('switches to MAR tab on click', () => {
    render(<PatientDrawer bed={makeBed()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-mar'));
    expect(screen.getByTestId('mar-tab')).toBeInTheDocument();
  });

  it('switches to orders tab on click', () => {
    render(<PatientDrawer bed={makeBed()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-orders'));
    expect(screen.getByTestId('orders-tab')).toBeInTheDocument();
  });

  it('switches to services tab on click', () => {
    render(<PatientDrawer bed={makeBed()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-services'));
    expect(screen.getByTestId('services-tab')).toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    render(<PatientDrawer bed={makeBed()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', () => {
    render(<PatientDrawer bed={makeBed()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on close button click', () => {
    render(<PatientDrawer bed={makeBed()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('drawer-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('opens more-actions menu on MoreVertical click', () => {
    render(<PatientDrawer bed={makeBed()} onClose={onClose} />);
    expect(screen.queryByTestId('more-actions-menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('more-actions-btn'));
    expect(screen.getByTestId('more-actions-menu')).toBeInTheDocument();
  });

  it('resets to overview tab when bed changes', () => {
    const { rerender } = render(<PatientDrawer bed={makeBed()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-mar'));
    expect(screen.getByTestId('mar-tab')).toBeInTheDocument();
    rerender(<PatientDrawer bed={makeBed({ bed_id: 2, patient_id: 200 })} onClose={onClose} />);
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  });
});
