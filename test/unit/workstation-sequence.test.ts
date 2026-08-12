import { describe, expect, it } from 'vitest';
import { formatScopedSequence, normalizeWorkstationCode } from '../../src/lib/workstation-sequence';

describe('workstation-scoped sequence formatting', () => {
  it('preserves legacy cloud format when no workstation code exists', () => {
    expect(formatScopedSequence('INV-A-2026', 42, null)).toBe('INV-A-2026-000042');
  });

  it('adds the stable workstation namespace for offline nodes', () => {
    expect(formatScopedSequence('INV-A-2026', 42, 'WS-A1B2C3D4')).toBe('INV-A-2026-WS-A1B2C3D4-000042');
  });

  it('normalizes valid workstation codes and rejects unsafe values', () => {
    expect(normalizeWorkstationCode(' ws-ab12cd34 ')).toBe('WS-AB12CD34');
    expect(normalizeWorkstationCode('WS-../../BAD')).toBeNull();
    expect(normalizeWorkstationCode('reception-1')).toBeNull();
  });

  it('does not change unprefixed numeric-only sequences', () => {
    expect(formatScopedSequence('', 7, 'WS-A1B2C3D4')).toBe('000007');
  });
});
