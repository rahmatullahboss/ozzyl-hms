import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiClientError, api } from './apiClient';

vi.mock('./tokenStore', () => ({
  getAccessToken: vi.fn(() => 'test-token-123'),
}));

vi.mock('../hooks/useTenantSlug', () => ({
  getTenantSlugFromPath: vi.fn(() => 'demo-hospital'),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
});

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

// ─── apiFetch ────────────────────────────────────────────────────────────────

describe('apiFetch', () => {
  it('sends GET request with auth, tenant, and workstation headers', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));

    await apiFetch('/api/test');

    expect(mockFetch).toHaveBeenCalledWith('/api/test', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token-123',
        'X-Tenant-Subdomain': 'demo-hospital',
        'X-HMS-Workstation-ID': expect.stringMatching(/^hms-ws-[a-f0-9-]+$/),
      },
      body: undefined,
      credentials: 'include',
    });
  });

  it('returns parsed JSON on success', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ patients: [1, 2, 3] }));

    const result = await apiFetch<{ patients: number[] }>('/api/patients');

    expect(result.patients).toEqual([1, 2, 3]);
  });

  it('aborts a request after the configured timeout instead of leaving the caller pending forever', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockFetch.mockImplementationOnce((_path: string, options: RequestInit) => {
      capturedSignal = options.signal as AbortSignal | undefined;
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    });

    const pending = apiFetch('/api/slow-refund', { timeoutMs: 10 } as any);

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    await expect(pending).rejects.toMatchObject({
      name: 'ApiRequestTimeoutError',
      timeoutMs: 10,
    });
  });

  it('deduplicates concurrent GET requests with the same tenant and auth context', async () => {
    let resolveFetch!: (response: unknown) => void;
    mockFetch.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));

    const first = apiFetch<{ patients: number[] }>('/api/patients');
    const second = apiFetch<{ patients: number[] }>('/api/patients');

    expect(mockFetch).toHaveBeenCalledTimes(1);

    resolveFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ patients: [1, 2, 3] }),
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { patients: [1, 2, 3] },
      { patients: [1, 2, 3] },
    ]);
  });

  it('sends POST with JSON-stringified body', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 1 }));

    await apiFetch('/api/patients', { method: 'POST', body: { name: 'Test' } });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe('{"name":"Test"}');
  });

  it('throws ApiClientError on non-2xx with server error message', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ error: 'Patient not found' }, 404));

    await expect(apiFetch('/api/patients/999')).rejects.toThrow(ApiClientError);
  });

  it('throws ApiClientError with status code', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ message: 'Unauthorized' }, 401));

    try {
      await apiFetch('/api/protected');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).status).toBe(401);
      expect((err as ApiClientError).message).toBe('Unauthorized');
    }
  });

  it('falls back to generic message when server returns no error field', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve(null),
      }),
    );

    try {
      await apiFetch('/api/broken');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect((err as ApiClientError).message).toBe('Request failed with status 500');
    }
  });
});

// ─── api convenience helpers ─────────────────────────────────────────────────

describe('api helpers', () => {
  it('api.get calls apiFetch with GET', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ data: 'ok' }));
    const result = await api.get('/api/test');
    expect(result).toEqual({ data: 'ok' });
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
  });

  it('api.post calls apiFetch with POST and body', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 1 }));
    await api.post('/api/test', { name: 'x' });
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    expect(mockFetch.mock.calls[0][1].body).toBe('{"name":"x"}');
  });

  it('api.put calls apiFetch with PUT', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));
    await api.put('/api/test/1', { status: 'done' });
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
  });

  it('api.patch calls apiFetch with PATCH', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));
    await api.patch('/api/test/1', { field: 'value' });
    expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
  });

  it('api.delete calls apiFetch with DELETE and no body', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ deleted: true }));
    await api.delete('/api/test/1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
  });
});
