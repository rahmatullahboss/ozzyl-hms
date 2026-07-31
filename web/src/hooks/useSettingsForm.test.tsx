import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsForm } from './useSettingsForm';

vi.mock('../lib/apiClient', async () => {
  const actual = await vi.importActual<typeof import('../lib/apiClient')>('../lib/apiClient');
  return {
    ...actual,
    api: {
      get: vi.fn(),
      put: vi.fn(),
    },
    getToken: vi.fn(() => 'mock-token'),
  };
});

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { api } from '../lib/apiClient';

const mockedApi = api as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useSettingsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.get.mockResolvedValue({ settings: {} });
    mockedApi.put.mockResolvedValue({ success: true });
  });

  it('omits null and undefined values when saving bulk settings', async () => {
    const { result } = renderHook(
      () => useSettingsForm({
        queryKey: ['settings', 'backup'],
        prefix: 'backup_',
        defaultValues: {
          last_backup_at: null,
          last_error: undefined as string | undefined,
          auto_backup_enabled: true,
          retention_days: 30,
        },
      }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save();
    });

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledTimes(1));
    expect(mockedApi.put).toHaveBeenCalledWith('/api/settings', {
      backup_auto_backup_enabled: true,
      backup_retention_days: 30,
    });
  });
});
