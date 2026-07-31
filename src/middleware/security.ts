import { Context, Next } from 'hono';
import bcrypt from 'bcryptjs';
import { enforceMvpFeatureGate } from '../lib/mvp-feature-gates';

/**
 * Input sanitization to prevent XSS
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/['\"]/g, '')  // Remove quotes
    .trim();
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate password strength
 * At least 8 characters, 1 uppercase, 1 lowercase, 1 number
 */
export function isStrongPassword(password: string): boolean {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
}

/**
 * Password hashing
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Password verification
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}



/**
 * Security headers middleware
 * Adds common security headers to all responses.
 *
 * Also enforces the MVP launch feature gate before routing continues so public
 * non-MVP modules cannot bypass the protected-route auth middleware.
 */
export async function securityHeaders(c: Context, next: Next) {
  enforceMvpFeatureGate({
    env: c.env as unknown as Record<string, unknown>,
    path: c.req.path,
  });

  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('X-XSS-Protection', '1; mode=block');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
      "img-src 'self' data: blob: https://*.googleusercontent.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' wss: ws: https://accounts.google.com https://fonts.googleapis.com https://fonts.gstatic.com",
      "frame-src https://accounts.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
}
