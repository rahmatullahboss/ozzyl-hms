import { describe, expect, it, vi } from 'vitest';
import { d1WithRetry, isD1VersionError } from '../src/lib/d1-retry';

describe('isD1VersionError', () => {
  it('returns true for the standard D1 VersionError message', () => {
    expect(
      isD1VersionError(
        new Error('D1 execute error: VersionError: The requested version (1) is less than the existing version (2).'),
      ),
    ).toBe(true);
  });

  it('returns true for the bare "VersionError" string', () => {
    expect(isD1VersionError(new Error('VersionError'))).toBe(true);
  });

  it('returns false for a SQL syntax error', () => {
    expect(isD1VersionError(new Error('SQLITE_ERROR: near "SELCT": syntax error'))).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isD1VersionError(null)).toBe(false);
    expect(isD1VersionError(undefined)).toBe(false);
  });

  it('returns false for a string error', () => {
    expect(isD1VersionError('VersionError')).toBe(false);
  });

  it('returns false for an error without a message field', () => {
    expect(isD1VersionError({})).toBe(false);
  });
});

describe('d1WithRetry', () => {
  // Uses real timers with tiny baseDelayMs (0-1ms) so the suite stays fast
  // but the helper still exercises the actual setTimeout path. Fake timers
  // were tried but the jitter (10%) makes timing assertions brittle.

  it('returns the operation result on the first successful try', async () => {
    const op = vi.fn().mockResolvedValue({ ok: true });
    const result = await d1WithRetry(op, { baseDelayMs: 0 });
    expect(result).toEqual({ ok: true });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries on VersionError and eventually succeeds', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('VersionError: requested version (1) is less than existing version (2).'))
      .mockRejectedValueOnce(new Error('VersionError: requested version (1) is less than existing version (2).'))
      .mockResolvedValueOnce({ ok: true });

    const result = await d1WithRetry(op, { baseDelayMs: 0 });

    expect(result).toEqual({ ok: true });
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('throws the last VersionError after exhausting attempts', async () => {
    const finalErr = new Error('VersionError: requested version (1) is less than existing version (2).');
    const op = vi.fn().mockRejectedValue(finalErr);

    await expect(d1WithRetry(op, { attempts: 3, baseDelayMs: 0 })).rejects.toBe(finalErr);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('re-throws non-VersionError errors immediately without retrying', async () => {
    const sqlErr = new Error('SQLITE_ERROR: syntax error');
    const op = vi.fn().mockRejectedValue(sqlErr);

    await expect(d1WithRetry(op, { baseDelayMs: 0 })).rejects.toBe(sqlErr);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('uses the configured number of attempts', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('VersionError'))
      .mockResolvedValueOnce('ok');

    const result = await d1WithRetry(op, { attempts: 2, baseDelayMs: 0 });

    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('logs a warning on retry when a label is provided', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('VersionError'))
      .mockResolvedValueOnce('ok');

    await d1WithRetry(op, { attempts: 2, baseDelayMs: 0, label: 'test-op' });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('[d1-retry]');
    expect(warn.mock.calls[0][0]).toContain('test-op');
    warn.mockRestore();
  });

  it('does not log when the operation succeeds on the first try', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const op = vi.fn().mockResolvedValue('ok');
    await d1WithRetry(op, { baseDelayMs: 0, label: 'noisy' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('attempts at least once even if attempts is set to 0 or negative', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    await expect(d1WithRetry(op, { attempts: 0 })).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });
});
