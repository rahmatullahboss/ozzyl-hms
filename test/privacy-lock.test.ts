import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const k in store) delete store[k]; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Import after mock
import {
  isLockEnabled,
  getLockConfig,
  saveLockConfig,
  isModuleLocked,
  isRecentlyUnlocked,
  recordUnlock,
  setPin,
  verifyPin,
  hasPinSet,
  clearLockData,
  LOCKABLE_MODULES,
} from '../apps/ozzyl-lifestyle/src/lib/privacy-lock';

describe('privacy-lock', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('lock config', () => {
    it('defaults to disabled with no locked modules', () => {
      const config = getLockConfig();
      expect(config.enabled).toBe(false);
      expect(config.lockedModules).toEqual([]);
    });

    it('saves and retrieves config', () => {
      saveLockConfig({ enabled: true, lockedModules: ['mental-health'] });
      const config = getLockConfig();
      expect(config.enabled).toBe(true);
      expect(config.lockedModules).toContain('mental-health');
    });

    it('isLockEnabled returns false by default', () => {
      expect(isLockEnabled()).toBe(false);
    });

    it('isLockEnabled returns true when enabled', () => {
      saveLockConfig({ enabled: true, lockedModules: ['mental-health'] });
      expect(isLockEnabled()).toBe(true);
    });
  });

  describe('module locking', () => {
    it('module is not locked when lock is disabled', () => {
      saveLockConfig({ enabled: false, lockedModules: ['mental-health'] });
      expect(isModuleLocked('mental-health')).toBe(false);
    });

    it('module is not locked if not in lockedModules', () => {
      saveLockConfig({ enabled: true, lockedModules: ['mental-health'] });
      expect(isModuleLocked('womens-health')).toBe(false);
    });

    it('module is locked when enabled and in list', () => {
      saveLockConfig({ enabled: true, lockedModules: ['mental-health'] });
      expect(isModuleLocked('mental-health')).toBe(true);
    });

    it('module is unlocked after recordUnlock', () => {
      saveLockConfig({ enabled: true, lockedModules: ['mental-health'] });
      recordUnlock();
      expect(isModuleLocked('mental-health')).toBe(false);
    });
  });

  describe('unlock window', () => {
    it('isRecentlyUnlocked returns false with no timestamp', () => {
      expect(isRecentlyUnlocked()).toBe(false);
    });

    it('isRecentlyUnlocked returns true after recordUnlock', () => {
      recordUnlock();
      expect(isRecentlyUnlocked()).toBe(true);
    });

    it('isRecentlyUnlocked returns false after 15 minutes', () => {
      // Set timestamp 16 minutes ago
      store['ozzyl_privacy_unlock_ts'] = String(Date.now() - 16 * 60 * 1000);
      expect(isRecentlyUnlocked()).toBe(false);
    });
  });

  describe('PIN management', () => {
    it('hasPinSet returns false initially', () => {
      expect(hasPinSet()).toBe(false);
    });

    it('rejects PIN shorter than 4 digits', () => {
      expect(setPin('123')).toBe(false);
    });

    it('rejects PIN longer than 6 digits', () => {
      expect(setPin('1234567')).toBe(false);
    });

    it('rejects non-numeric PIN', () => {
      expect(setPin('abcd')).toBe(false);
    });

    it('accepts valid 4-digit PIN', () => {
      expect(setPin('1234')).toBe(true);
      expect(hasPinSet()).toBe(true);
    });

    it('accepts valid 6-digit PIN', () => {
      expect(setPin('123456')).toBe(true);
    });

    it('verifyPin returns false with no PIN set', () => {
      expect(verifyPin('1234')).toBe(false);
    });

    it('verifyPin returns true for correct PIN', () => {
      setPin('5678');
      expect(verifyPin('5678')).toBe(true);
    });

    it('verifyPin returns false for wrong PIN', () => {
      setPin('5678');
      expect(verifyPin('1111')).toBe(false);
    });
  });

  describe('clearLockData', () => {
    it('removes all lock-related data', () => {
      saveLockConfig({ enabled: true, lockedModules: ['mental-health'] });
      setPin('1234');
      recordUnlock();
      clearLockData();
      expect(isLockEnabled()).toBe(false);
      expect(hasPinSet()).toBe(false);
      expect(isRecentlyUnlocked()).toBe(false);
    });
  });

  describe('LOCKABLE_MODULES constant', () => {
    it('contains expected modules', () => {
      expect(LOCKABLE_MODULES).toContain('mental-health');
      expect(LOCKABLE_MODULES).toContain('womens-health');
      expect(LOCKABLE_MODULES).toContain('pregnancy');
      expect(LOCKABLE_MODULES.length).toBe(3);
    });
  });
});
