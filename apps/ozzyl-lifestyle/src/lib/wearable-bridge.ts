/**
 * wearable-bridge.ts
 * Capacitor-native bridge for HealthKit (iOS) and Health Connect (Android).
 *
 * This module abstracts all native health-data queries behind a simple
 * `syncWearableData()` function that the React layer can call.
 */

import { Capacitor } from '@capacitor/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WearablePlatform = 'apple_health' | 'health_connect' | 'web';

export interface WearableSample {
  metric: 'steps' | 'heart_rate' | 'sleep_minutes' | 'active_calories' | 'distance_meters';
  value: number;
  unit: string;
  recorded_at: string;  // ISO-8601
  source: WearablePlatform;
}

export interface SyncResult {
  success: boolean;
  samplesCount: number;
  error?: string;
}

interface HealthPlugin {
  requestAuthorization(opts: { read: string[] }): Promise<void>;
  isAvailable(): Promise<{ available: boolean }>;
  queryAggregated(opts: {
    dataType: string;
    startDate: string;
    endDate: string;
    bucket: string;
  }): Promise<{ value: number }[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the current platform identifier for tagging samples. */
export function detectPlatform(): WearablePlatform {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios') return 'apple_health';
  if (platform === 'android') return 'health_connect';
  return 'web';
}

/** Returns true when running inside a native iOS/Android shell. */
export function isNativeHealthAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Builds an ISO date string for N days ago at midnight local time.
 */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Transforms raw aggregated values from the native plugin into
 * the `WearableSample[]` shape expected by the backend.
 */
export function transformToSamples(
  metric: WearableSample['metric'],
  unit: string,
  values: { value: number; date?: string }[],
  source: WearablePlatform,
): WearableSample[] {
  return values
    .filter((v) => v.value > 0)
    .map((v) => ({
      metric,
      value: Math.round(v.value),
      unit,
      recorded_at: v.date ?? new Date().toISOString(),
      source,
    }));
}

// ---------------------------------------------------------------------------
// Core Bridge
// ---------------------------------------------------------------------------

let _healthPlugin: HealthPlugin | null = null;

/**
 * Lazily loads the community health plugin so we don't crash on web.
 * Falls back to null when the plugin isn't installed.
 */
async function getHealthPlugin(): Promise<HealthPlugin | null> {
  if (_healthPlugin) return _healthPlugin;

  if (!isNativeHealthAvailable()) return null;

  try {
    // Runtime-only loading prevents web builds from trying to resolve optional native plugins.
    const candidates = ['@anthropic-ai/capacitor-health', '@capacitor-community/health'];
    for (const specifier of candidates) {
      try {
        const mod = await import(/* @vite-ignore */ specifier);
        _healthPlugin = (mod.Health ?? mod.default ?? null) as HealthPlugin | null;
        if (_healthPlugin) {
          return _healthPlugin;
        }
      } catch {
        // Try the next optional plugin candidate.
      }
    }
  } catch {
    console.warn('[wearable-bridge] Health plugin not available');
  }

  console.warn('[wearable-bridge] Health plugin not available');
  return null;
}

/**
 * Requests read-only permission for step count and sleep data.
 * Returns `true` when the user grants access.
 */
export async function requestHealthPermissions(): Promise<boolean> {
  const plugin = await getHealthPlugin();
  if (!plugin) return false;

  try {
    const { available } = await plugin.isAvailable();
    if (!available) return false;

    await plugin.requestAuthorization({
      read: ['steps', 'sleep', 'calories.active', 'distance'],
    });
    return true;
  } catch (err) {
    console.error('[wearable-bridge] Permission error:', err);
    return false;
  }
}

/**
 * Queries the native health store for the last 7 days of step count
 * and sleep data, transforms them into `WearableSample[]`.
 */
export async function queryHealthData(days = 7): Promise<WearableSample[]> {
  const plugin = await getHealthPlugin();
  if (!plugin) return [];

  const platform = detectPlatform();
  const startDate = daysAgo(days);
  const endDate = new Date().toISOString();
  const samples: WearableSample[] = [];

  try {
    // Steps — daily buckets
    const stepResults = await plugin.queryAggregated({
      dataType: 'steps',
      startDate,
      endDate,
      bucket: 'day',
    });
    samples.push(
      ...transformToSamples('steps', 'count', stepResults, platform),
    );

    // Sleep — daily buckets (in minutes)
    const sleepResults = await plugin.queryAggregated({
      dataType: 'sleep',
      startDate,
      endDate,
      bucket: 'day',
    });
    samples.push(
      ...transformToSamples('sleep_minutes', 'min', sleepResults, platform),
    );

    // Active calories
    const calResults = await plugin.queryAggregated({
      dataType: 'calories.active',
      startDate,
      endDate,
      bucket: 'day',
    });
    samples.push(
      ...transformToSamples('active_calories', 'kcal', calResults, platform),
    );

    // Distance
    const distResults = await plugin.queryAggregated({
      dataType: 'distance',
      startDate,
      endDate,
      bucket: 'day',
    });
    samples.push(
      ...transformToSamples('distance_meters', 'm', distResults, platform),
    );
  } catch (err) {
    console.error('[wearable-bridge] Query error:', err);
  }

  return samples;
}

/**
 * Full sync flow:
 *   1. Request permissions (if needed)
 *   2. Query last N days of health data
 *   3. POST to /api/wellness/sync/wearable
 *
 * Returns a `SyncResult` with success status and count.
 */
export async function syncWearableData(
  token: string,
  days = 7,
): Promise<SyncResult> {
  // 1. Permissions
  const granted = await requestHealthPermissions();
  if (!granted) {
    return { success: false, samplesCount: 0, error: 'Health permissions denied or unavailable' };
  }

  // 2. Query
  const samples = await queryHealthData(days);
  if (samples.length === 0) {
    return { success: true, samplesCount: 0 };
  }

  // 3. Sync to backend (max 500 per batch per API spec)
  const BATCH_SIZE = 500;
  let totalSynced = 0;

  for (let i = 0; i < samples.length; i += BATCH_SIZE) {
    const batch = samples.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch('/api/wellness/sync/wearable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          platform: batch[0].source,
          samples: batch,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return {
          success: false,
          samplesCount: totalSynced,
          error: (body as any).error ?? `HTTP ${res.status}`,
        };
      }

      totalSynced += batch.length;
    } catch (err) {
      return {
        success: false,
        samplesCount: totalSynced,
        error: err instanceof Error ? err.message : 'Network error',
      };
    }
  }

  return { success: true, samplesCount: totalSynced };
}
