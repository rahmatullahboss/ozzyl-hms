import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiClient', () => ({
  getAccessToken: vi.fn(() => 'access-token'),
  getWorkstationId: vi.fn(() => 'workstation-1'),
}));

vi.mock('../hooks/useTenantSlug', () => ({
  getTenantSlugFromPath: vi.fn(() => 'demo-hospital'),
}));

describe('apiBlob', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches blobs with the same tenant, workstation, auth, and session context as apiClient', async () => {
    const blob = new Blob(['voucher'], { type: 'image/webp' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      blob: vi.fn(async () => blob),
    } as unknown as Response);
    const { apiBlob } = await import('./blobFetch');

    await expect(apiBlob('/api/expenses/9/receipt')).resolves.toEqual(blob);
    expect(fetchMock).toHaveBeenCalledWith('/api/expenses/9/receipt', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer access-token',
        'X-Tenant-Subdomain': 'demo-hospital',
        'X-HMS-Workstation-ID': 'workstation-1',
      },
    });
  });

  it('throws the API error message when a blob request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      clone: () => ({ json: async () => ({ error: 'Voucher access denied' }) }),
    } as unknown as Response);
    const { apiBlob } = await import('./blobFetch');

    try {
      await apiBlob('/api/expenses/9/receipt');
      throw new Error('Expected apiBlob to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Voucher access denied');
    }
  });
});
