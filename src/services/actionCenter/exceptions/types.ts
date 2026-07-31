import type { D1Database } from '@cloudflare/workers-types';

export type ExceptionSeverity = 'critical' | 'warning' | 'info';

export interface ExceptionObservation {
  ruleKey: string;
  fingerprint: string;
  sourceType: string;
  sourceId: string;
  module: string;
  severity: ExceptionSeverity;
  title: string;
  description: string;
  sourceHref: string;
  metadata: Record<string, unknown>;
  autoResolvable: boolean;
  allowRecurrence: boolean;
}

export interface ExceptionDetectorContext {
  db: D1Database;
  tenantId: string;
  now: string;
}

export type ExceptionDetector = (
  context: ExceptionDetectorContext,
) => Promise<ExceptionObservation[]>;
