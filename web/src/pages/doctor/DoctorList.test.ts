import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseApiQuery = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn());
const mockDeactivateMutate = vi.hoisted(() => vi.fn());
const mockActivateMutate = vi.hoisted(() => vi.fn());
const mockPublishMutate = vi.hoisted(() => vi.fn());
const mockInviteMutate = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('../../components/doctor/DoctorDrawer', () => ({
  DoctorDrawer: () => null,
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  useApiMutation: (_method: string, pathOrFn: string | ((vars: unknown) => string)) => {
    const samplePath = typeof pathOrFn === 'function' ? pathOrFn(501) : pathOrFn;
    if (String(samplePath).includes('/deactivate')) return { mutate: mockDeactivateMutate, isPending: false };
    if (String(samplePath).includes('/activate')) return { mutate: mockActivateMutate, isPending: false };
    if (String(samplePath).includes('/publish')) return { mutate: mockPublishMutate, isPending: false };
    if (String(samplePath).includes('/invite')) return { mutate: mockInviteMutate, isPending: false };
    return { mutate: vi.fn(), isPending: false };
  },
}));

const doctors = [
  {
    id: 501,
    name: 'Dr Active',
    specialty: 'Medicine',
    department: 'OPD',
    consultation_fee: 500,
    is_active: 1,
    is_marketplace_visible: 1,
  },
  {
    id: 502,
    name: 'Dr Inactive',
    specialty: 'Kidney',
    department: 'OPD',
    consultation_fee: 700,
    is_active: 0,
    is_marketplace_visible: 0,
  },
];

async function renderDoctorList() {
  const mod = await import('./DoctorList');
  return render(React.createElement(mod.default));
}

describe('DoctorList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiQuery.mockReturnValue({ data: { doctors }, isLoading: false });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DoctorList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('loads all doctors so inactive doctors can be seen and reactivated', async () => {
    await renderDoctorList();

    expect(mockUseApiQuery).toHaveBeenCalledWith(
      expect.arrayContaining(['doctors', 'list']),
      '/api/doctors?is_active=all',
    );
    expect(screen.getByText('Dr Inactive')).toBeInTheDocument();
    expect(screen.getAllByText('Inactive').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(mockActivateMutate).toHaveBeenCalledWith(502);
  });

  it('requires confirmation before deactivating an active doctor', async () => {
    await renderDoctorList();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Dr Active'));
    expect(mockDeactivateMutate).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(mockDeactivateMutate).toHaveBeenCalledWith(501);
  });
});
