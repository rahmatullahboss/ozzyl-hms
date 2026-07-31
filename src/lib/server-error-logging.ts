export type ServerErrorLogSource = 'onError' | 'response';

export type ServerErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export type ServerErrorLogInput = {
  request: Request;
  status: number;
  environment: string;
  source: ServerErrorLogSource;
  error?: unknown;
  message?: string;
  // ─── P0-42 structured fields (optional) ─────────────────────────────
  // tenant_id and user_id come from request context (auth middleware).
  // request_id is set by the request-scoped logger / cf-ray fallback.
  // severity is mapped from HTTP status by default but can be overridden.
  tenantId?: string;
  userId?: string;
  requestId?: string;
  severity?: ServerErrorSeverity;
  tags?: string[];
};

export type ServerErrorLogEntry = {
  event: 'server_error' | 'http_error';
  source: ServerErrorLogSource;
  severity: ServerErrorSeverity;
  status: number;
  method: string;
  path: string;
  queryKeys: string[];
  message: string;
  errorName?: string;
  cfRay?: string;
  userAgent?: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  tags?: string[];
  timestamp: string;
  environment: string;
  stack?: string[];
};

const MAX_STACK_LINES = 6;

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return undefined;
}

function getErrorName(error: unknown): string | undefined {
  if (error instanceof Error) return error.name;
  return undefined;
}

function getStackLines(error: unknown, environment: string): string[] | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  const maxLines = environment === 'production' ? 2 : MAX_STACK_LINES;
  return error.stack.split('\n').slice(0, maxLines);
}

export function shouldLogServerErrorResponse(status: number): boolean {
  return status >= 500;
}

/**
 * Map an HTTP status to a default severity. Callers can override via
 * ServerErrorLogInput.severity. Critical 5xx are paged in
 * docs/INCIDENT_RUNBOOK.md.
 */
export function severityFromStatus(status: number): ServerErrorSeverity {
  if (status >= 500) return 'critical';
  if (status >= 400) return 'warning';
  return 'info';
}

export function buildServerErrorLogEntry(input: ServerErrorLogInput): ServerErrorLogEntry {
  const url = new URL(input.request.url);
  const message = input.message
    ?? getErrorMessage(input.error)
    ?? `HTTP ${input.status} response`;
  const severity = input.severity ?? severityFromStatus(input.status);
  const cfRay = input.request.headers.get('cf-ray') ?? undefined;
  // Prefer caller-provided request_id; fall back to cf-ray so downstream
  // log aggregators can still correlate entries.
  const requestId = input.requestId ?? cfRay;
  // Drop empty tag arrays so the payload stays compact.
  const tags = input.tags && input.tags.length > 0 ? input.tags : undefined;

  return {
    event: input.status >= 500 ? 'server_error' : 'http_error',
    source: input.source,
    severity,
    status: input.status,
    method: input.request.method,
    path: url.pathname,
    queryKeys: Array.from(url.searchParams.keys()).sort(),
    message,
    errorName: getErrorName(input.error),
    cfRay,
    userAgent: input.request.headers.get('user-agent') ?? undefined,
    requestId,
    tenantId: input.tenantId,
    userId: input.userId,
    tags,
    timestamp: new Date().toISOString(),
    environment: input.environment,
    stack: getStackLines(input.error, input.environment),
  };
}

export function logServerError(input: ServerErrorLogInput): void {
  // P0-42: structured payload suitable for ingestion by Sentry, Datadog,
  // Logflare, or any JSON log shipper. The shape is intentionally
  // framework-agnostic — no hard Sentry SDK dependency is added; only
  // the data shape is standardized. See docs/INCIDENT_RUNBOOK.md for
  // the alert pipeline that consumes this payload.
  console.error('[SERVER_ERROR]', JSON.stringify(buildServerErrorLogEntry(input)));
}
