function hasFileExtension(pathname: string): boolean {
  const lastSegment = pathname.split('/').pop() ?? '';
  return lastSegment.includes('.') && !lastSegment.endsWith('.');
}

export function resolvePatientAssetPath(pathname: string): string {
  if (pathname === '/patient' || pathname === '/patient/') {
    return '/patient/index.html';
  }

  return hasFileExtension(pathname) ? pathname : '/patient/index.html';
}
