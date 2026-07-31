import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerIOTab from './DrawerIOTab';
import type { BedGridItem } from './WardBedGrid';

const mockInvalidateQueries = vi.fn();
const mockMutate = vi.fn();

let queryData: Record<string, unknown> | undefined = undefined;
let balanceData: Record<string, unknown> | undefined = undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
  }),
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: (_key: unknown, path: string) => {
    if ((path as string).includes('/balance/')) {
      return { data: balanceData, isLoading: false, isError: false, refetch: vi.fn() };
    }
    return { data: queryData, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useApiMutation: (_method: string, _pathOrFn: unknown, _options?: Record<string, unknown>) => {
    return {
      mutate: mockMutate,
      isPending: false,
    };
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

describe('DrawerIOTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryData = undefined;
    balanceData = undefined;
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DrawerIOTab');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('renders the io tab container', () => {
    render(<DrawerIOTab bed={makeBed()} />);
    expect(screen.getByTestId('io-tab')).toBeInTheDocument();
  });

  it('renders fluid balance cards when patient has data', () => {
    balanceData = { total_intake: 1500, total_output: 800, balance: 700, period: '24h' };
    render(<DrawerIOTab bed={makeBed()} />);
    expect(screen.getByTestId('fluid-balance')).toBeInTheDocument();
    expect(screen.getByText('1500')).toBeInTheDocument();
    expect(screen.getByText('800')).toBeInTheDocument();
    expect(screen.getByText('+700')).toBeInTheDocument();
  });

  it('renders empty state when no records', () => {
    queryData = { Results: [] };
    render(<DrawerIOTab bed={makeBed()} />);
    expect(screen.getByTestId('io-empty')).toBeInTheDocument();
  });

  it('renders empty state when data is undefined', () => {
    queryData = undefined;
    render(<DrawerIOTab bed={makeBed()} />);
    expect(screen.getByTestId('io-empty')).toBeInTheDocument();
  });

  it('renders records list when records exist', () => {
    queryData = {
      Results: [
        { id: 1, patient_id: 100, intake_type: 'IV NS', intake_amount: 500, intake_unit: 'ml', recorded_on: new Date().toISOString() },
        { id: 2, patient_id: 100, output_type: 'Urine', output_amount: 200, output_unit: 'ml', recorded_on: new Date().toISOString() },
      ],
    };
    render(<DrawerIOTab bed={makeBed()} />);
    const items = screen.getAllByTestId('io-item');
    expect(items).toHaveLength(2);
  });

  it('toggles form visibility when add button clicked', () => {
    render(<DrawerIOTab bed={makeBed()} />);
    expect(screen.queryByTestId('io-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-io-btn'));
    expect(screen.getByTestId('io-form')).toBeInTheDocument();
  });

  it('renders intake/output type toggle buttons', () => {
    render(<DrawerIOTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('add-io-btn'));
    expect(screen.getByTestId('io-type-intake')).toBeInTheDocument();
    expect(screen.getByTestId('io-type-output')).toBeInTheDocument();
  });

  it('renders refresh button', () => {
    render(<DrawerIOTab bed={makeBed()} />);
    expect(screen.getByTestId('io-refresh')).toBeInTheDocument();
  });
});
