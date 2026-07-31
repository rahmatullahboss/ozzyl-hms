/**
 * SMS abstraction layer for Ozzyl Health.
 *
 * Currently in STUB mode — no SMS service purchased yet.
 * When ready, set SMS_PROVIDER to one of:
 *   - "sslwireless"  → SSL Wireless (Bangladesh)
 *   - "bnotify"     → bNotify (Bangladesh)
 *   - "twilio"      → Twilio (international)
 *
 * Required Wrangler secrets when activating a provider:
 *   wrangler secret put SMS_API_KEY
 *   wrangler secret put SMS_SENDER_ID
 */
import { formatDoctorName } from './doctor-display';

export interface SmsProvider {
  sendSMS(to: string, message: string): Promise<SmsResult>;
}

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ─── SSL Wireless (Bangladesh) ────────────────────────────────────────────────
// API docs: https://www.sslwireless.com/sms-api
class SslWirelessProvider implements SmsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string
  ) {}

  async sendSMS(to: string, message: string): Promise<SmsResult> {
    const phone = normalizePhone(to);
    const res = await fetch('https://sms.sslwireless.com/pushapi/dynamic/server.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_token: this.apiKey,
        sid: this.senderId,
        msisdn: phone,
        sms: message,
        csms_id: crypto.randomUUID(),
      }),
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json() as { status_code?: number; error?: string };
    if (data.status_code === 1011) {
      return { success: true, messageId: crypto.randomUUID() };
    }
    return { success: false, error: data.error || `status_code: ${data.status_code}` };
  }
}

// ─── bNotify (Bangladesh) ─────────────────────────────────────────────────────
class BNotifyProvider implements SmsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string
  ) {}

  async sendSMS(to: string, message: string): Promise<SmsResult> {
    const phone = normalizePhone(to);
    const params = new URLSearchParams({
      api_key: this.apiKey,
      sender_id: this.senderId,
      to: phone,
      message,
    });

    const res = await fetch(`https://api.bnotify.com/api/sms?${params.toString()}`);
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json() as { status?: string; message_id?: string };
    return data.status === 'success'
      ? { success: true, messageId: data.message_id }
      : { success: false, error: 'bNotify API error' };
  }
}

// ─── Disabled / Stub Providers ───────────────────────────────────────────────
class DisabledSmsProvider implements SmsProvider {
  async sendSMS(): Promise<SmsResult> {
    return { success: false, error: 'SMS delivery is not configured' };
  }
}

class StubSmsProvider implements SmsProvider {
  async sendSMS(to: string, message: string): Promise<SmsResult> {
    // Development-only visibility. Stub sends must never be recorded as delivered.
    console.log(`[SMS STUB] To: ${to} | Message: ${message}`);
    return { success: false, error: 'SMS stub mode does not send real messages' };
  }
}

// ─── Factory: choose provider based on env vars ───────────────────────────────
export interface SmsEnv {
  SMS_PROVIDER?: string;
  SMS_API_KEY?: string;
  SMS_SENDER_ID?: string;
}

export function createSmsProvider(env: SmsEnv): SmsProvider {
  const provider = env.SMS_PROVIDER?.toLowerCase();

  if (provider === 'sslwireless' && env.SMS_API_KEY && env.SMS_SENDER_ID) {
    return new SslWirelessProvider(env.SMS_API_KEY, env.SMS_SENDER_ID);
  }

  if (provider === 'bnotify' && env.SMS_API_KEY && env.SMS_SENDER_ID) {
    return new BNotifyProvider(env.SMS_API_KEY, env.SMS_SENDER_ID);
  }

  if (provider === 'disabled') {
    return new DisabledSmsProvider();
  }

  // Default: explicit stub mode for development only. Never report delivery success.
  if (provider && provider !== 'stub') {
    console.warn(`[SMS] Unknown provider "${provider}" — using non-delivery stub`);
  }
  return new StubSmsProvider();
}

// ─── Helper: normalize Bangladeshi phone numbers ──────────────────────────────
// Accepts: 01XXXXXXXXX, +8801XXXXXXXXX, 8801XXXXXXXXX
// Returns: 8801XXXXXXXXX (without +)
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('88')) return digits;
  if (digits.startsWith('0')) return `88${digits}`;
  if (digits.length === 10) return `880${digits}`;
  return digits;
}

// ─── Pre-built message templates ─────────────────────────────────────────────
export const SmsTemplates = {
  appointmentReminder: (patientName: string, doctorName: string, dateTime: string) =>
    `প্রিয় ${patientName}, আপনার অ্যাপয়েন্টমেন্ট ${dateTime} তারিখে ${doctorName} এর সাথে। সময়মতো আসুন। - Ozzyl Health`,

  appointmentReminderEn: (patientName: string, doctorName: string, dateTime: string) =>
    `Dear ${patientName}, your appointment with ${formatDoctorName(doctorName)} is on ${dateTime}. Please arrive on time. - Ozzyl Health`,

  labReady: (patientName: string, testName: string) =>
    `প্রিয় ${patientName}, আপনার "${testName}" পরীক্ষার রিপোর্ট প্রস্তুত। হাসপাতালে এসে সংগ্রহ করুন। - Ozzyl Health`,

  billDue: (patientName: string, amount: number) =>
    `প্রিয় ${patientName}, আপনার বকেয়া বিল ৳${amount}। দ্রুত পরিশোধ করুন। - Ozzyl Health`,

  medicineExpiry: (medicineName: string, expiryDate: string, stock: number) =>
    `[Ozzyl Health Alert] Medicine "${medicineName}" expires on ${expiryDate}. Current stock: ${stock} units. Please take action.`,

  consultationReminderEn: (patientName: string, doctorName: string, scheduledAt: string, roomUrl: string) =>
    `Dear ${patientName}, your video consultation with ${formatDoctorName(doctorName)} is at ${scheduledAt}. Join here: ${roomUrl} - Ozzyl Health`,
};
