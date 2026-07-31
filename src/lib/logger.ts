import { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Log levels
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Simple logger that uses console.log/error.
 * Cloudflare Workers Logs automatically captures console output.
 */
export const logger = {
  debug(message: string, data?: unknown) {
    console.log(`[DEBUG] ${message}`, data ?? '');
  },
  
  info(message: string, data?: unknown) {
    console.log(`[INFO] ${message}`, data ?? '');
  },
  
  warn(message: string, data?: unknown) {
    console.warn(`[WARN] ${message}`, data ?? '');
  },
  
  error(message: string, data?: unknown) {
    console.error(`[ERROR] ${message}`, data ?? '');
  },
};

/**
 * Error class for HMS
 */
export class HMSError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number = 400
  ) {
    super(message);
    this.name = 'HMSError';
  }
}

/**
 * Not found error
 */
export class NotFoundError extends HMSError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Unauthorized error
 */
export class UnauthorizedError extends HMSError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Forbidden error
 */
export class ForbiddenError extends HMSError {
  constructor(message: string = 'Forbidden') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

/**
 * Validation error
 */
export class ValidationError extends HMSError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

/**
 * Conflict error
 */
export class ConflictError extends HMSError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}

/**
 * Error handling middleware
 */
export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    const requestId = crypto.randomUUID();
    
    if (error instanceof HMSError) {
      logger.warn(`Health Error: ${error.message}`, {
        code: error.code,
        status: error.status,
        requestId,
      });
      
      return c.json({
        success: false,
        error: error.code,
        message: error.message,
        requestId,
      }, error.status as ContentfulStatusCode);
    }
    
    // Unexpected errors — don't leak stack trace in production
    logger.error(`Unexpected error: ${error}`, {
      requestId,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return c.json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    }, 500);
  }
}

/**
 * Request logging middleware
 */
export async function requestLogger(c: Context, next: Next) {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  
  await next();
  
  const duration = Date.now() - start;
  const status = c.res.status;
  
  logger.info(`${method} ${path} ${status} ${duration}ms`, { ip, status, duration });
}

/**
 * 404 handler
 */
export function notFoundHandler(c: Context) {
  return c.json({
    success: false,
    error: 'NOT_FOUND',
    message: `Route ${c.req.method} ${c.req.path} not found`,
  }, 404);
}

/**
 * Success response helper
 */
export function success(c: Context, data: unknown, message?: string) {
  return c.json({
    success: true,
    message,
    data,
  });
}

/**
 * Paginated response helper
 */
export function paginated(c: Context, data: unknown[], total: number, page: number, limit: number) {
  return c.json({
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
}
