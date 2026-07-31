import { describe, expect, it } from 'vitest';

describe('ReportAppointmentPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ReportAppointmentPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
