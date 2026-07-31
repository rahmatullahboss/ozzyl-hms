import { describe, expect, test, vi, beforeEach } from 'vitest';
import { sendOtp, verifyOtp, OtpSmsTemplates } from '../../src/lib/otp';
import type { SmsProvider, SmsResult } from '../../src/lib/sms';

// ─── Mock KV ──────────────────────────────────────────────────────────────────
function createMockKV() {
  const store = new Map<string, string>();
  const expirations = new Map<string, number>();

  return {
    get: vi.fn(async (key: string, type?: string) => {
      const exp = expirations.get(key);
      if (exp && Date.now() > exp) {
        store.delete(key);
        expirations.delete(key);
        return null;
      }
      const val = store.get(key);
      if (!val) return null;
      return type === 'json' ? JSON.parse(val) : val;
    }),
    put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, value);
      if (opts?.expirationTtl) {
        expirations.set(key, Date.now() + opts.expirationTtl * 1000);
      }
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
      expirations.delete(key);
    }),
    _store: store,
    _expirations: expirations,
  };
}

// ─── Mock SMS Provider ────────────────────────────────────────────────────────
function createMockSms(): SmsProvider & { calls: Array<{ to: string; message: string }> } {
  const calls: Array<{ to: string; message: string }> = [];
  return {
    calls,
    sendSMS: vi.fn(async (to: string, message: string): Promise<SmsResult> => {
      calls.push({ to, message });
      return { success: true, messageId: `mock-${Date.now()}` };
    }),
  };
}

