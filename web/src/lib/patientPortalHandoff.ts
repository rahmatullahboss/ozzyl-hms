export interface PatientPortalLocationLike {
  pathname: string;
  search?: string;
  hash?: string;
}

export function buildPatientPortalHandoffTarget(location: PatientPortalLocationLike): string {
  return `${location.pathname}${location.search ?? ''}${location.hash ?? ''}`;
}

export function shouldUnregisterServiceWorkerScope(scope: string, origin: string): boolean {
  if (!scope.startsWith(origin)) return false;

  const scopePath = scope.slice(origin.length) || '/';
  return scopePath === '/' || scopePath === '';
}
