export const BROKEN_SW_RESET_KEY = 'hms-sw-reset-public-api-patterns-2026-06-18';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, 'getRegistrations'>;

function isRootHmsWorker(registration: ServiceWorkerRegistration, origin: string): boolean {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (!worker) return false;

  try {
    const scope = new URL(registration.scope);
    const script = new URL(worker.scriptURL);
    return scope.origin === origin && scope.pathname === '/' && script.origin === origin && script.pathname === '/sw.js';
  } catch {
    return false;
  }
}

export async function refreshStaleHmsServiceWorker(
  serviceWorker: ServiceWorkerContainerLike,
  storage: StorageLike,
  origin: string,
  onUpdateReady?: () => void,
): Promise<void> {
  if (storage.getItem(BROKEN_SW_RESET_KEY) === '1') return;

  const registrations = await serviceWorker.getRegistrations();
  const hmsRegistrations = registrations.filter((registration) => isRootHmsWorker(registration, origin));

  await Promise.all(hmsRegistrations.map((registration) => registration.update()));

  for (const registration of hmsRegistrations) {
    if (!registration.waiting) continue;
    onUpdateReady?.();
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  storage.setItem(BROKEN_SW_RESET_KEY, '1');
}
