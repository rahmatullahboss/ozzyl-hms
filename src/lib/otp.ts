/**
 * OTP (One-Time Password) service for patient portal verification.
 *
 * Uses Cloudflare KV for storage with TTL.
 * Rate limiting: max 3 verify attempts per OTP, max 5 OTPs per hour per phone.
 */

import type { SmsProvider } from './sms';

const OTP_LENGTH = 6;
const OTP_TTL_SECONDS = 300; // 5 minutes
const MAX_VERIFY_ATTEMPTS = 3;
const MAX_OTPS_PER_HOUR = 5;

export interface OtpEnv {
  KV: KVNamespace;
  SMS_PROVIDER?: string;
  SMS_API_KEY?: string;
  SMS_SENDER_ID?: string;
}

interface OtpData {
  code: string;
  attempts: number;
  createdAt: number;
}

// ─── Generate OTP ─────────────────────────────────────────────────────────────
function generateOtp(): string {
  // Use crypto.getRandomValues for cryptographically secure OTP
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  return String(min + (array[0] % (max - min + 1)));
}

// ─── KV Keys ──────────────────────────────────────────────────────────────────
function otpKey(phone: string): string {
  return `otp:${phone}`;
}

function rateLimitKey(phone: string): string {
  return `otp_rate:${phone}`;
}

// ─── Send OTP ─────────────────────────────────────────────────────────────────
export async function sendOtp(
  env: OtpEnv,
  sms: SmsProvider,
  phone: string,
  purpose: 'signup' | 'login' | 'claim' = 'signup',
): Promise<{ success: boolean; error?: string; retryAfter?: number }> {
  const normalized = phone.replace(/\D/g, '');

  // Rate limit check
  const rateData = await env.KV.get(rateLimitKey(normalized), 'json') as { count: number; windowStart: number } | null;
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  if (rateData && (now - rateData.windowStart) < hourMs) {
    if (rateData.count >= MAX_OTPS_PER_HOUR) {
      const retryAfter = Math.ceil((hourMs - (now - rateData.windowStart)) / 1000);
      return { success: false, error: `Too many OTPs. Try again in ${Math.ceil(retryAfter / 60)} minutes.`, retryAfter };
    }
  }

  // Generate and store OTP
  const code = generateOtp();
  const otpData: OtpData = { code, attempts: 0, createdAt: now };

  await env.KV.put(otpKey(normalized), JSON.stringify(otpData), { expirationTtl: OTP_TTL_SECONDS });

  // Update rate limit
  const newRateData = rateData && (now - rateData.windowStart) < hourMs
    ? { count: rateData.count + 1, windowStart: rateData.windowStart }
    : { count: 1, windowStart: now };
  await env.KV.put(rateLimitKey(normalized), JSON.stringify(newRateData), { expirationTtl: 3600 });

  // Send SMS
  const purposeText = purpose === 'signup' ? 'রেজিস্ট্রেশন' : purpose === 'login' ? 'লগইন' : 'ভেরিফিকেশন';
  const message = `আপনার Ozzyl Health ${purposeText} OTP: ${code}। ৫ মিনিটের মধ্যে ব্যবহার করুন। কাউকে শেয়ার করবেন না।`;

  const result = await sms.sendSMS(normalized, message);

  if (!result.success) {
    return { success: false, error: result.error || 'Failed to send SMS' };
  }

  return { success: true };
}

// ─── Verify OTP ───────────────────────────────────────────────────────────────
export async function verifyOtp(
  env: OtpEnv,
  phone: string,
  code: string,
): Promise<{ valid: boolean; error?: string }> {
  const normalized = phone.replace(/\D/g, '');
  const key = otpKey(normalized);

  const otpData = await env.KV.get(key, 'json') as OtpData | null;

  if (!otpData) {
    return { valid: false, error: 'OTP expired or not found. Please request a new one.' };
  }

  // Check attempts
  if (otpData.attempts >= MAX_VERIFY_ATTEMPTS) {
    await env.KV.delete(key);
    return { valid: false, error: 'Too many failed attempts. Please request a new OTP.' };
  }

  // Increment attempts
  otpData.attempts += 1;
  await env.KV.put(key, JSON.stringify(otpData), { expirationTtl: OTP_TTL_SECONDS });

  // Verify code
  if (otpData.code !== code) {
    return { valid: false, error: `Incorrect OTP. ${MAX_VERIFY_ATTEMPTS - otpData.attempts} attempts remaining.` };
  }

  // Success — delete OTP
  await env.KV.delete(key);
  return { valid: true };
}

// ─── SMS Templates ────────────────────────────────────────────────────────────
export const OtpSmsTemplates = {
  appointmentWithPortal: (
    patientName: string,
    doctorName: string,
    dateTime: string,
    serial: string | number,
    hospitalName: string,
    portalUrl: string,
  ) =>
    `প্রিয় ${patientName}, আপনার অ্যাপয়েন্টমেন্ট বুক হয়েছে।\n` +
    `ডাক্তার: ${doctorName}\n` +
    `তারিখ: ${dateTime}\n` +
    `সিরিয়াল: ${serial}\n` +
    `${hospitalName}\n\n` +
    `রোগী পোর্টালে লগইন করে আপনার রিপোর্ট ও হেলথ রেকর্ড দেখুন:\n${portalUrl}`,

  appointmentWithPortalEn: (
    patientName: string,
    doctorName: string,
    dateTime: string,
    serial: string | number,
    hospitalName: string,
    portalUrl: string,
  ) =>
    `Dear ${patientName}, your appointment is confirmed.\n` +
    `Doctor: ${doctorName}\n` +
    `Date: ${dateTime}\n` +
    `Serial: ${serial}\n` +
    `${hospitalName}\n\n` +
    `Login to patient portal to view your reports & health records:\n${portalUrl}`,

  otpVerification: (otp: string, purpose: string) =>
    `আপনার Ozzyl Health ${purpose} OTP: ${otp}। ৫ মিনিটের মধ্যে ব্যবহার করুন। কাউকে শেয়ার করবেন না।`,
};
