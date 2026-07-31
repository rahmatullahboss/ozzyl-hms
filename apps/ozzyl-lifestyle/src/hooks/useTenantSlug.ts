/**
 * useTenantSlug — extracts the :slug from the current URL path.
 * Works for both /h/:slug/* routes and falls back to an empty string.
 *
 * Usage: const slug = useTenantSlug();  // → "citycare"
 */
import { useMemo } from 'react';
import { useParams } from 'react-router';

export function useTenantSlug(): string {
  const params = useParams<{ slug?: string }>();
  return useMemo(() => params.slug ?? '', [params.slug]);
}

/** Get slug directly from pathname (outside React context, e.g. apiClient) */
export function getTenantSlugFromPath(): string {
  const match = window.location.pathname.match(/^\/h\/([^/]+)/);
  return match?.[1] ?? '';
}
