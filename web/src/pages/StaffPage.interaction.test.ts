import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StaffPage from './StaffPage';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidateQueries: vi.fn(),
  mode: 'empty' as 'empty' | 'existing',
  pending: {} as Record<string, boolean>,
  options: new Map<string, Record<string, (...args: unknown[]) => unknown>>(),
}));

const existingStaff = {
  id: 11,
  name: 'Nurse Fatima',
  address: '',
  position: 'Nurse',
  salary: 22000,
  bank_account: 'BANK-1',
  mobile: '01700000000',
  joining_date: '2026-01-01',
  status: 'active',
  department: 'ICU',
  email: 'fatima@example.com',
  user_id: null,
};

vi.mock('react-hot-toast', () => ({
  default: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

vi.mock('../components/dashboard/KPICard', () => ({
  default: ({ title }: { title: string }) => createElement('div', null, title),
}));

vi.mock('../components/dashboard/EmptyState', () => ({
  default: ({ title, action }: { title: string; action?: ReactNode }) => createElement('div', null, title, action),
}));

vi.mock('../hooks/useFmt', () => ({
  useFmt: () => ({
    fmtCurrency: (value: number) => String(value),
    fmtDate: (value: string) => value,
  }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { permissions: ['*'] } }),
}));

vi.mock('../lib/apiClient', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn((_queryKey: unknown, path: string) => {
    if (path === '/api/staff') {
      return {
        data: { staff: mocks.mode === 'existing' ? [existingStaff] : [] },
        isLoading: false,
      };
    }
    if (path === '/api/hr/attendance/shifts') return { data: { data: [] }, isLoading: false };
    return { data: undefined, isLoading: false };
  }),
  useApiMutation: vi.fn((method: string, pathOrFn: string | ((value: unknown) => string), options?: Record<string, (...args: unknown[]) => unknown>) => {
    const key = typeof pathOrFn === 'string'
      ? pathOrFn
      : method === 'put'
        ? 'update'
        : 'remove';
    if (options) mocks.options.set(key, options);
    const mutate = key === '/api/staff'
      ? mocks.create
      : key === 'update'
        ? mocks.update
        : mocks.remove;
    return { mutate, mutateAsync: vi.fn(), isPending: Boolean(mocks.pending[key]) };
  }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.clear();
  mocks.mode = 'empty';
  for (const key of Object.keys(mocks.pending)) delete mocks.pending[key];
});

function openCreateDrawer() {
  render(createElement(StaffPage));
  fireEvent.click(screen.getByRole('button', { name: 'staff:addStaff' }));
}

describe('StaffPage interactions', () => {
  it('submits the exact camelCase operational staff payload without invitation-only fields', () => {
    openCreateDrawer();

    fireEvent.change(screen.getByPlaceholderText('staff:fullNameStaff'), {
      target: { value: 'Rahim Uddin' },
    });
    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'receptionist' },
    });
    fireEvent.change(screen.getByPlaceholderText('staff:mobilePlaceholder'), {
      target: { value: '01711111111' },
    });
    fireEvent.change(screen.getByPlaceholderText('staff@example.com'), {
      target: { value: 'rahim@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'staff:addStaffBtn' }));

    expect(mocks.create).toHaveBeenCalledWith({
      name: 'Rahim Uddin',
      address: '',
      position: 'Receptionist',
      department: '',
      mobile: '01711111111',
      email: 'rahim@example.com',
      salary: 0,
      bankAccount: '',
      joiningDate: '2026-07-27',
      emergencyContact: undefined,
      bloodGroup: undefined,
      category: 'receptionist',
      biometricDeviceId: undefined,
      shiftType: undefined,
    });
  });

  it('locks the save action while create is pending', () => {
    mocks.pending['/api/staff'] = true;
    openCreateDrawer();

    expect(screen.getByRole('button', { name: 'common:saving' })).toBeDisabled();
  });

  it('routes edit by id while stripping the id from the PUT JSON body', () => {
    mocks.mode = 'existing';
    render(createElement(StaffPage));

    fireEvent.click(screen.getByText('Nurse Fatima'));
    fireEvent.change(screen.getByPlaceholderText('staff:fullNameStaff'), {
      target: { value: 'Nurse Fatima Akter' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:save' }));

    const variables = mocks.update.mock.calls[0][0] as Record<string, unknown>;
    expect(variables).toMatchObject({ id: 11, name: 'Nurse Fatima Akter', category: 'nurse' });
    const body = mocks.options.get('update')?.body?.(variables) as Record<string, unknown>;
    expect(body).not.toHaveProperty('id');
    expect(body).toMatchObject({ name: 'Nurse Fatima Akter', position: 'Nurse', category: 'nurse' });
  });

  it('surfaces the API error returned by staff create/update', () => {
    openCreateDrawer();

    act(() => mocks.options.get('/api/staff')?.onError?.(new Error('Duplicate mobile number')));

    expect(mocks.toastError).toHaveBeenCalledWith('Duplicate mobile number');
  });
});
