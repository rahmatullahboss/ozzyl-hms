import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHandoverGuard } from './useHandoverGuard';

const HANDOVER_KEY = `handover_completed_${new Date().toISOString().slice(0, 10)}`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('useHandoverGuard', () => {
  it('returns needsHandover true when tasks are pending and no handover completed today', () => {
    const { result } = renderHook(() =>
      useHandoverGuard({ pendingVitals: 3, overdueMeds: 1, criticalPatients: 0 }),
    );

    expect(result.current.needsHandover).toBe(true);
    expect(result.current.pendingTasks).toBe(4);
  });

  it('returns needsHandover false when all tasks are complete', () => {
    const { result } = renderHook(() =>
      useHandoverGuard({ pendingVitals: 0, overdueMeds: 0, criticalPatients: 0 }),
    );

    expect(result.current.needsHandover).toBe(false);
    expect(result.current.pendingTasks).toBe(0);
  });

  it('returns needsHandover false when handover already completed today', () => {
    localStorage.setItem(HANDOVER_KEY, 'true');

    const { result } = renderHook(() =>
      useHandoverGuard({ pendingVitals: 5, overdueMeds: 2, criticalPatients: 1 }),
    );

    expect(result.current.needsHandover).toBe(false);
    expect(result.current.pendingTasks).toBe(8);
  });

  it('calculates pending tasks as sum of all task types', () => {
    const { result } = renderHook(() =>
      useHandoverGuard({ pendingVitals: 2, overdueMeds: 3, criticalPatients: 1 }),
    );

    expect(result.current.pendingTasks).toBe(6);
  });

  it('markCompleted sets localStorage and updates needsHandover', () => {
    const { result } = renderHook(() =>
      useHandoverGuard({ pendingVitals: 1, overdueMeds: 0, criticalPatients: 0 }),
    );

    expect(result.current.needsHandover).toBe(true);

    act(() => {
      result.current.markCompleted();
    });

    expect(localStorage.getItem(HANDOVER_KEY)).toBe('true');
    expect(result.current.needsHandover).toBe(false);
  });
});
