/**
 * Mental Health Screening Scoring
 *
 * Implements PHQ-9 (Patient Health Questionnaire-9) for depression
 * and GAD-7 (Generalized Anxiety Disorder-7) for anxiety.
 *
 * Both are validated, public-domain clinical screening tools.
 */

export type PHQ9Severity = 'none' | 'minimal' | 'mild' | 'moderate' | 'moderately_severe' | 'severe';
export type GAD7Severity = 'none' | 'minimal' | 'mild' | 'moderate' | 'severe';
export type Severity = PHQ9Severity | GAD7Severity;

export interface PHQ9Result {
  total: number;
  severity: PHQ9Severity;
  suicidal_risk: boolean;
}

export interface GAD7Result {
  total: number;
  severity: GAD7Severity;
}

/**
 * Score a PHQ-9 questionnaire.
 * @param answers - Array of 9 integers (0-3) for each question
 * @returns Scored result with total, severity, and suicidal risk flag
 */
export function scorePHQ9(answers: number[]): PHQ9Result {
  if (answers.length !== 9) {
    throw new Error(`PHQ-9 requires exactly 9 answers, got ${answers.length}`);
  }
  for (let i = 0; i < 9; i++) {
    if (answers[i] < 0 || answers[i] > 3 || !Number.isInteger(answers[i])) {
      throw new Error(`PHQ-9 answer ${i + 1} must be 0-3, got ${answers[i]}`);
    }
  }

  const total = answers.reduce((s, v) => s + v, 0);
  const severity = classifySeverity('phq9', total) as PHQ9Severity;

  // Question 9 asks about suicidal ideation
  const suicidal_risk = answers[8] > 0;

  return { total, severity, suicidal_risk };
}

/**
 * Score a GAD-7 questionnaire.
 * @param answers - Array of 7 integers (0-3) for each question
 * @returns Scored result with total and severity
 */
export function scoreGAD7(answers: number[]): GAD7Result {
  if (answers.length !== 7) {
    throw new Error(`GAD-7 requires exactly 7 answers, got ${answers.length}`);
  }
  for (let i = 0; i < 7; i++) {
    if (answers[i] < 0 || answers[i] > 3 || !Number.isInteger(answers[i])) {
      throw new Error(`GAD-7 answer ${i + 1} must be 0-3, got ${answers[i]}`);
    }
  }

  const total = answers.reduce((s, v) => s + v, 0);
  const severity = classifySeverity('gad7', total) as GAD7Severity;

  return { total, severity };
}

/**
 * Classify severity based on screening type and total score.
 */
export function classifySeverity(type: 'phq9' | 'gad7', total: number): Severity {
  if (type === 'phq9') {
    if (total >= 20) return 'severe';
    if (total >= 15) return 'moderately_severe';
    if (total >= 10) return 'moderate';
    if (total >= 5) return 'mild';
    if (total >= 1) return 'minimal';
    return 'none';
  }

  // GAD-7
  if (total >= 15) return 'severe';
  if (total >= 10) return 'moderate';
  if (total >= 5) return 'mild';
  if (total >= 1) return 'minimal';
  return 'none';
}

/**
 * PHQ-9 Questions (English reference)
 */
export const PHQ9_QUESTIONS = [
  'Little interest or pleasure in doing things',
  'Feeling down, depressed, or hopeless',
  'Trouble falling or staying asleep, or sleeping too much',
  'Feeling tired or having little energy',
  'Poor appetite or overeating',
  'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
  'Trouble concentrating on things, such as reading the newspaper or watching television',
  'Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual',
  'Thoughts that you would be better off dead, or of hurting yourself in some way',
];

/**
 * GAD-7 Questions (English reference)
 */
export const GAD7_QUESTIONS = [
  'Feeling nervous, anxious, or on edge',
  'Not being able to stop or control worrying',
  'Worrying too much about different things',
  'Trouble relaxing',
  'Being so restless that it\'s hard to sit still',
  'Becoming easily annoyed or irritable',
  'Feeling afraid as if something awful might happen',
];
