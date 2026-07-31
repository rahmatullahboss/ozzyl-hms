import { describe, expect, it } from 'vitest';
import {
  assertOfflineMutationAllowed,
  buildOfflineLocalRef,
  getOfflineMutationDecision,
} from './offlineMutationPolicy';

describe('offlineMutationPolicy', () => {
  it('allows first-phase browser offline draft workflows', () => {
    expect(getOfflineMutationDecision('post', '/api/patients').allowed).toBe(true);
    expect(getOfflineMutationDecision('post', '/api/billing/opd').allowed).toBe(true);
    expect(getOfflineMutationDecision('post', '/api/lab-orders').allowed).toBe(true);
  });

  it('blocks resource-locking and financial final-state workflows', () => {
    expect(getOfflineMutationDecision('post', '/api/beds/101/assign')).toMatchObject({
      allowed: false,
      risk: 'blocked',
    });
    expect(getOfflineMutationDecision('post', '/api/cash/handover')).toMatchObject({
      allowed: false,
      risk: 'blocked',
    });
    expect(getOfflineMutationDecision('post', '/api/pharmacy/dispense')).toMatchObject({
      allowed: false,
      risk: 'blocked',
    });
  });

  it('blocks delete replay from browser offline mode', () => {
    const decision = getOfflineMutationDecision('delete', '/api/patients/1');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/delete/i);
  });

  it('blocks unknown routes until explicitly allow-listed', () => {
    expect(getOfflineMutationDecision('post', '/api/custom-module')).toMatchObject({
      allowed: false,
      risk: 'review',
    });
  });

  it('throws a helpful error for unsafe offline mutations', () => {
    expect(() => assertOfflineMutationAllowed('post', '/api/inventory/adjustments')).toThrow(/cannot be queued/i);
  });

  it('builds workstation-scoped temporary offline references', () => {
    const ref = buildOfflineLocalRef(
      'patients',
      'WS-RECEPTION-01',
      new Date(2026, 5, 27, 9, 8, 7),
    );

    expect(ref).toBe('OFF-PATIENTS-RECEPTION01-20260627-090807');
  });
});
