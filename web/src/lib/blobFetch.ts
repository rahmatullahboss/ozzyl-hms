import { getAccessToken, getWorkstationId } from './apiClient';
import { getTenantSlugFromPath } from '../hooks/useTenantSlug';

export async function apiBlob(path: string): Promise<Blob> {
  const token = getAccessToken();
  const tenantSlug = getTenantSlugFromPath();
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantSlug ? { 'X-Tenant-Subdomain': tenantSlug } : {}),
      'X-HMS-Workstation-ID': getWorkstationId(),
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = await response.clone().json() as { error?: string; message?: string };
      message = payload.error ?? payload.message ?? message;
    } catch {
      // Blob endpoints may return an empty or non-JSON error response.
    }
    throw new Error(message);
  }

  return response.blob();
}
