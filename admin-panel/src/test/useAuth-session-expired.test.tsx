import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth, AuthProvider } from '../hooks/useAuth';

describe('useAuth — session-expired signal', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('exposes a sessionExpired flag that starts false', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(result.current.sessionExpired).toBe(false);
  });

  it('markSessionExpired() flips the flag to true', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => {
      result.current.markSessionExpired();
    });
    expect(result.current.sessionExpired).toBe(true);
  });

  it('markSessionExpired() clears the stored user profile from localStorage', () => {
    localStorage.setItem('admin_user', JSON.stringify({ id: '1', email: 'a@b.c', name: 'A', role: 'super_admin' }));
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => {
      result.current.markSessionExpired();
    });
    // admin_user is the only localStorage key the auth context owns now;
    // the JWT itself is in an httpOnly cookie that the server clears.
    expect(localStorage.getItem('admin_user')).toBeNull();
  });

  it('markSessionExpired() does NOT touch any non-auth localStorage keys', () => {
    localStorage.setItem('some_other_key', 'keep-me');
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => {
      result.current.markSessionExpired();
    });
    expect(localStorage.getItem('some_other_key')).toBe('keep-me');
  });
});
