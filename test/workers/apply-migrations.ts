/**
 * Apply D1 migrations before tests.
 * Uses the TEST_MIGRATIONS binding provided by vitest.workers.config.ts
 */
import { env } from 'cloudflare:workers';

const migrations = (env as any).TEST_MIGRATIONS;

if (migrations && Array.isArray(migrations)) {
  console.log(`[apply-migrations] Found ${migrations.length} migrations`);
  for (const migration of migrations) {
    const queries = migration.queries || [];
    console.log(`[apply-migrations] Applying: ${migration.name} (${queries.length} queries)`);
    for (const query of queries) {
      if (query.trim()) {
        try {
          await env.DB.exec(query);
        } catch (e: any) {
          // Log but don't fail — some queries may conflict with existing state
          if (!e.message?.includes('already exists')) {
            console.warn(`[apply-migrations] Warning in ${migration.name}: ${e.message}`);
          }
        }
      }
    }
  }
  console.log('[apply-migrations] Done');
} else {
  console.warn('[apply-migrations] No TEST_MIGRATIONS found, attempting fallback...');
  // Fallback: create essential tables directly
  const createTenants = `
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subdomain TEXT UNIQUE,
      status TEXT DEFAULT 'active',
      config TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `;
  const createUsers = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `;
  try {
    await env.DB.exec(createTenants);
    await env.DB.exec(createUsers);
    console.log('[apply-migrations] Fallback tables created');
  } catch (e: any) {
    console.error('[apply-migrations] Fallback failed:', e.message);
  }
}
