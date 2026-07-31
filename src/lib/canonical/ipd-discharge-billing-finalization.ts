import type { CanonicalPreparedStatement } from './command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';

export interface IpdDischargeCriticalStatement {
  statementIndex: number;
  stepKey: string;
  expectedChanges: number;
}

export interface PrepareIpdDischargeLegacyStatementsInput<TStatement extends CanonicalPreparedStatement> {
  tenantId: string;
  operationKey: string;
  statements: readonly TStatement[];
  critical: readonly IpdDischargeCriticalStatement[];
}

export interface PreparedIpdDischargeLegacyStatements<TStatement extends CanonicalPreparedStatement> {
  statements: TStatement[];
  resultIndexByOriginalIndex: number[];
}

type StatementFactory<TStatement extends CanonicalPreparedStatement> = {
  prepare(sql: string): TStatement;
};

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function prepareIpdDischargeLegacyStatements<TStatement extends CanonicalPreparedStatement>(
  db: StatementFactory<TStatement>,
  input: PrepareIpdDischargeLegacyStatementsInput<TStatement>,
): PreparedIpdDischargeLegacyStatements<TStatement> {
  const originalLegacyStatements = [...input.statements];
  const resultIndexByOriginalIndex = input.statements.map((_, index) => index);
  const buildStrictAuthoritativeStatements = (): TStatement[] => {
    const tenantId = exact(input.tenantId, 'tenantId');
    const operationKey = exact(input.operationKey, 'operationKey');
    const criticalByIndex = new Map<number, IpdDischargeCriticalStatement>();
    for (const critical of input.critical) {
      const statementIndex = nonNegativeInteger(critical.statementIndex, 'critical.statementIndex');
      if (statementIndex >= input.statements.length) {
        throw new RangeError('critical statement index is out of range');
      }
      if (criticalByIndex.has(statementIndex)) {
        throw new RangeError('duplicate critical statement index');
      }
      criticalByIndex.set(statementIndex, {
        statementIndex,
        stepKey: exact(critical.stepKey, 'critical.stepKey'),
        expectedChanges: nonNegativeInteger(critical.expectedChanges, 'critical.expectedChanges'),
      });
    }

    const strictAuthoritativeStatements: TStatement[] = [];
    for (let index = 0; index < input.statements.length; index += 1) {
      strictAuthoritativeStatements.push(input.statements[index]);
      const critical = criticalByIndex.get(index);
      if (critical) {
        strictAuthoritativeStatements.push(prepareFinancialBatchAssertion(db, {
          tenantId,
          operationKey,
          stepKey: critical.stepKey,
          expectedChanges: critical.expectedChanges,
        }));
      }
    }
    strictAuthoritativeStatements.push(prepareClearFinancialBatchAssertions(db, tenantId, operationKey));
    return strictAuthoritativeStatements;
  };
  Object.defineProperty(originalLegacyStatements, 'strictAuthoritativeStatements', {
    value: buildStrictAuthoritativeStatements,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return { statements: originalLegacyStatements, resultIndexByOriginalIndex };
}
