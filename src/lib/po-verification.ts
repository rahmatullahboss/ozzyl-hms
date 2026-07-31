/**
 * Multi-level PO verification utility.
 *
 * DanpheEMR pattern: VerificationModels with CurrentVerificationLevelCount.
 * Each level has assigned verifiers (roles/users). PO moves through levels
 * until all required levels are verified.
 */

export type VerificationAction = 'approved' | 'rejected';

export interface VerificationLevel {
  level: number;
  required_roles: string[];
  description: string;
}

export interface VerificationEntry {
  level: number;
  verified_by: number;
  action: VerificationAction;
  notes: string | null;
  timestamp: string;
}

export interface PoVerificationState {
  po_id: number;
  status: 'pending' | 'approved' | 'rejected';
  current_verification_level: number;
  required_levels: number;
  verification_history: VerificationEntry[];
}

/**
 * Default verification levels for pharmacy POs.
 */
export const DEFAULT_PO_VERIFICATION_LEVELS: VerificationLevel[] = [
  { level: 1, required_roles: ['pharmacist', 'hospital_admin'], description: 'Pharmacy manager review' },
  { level: 2, required_roles: ['hospital_admin', 'md', 'director'], description: 'Finance/director approval' },
];

/**
 * Check if a user role can verify at a specific level.
 */
export function canVerifyAtLevel(
  role: string,
  level: number,
  levels: VerificationLevel[] = DEFAULT_PO_VERIFICATION_LEVELS,
): boolean {
  const levelConfig = levels.find(l => l.level === level);
  if (!levelConfig) return false;
  return levelConfig.required_roles.includes(role) || role === 'hospital_admin';
}

/**
 * Process a verification action (approve or reject).
 */
export function processVerification(
  state: PoVerificationState,
  action: VerificationAction,
  userId: number,
  role: string,
  notes: string | null,
  levels: VerificationLevel[] = DEFAULT_PO_VERIFICATION_LEVELS,
): PoVerificationState {
  // Can't verify an already completed PO
  if (state.status !== 'pending') {
    throw new Error(`PO is already ${state.status}`);
  }

  // Check role authorization
  if (!canVerifyAtLevel(role, state.current_verification_level + 1, levels)) {
    throw new Error(`Role '${role}' is not authorized to verify at level ${state.current_verification_level + 1}`);
  }

  // Record verification
  const entry: VerificationEntry = {
    level: state.current_verification_level + 1,
    verified_by: userId,
    action,
    notes,
    timestamp: new Date().toISOString(),
  };

  const newHistory = [...state.verification_history, entry];

  // If rejected, mark as rejected
  if (action === 'rejected') {
    return {
      ...state,
      status: 'rejected',
      verification_history: newHistory,
    };
  }

  // If approved, check if all levels are complete
  const newLevel = state.current_verification_level + 1;
  const allLevelsComplete = newLevel >= state.required_levels;

  return {
    ...state,
    status: allLevelsComplete ? 'approved' : 'pending',
    current_verification_level: newLevel,
    verification_history: newHistory,
  };
}

/**
 * Initialize a new PO verification state.
 */
export function initPoVerification(
  poId: number,
  requiredLevels: number = DEFAULT_PO_VERIFICATION_LEVELS.length,
): PoVerificationState {
  return {
    po_id: poId,
    status: 'pending',
    current_verification_level: 0,
    required_levels: requiredLevels,
    verification_history: [],
  };
}
