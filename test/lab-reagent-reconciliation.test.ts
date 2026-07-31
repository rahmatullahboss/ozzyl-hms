import { describe, expect, it } from 'vitest';
import { classifyLabReagentReconciliation } from '../src/lib/lab-reagent-reconciliation';

describe('lab reagent reconciliation classification', () => {
  it('marks equal expected, canonical and projected quantities complete', () => {
    expect(classifyLabReagentReconciliation({
      expectedQuantity: 2,
      committedQuantity: 2,
      projectedQuantity: 2,
    })).toEqual({ status: 'complete', severity: 'ok', issues: [] });
  });

  it('detects partial canonical consumption', () => {
    const result = classifyLabReagentReconciliation({
      expectedQuantity: 2,
      committedQuantity: 1,
      projectedQuantity: 1,
    });
    expect(result.status).toBe('partial');
    expect(result.severity).toBe('error');
    expect(result.issues.join(' ')).toMatch(/expected|committed/i);
  });

  it('detects missing lab projection after canonical stock commit', () => {
    const result = classifyLabReagentReconciliation({
      expectedQuantity: 2,
      committedQuantity: 2,
      projectedQuantity: 1,
    });
    expect(result.status).toBe('projection_missing');
    expect(result.severity).toBe('warning');
  });

  it('detects over-consumption or duplicate projection', () => {
    expect(classifyLabReagentReconciliation({
      expectedQuantity: 2,
      committedQuantity: 3,
      projectedQuantity: 3,
    }).status).toBe('mismatch');
    expect(classifyLabReagentReconciliation({
      expectedQuantity: 2,
      committedQuantity: 2,
      projectedQuantity: 3,
    }).status).toBe('mismatch');
  });
});
