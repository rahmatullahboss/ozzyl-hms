import { Hono } from 'hono';
import { getRequiredRoutePermission } from '../../../lib/route-permissions';
import { requirePermission } from '../../../middleware/rbac';
import type { Env, Variables } from '../../../types';
import leaveRoutes from './leave';
import attendanceRoutes from './attendance';
import payrollRoutes from './payroll';
import rosterRoutes from './roster';
import biometricRoutes from './biometric';

const hrRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

hrRoutes.use('*', async (c, next) => {
  const lookup = getRequiredRoutePermission(c.req.path, c.req.method);
  if (!lookup || !lookup.prefix.startsWith('/api/hr/')) {
    await next();
    return;
  }

  const permissions = Array.isArray(lookup.permission)
    ? lookup.permission
    : [lookup.permission];
  if (permissions.length === 0) {
    await next();
    return;
  }

  await requirePermission(...permissions)(c, next);
});

// Mount sub-routes
hrRoutes.route('/leave', leaveRoutes);
hrRoutes.route('/attendance', attendanceRoutes);
hrRoutes.route('/payroll', payrollRoutes);
hrRoutes.route('/roster', rosterRoutes);
hrRoutes.route('/biometric', biometricRoutes);

export default hrRoutes;
