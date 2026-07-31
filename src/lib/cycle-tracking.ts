/**
 * Cycle Tracking — Pure functions for period prediction and stats.
 * Sprint 3.3 — Task 11
 */

export interface CycleEntry {
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
}

export interface CyclePrediction {
  predicted_start: string | null;
  avg_cycle_length: number | null;
  confidence: 'low' | 'medium' | 'high' | null;
}

export interface CycleStats {
  avg_cycle_length: number;
  avg_period_length: number;
  total_cycles: number;
  shortest_cycle: number | null;
  longest_cycle: number | null;
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 86400000;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / msPerDay);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Predict the next period start date based on cycle history.
 * Needs at least 2 entries to calculate cycle length.
 */
export function predictNextPeriod(cycles: CycleEntry[]): CyclePrediction {
  if (cycles.length < 2) {
    return { predicted_start: null, avg_cycle_length: null, confidence: null };
  }

  // Sort by start_date ascending
  const sorted = [...cycles].sort((a, b) => a.start_date.localeCompare(b.start_date));

  // Calculate cycle lengths (days between consecutive start_dates)
  const cycleLengths: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    cycleLengths.push(daysBetween(sorted[i - 1].start_date, sorted[i].start_date));
  }

  const avg = Math.round(cycleLengths.reduce((s, v) => s + v, 0) / cycleLengths.length);
  const lastStart = sorted[sorted.length - 1].start_date;
  const predicted = addDays(lastStart, avg);

  // Confidence based on number of data points and consistency
  let confidence: 'low' | 'medium' | 'high' = 'low';
  if (cycleLengths.length >= 5) {
    const stdDev = Math.sqrt(cycleLengths.reduce((s, v) => s + (v - avg) ** 2, 0) / cycleLengths.length);
    confidence = stdDev < 3 ? 'high' : stdDev < 7 ? 'medium' : 'low';
  } else if (cycleLengths.length >= 2) {
    confidence = 'medium';
  }

  return { predicted_start: predicted, avg_cycle_length: avg, confidence };
}

/**
 * Calculate cycle statistics from history.
 */
export function calculateCycleStats(cycles: CycleEntry[]): CycleStats {
  if (cycles.length < 2) {
    return { avg_cycle_length: 0, avg_period_length: 0, total_cycles: 0, shortest_cycle: null, longest_cycle: null };
  }

  const sorted = [...cycles].sort((a, b) => a.start_date.localeCompare(b.start_date));

  const cycleLengths: number[] = [];
  const periodLengths: number[] = [];

  for (let i = 0; i < sorted.length; i++) {
    periodLengths.push(daysBetween(sorted[i].start_date, sorted[i].end_date));
    if (i > 0) {
      cycleLengths.push(daysBetween(sorted[i - 1].start_date, sorted[i].start_date));
    }
  }

  const avgCycle = Math.round(cycleLengths.reduce((s, v) => s + v, 0) / cycleLengths.length);
  const avgPeriod = Math.round(periodLengths.reduce((s, v) => s + v, 0) / periodLengths.length);

  return {
    avg_cycle_length: avgCycle,
    avg_period_length: avgPeriod,
    total_cycles: cycleLengths.length,
    shortest_cycle: Math.min(...cycleLengths),
    longest_cycle: Math.max(...cycleLengths),
  };
}
