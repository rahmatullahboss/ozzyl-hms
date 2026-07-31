const RESERVED_HOST_SUBDOMAINS = new Set([
  'www',
  'api',
  'admin',
  'auth',
  'app',
  'hms',
  'super',
  'mail',
  'ftp',
  'blog',
  'shop',
  'dev',
  'test',
  'command-center',
]);

export function getTenantSlugFromHost(hostname: string = window.location.hostname): string {
  const normalized = hostname.toLowerCase();

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.workers.dev') ||
    normalized.endsWith('.pages.dev')
  ) {
    return '';
  }

  const parts = normalized.split('.');
  if (parts.length < 3) {
    return '';
  }

  const subdomain = parts[0];
  if (RESERVED_HOST_SUBDOMAINS.has(subdomain)) {
    return '';
  }

  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(subdomain) ? subdomain : '';
}

function getHostSubdomain(hostname: string): string {
  const normalized = hostname.toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.workers.dev') ||
    normalized.endsWith('.pages.dev')
  ) {
    return '';
  }

  const parts = normalized.split('.');
  return parts.length >= 3 ? parts[0] : '';
}

export function isAdminHost(hostname: string = window.location.hostname): boolean {
  return getHostSubdomain(hostname) === 'admin';
}

export function isStaffAuthHost(hostname: string = window.location.hostname): boolean {
  const subdomain = getHostSubdomain(hostname);
  return subdomain === 'auth' || subdomain === 'hms' || subdomain === 'command-center';
}

export function isPatientAppHost(hostname: string = window.location.hostname): boolean {
  return getHostSubdomain(hostname) === 'app';
}
