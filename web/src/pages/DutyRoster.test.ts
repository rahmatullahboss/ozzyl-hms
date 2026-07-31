import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import DutyRoster from './DutyRoster';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  assign: vi.fn(),
  cancel: vi.fn(),
  swap: vi.fn(),
  bulk: vi.fn(),
  generate: vi.fn(),
  createRotation: vi.fn(),
  assignRotation: vi.fn(),
  holiday: vi.fn(),
  overtime: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  pending: {} as Record<string, boolean>,
  options: new Map<string, Record<string, (...args: unknown[]) => unknown>>(),
  rosterMode: 'empty' as 'empty' | 'assigned',
}));

const staff = [
  { id: 1, name: 'Nurse Fatima', position: 'Nurse', department: 'ICU' },
  { id: 2, name: 'Nurse Rina', position: 'Nurse', department: 'Ward' },
];

const shifts = [
  { id: 1, shift_name: 'Morning', short_code: 'M', start_time: '08:00', end_time: '16:00', color: '#3B82F6' },
  { id: 2, shift_name: 'Evening', short_code: 'E', start_time: '16:00', end_time: '00:00', color: '#F59E0B' },
];

const rotations = [
  { patternId: 5, patternName: 'ICU weekly', cycleDays: 7, isActive: true, days: [] },
];

const overtimeRules = [
  {
    ruleId: 2,
    ruleName: 'Weekday overtime',
    multiplier: 1.5,
    minHoursBeforeOvertime: 8,
    maxOvertimeHoursPerDay: 4,
    appliesOn: 'weekday' as const,
    isActive: true,
  },
];

