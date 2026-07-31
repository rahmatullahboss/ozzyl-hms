import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export type DrizzleDb = ReturnType<typeof getDb>;

/**
 * Create a Drizzle ORM instance from a D1 binding.
 * Usage in Hono routes:
 *   const db = getDb(c.env.DB);
 *   const patients = await db.select().from(schema.patients).where(...);
 */
export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
