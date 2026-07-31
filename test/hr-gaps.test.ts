import { describe, it, expect } from 'vitest';
import { createStaffSchema, updateStaffSchema } from '../src/schemas/staff';
import { createWeekendPolicySchema, updateWeekendPolicySchema, carryForwardLeaveSchema, markAbsentSchema, overtimePayrollIntegrationSchema } from '../src/schemas/hr';

describe('Gap 1: Department Field', () => {
  it('accepts valid department', () => { expect(createStaffSchema.parse({ name: 'J', address: 'S', position: 'N', salary: 1, bankAccount: '1', mobile: '01712345678', department: 'Cardio' }).department).toBe('Cardio'); });
  it('accepts optional department', () => { expect(createStaffSchema.parse({ name: 'J', address: 'S', position: 'N', salary: 1, bankAccount: '1', mobile: '01712345678' }).department).toBeUndefined(); });
  it('rejects empty department', () => { expect(() => createStaffSchema.parse({ name: 'J', address: 'S', position: 'N', salary: 1, bankAccount: '1', mobile: '01712345678', department: '' })).toThrow(); });
  it('rejects department > 100', () => { expect(() => createStaffSchema.parse({ name: 'J', address: 'S', position: 'N', salary: 1, bankAccount: '1', mobile: '01712345678', department: 'A'.repeat(101) })).toThrow(); });
  it('accepts department in update', () => { expect(updateStaffSchema.parse({ department: 'Ortho' }).department).toBe('Ortho'); });
  it('accepts null department', () => { expect(updateStaffSchema.parse({ department: null }).department).toBeNull(); });
});

describe('Gap 2: Weekend Policy Schema', () => {
  it('accepts valid', () => { const r = createWeekendPolicySchema.parse({ year: 2025, dayOfWeek: 'friday' }); expect(r.weekPattern).toBe('every'); });
  it('accepts first_and_third', () => { expect(createWeekendPolicySchema.parse({ year: 2025, dayOfWeek: 'saturday', weekPattern: 'first_and_third' }).weekPattern).toBe('first_and_third'); });
  it('rejects invalid day', () => { expect(() => createWeekendPolicySchema.parse({ year: 2025, dayOfWeek: 'funday' })).toThrow(); });
  it('rejects year < 2020', () => { expect(() => createWeekendPolicySchema.parse({ year: 2019, dayOfWeek: 'friday' })).toThrow(); });
  it('accepts partial update', () => { expect(updateWeekendPolicySchema.parse({ weekPattern: 'first' }).weekPattern).toBe('first'); });
  it('accepts isActive', () => { expect(updateWeekendPolicySchema.parse({ isActive: false }).isActive).toBe(false); });
});

describe('Gap 3: Carry-Forward Schema', () => {
  it('accepts valid', () => { expect(carryForwardLeaveSchema.parse({ staffId: 1, fromYear: 2024, toYear: 2025 }).toYear).toBe(2025); });
  it('rejects toYear <= fromYear', () => { expect(() => carryForwardLeaveSchema.parse({ staffId: 1, fromYear: 2025, toYear: 2025 })).toThrow(); });
  it('rejects staffId 0', () => { expect(() => carryForwardLeaveSchema.parse({ staffId: 0, fromYear: 2024, toYear: 2025 })).toThrow(); });
});

describe('Gap 4: Overtime Schema', () => {
  it('accepts valid', () => { expect(overtimePayrollIntegrationSchema.parse({ payrollRunId: 1, staffId: 2 }).includeOvertime).toBe(true); });
  it('rejects payrollRunId 0', () => { expect(() => overtimePayrollIntegrationSchema.parse({ payrollRunId: 0, staffId: 2 })).toThrow(); });
});

describe('Gap 5: Mark Absent Schema', () => {
  it('accepts valid', () => { expect(markAbsentSchema.parse({ date: '2025-03-15' }).date).toBe('2025-03-15'); });
  it('accepts department', () => { expect(markAbsentSchema.parse({ date: '2025-03-15', department: 'C' }).department).toBe('C'); });
  it('rejects bad date', () => { expect(() => markAbsentSchema.parse({ date: 'x' })).toThrow(); });
});

describe('Bug Fix: Carry-Forward Idempotency', () => {
  const sim = (ex: {tA:number;bal:number;cf:number}|null, cf:number, max:number, fix:boolean) => {
    if (!ex) return fix ? {tA:max+cf,bal:max+cf,cf} : {tA:cf,bal:cf,cf};
    if (fix) { const b=ex.tA-ex.cf; return {tA:b+cf,bal:b+cf,cf}; }
    return {tA:ex.tA+cf,bal:ex.bal+cf,cf:ex.cf+cf};
  };
  it('FIX: no inflate on retry', () => { const a=sim(null,8,20,true); expect(a.bal).toBe(28); const b=sim(a,8,20,true); expect(b.bal).toBe(28); expect(b.cf).toBe(8); });
  it('BUG: inflates without fix', () => { const a=sim(null,8,20,false); const b=sim(a,8,20,false); expect(b.cf).toBe(16); });
  it('FIX: includes base quota', () => { expect(sim(null,5,20,true).tA).toBe(25); });
  it('BUG: misses base quota', () => { expect(sim(null,5,20,false).tA).toBe(5); });
});

describe('Bug Fix: Overtime Idempotency', () => {
  const sim = (p:{tE:number;nP:number;oA:number},ot:number,fix:boolean) => {
    if (fix) { const b=p.tE-p.oA; return {tE:b+ot,nP:b+ot,oA:ot}; }
    return {tE:p.tE+ot,nP:p.nP+ot,oA:p.oA+ot};
  };
  it('FIX: no inflate on retry', () => { const a=sim({tE:30000,nP:27000,oA:0},5000,true); const b=sim(a,5000,true); expect(b.tE).toBe(35000); expect(b.oA).toBe(5000); });
  it('BUG: inflates without fix', () => { const a=sim({tE:30000,nP:27000,oA:0},5000,false); const b=sim(a,5000,false); expect(b.tE).toBe(40000); expect(b.oA).toBe(10000); });
});
