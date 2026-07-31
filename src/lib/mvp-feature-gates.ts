export type MvpFeatureGateContext = {
  env: Record<string, unknown>;
  path: string;
};

/**
 * Backward-compatible no-op.
 *
 * The product should not run a separate MVP-only feature mode. Launch scope is
 * now handled by hardening the normal production modules rather than disabling
 * unrelated modules at runtime.
 */
export function isMvpOnlyMode(_env: Record<string, unknown>): boolean {
  return false;
}

/**
 * Backward-compatible no-op for older tests/imports.
 */
export function getBlockedNonMvpPrefix(_path: string): string | null {
  return null;
}

/**
 * Backward-compatible no-op.
 */
export function enforceMvpFeatureGate(_ctx: MvpFeatureGateContext): void {
  return;
}
