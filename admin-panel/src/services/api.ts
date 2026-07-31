const API_BASE = '';

/**
 * Hook for the AuthProvider to register a 401 handler. When the api client
 * sees a 401 it calls this so the UI can surface a "session expired" message
 * and bounce the user to /login cleanly.
 */
let sessionExpiredHandler: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

async function fetchApi<T>(url: string, options: RequestInit = {}): Promise<T> {
  // Auth is delivered via httpOnly `admin_token` cookie. The browser sends
  // the cookie automatically on same-origin requests when credentials is
  // 'include'. We never read the token from JavaScript — XSS cannot exfiltrate
  // an httpOnly cookie.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401) {
      // The server has already (or will, on logout) cleared the cookie.
      // Drop the cached user profile from localStorage and signal auth.
      localStorage.removeItem('admin_user');
      try {
        sessionExpiredHandler?.();
      } catch (handlerErr) {
        console.error('sessionExpiredHandler threw:', handlerErr);
      }
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Session expired');
    }
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

async function loginRequest(url: string, email: string, password: string) {
  const response = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({ error: 'Login failed' }));
  return { ok: response.ok, status: response.status, body };
}

export const api = {
  auth: {
    // Returns just the user profile; the JWT is delivered via Set-Cookie.
    // Try super-admin login first, then platform-staff login. Both use the
    // same httpOnly admin_token cookie contract and never expose the JWT to JS.
    login: async (email: string, password: string) => {
      const admin = await loginRequest('/api/admin/login', email, password);
      if (admin.ok) return admin.body as { user: { id: string; email: string; name: string; role: string } };

      const staff = await loginRequest('/api/admin/platform-staff/login', email, password);
      if (staff.ok) return staff.body as { user: { id: string; email: string; name: string; role: string } };

      throw new Error((staff.body as { error?: string }).error || (admin.body as { error?: string }).error || 'Invalid credentials');
    },
    // Calls the server endpoint that clears the admin_token cookie.
    logout: () => fetchApi<{ success: true }>('/api/admin/logout', { method: 'POST' }),
  },

  stats: {
    get: (sinceDays?: number) => {
      const q = sinceDays ? `?since=${sinceDays}` : '';
      return fetchApi<import('../types').PlatformStats & { since?: number }>(`/api/admin/stats${q}`);
    },
  },

  hospitals: {
    list: (page = 1, limit = 50, search?: string) => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.append('search', search);
      return fetchApi<{ hospitals: import('../types').Hospital[]; pagination: import('../types').Pagination }>(`/api/admin/hospitals?${params}`);
    },
    get: (id: number) => fetchApi<{ hospital: import('../types').HospitalDetail }>(`/api/admin/hospitals/${id}`),
    create: (data: { name: string; subdomain: string; adminEmail?: string; adminName?: string; adminPassword?: string }) =>
      fetchApi<{ message: string; hospital: { id: number; name: string; subdomain: string } }>('/api/admin/hospitals', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: { name?: string; status?: string; plan?: string }) =>
      fetchApi<{ message: string }>(`/api/admin/hospitals/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      fetchApi<{ message: string }>(`/api/admin/hospitals/${id}`, { method: 'DELETE' }),
    updateAddons: (id: number, addons: string[]) =>
      fetchApi<{ success: boolean }>(`/api/admin/hospitals/${id}/addons`, {
        method: 'PATCH',
        body: JSON.stringify({ addons }),
      }),
  },

  users: {
    list: (page = 1, limit = 50, search?: string) => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.append('search', search);
      return fetchApi<{ users: import('../types').User[]; pagination: import('../types').Pagination }>(`/api/admin/users?${params}`);
    },
  },

  auditLogs: {
    list: (page = 1, limit = 50, search?: string) => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.append('search', search);
      return fetchApi<{ logs: import('../types').AuditLog[]; pagination: import('../types').Pagination }>(`/api/admin/audit-logs?${params}`);
    },
  },

  onboarding: {
    list: (status?: string) => {
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      return fetchApi<{ requests: import('../types').OnboardingRequest[] }>(`/api/admin/onboarding?${params}`);
    },
    update: (id: string, data: { status: string; notes?: string }) =>
      fetchApi<{ message: string }>(`/api/admin/onboarding/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    provision: (id: string, data: { slug: string; adminEmail: string; adminName: string; plan: string }) =>
      fetchApi<{ message: string; hospital: object; credentials: object }>(`/api/admin/onboarding/${id}/provision`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  systemHealth: {
    get: () => fetchApi<import('../types').SystemHealth>('/api/admin/system-health'),
  },

  impersonate: {
    start: (tenantId: number) =>
      fetchApi<{ token: string; tenant: object; redirectUrl: string }>(`/api/admin/impersonate/${tenantId}`, {
        method: 'POST',
      }),
  },

  platformStaff: {
    hospitals: () => fetchApi<{ hospitals: Array<{ id: number; name: string; subdomain: string; status: string; plan: string }> }>('/api/admin/platform-staff/hospitals'),
    list: () => fetchApi<{ staff: import('../types').PlatformStaffAccount[] }>('/api/admin/platform-staff'),
    create: (data: { email: string; password: string; name: string; role: import('../types').PlatformRole }) =>
      fetchApi<{ staffId: number }>('/api/admin/platform-staff', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: { name?: string; role?: import('../types').PlatformRole; is_active?: number }) =>
      fetchApi<{ message: string }>(`/api/admin/platform-staff/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    resetPassword: (id: number, password: string) =>
      fetchApi<{ message: string }>(`/api/admin/platform-staff/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    myGrants: () =>
      fetchApi<{ grants: import('../types').PlatformTenantGrant[] }>('/api/admin/platform-staff/my-grants'),
    grants: (id: number) =>
      fetchApi<{ grants: import('../types').PlatformTenantGrant[] }>(`/api/admin/platform-staff/${id}/grants`),
    grant: (id: number, data: { tenantId: number; allowedRole: import('../types').TenantRole; reason: string; expiresAt?: string }) =>
      fetchApi<{ grantId: number }>(`/api/admin/platform-staff/${id}/grants`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    revokeGrant: (id: number, grantId: number) =>
      fetchApi<{ message: string }>(`/api/admin/platform-staff/${id}/grants/${grantId}`, {
        method: 'DELETE',
      }),
    impersonate: (tenantId: number, data?: { reason?: string; targetUserId?: number }) =>
      fetchApi<import('../types').PlatformImpersonationResponse>(`/api/admin/platform-staff/impersonate/${tenantId}`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }),
  },

  /**
   * Remote Control endpoints. Backed by /api/admin/remote/* on the worker.
   * Each call is a real backend operation — the UI surfaces success/error
   * via toasts and disables the button while the request is in flight.
   */
  remote: {
    setMaintenance: (enabled: boolean) =>
      fetchApi<{ enabled: boolean }>('/api/admin/remote/maintenance', {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      }),
    broadcast: (target: 'all' | number, message: string) =>
      fetchApi<{ sent: number; target: 'all' | number }>('/api/admin/remote/broadcast', {
        method: 'POST',
        body: JSON.stringify({ target, message }),
      }),
    revokeSessions: (scope: 'admins' | 'all' = 'admins') =>
      fetchApi<{ revoked: number; scope: 'admins' | 'all'; epoch: number }>(
        '/api/admin/remote/revoke-sessions',
        { method: 'POST', body: JSON.stringify({ scope }) },
      ),
  },

  /**
   * Local Schema Sync endpoints — talks to the local-server worker
   * (separate from the main /api/admin/* router). The api client still
   * adds the bearer token, so auth is preserved.
   */
  localSchema: {
    status: () => fetchApi<{ lastSyncAt: string | null; appliedCount: number; pendingCount: number; dryRun: boolean }>('/api/local-server/schema-sync/status'),
    approvals: () => fetchApi<{ approvals: Array<{ id: number; filename: string; sql_content: string; status: string; apply_error: string | null; detected_at: string }> }>('/api/local-server/schema-sync/approvals'),
    log: (limit = 50) => fetchApi<{ log: Array<{ id: number; filename: string; event: string; actor: string | null; message: string | null; created_at: string }> }>(`/api/local-server/schema-sync/log?limit=${limit}`),
    approve: (filename: string) =>
      fetchApi<{ ok: true }>(`/api/local-server/schema-sync/approvals/${encodeURIComponent(filename)}/approve`, {
        method: 'POST',
      }),
    reject: (filename: string) =>
      fetchApi<{ ok: true }>(`/api/local-server/schema-sync/approvals/${encodeURIComponent(filename)}/reject`, {
        method: 'POST',
      }),
  },
};
