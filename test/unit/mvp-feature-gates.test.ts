import { describe, expect, it } from 'vitest';
import { getBlockedNonMvpPrefix, isMvpOnlyMode } from '../../src/lib/mvp-feature-gates';

describe('legacy MVP feature gate compatibility', () => {
  it('never enables a separate MVP-only runtime mode', () => {
    expect(isMvpOnlyMode({})).toBe(false);
    expect(isMvpOnlyMode({ MVP_ONLY_MODE: 'true' })).toBe(false);
    expect(isMvpOnlyMode({ FEATURE_MVP_ONLY: '1' })).toBe(false);
    expect(isMvpOnlyMode({ FEATURE_MVP_ONLY: 'enabled' })).toBe(false);
  });

  it('does not block normal production modules', () => {
    expect(getBlockedNonMvpPrefix('/api/ai/scribe')).toBeNull();
    expect(getBlockedNonMvpPrefix('/api/fhir/Patient')).toBeNull();
    expect(getBlockedNonMvpPrefix('/api/marketplace/doctors')).toBeNull();
    expect(getBlockedNonMvpPrefix('/api/whatsapp/templates')).toBeNull();
    expect(getBlockedNonMvpPrefix('/api/patients')).toBeNull();
    expect(getBlockedNonMvpPrefix('/api/billing/due')).toBeNull();
    expect(getBlockedNonMvpPrefix('/api/lab/orders')).toBeNull();
    expect(getBlockedNonMvpPrefix('/api/pharmacy/medicines')).toBeNull();
  });
});
