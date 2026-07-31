/**
 * Returns true when a nav item should be rendered as "active" for the
 * current pathname. The dashboard root '/' is the "home" item — it only
 * matches the exact root path. For other paths, we match the exact path
 * OR a child path that begins with the nav path followed by '/'.
 */
export function isNavItemActive(navPath: string, currentPath: string): boolean {
  if (navPath === '/') return currentPath === '/' || currentPath === '';
  if (currentPath === navPath) return true;
  return currentPath.startsWith(navPath + '/');
}
