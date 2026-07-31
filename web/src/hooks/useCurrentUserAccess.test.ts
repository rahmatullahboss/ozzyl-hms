import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApiQuery } from './useApiQuery';
import { useCurrentUserAccess } from './useCurrentUserAccess';

vi.mock('./useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

const mockedUseApiQuery = vi.mocked(useApiQuery);

describe('useCurrentUserAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseApiQuery.mockReturnValue({} as ReturnType<typeof useApiQuery>);
  });

  it('never reuses a previous user access profile while a new auth-scoped query loads', () => {
    useCurrentUserAccess(true);

    expect(mockedUseApiQuery).toHaveBeenCalledWith(
      ['access-control', 'current-user', 'workspaces'],
      '/api/access-control/current-user/workspaces',
      expect.objectContaining({
        enabled: true,
        placeholderData: undefined,
      }),
    );
  });
});
