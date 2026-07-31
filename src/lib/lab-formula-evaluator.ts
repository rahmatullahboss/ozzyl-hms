/**
 * Safe formula evaluator for lab auto-calculations.
 * Supports: +, -, *, /, (, ), numbers, and {component_code} placeholders.
 * Example: "{HGB} / {PCV} * 100" → evaluates to MCHC
 */

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

/**
 * Extract component codes from a formula string.
 * "{HGB} / {PCV} * 100" → ["HGB", "PCV"]
 */
export function extractComponentCodes(formula: string): string[] {
  const codes: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let match;
  while ((match = regex.exec(formula)) !== null) {
    codes.push(match[1]);
  }
  return [...new Set(codes)]; // deduplicate
}

/**
 * Substitute component codes with actual values in a formula.
 * "{HGB} / {PCV} * 100", { HGB: 14, PCV: 42 } → "14 / 42 * 100"
 */
export function substituteValues(formula: string, values: Record<string, number>): string {
  let result = formula;
  for (const [code, val] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{${code}\\}`, 'g'), String(val));
  }
  return result;
}

/**
 * Safely evaluate a mathematical expression.
 * Only allows: digits, ., +, -, *, /, (, ), spaces
 */
export function safeEvaluate(expression: string): number {
  // Security: only allow safe characters
  const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
  if (sanitized !== expression.trim()) {
    throw new FormulaError('Formula contains invalid characters');
  }

  // Prevent division by zero by replacing / 0 with / null
  // Actually, let's evaluate and catch errors
  try {
    // Use Function constructor for safe evaluation (no access to global scope)
    const fn = new Function(`return (${sanitized})`);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new FormulaError('Formula result is not a valid number');
    }
    return result;
  } catch (e) {
    throw new FormulaError(`Formula evaluation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Evaluate a lab formula given component values.
 * @param formula - e.g. "{HGB} / {PCV} * 100"
 * @param componentValues - map of component_code → numeric value
 * @returns calculated result
 */
export function evaluateFormula(
  formula: string,
  componentValues: Record<string, number | null | undefined>
): number {
  const requiredCodes = extractComponentCodes(formula);

  // Check all required values are present and numeric
  const values: Record<string, number> = {};
  for (const code of requiredCodes) {
    const val = componentValues[code];
    if (val === null || val === undefined || isNaN(val)) {
      throw new FormulaError(`Missing or invalid value for component "${code}"`);
    }
    values[code] = val;
  }

  const expression = substituteValues(formula, values);
  return safeEvaluate(expression);
}

/**
 * Round a number to specified decimal places.
 */
export function roundResult(value: number, decimals: number = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Determine abnormal flag based on reference range.
 */
export function determineAbnormalFlag(
  value: number,
  rangeLow: number | null | undefined,
  rangeHigh: number | null | undefined,
  criticalLow: number | null | undefined,
  criticalHigh: number | null | undefined
): 'normal' | 'low' | 'high' | 'critical' {
  if (criticalLow !== null && criticalLow !== undefined && value <= criticalLow) return 'critical';
  if (criticalHigh !== null && criticalHigh !== undefined && value >= criticalHigh) return 'critical';
  if (rangeLow !== null && rangeLow !== undefined && value < rangeLow) return 'low';
  if (rangeHigh !== null && rangeHigh !== undefined && value > rangeHigh) return 'high';
  return 'normal';
}

/**
 * Calculate delta flag between current and previous value.
 */
export function calculateDelta(
  current: number,
  previous: number | null | undefined,
  thresholdPercent: number = 20
): 'new' | 'stable' | 'increased' | 'decreased' {
  if (previous === null || previous === undefined || previous === 0) return 'new';
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(change) <= thresholdPercent) return 'stable';
  return change > 0 ? 'increased' : 'decreased';
}
