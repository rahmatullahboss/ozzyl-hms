/**
 * Global Axios interceptor — automatically adds:
 * 1. Authorization: Bearer <token> from localStorage
 * 2. X-Tenant-Subdomain: <slug> from the current URL path (/h/:slug/*)
 *
 * This ensures ALL pages using raw `axios` get the correct headers
 * without needing per-component header logic.
 */
import axios from 'axios';
import { getToken } from '../hooks/useAuth';
import { getTenantSlugFromPath } from '../hooks/useTenantSlug';

axios.interceptors.request.use((config) => {
  const token = getToken();
  const slug = getTenantSlugFromPath();

  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (slug && !config.headers['X-Tenant-Subdomain']) {
    config.headers['X-Tenant-Subdomain'] = slug;
  }

  return config;
});
