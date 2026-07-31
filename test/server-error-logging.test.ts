import { describe, expect, it, vi } from 'vitest';
import {
  buildServerErrorLogEntry,
  logServerError,
  shouldLogServerErrorResponse,
} from '../src/lib/server-error-logging';

describe('server error logging', () => {
  it('builds a sanitized log entry for thrown server errors', () => {
    const req = new Request('https://hms.ozzyl.com/api/admissions/13051/billing-status?debug=true', {
      method: 'GET',
      headers: {
        authorization: 'Bearer secret-token',
        cookie: 'session=secret-cookie',
        'cf-ray': 'abc123-DAC',
        'user-agent': 'vitest',
      },
    });
    const err = new Error('D1_ERROR: no such column: admission_id');
    err.stack = 'Error: D1_ERROR\n    at sensitive (/tmp/file.ts:1:1)\n    at ignored (/tmp/file.ts:2:1)';

    const entry = buildServerErrorLogEntry({
      request: req,
      status: 500,
      error: err,
      environment: 'production',
      source: 'onError',
    });

    expect(entry).toMatchObject({
      event: 'server_error',
      source: 'onError',
      status: 500,
      method: 'GET',
      path: '/api/admissions/13051/billing-status',
      queryKeys: ['debug'],
      message: 'D1_ERROR: no such column: admission_id',
      errorName: 'Error',
      cfRay: 'abc123-DAC',
    });
    expect(JSON.stringify(entry)).not.toContain('secret-token');
    expect(JSON.stringify(entry)).not.toContain('secret-cookie');
    expect(entry.stack).toHaveLength(2);
  });

  it('includes safe request context fields for observe correlation', () => {
    const entry = buildServerErrorLogEntry({
      request: new Request('https://hms.ozzyl.com/api/billing-counter/handovers/55/accept', {
        method: 'POST',
        headers: {
          'x-request-id': 'req-cash-55',
          authorization: 'Bearer secret-token',
        },
      }),
      status: 500,
      environment: 'production',
      source: 'onError',
      error: new Error('D1_ERROR: no such column: receiver_counted_amount'),
      tenantId: 'tenant-1',
      userId: '42',
      requestId: 'req-cash-55',
      tags: ['unhandled_exception'],
    });

    expect(entry).toMatchObject({
      requestId: 'req-cash-55',
      tenantId: 'tenant-1',
      userId: '42',
      tags: ['unhandled_exception'],
      path: '/api/billing-counter/handovers/55/accept',
    });
    expect(JSON.stringify(entry)).not.toContain('secret-token');
  });

  it('logs only 5xx responses from normal response flow', () => {
    expect(shouldLogServerErrorResponse(500)).toBe(true);
    expect(shouldLogServerErrorResponse(503)).toBe(true);
    expect(shouldLogServerErrorResponse(404)).toBe(false);
    expect(shouldLogServerErrorResponse(200)).toBe(false);
  });

  it('writes server errors as a searchable JSON log line', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      logServerError({
        request: new Request('https://hms.ozzyl.com/api/ip-billing/discharge-bill', { method: 'POST' }),
        status: 500,
        environment: 'production',
        source: 'onError',
        error: new Error('D1_ERROR: CHECK constraint failed: invoice_items'),
      });
    } finally {
      expect(spy).toHaveBeenCalledWith(
        '[SERVER_ERROR]',
        expect.stringContaining('"path":"/api/ip-billing/discharge-bill"'),
      );
      expect(spy).toHaveBeenCalledWith(
        '[SERVER_ERROR]',
        expect.stringContaining('CHECK constraint failed'),
      );
      spy.mockRestore();
    }
  });
});
