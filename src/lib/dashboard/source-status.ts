import type {
  DashboardSourceFailure,
  DashboardSourceStatus,
} from '../../../packages/shared/src/dashboard';

export interface ResolveDashboardSourceStatusInput {
  requiredSources: string[];
  loadedSources: string[];
  unavailableSources: DashboardSourceFailure[];
  generatedAt: string;
  staleAfterSeconds: number;
  now?: string;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function resolveDashboardSourceStatus(
  input: ResolveDashboardSourceStatusInput,
): DashboardSourceStatus {
  const requiredSources = uniqueSorted(input.requiredSources);
  const requiredSet = new Set(requiredSources);
  const loadedSources = uniqueSorted(input.loadedSources.filter((source) => requiredSet.has(source)));
  const loadedSet = new Set(loadedSources);
  const unavailableSources = input.unavailableSources
    .filter((failure) => requiredSet.has(failure.source) && !loadedSet.has(failure.source))
    .sort((a, b) => a.source.localeCompare(b.source));

  let state: DashboardSourceStatus['state'];
  if (requiredSources.length > 0 && loadedSources.length === 0) {
    state = 'unavailable';
  } else if (loadedSources.length < requiredSources.length || unavailableSources.length > 0) {
    state = 'partial';
  } else {
    const generatedAtMs = Date.parse(input.generatedAt);
    const nowMs = Date.parse(input.now ?? new Date().toISOString());
    const staleAfterMs = Math.max(0, input.staleAfterSeconds) * 1000;
    const validTimes = Number.isFinite(generatedAtMs) && Number.isFinite(nowMs);
    state = validTimes && nowMs - generatedAtMs > staleAfterMs ? 'stale' : 'complete';
  }

  return {
    state,
    requiredSources,
    loadedSources,
    unavailableSources,
    generatedAt: input.generatedAt,
    staleAfterSeconds: Math.max(0, input.staleAfterSeconds),
  };
}

export function metricValueForSource(
  value: number | null | undefined,
  status: DashboardSourceStatus,
): number | null {
  if (status.state === 'partial' || status.state === 'unavailable') return null;
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value;
}
