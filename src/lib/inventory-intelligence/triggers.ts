import { recomputeInventoryIntelligence } from './recompute';

type RecomputeFn = typeof recomputeInventoryIntelligence;

type LoggerLike = {
  error: (...args: unknown[]) => void;
};

export type ScheduleInventoryIntelligenceRecomputeInput = {
  dbClient: Parameters<RecomputeFn>[0];
  tenantId: string;
  waitUntil?: (promise: Promise<unknown>) => void;
  recompute?: RecomputeFn;
  logger?: LoggerLike;
};

export function scheduleInventoryIntelligenceRecompute(input: ScheduleInventoryIntelligenceRecomputeInput): void {
  const recompute = input.recompute ?? recomputeInventoryIntelligence;
  const logger = input.logger ?? console;
  const recomputeTask = Promise.resolve()
    .then(() => recompute(input.dbClient, input.tenantId))
    .catch((error) => {
      logger.error('[inventory-intelligence] background recompute failed:', error);
    });

  if (input.waitUntil) {
    try {
      input.waitUntil(recomputeTask);
      return;
    } catch (error) {
      logger.error('[inventory-intelligence] waitUntil recompute scheduling failed:', error);
    }
  }

  void recomputeTask;
}
