import { dispatchLisRetractionNotifications } from './services/lis-retraction-notification-dispatch';

interface LisJobsEnv {
  DB: D1Database;
}

export default {
  async scheduled(_event: ScheduledEvent, env: LisJobsEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      dispatchLisRetractionNotifications(env.DB).catch((error) => {
        console.error('LIS jobs dispatch failed:', error);
      }),
    );
  },
};
