import type { CanonicalBatchDatabase } from '../../src/lib/canonical/command-batch';
import {
  backfillCanonicalCompensationReportingContext,
  type CanonicalCompensationReportingContextBackfillInput,
  type CanonicalCompensationReportingContextBackfillResult,
} from '../../src/lib/canonical/backfill-compensation-reporting-context';

export interface CompensationReportingContextBackfillExecutionOptions
  extends CanonicalCompensationReportingContextBackfillInput {
  requireComplete?: boolean;
}

/**
 * Operator-facing bounded execution wrapper.
 *
 * Run repeatedly with a bounded `maxRows` until
 * `remainingActiveAccrualsWithoutContext` is zero. Setting `requireComplete`
 * turns the remaining-count check into a cutover gate.
 */
export async function executeCompensationReportingContextBackfill(
  db: CanonicalBatchDatabase,
  options: CompensationReportingContextBackfillExecutionOptions,
): Promise<CanonicalCompensationReportingContextBackfillResult> {
  const result = await backfillCanonicalCompensationReportingContext(db, options);
  if (options.requireComplete && result.remainingActiveAccrualsWithoutContext !== 0) {
    throw new Error(
      `Canonical compensation reporting context backfill incomplete: ${result.remainingActiveAccrualsWithoutContext} active accruals remain`,
    );
  }
  return result;
}
