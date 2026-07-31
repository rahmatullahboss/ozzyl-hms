import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerCarePlanTab from './DrawerCarePlanTab';
import type { BedGridItem } from './WardBedGrid';

const mockInvalidateQueries = vi.fn();
const mockMutate = vi.fn();

let queryData: Record<string, unknown> | undefined = undefined;
let mutationCallbacks: Record<string, unknown> = {};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
  }),
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: queryData, isLoading: false, isError: false, refetch: vi.fn() }),
  useApiMutation: (_method: string, _pathOrFn: unknown, options?: Record<string, unknown>) => {
    mutationCallbacks = options ?? {};
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

describe('DrawerCarePlanTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryData = undefined;
    mutationCallbacks = {};
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DrawerCarePlanTab');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('renders the care plan tab container', () => {
    render(<DrawerCarePlanTab bed={makeBed()} />);
    expect(screen.getByTestId('care-plan-tab')).toBeInTheDocument();
  });

  it('renders empty state when no items', () => {
    queryData = { Results: [] };
    render(<DrawerCarePlanTab bed={makeBed()} />);
    expect(screen.getByTestId('care-plan-empty')).toBeInTheDocument();
  });

  it('renders empty state when data is undefined', () => {
    queryData = undefined;
    render(<DrawerCarePlanTab bed={makeBed()} />);
    expect(screen.getByTestId('care-plan-empty')).toBeInTheDocument();
  });

  it('renders care plan items when they exist', () => {
    queryData = {
      Results: [
        { id: 1, patient_id: 100, problem: 'Pain management', goal: 'Pain score < 4', intervention: 'PRN analgesics', status: 'active', created_at: new Date().toISOString() },
        { id: 2, patient_id: 100, problem: 'Mobility', goal: 'Ambulate 2x daily', intervention: 'PT consultation', status: 'completed', created_at: new Date().toISOString() },
      ],
    };
    render(<DrawerCarePlanTab bed={makeBed()} />);
    const items = screen.getAllByTestId('care-plan-item');
    expect(items).toHaveLength(2);
  });

  it('toggles form visibility when add button clicked', () => {
    render(<DrawerCarePlanTab bed={makeBed()} />);
    expect(screen.queryByTestId('care-plan-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-care-plan-btn'));
    expect(screen.getByTestId('care-plan-form')).toBeInTheDocument();
  });

  it('renders form fields', () => {
    render(<DrawerCarePlanTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('add-care-plan-btn'));
    expect(screen.getByTestId('care-plan-problem-input')).toBeInTheDocument();
    expect(screen.getByTestId('care-plan-goal-input')).toBeInTheDocument();
    expect(screen.getByTestId('care-plan-intervention-input')).toBeInTheDocument();
  });

  it('renders toggle status buttons for items', () => {
    queryData = {
      Results: [
        { id: 1, patient_id: 100, problem: 'Test problem', status: 'active', created_at: new Date().toISOString() },
      ],
    };
    render(<DrawerCarePlanTab bed={makeBed()} />);
    expect(screen.getByTestId('toggle-care-plan-status')).toBeInTheDocument();
  });

  it('renders refresh button', () => {
    render(<DrawerCarePlanTab bed={makeBed()} />);
    expect(screen.getByTestId('care-plan-refresh')).toBeInTheDocument();
  });
});
