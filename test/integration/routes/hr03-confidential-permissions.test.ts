import { describe, expect, it } from 'vitest';
import { getRequiredRoutePermission, ROUTE_PERMISSIONS } from '../../../src/lib/route-permissions';

/**
 * HR-03 permission assertions are checked at the central route matrix in addition
 * to the route-local guards. Never downgrade confidential reads to workforce:read.
 */
describe('HR-03 explicit confidential staff capabilities', () => {
  const expected: Array<[string, string, string]> = [
    ['/api/staff', 'GET', 'workforce:read'],
    ['/api/staff/42', 'GET', 'workforce:read'],
    ['/api/staff/salary-report', 'GET', 'payroll:read'],
    ['/api/staff/42/salary', 'GET', 'payroll:read'],
    ['/api/staff/42/salary', 'POST', 'payroll:payout'],
    ['/api/staff/42/bank-account', 'GET', 'staff:bank:reveal'],
    ['/api/staff/42/invite', 'POST', 'staff:write'],
    ['/api/staff/42', 'PUT', 'workforce:write'],
  ];

  for (const [path, method, permission] of expected) {
    it(`${method} ${path} requires ${permission}`, () => {
      expect(getRequiredRoutePermission(path, method)?.permission).toEqual([permission]);
      expect(Object.prototype.hasOwnProperty.call(ROUTE_PERMISSIONS, permission)).toBe(true);
    });
  }

  it('rejects writes to the bank disclosure route', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(getRequiredRoutePermission('/api/staff/42/bank-account', method)?.permission).toEqual([]);
    }
  });
});
