/**
 * Typed fetch client for real-DB integration tests.
 * Provides get/post/put/patch/delete helpers with consistent error reporting.
 */
import { BASE_URL } from './auth';

export { BASE_URL };

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
  headers: Record<string, string>;
}

async function request<T = unknown>(
  method: HttpMethod,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let parsed: T;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    parsed = (await res.json()) as T;
  } else {
    parsed = (await res.text()) as unknown as T;
  }

  // Collect all response headers
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    status: res.status,
    ok: res.ok,
    body: parsed,
    headers: responseHeaders,
  };
}

export const api = {
  get: <T = unknown>(path: string, headers: Record<string, string>) =>
    request<T>('GET', path, headers),

  post: <T = unknown>(path: string, headers: Record<string, string>, body?: unknown) =>
    request<T>('POST', path, headers, body),

  put: <T = unknown>(path: string, headers: Record<string, string>, body?: unknown) =>
    request<T>('PUT', path, headers, body),

  patch: <T = unknown>(path: string, headers: Record<string, string>, body?: unknown) =>
    request<T>('PATCH', path, headers, body),

  delete: <T = unknown>(path: string, headers: Record<string, string>) =>
    request<T>('DELETE', path, headers),
};

/**
 * Check if the wrangler dev server is running.
 * Throws a helpful error if not reachable.
 */
export async function assertServerRunning(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok && res.status !== 404) {
      // 404 is fine — server is up, route just doesn't exist
      return;
    }
  } catch (err) {
    throw new Error(
      `\n\n🚨 Wrangler dev server not running!\n` +
      `Run: npm run dev:api\n` +
      `Then retry: npm run test:real\n` +
      `BASE_URL: ${BASE_URL}\n\n` +
      `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
