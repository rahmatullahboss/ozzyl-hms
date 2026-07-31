import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerIVFluidTab from './DrawerIVFluidTab';
import type { BedGridItem } from './WardBedGrid';

const mockInvalidateQueries = vi.fn();
const mockMutate = vi.fn();
const mockStatusMutate = vi.fn();

let queryData: Record<string, unknown> | undefined = undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
  }),
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: () => {
    return { data: queryData, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useApiMutation: (method: string, _pathOrFn: unknown, _options?: Record<string, unknown>) => {
    if (method === 'patch') return { mutate: mockStatusMutate, isPending: false };
    return { mutate: mockMutate, isPending: false };
  },
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

function makeFluid(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    patient_id: 100,
    admission_id: 50,
    fluid_name: 'Normal Saline',
    volume_ml: 500,
    drop_rate: '20 drops/min',
    start_time: new Date().toISOString(),
    expected_end_time: new Date(Date.now() + 3600000).toISOString(),
    status: 'running',
    ...overrides,
  };
}

describe('DrawerIVFluidTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryData = undefined;
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DrawerIVFluidTab');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('renders the iv fluid tab container', () => {
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByTestId('iv-fluid-tab')).toBeInTheDocument();
  });

  it('renders empty state when no iv fluids', () => {
    queryData = { Results: [] };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByTestId('iv-empty')).toBeInTheDocument();
  });

  it('renders empty state when data is undefined', () => {
    queryData = undefined;
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByTestId('iv-empty')).toBeInTheDocument();
  });

  it('renders active iv fluid list', () => {
    queryData = {
      Results: [
        makeFluid(),
        makeFluid({ id: 2, fluid_name: 'DNS', volume_ml: 1000, status: 'completed' }),
      ],
    };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    const items = screen.getAllByTestId('iv-item');
    expect(items).toHaveLength(2);
  });

  it('shows summary when active fluids exist', () => {
    queryData = { Results: [makeFluid()] };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByTestId('iv-summary')).toBeInTheDocument();
  });

  it('toggles form visibility when add button clicked', () => {
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.queryByTestId('iv-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-iv-btn'));
    expect(screen.getByTestId('iv-form')).toBeInTheDocument();
  });

  it('renders quick actions for running fluids', () => {
    queryData = { Results: [makeFluid()] };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByTestId('complete-iv-1')).toBeInTheDocument();
    expect(screen.getByTestId('stop-iv-1')).toBeInTheDocument();
  });

  it('does not show quick actions for completed fluids', () => {
    queryData = { Results: [makeFluid({ status: 'completed' })] };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.queryByTestId('complete-iv-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stop-iv-1')).not.toBeInTheDocument();
  });

  it('renders refresh button', () => {
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByTestId('iv-refresh')).toBeInTheDocument();
  });

  it('renders form fields when form is open', () => {
    render(<DrawerIVFluidTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('add-iv-btn'));
    expect(screen.getByTestId('iv-fluid-input')).toBeInTheDocument();
    expect(screen.getByTestId('iv-volume-input')).toBeInTheDocument();
    expect(screen.getByTestId('iv-drop-rate-input')).toBeInTheDocument();
    expect(screen.getByTestId('iv-remarks-input')).toBeInTheDocument();
  });

  it('calls create mutation when save clicked with valid data', () => {
    render(<DrawerIVFluidTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('add-iv-btn'));
    fireEvent.change(screen.getByTestId('iv-fluid-input'), { target: { value: 'NS' } });
    fireEvent.change(screen.getByTestId('iv-volume-input'), { target: { value: '500' } });
    fireEvent.click(screen.getByTestId('save-iv-btn'));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: 100,
        admission_id: 50,
        fluid_name: 'NS',
        volume_ml: 500,
      }),
    );
  });

  it('calls status mutation when Mark Completed clicked', () => {
    queryData = { Results: [makeFluid()] };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('complete-iv-1'));
    expect(mockStatusMutate).toHaveBeenCalledWith({ id: 1, status: 'completed' });
  });

  it('calls status mutation when Stop IV clicked', () => {
    queryData = { Results: [makeFluid()] };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('stop-iv-1'));
    expect(mockStatusMutate).toHaveBeenCalledWith({ id: 1, status: 'stopped' });
  });

  it('renders fluid name and volume in list', () => {
    queryData = { Results: [makeFluid({ fluid_name: 'Ringer Lactate', volume_ml: 1000 })] };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByText('Ringer Lactate')).toBeInTheDocument();
    expect(screen.getByText(/1000 ml/)).toBeInTheDocument();
  });

  it('renders drop rate when present', () => {
    queryData = { Results: [makeFluid({ drop_rate: '30 drops/min' })] };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByText('30 drops/min')).toBeInTheDocument();
  });

  it('renders running status badge', () => {
    queryData = { Results: [makeFluid({ status: 'running' })] };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByText(/Running/)).toBeInTheDocument();
  });

  it('renders completed status badge', () => {
    queryData = { Results: [makeFluid({ status: 'completed' })] };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByText(/Completed/)).toBeInTheDocument();
  });

  it('renders stopped status badge', () => {
    queryData = { Results: [makeFluid({ status: 'stopped' })] };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByText(/Stopped/)).toBeInTheDocument();
  });

  it('shows summary with total volume', () => {
    queryData = {
      Results: [
        makeFluid({ id: 1, volume_ml: 500, status: 'running' }),
        makeFluid({ id: 2, fluid_name: 'DNS', volume_ml: 1000, status: 'running' }),
      ],
    };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.getByText(/1500/)).toBeInTheDocument();
  });

  it('does not show summary when no active fluids', () => {
    queryData = {
      Results: [makeFluid({ status: 'completed' })],
    };
    render(<DrawerIVFluidTab bed={makeBed()} />);
    expect(screen.queryByTestId('iv-summary')).not.toBeInTheDocument();
  });
});
