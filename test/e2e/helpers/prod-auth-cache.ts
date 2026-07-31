import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BASE_URL =
  process.env['BASE_URL'] ||
  'https://hms-saas-production.rahmatullahzisan.workers.dev';

const TOKEN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface RoleAuthState {
  token: string;
  slug: string;
  user: { id: number; email: string; name: string; role: string };
  hospital: { id: number; name: string; slug: string };
}

function cachePath(cacheKey: string): string {
  return path.join(__dirname, '..', `.auth-state.${cacheKey}.json`);
}

export function loadCachedRoleAuth(cacheKey: string): RoleAuthState | null {
  const file = cachePath(cacheKey);
  if (!fs.existsSync(file)) return null;

  const stat = fs.statSync(file);
  if (Date.now() - stat.mtimeMs > TOKEN_MAX_AGE_MS) return null;

  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as RoleAuthState;
    return parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCachedRoleAuth(cacheKey: string, auth: RoleAuthState): void {
  fs.writeFileSync(cachePath(cacheKey), JSON.stringify(auth, null, 2));
}

export async function loginDirectAndCache(
  email: string,
  password: string,
  cacheKey: string,
): Promise<RoleAuthState> {
  const cached = loadCachedRoleAuth(cacheKey);
  if (cached) return cached;

  const res = await fetch(`${BASE_URL}/api/auth/login-direct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = await res.json().catch(async () => ({ error: await res.text() }));

  if (!res.ok || !body?.token || !body?.slug) {
    const message = body?.message || body?.error || `Login failed with status ${res.status}`;
    throw new Error(`${email}: ${message}`);
  }

  const auth = body as RoleAuthState;
  saveCachedRoleAuth(cacheKey, auth);
  return auth;
}

