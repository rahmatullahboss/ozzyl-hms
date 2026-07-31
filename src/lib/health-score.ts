/**
 * Health Score Calculation Engine
 *
 * Computes a daily 0-100 wellness score from sub-scores.
 * Weights per spec Section 2:
 *   sleep 25%, activity 20%, nutrition 15%, mood 15%, medication 15%, vitals 10%
 *
 * Standalone users (no hospital) redistribute medication weight:
 *   hydration +10%, sleep +5%
 */

export interface SubScores {
  sleep: number;      // 0-100
  activity: number;   // 0-100
  nutrition: number;  // 0-100
  mood: number;       // 0-100
  medication: number; // 0-100
  vitals: number;     // 0-100
}

export interface HealthScoreResult {
  total: number;
  breakdown: SubScores;
  label: 'excellent' | 'good' | 'fair' | 'needsWork' | 'attention';
  color: 'green' | 'yellow' | 'red';
}

const CONNECTED_WEIGHTS = {
  sleep: 0.25,
  activity: 0.20,
  nutrition: 0.15,
  mood: 0.15,
  medication: 0.15,
  vitals: 0.10,
};

const STANDALONE_WEIGHTS = {
  sleep: 0.30,      // +5% from medication
  activity: 0.20,
  nutrition: 0.25,  // +10% from medication (hydration proxy)
  mood: 0.15,
  medication: 0,    // redistributed
  vitals: 0.10,
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function getLabel(score: number): HealthScoreResult['label'] {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 70) return 'fair';
  if (score >= 60) return 'needsWork';
  return 'attention';
}

function getColor(score: number): HealthScoreResult['color'] {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  return 'red';
}

export function calculateHealthScore(
  subScores: SubScores,
  isConnected: boolean = false,
): HealthScoreResult {
  const weights = isConnected ? CONNECTED_WEIGHTS : STANDALONE_WEIGHTS;

  const clamped: SubScores = {
    sleep: clamp(subScores.sleep, 0, 100),
    activity: clamp(subScores.activity, 0, 100),
    nutrition: clamp(subScores.nutrition, 0, 100),
    mood: clamp(subScores.mood, 0, 100),
    medication: clamp(subScores.medication, 0, 100),
    vitals: clamp(subScores.vitals, 0, 100),
  };

  const total = Math.round(
    clamped.sleep * weights.sleep +
    clamped.activity * weights.activity +
    clamped.nutrition * weights.nutrition +
    clamped.mood * weights.mood +
    clamped.medication * weights.medication +
    clamped.vitals * weights.vitals,
  );

  const finalScore = clamp(total, 0, 100);

  return {
    total: finalScore,
    breakdown: clamped,
    label: getLabel(finalScore),
    color: getColor(finalScore),
  };
}
