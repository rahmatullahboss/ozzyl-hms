export function shouldBypassPatientAuthRateLimit(path: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase();

  if (normalizedMethod === 'GET') {
    return true;
  }

  if (path === '/api/patient-auth/me' || path === '/api/patient-auth/refresh') {
    return true;
  }

  if (normalizedMethod === 'PATCH' && path === '/api/patient-auth/me') {
    return true;
  }

  return false;
}
