import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BackupSettings from './BackupSettings';
import { useApiMutation } from '../hooks/useApiQuery';

const mutateMock = vi.fn();

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

vi.mock('../hooks/useSettingsForm', () => ({
  useSettingsForm: () => ({
    values: {
      last_backup_at: '2026-05-29T06:00:00.000Z',
      last_backup_status: 'requested',
      auto_backup_enabled: true,
      auto_backup_time: '02:00',
      auto_backup_frequency: 'daily',
    },
    update: vi.fn(),
    save: vi.fn(),
    loading: false,
    saving: false,
  }),
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

describe('BackupSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiMutation as any).mockReturnValue({ mutate: mutateMock, isPending: false });
  });

  it('shows a safe backup request workflow instead of pretending to complete a database dump', () => {
    render(<BackupSettings role="hospital_admin" />);

    expect(screen.getByText(/Requested/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create backup request/i }));

    expect(useApiMutation).toHaveBeenCalledWith(
      'post',
      '/api/backup/create',
      expect.any(Object),
    );
    expect(mutateMock).toHaveBeenCalled();
  });
});
