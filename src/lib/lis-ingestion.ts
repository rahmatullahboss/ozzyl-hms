export type LisProtocol = 'hl7' | 'astm' | 'json' | 'csv' | 'file_drop' | string;

export interface LisMessageIdentityInput {
  tenantId: string | number;
  machineId: string | number;
  protocol: LisProtocol;
  sourceIdentity: string;
}

export type ReplayClassification = 'new' | 'duplicate' | 'collision';

export type ExactCandidateSelection<T> =
  | { kind: 'none' }
  | { kind: 'exact'; candidate: T }
  | { kind: 'ambiguous' };

export async function sha256Hex(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildLisMessageIdentity(input: LisMessageIdentityInput): string {
  const tenantId = String(input.tenantId).trim();
  const machineId = String(input.machineId).trim();
  const protocol = String(input.protocol).trim().toLowerCase();
  const sourceIdentity = String(input.sourceIdentity).trim();

  if (!tenantId || !machineId || !protocol || !sourceIdentity) {
    throw new Error('LIS message identity requires tenant, machine, protocol, and source identity');
  }

  return `${tenantId}:${machineId}:${protocol}:${sourceIdentity}`;
}

export function resolveLisSourceIdentity(
  deliveryId: string | null | undefined,
  payloadHash: string,
): string {
  const normalizedDeliveryId = String(deliveryId ?? '').trim();
  return normalizedDeliveryId || payloadHash;
}

export function classifyReplay(existingHash: string | null | undefined, incomingHash: string): ReplayClassification {
  if (!existingHash) return 'new';
  return existingHash === incomingHash ? 'duplicate' : 'collision';
}

export function selectExactCandidate<T>(candidates: readonly T[]): ExactCandidateSelection<T> {
  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length === 1) return { kind: 'exact', candidate: candidates[0] };
  return { kind: 'ambiguous' };
}