vi.mock('react-hot-toast', () => ({
  default: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (values && ['created', 'updated', 'unchanged', 'skipped'].some((name) => name in values)) {
        return `${key}:${values.created ?? 0}:${values.updated ?? values.unchanged ?? 0}:${values.skipped ?? 0}`;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn((_queryKey: unknown, path: string) => {
    if (path === '/api/staff') return { data: { data: staff }, isLoading: false };
    if (path === '/api/hr/attendance/shifts') return { data: { data: shifts }, isLoading: false };
    if (path.startsWith('/api/hr/roster?')) {
      const from = new URLSearchParams(path.split('?')[1] ?? '').get('from') ?? '2026-07-27';
      const data = mocks.rosterMode === 'assigned'
        ? [
            {
              rosterId: 1,
              staffId: 1,
              staffName: 'Nurse Fatima',
              position: 'Nurse',
              department: 'ICU',
              shiftId: 1,
              shiftName: 'Morning',
              shiftShortCode: 'M',
              shiftStartTime: '08:00',
              shiftEndTime: '16:00',
              shiftColor: '#3B82F6',
              rosterDate: from,
              status: 'scheduled',
              swappedWithStaffId: null,
              remarks: null,
              version: 1,
            },
            {
              rosterId: 2,
              staffId: 2,
              staffName: 'Nurse Rina',
              position: 'Nurse',
              department: 'Ward',
              shiftId: 2,
              shiftName: 'Evening',
              shiftShortCode: 'E',
              shiftStartTime: '16:00',
              shiftEndTime: '00:00',
              shiftColor: '#F59E0B',
              rosterDate: from,
              status: 'scheduled',
              swappedWithStaffId: null,
              remarks: null,
              version: 1,
            },
          ]
        : [];
      return { data: { data }, isLoading: false };
    }
    if (path.startsWith('/api/hr/roster/holidays')) return { data: { data: [] }, isLoading: false };
    if (path === '/api/hr/roster/rotations') return { data: { data: rotations }, isLoading: false };
    if (path === '/api/hr/biometric/overtime/rules') return { data: { data: overtimeRules }, isLoading: false };
    return { data: undefined, isLoading: false };
  }),
  useApiMutation: vi.fn((method: string, pathOrFn: string | ((value: unknown) => string), options?: Record<string, (...args: unknown[]) => unknown>) => {
    const key = typeof pathOrFn === 'string'
      ? pathOrFn
      : method === 'delete'
        ? 'cancel'
        : method === 'put'
          ? 'swap'
          : 'dynamic';
    const mutate = typeof pathOrFn === 'string'
      ? ({
          '/api/hr/roster': mocks.assign,
          '/api/hr/roster/bulk': mocks.bulk,
          '/api/hr/roster/generate': mocks.generate,
          '/api/hr/roster/rotation': mocks.createRotation,
          '/api/hr/roster/rotation/assign': mocks.assignRotation,
          '/api/hr/roster/holidays': mocks.holiday,
          '/api/hr/biometric/overtime/rules': mocks.overtime,
        } as Record<string, typeof mocks.assign>)[pathOrFn] ?? vi.fn()
      : key === 'cancel'
        ? mocks.cancel
        : key === 'swap'
          ? mocks.swap
          : vi.fn();

    if (options) mocks.options.set(key, options);
    return { mutate, mutateAsync: vi.fn(), isPending: Boolean(mocks.pending[key]) };
  }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

function getDateInputs(dialog: HTMLElement): HTMLInputElement[] {
  return Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="date"]'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.clear();
  mocks.rosterMode = 'empty';
  for (const key of Object.keys(mocks.pending)) delete mocks.pending[key];
});

describe('DutyRoster mutation contracts', () => {
  it('sends the documented single-assignment body', () => {
    const { container } = render(createElement(DutyRoster));
    const emptyCellButton = container.querySelector<HTMLButtonElement>('button[class*="border-dashed"]');
    expect(emptyCellButton).not.toBeNull();

    fireEvent.click(emptyCellButton as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: /Evening/ }));

    expect(mocks.assign).toHaveBeenCalledWith({
      staffId: 1,
      shiftId: 2,
      rosterDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      idempotencyKey: expect.stringMatching(/^roster:assign:/),
    });
  });

  it('sends the documented bulk-assignment body', () => {
    render(createElement(DutyRoster));
    fireEvent.click(screen.getByRole('button', { name: 'roster.bulkAssign' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText(/Nurse Fatima/));
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '2' } });
    const dates = getDateInputs(dialog);
    fireEvent.change(dates[0], { target: { value: '2026-07-27' } });
    fireEvent.change(dates[1], { target: { value: '2026-07-31' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'roster.bulkAssignButton' }));

    expect(mocks.bulk).toHaveBeenCalledWith({
      assignments: [{ staffId: 1, shiftId: 2 }],
      startDate: '2026-07-27',
      endDate: '2026-07-31',
      dateMode: 'all_dates',
      idempotencyKey: expect.stringMatching(/^roster:bulk:/),
    });
  });

  it('sends the documented roster-generation body', () => {
    render(createElement(DutyRoster));
    fireEvent.click(screen.getByRole('button', { name: 'roster.generateFromRotations' }));

    const dialog = screen.getByRole('dialog');
    const dates = getDateInputs(dialog);
    fireEvent.change(dates[0], { target: { value: '2026-07-27' } });
    fireEvent.change(dates[1], { target: { value: '2026-07-31' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'roster.generateRoster' }));

    expect(mocks.generate).toHaveBeenCalledWith({
      startDate: '2026-07-27',
      endDate: '2026-07-31',
      replaceExisting: false,
      idempotencyKey: expect.stringMatching(/^roster:generate:/),
    });
  });

  it('sends the documented rotation-creation body', () => {
    render(createElement(DutyRoster));
    fireEvent.click(screen.getByRole('button', { name: 'tabs.rotations' }));
    fireEvent.click(screen.getByRole('button', { name: 'rotations.newRotation' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('rotations.patternNamePlaceholder'), {
      target: { value: 'ICU weekly' },
    });
    fireEvent.change(dialog.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement, {
      target: { value: '2' },
    });

    const selects = within(dialog).getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '2' } });
    const checkboxes = within(dialog).getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'rotations.createRotation' }));

    expect(mocks.createRotation).toHaveBeenCalledWith({
      patternName: 'ICU weekly',
      cycleDays: 2,
      days: [
        { dayNumber: 1, shiftId: 2, isOff: false },
        { dayNumber: 2, shiftId: null, isOff: true },
      ],
      idempotencyKey: expect.stringMatching(/^rotation:create:/),
    });
  });

  it('sends the documented rotation-assignment body', () => {
    render(createElement(DutyRoster));
    fireEvent.click(screen.getByRole('button', { name: 'tabs.rotations' }));
    fireEvent.click(screen.getByRole('button', { name: 'rotations.assignStaff' }));

    const dialog = screen.getByRole('dialog');
    const selects = within(dialog).getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });
    fireEvent.change(selects[1], { target: { value: '5' } });
    fireEvent.change(getDateInputs(dialog)[0], { target: { value: '2026-07-27' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'rotations.assignToRotation' }));

    expect(mocks.assignRotation).toHaveBeenCalledWith({
      staffId: 1,
      patternId: 5,
      startDate: '2026-07-27',
      cycleOffset: 0,
      idempotencyKey: expect.stringMatching(/^rotation:assign:/),
    });
  });

  it('sends the documented holiday body', () => {
    render(createElement(DutyRoster));
    fireEvent.click(screen.getByRole('button', { name: 'tabs.holidays' }));
    fireEvent.click(screen.getByRole('button', { name: 'holidays.addHoliday' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('holidays.holidayNamePlaceholder'), {
      target: { value: 'Victory Day' },
    });
    fireEvent.change(getDateInputs(dialog)[0], { target: { value: '2026-12-16' } });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'public' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'holidays.addHolidayButton' }));

    expect(mocks.holiday).toHaveBeenCalledWith({
      holidayName: 'Victory Day',
      holidayDate: '2026-12-16',
      holidayType: 'public',
    });
  });

  it('sends the documented overtime-rule body', () => {
    render(createElement(DutyRoster));
    fireEvent.click(screen.getByRole('button', { name: 'tabs.overtime' }));
    fireEvent.click(screen.getByRole('button', { name: 'overtime.addRule' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('overtime.ruleNamePlaceholder'), {
      target: { value: 'Weekday overtime' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'overtime.addRuleButton' }));

    expect(mocks.overtime).toHaveBeenCalledWith({
      ruleName: 'Weekday overtime',
      multiplier: 1.5,
      minHoursBeforeOt: 8,
      maxOtHoursPerDay: 4,
      appliesOn: 'weekday',
    });
  });

  it('does not render a destructive overtime action without a reviewed lifecycle endpoint', () => {
    render(createElement(DutyRoster));
    fireEvent.click(screen.getByRole('button', { name: 'tabs.overtime' }));

    expect(screen.getByText('Weekday overtime')).toBeInTheDocument();
    expect(screen.queryByText('common:actions')).not.toBeInTheDocument();
  });

  it('requires and sends an explicit cancellation reason', () => {
    mocks.rosterMode = 'assigned';
    render(createElement(DutyRoster));

    fireEvent.click(screen.getByRole('button', { name: 'M' }));
    fireEvent.click(screen.getByRole('button', { name: 'roster.cancelAssignment' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('roster.cancelReasonPlaceholder'), {
      target: { value: 'Coverage changed' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'roster.confirmCancel' }));

    expect(mocks.cancel).toHaveBeenCalledWith({
      id: '1',
      reason: 'Coverage changed',
      idempotencyKey: expect.stringMatching(/^roster:cancel:1:1:/),
    });
  });

  it('sends an explicit two-way swap target and reason', () => {
    mocks.rosterMode = 'assigned';
    render(createElement(DutyRoster));

    fireEvent.click(screen.getByRole('button', { name: 'M' }));
    fireEvent.click(screen.getByRole('button', { name: 'roster.swapAssignment' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '2' } });
    fireEvent.change(within(dialog).getByPlaceholderText('roster.swapReasonPlaceholder'), {
      target: { value: 'Emergency coverage' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'roster.confirmSwap' }));

    expect(mocks.swap).toHaveBeenCalledWith({
      id: '1',
      swapWithStaffId: 2,
      reason: 'Emergency coverage',
      idempotencyKey: expect.stringMatching(/^roster:swap:1:2:1:/),
    });
  });

  it('locks destructive assignment actions while a mutation is pending', () => {
    mocks.rosterMode = 'assigned';
    mocks.pending.cancel = true;
    render(createElement(DutyRoster));

    fireEvent.click(screen.getByRole('button', { name: 'M' }));
    expect(screen.getByRole('button', { name: 'roster.cancelAssignment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'roster.swapAssignment' })).toBeDisabled();
  });

  it('surfaces the safe API error message instead of replacing it with a generic failure', () => {
    render(createElement(DutyRoster));
    const onError = mocks.options.get('cancel')?.onError;

    act(() => onError?.(new Error('Roster is locked')));

    expect(mocks.toastError).toHaveBeenCalledWith('Roster is locked');
  });

  it('shows bulk and generation outcome counts returned by the API', () => {
    render(createElement(DutyRoster));

    act(() => {
      mocks.options.get('/api/hr/roster/bulk')?.onSuccess?.({
        data: { created: 3, updated: 1, skipped: 2 },
      });
      mocks.options.get('/api/hr/roster/generate')?.onSuccess?.({
        data: { created: 4, unchanged: 2, skipped: 1 },
      });
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith('toast.bulkAssignmentResult:3:1:2');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('toast.generationResult:4:2:1');
  });
});
