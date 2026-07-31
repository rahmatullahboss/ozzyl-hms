import { describe, it, expect } from 'vitest';
import {
  transformToSamples,
  detectPlatform,
  daysAgo,
  type WearableSample,
} from '../apps/ozzyl-lifestyle/src/lib/wearable-bridge';

describe('wearable-bridge', () => {
  describe('transformToSamples', () => {
    it('converts raw values into WearableSample array', () => {
      const raw = [
        { value: 8500, date: '2026-04-17T00:00:00Z' },
        { value: 12000, date: '2026-04-16T00:00:00Z' },
      ];
      const result = transformToSamples('steps', 'count', raw, 'apple_health');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual<WearableSample>({
        metric: 'steps',
        value: 8500,
        unit: 'count',
        recorded_at: '2026-04-17T00:00:00Z',
        source: 'apple_health',
      });
    });

    it('filters out zero-value samples', () => {
      const raw = [
        { value: 0, date: '2026-04-17T00:00:00Z' },
        { value: 100, date: '2026-04-16T00:00:00Z' },
      ];
      const result = transformToSamples('sleep_minutes', 'min', raw, 'health_connect');

      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(100);
    });

    it('rounds fractional values', () => {
      const raw = [{ value: 345.67, date: '2026-04-17T00:00:00Z' }];
      const result = transformToSamples('active_calories', 'kcal', raw, 'apple_health');

      expect(result[0].value).toBe(346);
    });

    it('returns empty array for empty input', () => {
      const result = transformToSamples('steps', 'count', [], 'web');
      expect(result).toEqual([]);
    });

    it('provides fallback date when date is missing', () => {
      const raw = [{ value: 500 }];
      const result = transformToSamples('distance_meters', 'm', raw, 'apple_health');

      expect(result).toHaveLength(1);
      expect(result[0].recorded_at).toBeTruthy();
      // Should be a valid ISO date string
      expect(new Date(result[0].recorded_at).getTime()).toBeGreaterThan(0);
    });

    it('handles all metric types', () => {
      const metrics: WearableSample['metric'][] = [
        'steps', 'heart_rate', 'sleep_minutes', 'active_calories', 'distance_meters',
      ];
      for (const metric of metrics) {
        const result = transformToSamples(metric, 'unit', [{ value: 10 }], 'apple_health');
        expect(result[0].metric).toBe(metric);
      }
    });
  });

  describe('daysAgo', () => {
    it('returns an ISO string for N days in the past', () => {
      const result = daysAgo(7);
      const date = new Date(result);

      expect(date.getTime()).toBeLessThan(Date.now());
      // Should be roughly 7 days ago (within a day tolerance)
      const diffDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(6.5);
      expect(diffDays).toBeLessThanOrEqual(8.0);
    });

    it('returns midnight for the target day', () => {
      const result = daysAgo(1);
      const date = new Date(result);
      // Hours should be 0 in local time  
      expect(date.getHours()).toBe(0);
      expect(date.getMinutes()).toBe(0);
    });
  });

  describe('detectPlatform', () => {
    it('returns web when running outside native shell', () => {
      // In test environment, Capacitor.getPlatform() returns 'web'
      const platform = detectPlatform();
      expect(platform).toBe('web');
    });
  });
});
