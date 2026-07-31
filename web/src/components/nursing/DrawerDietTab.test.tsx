import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerDietTab from './DrawerDietTab';
import type { BedGridItem } from './WardBedGrid';

const mockInvalidateQueries = vi.fn();
const mockMutate = vi.fn();
let queryData: Record<string, unknown> | undefined = undefined;
let dietTypesData: Record<string, unknown> | undefined = undefined;

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
    if (path.includes('/types')) return { data: dietTypesData, isLoading: false, isError: false, refetch: vi.fn() };
    return { data: queryData, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useApiMutation: () => ({
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

function makeDiet(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    patient_id: 100,
    visit_id: 50,
    diet_type_id: 2,
    diet_name: 'Diabetic',
    diet_code: 'DIABETIC',
    extra_diet: null,
    remarks: null,
    recorded_on: '2026-05-27T10:00:00Z',
    patient_name: 'Test Patient',
    patient_code: 'P001',
    ...overrides,
  };
}

describe('DrawerDietTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryData = undefined;
    dietTypesData = undefined;
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DrawerDietTab');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('renders diet tab container', () => {
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.getByTestId('diet-tab')).toBeInTheDocument();
  });

  it('renders empty state when no diet assigned', () => {
    queryData = { Results: [] };
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.getByTestId('diet-empty')).toBeInTheDocument();
  });

  it('renders current diet when diet exists', () => {
    queryData = {
      Results: [makeDiet()],
    };
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.getByTestId('current-diet')).toBeInTheDocument();
    expect(screen.getByText('Diabetic')).toBeInTheDocument();
  });

  it('renders extra diet info when present', () => {
    queryData = {
      Results: [makeDiet({ extra_diet: 'Low sugar fruits' })],
    };
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.getByText(/Low sugar fruits/)).toBeInTheDocument();
  });

  it('renders remarks when present', () => {
    queryData = {
      Results: [makeDiet({ remarks: 'Monitor blood sugar' })],
    };
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.getByText('Monitor blood sugar')).toBeInTheDocument();
  });

  it('renders all 4 quick action buttons', () => {
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.getByTestId('diet-action-given')).toBeInTheDocument();
    expect(screen.getByTestId('diet-action-refused')).toBeInTheDocument();
    expect(screen.getByTestId('diet-action-vomiting')).toBeInTheDocument();
    expect(screen.getByTestId('diet-action-npo')).toBeInTheDocument();
  });

  it('renders diet type buttons when types loaded', () => {
    dietTypesData = {
      Results: [
        { id: 1, diet_code: 'NORMAL', diet_name: 'Normal', display_order: 1 },
        { id: 2, diet_code: 'DIABETIC', diet_name: 'Diabetic', display_order: 2 },
      ],
    };
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.getByTestId('diet-types')).toBeInTheDocument();
    expect(screen.getByTestId('diet-type-NORMAL')).toBeInTheDocument();
    expect(screen.getByTestId('diet-type-DIABETIC')).toBeInTheDocument();
  });

  it('calls mutation when Given quick action clicked', () => {
    queryData = { Results: [makeDiet()] };
    render(<DrawerDietTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('diet-action-given'));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: 100,
        visit_id: 50,
        diet_type_id: 2,
        remarks: '[GIVEN]',
      }),
    );
  });

  it('calls mutation when Refused quick action clicked', () => {
    queryData = { Results: [makeDiet()] };
    render(<DrawerDietTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('diet-action-refused'));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        remarks: '[REFUSED]',
      }),
    );
  });

  it('calls mutation when Vomiting quick action clicked', () => {
    queryData = { Results: [makeDiet()] };
    render(<DrawerDietTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('diet-action-vomiting'));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        remarks: '[VOMITING]',
      }),
    );
  });

  it('calls mutation when NPO quick action clicked', () => {
    queryData = { Results: [makeDiet()] };
    render(<DrawerDietTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('diet-action-npo'));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        remarks: '[NPO]',
      }),
    );
  });

  it('calls mutation when diet type button clicked', () => {
    dietTypesData = {
      Results: [
        { id: 3, diet_code: 'LIQUID', diet_name: 'Liquid', display_order: 3 },
      ],
    };
    render(<DrawerDietTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('diet-type-LIQUID'));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: 100,
        visit_id: 50,
        diet_type_id: 3,
      }),
    );
  });

  it('renders notes input', () => {
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.getByTestId('diet-notes')).toBeInTheDocument();
  });

  it('renders refresh button', () => {
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.getByTestId('diet-refresh')).toBeInTheDocument();
  });

  it('disables quick actions when no current diet', () => {
    queryData = { Results: [] };
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.getByTestId('diet-action-given')).toBeDisabled();
    expect(screen.getByTestId('diet-action-refused')).toBeDisabled();
    expect(screen.getByTestId('diet-action-vomiting')).toBeDisabled();
    expect(screen.getByTestId('diet-action-npo')).toBeDisabled();
  });

  it('renders empty state when data is undefined', () => {
    queryData = undefined;
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.getByTestId('diet-empty')).toBeInTheDocument();
  });

  it('does not render diet types when types data is empty', () => {
    dietTypesData = { Results: [] };
    render(<DrawerDietTab bed={makeBed()} />);
    expect(screen.queryByTestId('diet-types')).not.toBeInTheDocument();
  });
});
