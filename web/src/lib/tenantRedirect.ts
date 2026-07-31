export function buildTenantRedirectTarget(
  slug: string,
  path: string,
  search = '',
  preserveSearch = false,
): string {
  const normalizedSlug = slug.replace(/^\/+|\/+$/g, '');
  const [pathPart, defaultSearch = ''] = path.split('?', 2);
  const normalizedPath = pathPart.replace(/^\/+|\/+$/g, '');
  const params = new URLSearchParams(defaultSearch);

  if (preserveSearch && search) {
    const incoming = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    for (const [key, value] of incoming.entries()) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return `/h/${normalizedSlug}/${normalizedPath}${query ? `?${query}` : ''}`;
}
