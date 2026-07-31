/**
 * apiClient — central fetch wrapper that automatically:
 * 1. Adds Authorization: Bearer <token> header from localStorage
 * 2. Adds X-Tenant-Subdomain: <slug> header from the current URL path
 * 3. Handles JSON encoding/decoding
 * 4. Throws on non-2xx responses with a parsed error message
 */

import { getToken } from '../hooks/useAuth';
import { getTenantSlugFromPath } from '../hooks/useTenantSlug';

export interface ApiError {
  message: string;
  status: number;
}

export class ApiClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiClientError';
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const token = getToken();
  const slug = getTenantSlugFromPath();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(slug ? { 'X-Tenant-Subdomain': slug } : {}),
    ...options.headers,
  };

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const errMsg =
      (data as { error?: string })?.error ??
      (data as { message?: string })?.message ??
      `Request failed with status ${res.status}`;
    throw new ApiClientError(errMsg, res.status);
  }

  return data as T;
}

// ─── Convenience helpers ────────────────────────────────────────────────
export const api = {
  get: <T>(path: string, headers?: Record<string, string>) =>
    apiFetch<T>(path, { method: 'GET', headers }),

  post: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    apiFetch<T>(path, { method: 'POST', body, headers }),

  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body }),

  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body }),

  delete: <T>(path: string) =>
    apiFetch<T>(path, { method: 'DELETE' }),
};
