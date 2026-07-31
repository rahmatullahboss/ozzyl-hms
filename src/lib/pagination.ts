/**
 * Pagination utilities for D1 queries.
 *
 * Provides consistent pagination across all list endpoints.
 * Returns page, limit, offset + a meta builder for responses.
 */

import type { Context } from 'hono';

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Extract pagination params from request query string.
 * Enforces sensible defaults and maximums.
 */
export function getPagination(c: Context): PaginationParams {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(c.req.query('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Build pagination metadata for response.
 */
export function paginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}
