/**
 * apiClient — central fetch wrapper that automatically:
 * 1. Adds Authorization: Bearer <token> header from the in-memory token store
 *    (P0-34: token no longer lives in localStorage; see `lib/tokenStore.ts`).
 * 2. Adds X-Tenant-Subdomain: <slug> header from the current URL path
 * 3. Adds X-HMS-Workstation-ID so counter sessions can stay bound to one computer
 * 4. Handles JSON encoding/decoding
 * 5. Throws on non-2xx responses with a parsed error message
 */

import { getAccessToken } from './tokenStore';
import { getTenantSlugFromPath } from '../hooks/useTenantSlug';

export { getAccessToken };

/**
 * @deprecated use `getAccessToken` from `lib/tokenStore` instead.
 * Kept as a thin alias so older imports do not break. The token lives
 * in memory (P0-34); see lib/tokenStore.ts.
 */
export function getToken(): string | null {
  return getAccessToken();
}

export interface ApiError {
  message: string;
  status: number;
}

export class ApiClientError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
    this.name = 'ApiClientError';
  }
}

export class ApiRequestTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly path: string;

  constructor(path: string, timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'ApiRequestTimeoutError';
    this.path = path;
    this.timeoutMs = timeoutMs;
  }
}

export function isRetryableApiTransportError(error: unknown): boolean {
  if (error instanceof ApiRequestTimeoutError) return true;
  return error instanceof TypeError && /network|failed to fetch|load failed|fetch/i.test(error.message);
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

const inFlightGetRequests = new Map<string, Promise<unknown>>();
const WORKSTATION_STORAGE_KEY = 'hms.workstationId';

function createWorkstationId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `hms-ws-${random}`;
}

export function getWorkstationId(): string {
  try {
    const existing = globalThis.localStorage?.getItem(WORKSTATION_STORAGE_KEY);
    if (existing) return existing;
    const created = createWorkstationId();
    globalThis.localStorage?.setItem(WORKSTATION_STORAGE_KEY, created);
    return created;
  } catch {
    return createWorkstationId();
  }
}

function getInFlightKey(path: string, headers: Record<string, string>): string {
  return [
    path,
    headers.Authorization ?? '',
    headers['X-Tenant-Subdomain'] ?? '',
  ].join('|');
}

function buildApiHeaders(options: RequestOptions = {}): Record<string, string> {
  const token = getAccessToken();
  const slug = getTenantSlugFromPath();
  const isFormData = options.body instanceof FormData;

  return {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(slug ? { 'X-Tenant-Subdomain': slug } : {}),
    'X-HMS-Workstation-ID': getWorkstationId(),
    ...options.headers,
  };
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers = buildApiHeaders(options);

  const method = options.method ?? 'GET';
  const configuredTimeoutMs = Number(options.timeoutMs ?? 0);
  const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? Math.floor(configuredTimeoutMs)
    : null;
  const request = async (): Promise<T> => {
    const controller = timeoutMs ? new AbortController() : null;
    const timeoutId = controller && timeoutMs !== null
      ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const res = await fetch(path, {
        method,
        headers,
        // P0-34 follow-up: include the HttpOnly staff session cookie on
        // /api/auth/refresh + /api/auth/logout so the SPA can recover its
        // in-memory access token after a hard reload. The cookie is
        // scoped to /api/auth so it is NOT attached to other API calls.
        credentials: 'include',
        body: options.body !== undefined
          ? (isFormData ? (options.body as any) : JSON.stringify(options.body))
          : undefined,
        ...(controller ? { signal: controller.signal } : {}),
      });

      let data: unknown;
      try {
        data = await res.json();
      } catch (error) {
        if (controller?.signal.aborted) throw error;
        data = null;
      }

      if (!res.ok) {
        let errMsg = `Request failed with status ${res.status}`;
        if (data && typeof data === 'object') {
          const d = data as any;
          if (typeof d.error === 'string') {
            errMsg = d.error;
          } else if (d.error && typeof d.error === 'object' && Array.isArray(d.error.issues)) {
            errMsg = d.error.issues[0]?.message || 'Validation error';
          } else if (typeof d.message === 'string') {
            errMsg = d.message;
          }
        }
        throw new ApiClientError(errMsg, res.status, data);
      }

      return data as T;
    } catch (error) {
      if (controller?.signal.aborted && timeoutMs) {
        throw new ApiRequestTimeoutError(path, timeoutMs);
      }
      throw error;
    } finally {
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    }
  };

  if (method === 'GET' && options.body === undefined) {
    const key = getInFlightKey(path, headers);
    const existing = inFlightGetRequests.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = request();
    inFlightGetRequests.set(key, pending);
    try {
      return await pending;
    } finally {
      inFlightGetRequests.delete(key);
    }
  }

  return request();
}

export async function apiTextFetch(
  path: string,
  options: RequestOptions = {}
): Promise<string> {
  const isFormData = options.body instanceof FormData;
  const headers = buildApiHeaders(options);
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined
      ? (isFormData ? (options.body as any) : JSON.stringify(options.body))
      : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    let errMsg = `Request failed with status ${res.status}`;
    try {
      const data = JSON.parse(text);
      if (typeof data?.message === 'string') errMsg = data.message;
      else if (typeof data?.error === 'string') errMsg = data.error;
    } catch {
      if (text.trim()) errMsg = text.trim().slice(0, 240);
    }
    throw new ApiClientError(errMsg, res.status, text);
  }

  return text;
}

// ─── Convenience helpers ────────────────────────────────────────────────
export const api = {
  get: <T>(path: string, headers?: Record<string, string>) =>
    apiFetch<T>(path, { method: 'GET', headers }),

  text: (path: string, headers?: Record<string, string>) =>
    apiTextFetch(path, { method: 'GET', headers }),

  post: <T>(path: string, body: unknown, headers?: Record<string, string>, timeoutMs?: number) =>
    apiFetch<T>(path, { method: 'POST', body, headers, timeoutMs }),

  put: <T>(path: string, body: unknown, timeoutMs?: number) =>
    apiFetch<T>(path, { method: 'PUT', body, timeoutMs }),

  patch: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    apiFetch<T>(path, { method: 'PATCH', body, timeoutMs }),

  delete: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    apiFetch<T>(path, { method: 'DELETE', body, timeoutMs }),
};