function createFailingSms(): SmsProvider {
  return {
    sendSMS: vi.fn(async (): Promise<SmsResult> => ({
      success: false,
      error: 'SMS provider down',
    })),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('OTP Service', () => {
  const phone = '01712345678';

  describe('sendOtp', () => {
    test('sends OTP and stores in KV', async () => {
      const kv = createMockKV();
      const sms = createMockSms();
      const env = { KV: kv as unknown as KVNamespace };

      const result = await sendOtp(env, sms, phone, 'signup');

      expect(result.success).toBe(true);
      expect(sms.calls).toHaveLength(1);
      expect(sms.calls[0].to).toBe('01712345678');
      expect(sms.calls[0].message).toContain('OTP');
      expect(kv.put).toHaveBeenCalledTimes(2); // OTP + rate limit
    });

    test('normalizes phone number', async () => {
      const kv = createMockKV();
      const sms = createMockSms();
      const env = { KV: kv as unknown as KVNamespace };

      await sendOtp(env, sms, '01712345678', 'signup');

      // Should store with normalized key
      const putCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls;
      const otpCall = putCalls.find((c: unknown[]) => String(c[0]).startsWith('otp:'));
      expect(otpCall?.[0]).toBe('otp:01712345678');
    });

    test('stores OTP with 5 minute TTL', async () => {
      const kv = createMockKV();
      const sms = createMockSms();
      const env = { KV: kv as unknown as KVNamespace };

      await sendOtp(env, sms, phone, 'signup');

      const putCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls;
      const otpCall = putCalls.find((c: unknown[]) => String(c[0]).startsWith('otp:'));
      expect(otpCall?.[2]).toEqual({ expirationTtl: 300 });
    });

    test('includes purpose in SMS message', async () => {
      const kv = createMockKV();
      const sms = createMockSms();
      const env = { KV: kv as unknown as KVNamespace };

      await sendOtp(env, sms, phone, 'signup');
      expect(sms.calls[0].message).toContain('রেজিস্ট্রেশন');

      sms.calls.length = 0;
      await sendOtp(env, sms, phone, 'login');
      expect(sms.calls[0].message).toContain('লগইন');

      sms.calls.length = 0;
      await sendOtp(env, sms, phone, 'claim');
      expect(sms.calls[0].message).toContain('ভেরিফিকেশন');
    });

    test('returns error when SMS fails', async () => {
      const kv = createMockKV();
      const sms = createFailingSms();
      const env = { KV: kv as unknown as KVNamespace };

      const result = await sendOtp(env, sms, phone, 'signup');

      expect(result.success).toBe(false);
      expect(result.error).toBe('SMS provider down');
    });

    test('rate limits after 5 OTPs per hour', async () => {
      const kv = createMockKV();
      const sms = createMockSms();
      const env = { KV: kv as unknown as KVNamespace };

      // Send 5 OTPs
      for (let i = 0; i < 5; i++) {
        await sendOtp(env, sms, phone, 'signup');
      }

      // 6th should be rate limited
      const result = await sendOtp(env, sms, phone, 'signup');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Too many OTPs');
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    test('rate limit resets after window expires', async () => {
      const kv = createMockKV();
      const sms = createMockSms();
      const env = { KV: kv as unknown as KVNamespace };

      // Send 5 OTPs
      for (let i = 0; i < 5; i++) {
        await sendOtp(env, sms, phone, 'signup');
      }

      // Simulate time passing by modifying the rate limit data with old windowStart
      const rateKey = `otp_rate:01712345678`;
      kv._store.set(rateKey, JSON.stringify({ count: 5, windowStart: Date.now() - 3600001 }));

      // Should be able to send again
      const result = await sendOtp(env, sms, phone, 'signup');
      expect(result.success).toBe(true);
    });
  });

  describe('verifyOtp', () => {
    test('verifies correct OTP', async () => {
      const kv = createMockKV();
      const sms = createMockSms();
      const env = { KV: kv as unknown as KVNamespace };

      // Send OTP first
      await sendOtp(env, sms, phone, 'signup');

      // Get the stored OTP
      const putCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls;
      const otpCall = putCalls.find((c: unknown[]) => String(c[0]).startsWith('otp:'));
      const otpData = JSON.parse(otpCall?.[1] as string);
      const code = otpData.code;

      // Verify
      const result = await verifyOtp(env, phone, code);
      expect(result.valid).toBe(true);

      // OTP should be deleted after successful verification
      expect(kv.delete).toHaveBeenCalled();
    });

    test('rejects incorrect OTP', async () => {
      const kv = createMockKV();
      const sms = createMockSms();
      const env = { KV: kv as unknown as KVNamespace };

      await sendOtp(env, sms, phone, 'signup');

      const result = await verifyOtp(env, phone, '000000');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Incorrect OTP');
    });

    test('rejects expired OTP', async () => {
      const kv = createMockKV();
      const env = { KV: kv as unknown as KVNamespace };

      // Don't send OTP — KV will return null
      const result = await verifyOtp(env, phone, '123456');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    test('blocks after 3 failed attempts', async () => {
      const kv = createMockKV();
      const sms = createMockSms();
      const env = { KV: kv as unknown as KVNamespace };

      await sendOtp(env, sms, phone, 'signup');

      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        await verifyOtp(env, phone, '000000');
      }

      // 4th attempt should be blocked
      const result = await verifyOtp(env, phone, '000000');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Too many failed attempts');
    });

    test('increments attempt count', async () => {
      const kv = createMockKV();
      const sms = createMockSms();
      const env = { KV: kv as unknown as KVNamespace };

      await sendOtp(env, sms, phone, 'signup');

      // First failed attempt
      await verifyOtp(env, phone, '000000');

      // Check that attempts were incremented
      const putCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls;
      const otpUpdateCalls = putCalls.filter((c: unknown[]) => String(c[0]).startsWith('otp:'));
      const lastUpdate = otpUpdateCalls[otpUpdateCalls.length - 1];
      const otpData = JSON.parse(lastUpdate?.[1] as string);
      expect(otpData.attempts).toBe(1);
    });
  });

  describe('OtpSmsTemplates', () => {
    test('appointmentWithPortal includes all fields', () => {
      const msg = OtpSmsTemplates.appointmentWithPortal(
        'Rahim', 'Dr. Karim', '2026-05-21 5:00 PM', 5, 'Dhaka Hospital', 'https://portal.example.com'
      );

      expect(msg).toContain('Rahim');
      expect(msg).toContain('Dr. Karim');
      expect(msg).toContain('2026-05-21 5:00 PM');
      expect(msg).toContain('5');
      expect(msg).toContain('Dhaka Hospital');
      expect(msg).toContain('https://portal.example.com');
    });

    test('appointmentWithPortalEn includes all fields', () => {
      const msg = OtpSmsTemplates.appointmentWithPortalEn(
        'Rahim', 'Dr. Karim', '2026-05-21 5:00 PM', 5, 'Dhaka Hospital', 'https://portal.example.com'
      );

      expect(msg).toContain('Rahim');
      expect(msg).toContain('Dr. Karim');
      expect(msg).toContain('portal.example.com');
    });

    test('otpVerification includes OTP and purpose', () => {
      const msg = OtpSmsTemplates.otpVerification('123456', 'রেজিস্ট্রেশন');

      expect(msg).toContain('123456');
      expect(msg).toContain('রেজিস্ট্রেশন');
    });
  });
});
