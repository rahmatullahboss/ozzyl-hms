import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import appointmentRoutes from './appointments';
import { loadPaidAppointmentContext } from './appointment-paid-context';

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();

routes.use('/fee-preview', async (c, next) => {
  await next();

  if (c.res.status !== 200) return;

  const patientId = Number(c.req.query('patientId'));
  const doctorIdValue = c.req.query('doctorId');
  const doctorId = doctorIdValue ? Number(doctorIdValue) : null;
  const paidVisitContext = Number.isInteger(patientId) && patientId > 0
    ? await loadPaidAppointmentContext(c.env.DB, {
        tenantId: String(requireTenantId(c)),
        patientId,
        doctorId: Number.isInteger(doctorId) && Number(doctorId) > 0 ? doctorId : null,
      })
    : { selectedDoctor: null, latestAnyDoctor: null };

  const responseBody = await c.res.clone().json<Record<string, unknown>>();
  const headers = new Headers(c.res.headers);
  headers.delete('content-length');
  c.res = new Response(JSON.stringify({ ...responseBody, paidVisitContext }), {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
});

routes.route('/', appointmentRoutes);

export default routes;
