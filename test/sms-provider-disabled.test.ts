import { describe, expect, it, vi } from 'vitest';
import { createSmsProvider } from '../src/lib/sms';

describe('SMS provider safety', () => {
  it('fails closed when SMS is explicitly disabled', async () => {
    const provider = createSmsProvider({ SMS_PROVIDER: 'disabled' });

    await expect(provider.sendSMS('01700000000', 'Test message')).resolves.toEqual({
      success: false,
      error: 'SMS delivery is not configured',
    });
  });

  it('does not report stub messages as delivered', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const provider = createSmsProvider({ SMS_PROVIDER: 'stub' });

    await expect(provider.sendSMS('01700000000', 'Test message')).resolves.toEqual({
      success: false,
      error: 'SMS stub mode does not send real messages',
    });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
