import { describe, expect, it, vi } from 'vitest';
import type { ShiftRepository, WorkforceMemberRepository } from '../../../src/modules/workforce-management';
import { requireActiveMember, requireActiveShift } from '../../../src/modules/workforce-management/application/workforce-directory';
import { createD1WorkforceDirectoryRepository } from '../../../src/modules/workforce-management/infrastructure/d1-workforce-member-repository';

type QueryMethod = 'first' | 'all';
type QueryHandler = (sql: string, bindings: unknown[], method: QueryMethod) => unknown | Promise<unknown>;

function createFakeDb(handler: QueryHandler): D1Database {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async first() {
          return handler(sql, bindings, 'first');
        },
        async all() {
          const result = await handler(sql, bindings, 'all');
          return { results: Array.isArray(result) ? result : [] };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

const activeStaffRow = {
  id: 21,
  tenant_id: 100,
  name: 'Nurse Fatima',
  position: 'Nurse',
  department: 'ICU',
  status: 'active',
  user_id: 44,
  practitioner_public_id: 'prac_icu_21',
};

describe('D1 workforce directory repository', () => {
  it('returns an active tenant-owned employee with an exact practitioner link', async () => {
    const repository = createD1WorkforceDirectoryRepository(createFakeDb((_sql, bindings) => {
      return bindings[0] === '100' && bindings[1] === 21 ? activeStaffRow : null;
    }));

    expect(await repository.getMember('100', 21)).toEqual({
      tenantId: '100',
      staffId: 21,
      displayName: 'Nurse Fatima',
      position: 'Nurse',
      department: 'ICU',
      status: 'active',
      userId: 44,
      practitionerPublicId: 'prac_icu_21',
    });
  });

  it('never returns a staff row from another tenant', async () => {
    const repository = createD1WorkforceDirectoryRepository(createFakeDb((_sql, bindings) => {
      return bindings[0] === '100' && bindings[1] === 21 ? activeStaffRow : null;
    }));

    expect(await repository.getMember('200', 21)).toBeNull();
  });

  it('returns null practitionerPublicId for a non-clinical employee', async () => {
    const repository = createD1WorkforceDirectoryRepository(createFakeDb(() => ({
      ...activeStaffRow,
      id: 22,
      name: 'Cashier Rahim',
      position: 'Cashier',
      department: 'Billing',
      user_id: null,
      practitioner_public_id: null,
    })));

    expect((await repository.getMember('100', 22))?.practitionerPublicId).toBeNull();
  });

  it('falls back to staff-only lookup when the canonical employee-link table is absent', async () => {
    const prepareSpy = vi.fn();
    const repository = createD1WorkforceDirectoryRepository(createFakeDb((sql) => {
      prepareSpy(sql);
      if (sql.includes('canonical_practitioner_employee_links')) {
        throw new Error('D1_ERROR: no such table: canonical_practitioner_employee_links');
      }
      return { ...activeStaffRow, practitioner_public_id: null };
    }));

    expect((await repository.getMember('100', 21))?.practitionerPublicId).toBeNull();
    expect(prepareSpy).toHaveBeenCalledTimes(2);
  });

  it('rethrows database failures unrelated to the optional practitioner-link table', async () => {
    const repository = createD1WorkforceDirectoryRepository(createFakeDb(() => {
      throw new Error('D1_ERROR: database is locked');
    }));

    await expect(repository.getMember('100', 21)).rejects.toThrow('database is locked');
  });
});

describe('workforce active-reference guards', () => {
  it('rejects an inactive workforce member', async () => {
    const repository = {
      getMember: async () => ({ ...activeStaffRow, tenantId: '100', staffId: 21, displayName: 'Nurse Fatima', department: 'ICU', userId: 44, practitionerPublicId: null, status: 'inactive' as const }),
      getActiveMember: async () => null,
      listActiveMembers: async () => [],
    } as unknown as WorkforceMemberRepository;

    await expect(requireActiveMember(repository, '100', 21)).rejects.toMatchObject({
      code: 'WORKFORCE_MEMBER_INACTIVE',
      httpStatus: 409,
    });
  });

  it('rejects an inactive shift', async () => {
    const repository = {
      getShift: async () => ({
        tenantId: '100',
        shiftId: 8,
        name: 'Old Night',
        shortCode: 'ON',
        startTime: '22:00',
        endTime: '06:00',
        gracePeriodMinutes: 10,
        breakDurationMinutes: 0,
        isNightShift: true,
        color: null,
        isActive: false,
      }),
      listActiveShifts: async () => [],
    } satisfies ShiftRepository;

    await expect(requireActiveShift(repository, '100', 8)).rejects.toMatchObject({
      code: 'SHIFT_INACTIVE',
      httpStatus: 409,
    });
  });
});
