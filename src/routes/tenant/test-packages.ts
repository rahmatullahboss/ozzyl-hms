import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { getTestPackage, listTestPackages } from '../../lib/doctor-dashboard';

type AppEnv = { Bindings: Env; Variables: Variables };
const testPackagesRoutes = new Hono<AppEnv>();

testPackagesRoutes.get('/', (c) => {
  const packages = listTestPackages();
  return c.json({ data: packages });
});

testPackagesRoutes.get('/:key', (c) => {
  const key = c.req.param('key');
  const tests = getTestPackage(key);
  if (tests.length === 0) {
    return c.json({ error: 'Test package not found' }, 404);
  }
  return c.json({ data: { key, tests } });
});

export default testPackagesRoutes;
