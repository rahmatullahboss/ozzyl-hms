import type { D1Database } from '@cloudflare/workers-types';

export const TASK_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export const TASK_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'] as const;
export const TASK_SOURCE_TYPES = ['exception', 'collection', 'manual'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskSourceType = (typeof TASK_SOURCE_TYPES)[number];

export interface TaskSourceMetadata {
  legacyBillId?: number;
  canonicalInvoicePublicId?: string;
  collectionCaseId?: number;
  exceptionCaseId?: number;
}

export interface UpsertSourceTaskInput {
  db: D1Database;
  tenantId: string;
  sourceType: TaskSourceType;
  sourcePublicId: string;
  sourceHref: string;
  sourceMetadata?: TaskSourceMetadata;
  title: string;
  description?: string;
  priority: TaskPriority;
  assignedTo?: number;
  dueAtUtc?: string;
  actorId: number;
  reopenCompleted?: boolean;
  nowUtc?: string;
}

export interface CreateManualTaskInput {
  db: D1Database;
  tenantId: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  assignedTo?: number;
  dueAtUtc?: string;
  actorId: number;
  nowUtc?: string;
}

export type TaskTransition =
  | { action: 'assign'; assignedTo: number; note?: string }
  | { action: 'start'; note?: string }
  | { action: 'reschedule'; dueAtUtc: string; note?: string }
  | { action: 'complete'; note: string }
  | { action: 'cancel'; note: string };

export interface TransitionTaskInput {
  db: D1Database;
  tenantId: string;
  taskId: number;
  actorId: number;
  expectedUpdatedAtUtc?: string;
  transition: TaskTransition;
  nowUtc?: string;
}

export type TaskTransitionResult = 'updated' | 'not_found' | 'conflict';
