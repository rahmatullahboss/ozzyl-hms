import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { api } from '../services/api';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  // Login no longer takes a token — the server sets it as an httpOnly cookie
  // and the browser stores/sends it automatically.
  login: (user: AuthUser) => void;
  logout: () => Promise<void>;
  markSessionExpired: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionExpired: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // We persist only the non-sensitive user profile to localStorage so the
  // sidebar can show the admin's name while the session is being verified.
  // The JWT itself lives in an httpOnly cookie that JavaScript cannot read.
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem('admin_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const verifySession = async () => {
      // If we have no cached user, skip the network call.
      if (!localStorage.getItem('admin_user')) {
        setIsLoading(false);
        return;
      }

      try {
        // Cookie is sent automatically; the server will 401 if it's missing
        // or expired. The api client throws on 401 and triggers the
        // session-expired handler (which clears local state).
        await api.stats.get();
      } catch {
        // Network error or 401 — keep cached user; the next protected
        // request will trigger the proper session-expired flow.
      } finally {
        setIsLoading(false);
      }
    };

    verifySession();
  }, []);

  const login = useCallback((userData: AuthUser) => {
    localStorage.setItem('admin_user', JSON.stringify(userData));
    setUser(userData);
    setSessionExpired(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      // Ask the server to clear the admin_token cookie. Errors are
      // swallowed because local cleanup should happen regardless.
      await api.auth.logout();
    } catch (err) {
      console.error('Logout request failed:', err);
    }
    localStorage.removeItem('admin_user');
    localStorage.removeItem('admin_super_token');
    localStorage.removeItem('admin_impersonating');
    setUser(null);
    setSessionExpired(false);
  }, []);

  // Called by the api client when a 401 is observed. Clears credentials and
  // signals to the UI that the user should be bounced to /login with a
  // "session expired" toast instead of a generic crash.
  const markSessionExpired = useCallback(() => {
    localStorage.removeItem('admin_user');
    setUser(null);
    setSessionExpired(true);
  }, []);

  // Wire the api client to our session-expired signal.
  useEffect(() => {
    import('../services/api').then((m) => m.setSessionExpiredHandler(markSessionExpired));
    return () => {
      import('../services/api').then((m) => m.setSessionExpiredHandler(null));
    };
  }, [markSessionExpired]);

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        markSessionExpired,
        isAuthenticated: !!user,
        isLoading,
        sessionExpired,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
