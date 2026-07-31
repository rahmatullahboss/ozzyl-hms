/**
 * Playwright Global Setup — Logs in once, saves JWT to disk for all workers.
 *
 * - Reuses cached token if .auth-state.json exists and is < 6 hours old
 * - Only calls the login API when no valid cache exists
 * - Prevents 429 rate-limit errors on consecutive test runs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL =
  process.env['BASE_URL'] ||
  'https://hms-saas-production.rahmatullahzisan.workers.dev';

const AUTH_STATE_PATH = path.join(__dirname, '.auth-state.json');
const TOKEN_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

async function globalSetup(): Promise<void> {
  const email = process.env['E2E_EMAIL'];
  const password = process.env['E2E_PASSWORD'];

  if (!email || !password) {
    console.log('⚠️  E2E_EMAIL/E2E_PASSWORD not set — skipping auth global setup');
    return;
  }

  // ─── Reuse existing token if fresh ──────────────────────────────────────────
  if (fs.existsSync(AUTH_STATE_PATH)) {
    const stat = fs.statSync(AUTH_STATE_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < TOKEN_MAX_AGE_MS) {
      try {
        const raw = fs.readFileSync(AUTH_STATE_PATH, 'utf-8');
        const existing = JSON.parse(raw);
        if (existing.token) {
          console.log(`ℹ️  Reusing cached auth token (${Math.round(ageMs / 60000)}min old) → ${AUTH_STATE_PATH}`);
          return;
        }
      } catch {
        // Corrupted file — fall through to fresh login
      }
    }
  }

  // ─── Fresh login ─────────────────────────────────────────────────────────────
  console.log(`🔐 Logging in as ${email}...`);

  const res = await fetch(`${BASE_URL}/api/auth/login-direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Global login failed (${res.status}): ${body}`);
  }

  const authState = await res.json() as Record<string, unknown>;

  if (!(authState as { token?: string }).token) {
    throw new Error('Login response missing token');
  }

  // Write auth state to disk for workers to read
  fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(authState, null, 2));
  console.log(`✅ Logged in — token cached to ${AUTH_STATE_PATH}`);
}

export default globalSetup;
