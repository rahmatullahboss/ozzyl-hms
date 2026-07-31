import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import DrawerActivityLogTab from './DrawerActivityLogTab';
import type { BedGridItem } from './WardBedGrid';

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
  useApiQuery: () => ({ data: queryData, isLoading: false, isError: false, refetch: vi.fn() }),
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

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_name: 'Nurse Joy',
    action: 'vitals_recorded',
    details: 'BP 120/80, HR 72',
    created_at: '2026-05-27T10:30:00Z',
    ...overrides,
  };
}

describe('DrawerActivityLogTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryData = undefined;
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DrawerActivityLogTab');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('renders the activity log tab container', () => {
    render(<DrawerActivityLogTab bed={makeBed()} />);
    expect(screen.getByTestId('activity-log-tab')).toBeInTheDocument();
  });

  it('renders empty state when no log entries', () => {
    queryData = { Results: [] };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    expect(screen.getByTestId('activity-log-empty')).toBeInTheDocument();
  });

  it('renders empty state when data is undefined', () => {
    queryData = undefined;
    render(<DrawerActivityLogTab bed={makeBed()} />);
    expect(screen.getByTestId('activity-log-empty')).toBeInTheDocument();
  });

  it('renders log entries when data exists', () => {
    queryData = {
      Results: [
        makeEntry(),
        makeEntry({ id: 2, user_name: 'Dr. Smith', action: 'medication_given', details: 'Paracetamol 500mg' }),
      ],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    const items = screen.getAllByTestId('activity-log-item');
    expect(items).toHaveLength(2);
  });

  it('renders action type badges with correct color coding', () => {
    queryData = {
      Results: [
        makeEntry({ action: 'vitals_recorded' }),
        makeEntry({ id: 2, action: 'emergency_alert', details: 'Code Blue' }),
      ],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    const badges = screen.getAllByTestId('action-badge');
    expect(badges).toHaveLength(2);
    expect(badges[0].className).toContain('blue');
    expect(badges[1].className).toContain('red');
  });

  it('renders filter dropdown for action types', () => {
    render(<DrawerActivityLogTab bed={makeBed()} />);
    expect(screen.getByTestId('activity-type-filter')).toBeInTheDocument();
  });

  it('renders user name for each entry', () => {
    queryData = { Results: [makeEntry()] };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    expect(screen.getByText('Nurse Joy')).toBeInTheDocument();
  });

  it('renders details for each entry', () => {
    queryData = { Results: [makeEntry()] };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    expect(screen.getByText('BP 120/80, HR 72')).toBeInTheDocument();
  });

  it('filters entries by action type', () => {
    queryData = {
      Results: [
        makeEntry({ id: 1, action: 'vitals_recorded', details: 'BP check' }),
        makeEntry({ id: 2, action: 'medication_given', details: 'Gave aspirin' }),
        makeEntry({ id: 3, action: 'vitals_recorded', details: 'Temp check' }),
      ],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    expect(screen.getAllByTestId('activity-log-item')).toHaveLength(3);
    fireEvent.change(screen.getByTestId('activity-type-filter'), { target: { value: 'vitals_recorded' } });
    expect(screen.getAllByTestId('activity-log-item')).toHaveLength(2);
  });

  it('shows all entries when filter is set to all', () => {
    queryData = {
      Results: [
        makeEntry({ id: 1, action: 'vitals_recorded' }),
        makeEntry({ id: 2, action: 'medication_given' }),
      ],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    fireEvent.change(screen.getByTestId('activity-type-filter'), { target: { value: 'medication_given' } });
    expect(screen.getAllByTestId('activity-log-item')).toHaveLength(1);
    fireEvent.change(screen.getByTestId('activity-type-filter'), { target: { value: 'all' } });
    expect(screen.getAllByTestId('activity-log-item')).toHaveLength(2);
  });

  it('renders correct badge label for known action types', () => {
    queryData = {
      Results: [
        makeEntry({ action: 'medication_given' }),
      ],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    const badges = screen.getAllByText('Medication Given');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(badges.some(b => b.getAttribute('data-testid') === 'action-badge')).toBe(true);
  });

  it('renders action key as fallback for unknown action types', () => {
    queryData = {
      Results: [
        makeEntry({ action: 'custom_action' }),
      ],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    expect(screen.getByText('custom_action')).toBeInTheDocument();
  });

  it('renders green badge for medication_given action', () => {
    queryData = {
      Results: [makeEntry({ action: 'medication_given' })],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    const badge = screen.getByTestId('action-badge');
    expect(badge.className).toContain('green');
  });

  it('renders purple badge for order_acknowledged action', () => {
    queryData = {
      Results: [makeEntry({ action: 'order_acknowledged' })],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    const badge = screen.getByTestId('action-badge');
    expect(badge.className).toContain('purple');
  });

  it('renders cyan badge for service_added action', () => {
    queryData = {
      Results: [makeEntry({ action: 'service_added' })],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    const badge = screen.getByTestId('action-badge');
    expect(badge.className).toContain('cyan');
  });

  it('renders yellow badge for transfer_initiated action', () => {
    queryData = {
      Results: [makeEntry({ action: 'transfer_initiated' })],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    const badge = screen.getByTestId('action-badge');
    expect(badge.className).toContain('yellow');
  });

  it('renders orange badge for medication_missed action', () => {
    queryData = {
      Results: [makeEntry({ action: 'medication_missed' })],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    const badge = screen.getByTestId('action-badge');
    expect(badge.className).toContain('orange');
  });

  it('does not render details when details is empty', () => {
    queryData = {
      Results: [makeEntry({ details: '' })],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    expect(screen.queryByText('BP 120/80, HR 72')).not.toBeInTheDocument();
  });

  it('renders empty filtered list when no entries match filter', () => {
    queryData = {
      Results: [makeEntry({ action: 'vitals_recorded' })],
    };
    render(<DrawerActivityLogTab bed={makeBed()} />);
    fireEvent.change(screen.getByTestId('activity-type-filter'), { target: { value: 'emergency_alert' } });
    expect(screen.queryByTestId('activity-log-item')).not.toBeInTheDocument();
    expect(screen.getByTestId('activity-log-empty')).toBeInTheDocument();
  });
});
