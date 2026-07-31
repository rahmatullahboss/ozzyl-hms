import { describe, expect, it } from 'vitest';


describe('dedicated LIS jobs worker', () => {
  it('runs durable retraction notification retries from one scheduled trigger', async () => {
    const source = await import('../src/lis-jobs?raw');
    const config = await import('../wrangler.lis-jobs.toml?raw');

    expect(source.default).toContain('dispatchLisRetractionNotifications(env.DB)');
    expect(source.default).toContain('ctx.waitUntil');
    expect(source.default).toContain('LIS jobs dispatch failed');
    expect(config.default).toContain('main = "src/lis-jobs.ts"');
    expect(config.default).toContain('crons = ["*/5 * * * *"]');
    expect(config.default).toContain('binding = "DB"');
    expect(config.default).toContain('hms-super-admin-production-apac');
    expect(config.default).toContain('Do not deploy until account cron slots are consolidated');
  });
});
