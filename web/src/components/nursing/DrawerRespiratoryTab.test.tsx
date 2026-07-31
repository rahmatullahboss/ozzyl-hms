import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerRespiratoryTab from './DrawerRespiratoryTab';
import type { BedGridItem } from './WardBedGrid';

const mockMutate = vi.fn();
const mockInvalidateQueries = vi.fn();

let queryData: Record<string, unknown> | undefined = undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
  }),
}));

vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    nurseStation: {
      respiratory: (patientId: number) => ['nurseStation', 'respiratory', patientId],
    },
  },
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: queryData, isLoading: false, isError: false, refetch: vi.fn() }),
  useApiMutation: (_method: string, _pathOrFn: unknown, _options?: Record<string, unknown>) => ({
    mutate: mockMutate,
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
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
    patient_name: 'Test Patient',
    statusColor: 'stable',
    ...overrides,
  };
}

describe('DrawerRespiratoryTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryData = undefined;
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DrawerRespiratoryTab');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('renders the respiratory tab container', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    expect(screen.getByTestId('respiratory-tab')).toBeInTheDocument();
  });

  it('renders quick action buttons', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    expect(screen.getByTestId('start-o2-btn')).toBeInTheDocument();
    expect(screen.getByTestId('give-neb-btn')).toBeInTheDocument();
    expect(screen.getByTestId('stop-o2-btn')).toBeInTheDocument();
  });

  it('shows empty state when no records', () => {
    queryData = { Results: [] };
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    expect(screen.getByTestId('respiratory-empty')).toBeInTheDocument();
  });

  it('renders records list when records exist', () => {
    queryData = {
      Results: [
        { id: 1, entry_type: 'oxygen', delivery_mode: 'Nasal Cannula', flow_rate: 4, status: 'active', created_at: new Date().toISOString() },
        { id: 2, entry_type: 'nebulization', medicine_name: 'Salbutamol', dose: '2.5mg', response: 'improved', created_at: new Date().toISOString() },
      ],
    };
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    const items = screen.getAllByTestId('respiratory-item');
    expect(items).toHaveLength(2);
  });

  it('opens O2 form when Start O2 clicked', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('start-o2-btn'));
    expect(screen.getByTestId('o2-form')).toBeInTheDocument();
  });

  it('opens nebulization form when Give Nebulization clicked', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('give-neb-btn'));
    expect(screen.getByTestId('neb-form')).toBeInTheDocument();
  });

  it('renders oxygen delivery mode select in O2 form', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('start-o2-btn'));
    expect(screen.getByTestId('o2-delivery-mode')).toBeInTheDocument();
  });

  it('renders oxygen flow rate input in O2 form', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('start-o2-btn'));
    expect(screen.getByTestId('o2-flow-rate')).toBeInTheDocument();
  });

  it('renders SpO2 before and after inputs in O2 form', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('start-o2-btn'));
    expect(screen.getByTestId('spo2-before')).toBeInTheDocument();
    expect(screen.getByTestId('spo2-after')).toBeInTheDocument();
  });

  it('renders nebulization medicine input in Neb form', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('give-neb-btn'));
    expect(screen.getByTestId('neb-medicine')).toBeInTheDocument();
  });

  it('renders nebulization dose and time inputs in Neb form', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('give-neb-btn'));
    expect(screen.getByTestId('neb-dose')).toBeInTheDocument();
    expect(screen.getByTestId('neb-time')).toBeInTheDocument();
  });

  it('renders nebulization response select in Neb form', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('give-neb-btn'));
    expect(screen.getByTestId('neb-response')).toBeInTheDocument();
  });

  it('submits O2 form with correct data', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('start-o2-btn'));
    fireEvent.change(screen.getByTestId('o2-flow-rate'), { target: { value: '4' } });
    fireEvent.change(screen.getByTestId('spo2-before'), { target: { value: '92' } });
    fireEvent.click(screen.getByText('Save'));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: 100,
        admission_id: 50,
        entry_type: 'oxygen',
        delivery_mode: 'Nasal Cannula',
        flow_rate: 4,
        spo2_before: 92,
        status: 'active',
      }),
    );
  });

  it('submits nebulization form with correct data', () => {
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('give-neb-btn'));
    fireEvent.change(screen.getByTestId('neb-medicine'), { target: { value: 'Salbutamol' } });
    fireEvent.change(screen.getByTestId('neb-dose'), { target: { value: '2.5mg' } });
    const saveButtons = screen.getAllByText('Save');
    fireEvent.click(saveButtons[saveButtons.length - 1]);
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: 100,
        admission_id: 50,
        entry_type: 'nebulization',
        medicine_name: 'Salbutamol',
        dose: '2.5mg',
        response: 'improved',
      }),
    );
  });

  it('renders oxygen record with correct badge', () => {
    queryData = {
      Results: [
        { id: 1, entry_type: 'oxygen', delivery_mode: 'Nasal Cannula', flow_rate: 4, status: 'active', created_at: new Date().toISOString() },
      ],
    };
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    expect(screen.getByText('O₂')).toBeInTheDocument();
  });

  it('renders nebulization record with correct badge', () => {
    queryData = {
      Results: [
        { id: 1, entry_type: 'nebulization', medicine_name: 'Salbutamol', dose: '2.5mg', status: 'active', created_at: new Date().toISOString() },
      ],
    };
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    expect(screen.getByText('Neb')).toBeInTheDocument();
  });

  it('renders active status badge for active records', () => {
    queryData = {
      Results: [
        { id: 1, entry_type: 'oxygen', delivery_mode: 'Nasal Cannula', flow_rate: 4, status: 'active', created_at: new Date().toISOString() },
      ],
    };
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders stopped status badge for stopped records', () => {
    queryData = {
      Results: [
        { id: 1, entry_type: 'oxygen', delivery_mode: 'Nasal Cannula', flow_rate: 4, status: 'stopped', created_at: new Date().toISOString() },
      ],
    };
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('displays SpO2 values for oxygen records', () => {
    queryData = {
      Results: [
        { id: 1, entry_type: 'oxygen', delivery_mode: 'Nasal Cannula', flow_rate: 4, status: 'active', spo2_before: 92, spo2_after: 98, created_at: new Date().toISOString() },
      ],
    };
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    expect(screen.getByText(/SpO₂: 92% → 98%/)).toBeInTheDocument();
  });

  it('displays response for nebulization records', () => {
    queryData = {
      Results: [
        { id: 1, entry_type: 'nebulization', medicine_name: 'Salbutamol', dose: '2.5mg', response: 'improved', status: 'active', created_at: new Date().toISOString() },
      ],
    };
    render(<DrawerRespiratoryTab bed={makeBed()} />);
    expect(screen.getByText(/Response: improved/)).toBeInTheDocument();
  });
});
