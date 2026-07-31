import { describe, expect, it } from 'vitest';
import * as workforce from '../../../src/modules/workforce-management';

describe('workforce-management public API', () => {
  it('exports the supported composition surface', () => {
    expect(workforce.WorkforceError).toBeTypeOf('function');
    expect(workforce.createWorkforceModule).toBeTypeOf('function');
    expect(workforce.calculateCycleDay).toBeTypeOf('function');
    expect(workforce.enumerateInclusiveDates).toBeTypeOf('function');
    expect(workforce.resolveWeekPattern).toBeTypeOf('function');
    expect(workforce.createWorkCalendarService).toBeTypeOf('function');
    expect(workforce.createRotationService).toBeTypeOf('function');
    expect(workforce.createAttendanceQueryService).toBeTypeOf('function');
    expect(workforce.createAttendancePunchService).toBeTypeOf('function');
    expect(workforce.createD1AttendanceApplication).toBeTypeOf('function');
    expect(workforce.createD1AttendanceRepository).toBeTypeOf('function');
    expect(workforce.createD1WorkCalendarRepository).toBeTypeOf('function');
    expect(workforce.createD1RotationRepository).toBeTypeOf('function');
    expect(workforce.resolveAttendanceBusinessDate).toBeTypeOf('function');
  });
});
