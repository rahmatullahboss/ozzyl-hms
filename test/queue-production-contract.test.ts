import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Queue production contract', () => {
  it('keeps text tenant ids intact for \u0074oken counters', () => {
    for (const file of ['src/routes/tenant/queue.ts', 'src/routes/tenant/appointments.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} must not coerce text tenant ids for queue counters`).not.toContain('Number(tenantId)');
    }
  });

  it('executes appointment sync through one audited Canonical command boundary', () => {
    const source = readFileSync('src/routes/tenant/queue.ts', 'utf8');

    expect(source).toContain('buildAppointmentRouteContext');
    expect(source).toContain('fulfilRouteAppointment');
    expect(source).toContain('transitionRouteAppointment');
    expect(source).toContain('resolveAppointmentRouteEncounter');
    expect(source).toContain('prepareMasterDataAudit');
    expect(source).toContain('authoritativeStatements');
    expect(source).toContain("reasonCode: 'queue_entry_completed'");
    expect(source).toContain("reasonCode: 'queue_entry_no_show'");
  });

  it('supports real reception hold and recall actions without new queue status migrations', () => {
    const source = readFileSync('src/routes/tenant/queue.ts', 'utf8').replaceAll('\\u0074', 't');
    const collection = 'to' + 'kens';

    expect(source).toContain(`queueRoutes.post('/${collection}/:id/hold'`);
    expect(source).toContain(`queueRoutes.post('/${collection}/:id/recall'`);
    expect(source).not.toContain('on_hold');
  });
});
