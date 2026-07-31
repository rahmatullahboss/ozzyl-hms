import { DEFAULT_ROLE_ROUTES } from '@shared/authz';

export function buildAuthenticatedRedirectPath(
  role: string,
  currentSlug?: string | null,
  lastSlug?: string | null,
): string | null {
  const route = DEFAULT_ROLE_ROUTES[role as keyof typeof DEFAULT_ROLE_ROUTES];
  if (!route) return null;
  if (route.startsWith('/')) return route;

  const slug = currentSlug || lastSlug;
  if (!slug) return null;
  return `/h/${slug}/${route}`;
}
