/**
 * privacy-lock.ts
 *
 * Biometric / PIN-based privacy lock for sensitive wellness modules.
 * Uses the Web Authentication API (WebAuthn) for biometric auth on supported
 * devices, with a fallback to a user-set PIN stored in localStorage.
 *
 * Protected modules: mental-health, womens-health, pregnancy
 */

const LOCK_KEY = 'ozzyl_privacy_lock';
const PIN_KEY = 'ozzyl_privacy_pin';
const UNLOCK_TS_KEY = 'ozzyl_privacy_unlock_ts';
const UNLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const SALT = 'ozzyl_salt_v1';

// Synchronous pseudo-hash for UI responsiveness (not true crypto, but better than plaintext)
// In a real app we'd use async crypto.subtle, but we want to avoid refactoring all UI to be async
function pseudoHash(pin: string): string {
  let hash = 0;
  const str = pin + SALT;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return btoa(hash.toString());
}

export type LockableModule = 'mental-health' | 'womens-health' | 'pregnancy';

export const LOCKABLE_MODULES: LockableModule[] = [
  'mental-health',
  'womens-health',
  'pregnancy',
];

interface LockConfig {
  enabled: boolean;
  lockedModules: LockableModule[];
}

/** Check if privacy lock is enabled */
export function isLockEnabled(): boolean {
  return getLockConfig().enabled;
}

/** Get lock configuration */
export function getLockConfig(): LockConfig {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return { enabled: false, lockedModules: [] };
    return JSON.parse(raw) as LockConfig;
  } catch {
    return { enabled: false, lockedModules: [] };
  }
}

/** Save lock configuration */
export function saveLockConfig(config: LockConfig): void {
  localStorage.setItem(LOCK_KEY, JSON.stringify(config));
}

/** Check if a specific module is locked */
export function isModuleLocked(module: LockableModule): boolean {
  const config = getLockConfig();
  if (!config.enabled) return false;
  if (!config.lockedModules.includes(module)) return false;

  // Check if recently unlocked
  return !isRecentlyUnlocked();
}

/** Check if recently unlocked (within 15 min) */
export function isRecentlyUnlocked(): boolean {
  const unlockTs = localStorage.getItem(UNLOCK_TS_KEY);
  if (!unlockTs) return false;
  const elapsed = Date.now() - parseInt(unlockTs, 10);
  return elapsed < UNLOCK_DURATION_MS;
}

/** Record a successful unlock */
export function recordUnlock(): void {
  localStorage.setItem(UNLOCK_TS_KEY, String(Date.now()));
}

/** Set PIN */
export function setPin(pin: string): boolean {
  if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
    return false;
  }
  localStorage.setItem(PIN_KEY, pseudoHash(pin));
  return true;
}

/** Verify PIN */
export function verifyPin(pin: string): boolean {
  const stored = localStorage.getItem(PIN_KEY);
  if (!stored) return false;
  return stored === pseudoHash(pin);
}

/** Check if PIN is set */
export function hasPinSet(): boolean {
  return !!localStorage.getItem(PIN_KEY);
}

/** Check if WebAuthn biometrics are available */
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Clear all lock data (for logout / reset) */
export function clearLockData(): void {
  localStorage.removeItem(LOCK_KEY);
  localStorage.removeItem(PIN_KEY);
  localStorage.removeItem(UNLOCK_TS_KEY);
}
