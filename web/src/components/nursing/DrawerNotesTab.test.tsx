import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerNotesTab from './DrawerNotesTab';
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

describe('DrawerNotesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryData = undefined;
    mutationCallbacks = {};
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DrawerNotesTab');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('renders the notes tab container', () => {
    render(<DrawerNotesTab bed={makeBed()} />);
    expect(screen.getByTestId('notes-tab')).toBeInTheDocument();
  });

  it('renders empty state when no notes', () => {
    queryData = { Results: [] };
    render(<DrawerNotesTab bed={makeBed()} />);
    expect(screen.getByTestId('notes-empty')).toBeInTheDocument();
  });

  it('renders empty state when data is undefined', () => {
    queryData = undefined;
    render(<DrawerNotesTab bed={makeBed()} />);
    expect(screen.getByTestId('notes-empty')).toBeInTheDocument();
  });

  it('renders notes list when notes exist', () => {
    queryData = {
      Results: [
        { id: 1, patient_id: 100, note_type: 'general', note: 'Test note', created_at: new Date().toISOString() },
        { id: 2, patient_id: 100, note_type: 'assessment', note: 'Assessment note', created_at: new Date().toISOString() },
      ],
    };
    render(<DrawerNotesTab bed={makeBed()} />);
    const items = screen.getAllByTestId('note-item');
    expect(items).toHaveLength(2);
  });

  it('toggles form visibility when add button clicked', () => {
    render(<DrawerNotesTab bed={makeBed()} />);
    expect(screen.queryByTestId('note-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-note-btn'));
    expect(screen.getByTestId('note-form')).toBeInTheDocument();
  });

  it('renders quick templates in form', () => {
    render(<DrawerNotesTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('add-note-btn'));
    expect(screen.getByTestId('template-vitals')).toBeInTheDocument();
    expect(screen.getByTestId('template-medication')).toBeInTheDocument();
    expect(screen.getByTestId('template-assessment')).toBeInTheDocument();
    expect(screen.getByTestId('template-intake')).toBeInTheDocument();
  });

  it('renders note type select with options', () => {
    render(<DrawerNotesTab bed={makeBed()} />);
    fireEvent.click(screen.getByTestId('add-note-btn'));
    const select = screen.getByTestId('note-type-select');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('general');
  });

  it('renders refresh button', () => {
    render(<DrawerNotesTab bed={makeBed()} />);
    expect(screen.getByTestId('notes-refresh')).toBeInTheDocument();
  });
});
