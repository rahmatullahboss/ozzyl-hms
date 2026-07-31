import { apiFetch } from './apiClient';

/**
 * Shared API wrapper for Super Admin API calls.
 * Exposes the same .get/.post/.put/.patch/.delete interface
 * that the SuperAdmin pages expect, backed by apiFetch.
 *
 * apiFetch already adds the Authorization header from the
 * standard token store, so no interceptor is needed.
 *
 * Returns `{ data }` to match the axios-style destructuring
 * pattern used by all SuperAdmin pages.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminResponse<T = any> = { data: T };

const adminApi = {
  get: <T = any>(path: string): Promise<AdminResponse<T>> =>
    apiFetch<T>(`/api/admin${path}`).then(data => ({ data })),

  post: <T = any>(path: string, body?: unknown): Promise<AdminResponse<T>> =>
    apiFetch<T>(`/api/admin${path}`, { method: 'POST', body }).then(data => ({ data })),

  put: <T = any>(path: string, body?: unknown): Promise<AdminResponse<T>> =>
    apiFetch<T>(`/api/admin${path}`, { method: 'PUT', body }).then(data => ({ data })),

  patch: <T = any>(path: string, body?: unknown): Promise<AdminResponse<T>> =>
    apiFetch<T>(`/api/admin${path}`, { method: 'PATCH', body }).then(data => ({ data })),

  delete: <T = any>(path: string): Promise<AdminResponse<T>> =>
    apiFetch<T>(`/api/admin${path}`, { method: 'DELETE' }).then(data => ({ data })),
};

export default adminApi;
