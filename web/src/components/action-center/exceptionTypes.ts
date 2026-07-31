export type ExceptionSeverity = 'critical' | 'warning' | 'info';
export type ExceptionStatus = 'open' | 'acknowledged' | 'in_progress' | 'snoozed' | 'resolved' | 'dismissed';

export interface ExceptionCase {
  id: number;
  ruleKey: string;
  fingerprint: string;
  sourceType: string;
  sourceId: string;
  module: string;
  severity: ExceptionSeverity;
  title: string;
  description: string;
  sourceHref: string | null;
  status: ExceptionStatus;
  assignedTo: number | null;
  assignedToName: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  acknowledgedBy?: number | null;
  acknowledgedAt?: string | null;
  resolvedBy?: number | null;
  resolvedAt?: string | null;
  resolutionCode?: string | null;
  resolutionNote?: string | null;
  dismissedBy?: number | null;
  dismissedAt?: string | null;
  dismissalReason?: string | null;
  snoozedUntil: string | null;
  metadata?: Record<string, unknown>;
  slaAgeHours: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExceptionEvent {
  id: number;
  eventType: string;
  actorId: number | null;
  actorName: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  note: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ExceptionListSummary {
  total?: number;
  open?: number;
  acknowledged?: number;
  in_progress?: number;
  snoozed?: number;
  resolved?: number;
  dismissed?: number;
  critical?: number;
  warning?: number;
  info?: number;
}

export interface ExceptionListResponse {
  data: {
    items: ExceptionCase[];
    summary: ExceptionListSummary;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

export interface ExceptionDetailResponse {
  data: ExceptionCase;
}

export interface ExceptionEventsResponse {
  data: ExceptionEvent[];
}
