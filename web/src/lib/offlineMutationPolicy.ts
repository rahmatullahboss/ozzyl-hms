export type OfflineMutationRisk = 'safe' | 'review' | 'blocked';

export interface OfflineMutationDecision {
  allowed: boolean;
  risk: OfflineMutationRisk;
  reason: string;
}

const RISKY_PATH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(cancel|cancellation|void|refund|return)\b/i, reason: 'cancellations, refunds, voids, and returns need the latest cloud state' },
  { pattern: /\b(settlement|final-settlement|discharge|transfer)\b/i, reason: 'settlement, discharge, and transfer workflows are final-state operations' },
  { pattern: /\b(bed|beds|ward-bed)\b/i, reason: 'bed allocation needs realtime resource locking across workstations' },
  { pattern: /\b(pharmacy|dispense|stock|inventory|goods|purchase|requisition)\b/i, reason: 'stock-sensitive workflows need realtime quantity validation' },
  { pattern: /\b(payout|commission|deposit|bank|handover|drawer-close|shift-close)\b/i, reason: 'cash close, handover, payout, and bank operations must reconcile online' },
  { pattern: /\b(permission|permissions|user|users|staff|role|settings)\b/i, reason: 'identity, permission, and settings changes must be online-authoritative' },
];

const SAFE_PATH_PATTERNS: RegExp[] = [
  /^\/api\/patients(?:\/.*)?$/i,
  /^\/api\/appointments(?:\/.*)?$/i,
  /^\/api\/opd(?:\/.*)?$/i,
  /^\/api\/diagnostic(?:\/.*)?$/i,
  /^\/api\/diagnostics(?:\/.*)?$/i,
  /^\/api\/lab-orders(?:\/.*)?$/i,
  /^\/api\/lab\/orders(?:\/.*)?$/i,
  /^\/api\/billing(?:\/.*)?$/i,
  /^\/api\/payments(?:\/.*)?$/i,
];

function normalizePath(path: string): string {
  return (path || '').split('?')[0] || '/';
}

export function getOfflineMutationDecision(
  method: 'post' | 'put' | 'patch' | 'delete' | string,
  path: string,
): OfflineMutationDecision {
  const normalizedMethod = method.toLowerCase();
  const normalizedPath = normalizePath(path);

  if (normalizedMethod === 'delete') {
    return {
      allowed: false,
      risk: 'blocked',
      reason: 'delete operations are not safe to replay from browser offline mode',
    };
  }

  for (const risky of RISKY_PATH_PATTERNS) {
    if (risky.pattern.test(normalizedPath)) {
      return {
        allowed: false,
        risk: 'blocked',
        reason: risky.reason,
      };
    }
  }

  if (SAFE_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return {
      allowed: true,
      risk: 'safe',
      reason: 'allowed browser-offline draft workflow',
    };
  }

  return {
    allowed: false,
    risk: 'review',
    reason: 'this API route is not allow-listed for browser offline replay yet',
  };
}

export function assertOfflineMutationAllowed(
  method: 'post' | 'put' | 'patch' | 'delete' | string,
  path: string,
): OfflineMutationDecision {
  const decision = getOfflineMutationDecision(method, path);
  if (!decision.allowed) {
    throw new Error(`Offline mutation cannot be queued for ${method.toUpperCase()} ${normalizePath(path)}: ${decision.reason}`);
  }
  return decision;
}

export function buildOfflineLocalRef(
  store: string,
  workstationId: string | null | undefined,
  createdAt = new Date(),
): string {
  const cleanStore = (store || 'GENERIC').replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase() || 'GENERIC';
  const rawWorkstation = (workstationId || 'BROWSER').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const cleanWorkstation = rawWorkstation.replace(/^WS/, '').slice(-12) || 'BROWSER';
  const datePart = [
    createdAt.getFullYear(),
    String(createdAt.getMonth() + 1).padStart(2, '0'),
    String(createdAt.getDate()).padStart(2, '0'),
  ].join('');
  const timePart = [
    String(createdAt.getHours()).padStart(2, '0'),
    String(createdAt.getMinutes()).padStart(2, '0'),
    String(createdAt.getSeconds()).padStart(2, '0'),
  ].join('');

  return `OFF-${cleanStore}-${cleanWorkstation}-${datePart}-${timePart}`;
}
