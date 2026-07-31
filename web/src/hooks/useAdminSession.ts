/**
 * useAdminSession — reactive super-admin session hook.
 *
 * Mirrors `useAuth` for the super-admin flow. The actual JWT lives in
 * the HttpOnly `admin_token` cookie and is unreadable from JavaScript
 * (P0-34). This hook only exposes the *indicator* (userId, role, name,
 * email) that `adminSessionStore` keeps in memory.
 */
import { useSyncExternalStore } from 'react';
import {
  _adminSessionStoreInternals,
  getAdminSession,
  isAdminAuthenticated,
  type AdminSessionRole,
} from '../lib/adminSessionStore';

export interface AdminSessionState {
  isAuthenticated: boolean;
  user: {
    userId: string;
    role: AdminSessionRole;
    name: string;
    email: string;
  } | null;
}

export function useAdminSession(): AdminSessionState {
  useSyncExternalStore(
    _adminSessionStoreInternals.subscribe,
    _adminSessionStoreInternals.getSnapshot,
    _adminSessionStoreInternals.getServerSnapshot,
  );

  if (!isAdminAuthenticated()) {
    return { isAuthenticated: false, user: null };
  }
  const session = getAdminSession();
  if (!session) {
    return { isAuthenticated: false, user: null };
  }
  return {
    isAuthenticated: true,
    user: {
      userId: session.userId,
      role: session.role,
      name: session.name,
      email: session.email,
    },
  };
}
