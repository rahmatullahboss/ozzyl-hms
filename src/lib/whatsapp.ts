/**
 * WhatsApp Business API abstraction layer for Ozzyl Health.
 *
 * Uses Meta Cloud API (graph.facebook.com) for sending WhatsApp messages.
 * Supports two modes:
 *   1. Template messages (HSM) — pre-approved message templates
 *   2. Text messages — only within 24h customer-initiated window
 *
 * Setup:
 *   1. Create a Meta App at developers.facebook.com
 *   2. Add WhatsApp Business product
 *   3. Get Phone Number ID and Access Token
 *   4. Register message templates in Meta Business Suite
 *
 * Required Wrangler secrets when activating:
 *   wrangler secret put WHATSAPP_ACCESS_TOKEN
 *   wrangler secret put WHATSAPP_PHONE_NUMBER_ID
 *   wrangler secret put WHATSAPP_BUSINESS_ACCOUNT_ID
 *
 * Template naming convention: all templates are in Bengali (bn) and English (en).
 * Templates must be pre-approved by Meta before use.
 */

export interface WhatsAppResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface WhatsAppTemplateParams {
  headerText?: string;    // for HEADER component
  bodyParams: string[];   // ordered positional params for BODY component
  buttonParams?: string[]; // for URL button with dynamic suffix
}

export interface WhatsAppProvider {
  sendTemplate(
    to: string,
    templateName: string,
    languageCode: 'bn' | 'en',
    params: WhatsAppTemplateParams
  ): Promise<WhatsAppResult>;
  sendText(to: string, message: string): Promise<WhatsAppResult>;
}

// ─── Meta Cloud API Provider ─────────────────────────────────────────────────
class MetaCloudProvider implements WhatsAppProvider {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion = 'v21.0';

  constructor(accessToken: string, phoneNumberId: string) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
  }

  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: 'bn' | 'en',
    params: WhatsAppTemplateParams
  ): Promise<WhatsAppResult> {
    const phone = normalizePhone(to);

    const components: object[] = [];

    // Header parameter (if provided)
    if (params.headerText) {
      components.push({
        type: 'header',
        parameters: [{ type: 'text', text: params.headerText }],
      });
    }

    // Body parameters
    if (params.bodyParams.length > 0) {
      components.push({
        type: 'body',
        parameters: params.bodyParams.map((text) => ({ type: 'text', text })),
      });
    }

    // Button parameters (e.g. dynamic URL suffix)
    if (params.buttonParams && params.buttonParams.length > 0) {
      params.buttonParams.forEach((param, index) => {
        components.push({
          type: 'button',
          sub_type: 'url',
          index: String(index),
          parameters: [{ type: 'text', text: param }],
        });
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };

    const res = await fetch(
      `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[WhatsApp] Template send failed (${res.status}): ${errText}`);
      return { success: false, error: `HTTP ${res.status}: ${errText}` };
    }

    const data = await res.json() as { messages?: Array<{ id: string }> };
    const msgId = data.messages?.[0]?.id;
    return { success: true, messageId: msgId };
  }

  async sendText(to: string, message: string): Promise<WhatsAppResult> {
    const phone = normalizePhone(to);

    const payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: message },
    };

    const res = await fetch(
      `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[WhatsApp] Text send failed (${res.status}): ${errText}`);
      return { success: false, error: `HTTP ${res.status}: ${errText}` };
    }

    const data = await res.json() as { messages?: Array<{ id: string }> };
    return { success: true, messageId: data.messages?.[0]?.id };
  }
}

// ─── Stub Provider (no credentials set) ──────────────────────────────────────
class StubWhatsAppProvider implements WhatsAppProvider {
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: 'bn' | 'en',
    params: WhatsAppTemplateParams
  ): Promise<WhatsAppResult> {
    console.log(
      `[WHATSAPP STUB] Template: ${templateName} (${languageCode})\n` +
      `  To: ${to}\n` +
      `  Body params: ${JSON.stringify(params.bodyParams)}`
    );
    return { success: true, messageId: `stub-wa-${Date.now()}` };
  }

  async sendText(to: string, message: string): Promise<WhatsAppResult> {
    console.log(`[WHATSAPP STUB] Text to: ${to}\n  Message: ${message}`);
    return { success: true, messageId: `stub-wa-text-${Date.now()}` };
  }
}

// ─── Env interface ─────────────────────────────────────────────────────────
export interface WhatsAppEnv {
  WHATSAPP_PROVIDER?: string;          // "meta" | "stub" (default: stub)
  WHATSAPP_ACCESS_TOKEN?: string;      // Meta Business API access token
  WHATSAPP_PHONE_NUMBER_ID?: string;   // Meta WhatsApp phone number ID
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string;
}

// ─── Factory ──────────────────────────────────────────────────────────────
export function createWhatsAppProvider(env: WhatsAppEnv): WhatsAppProvider {
  const provider = env.WHATSAPP_PROVIDER?.toLowerCase();

  if (
    (provider === 'meta' || provider === 'whatsapp') &&
    env.WHATSAPP_ACCESS_TOKEN &&
    env.WHATSAPP_PHONE_NUMBER_ID
  ) {
    console.log('[WHATSAPP] Using Meta Cloud API provider');
    return new MetaCloudProvider(env.WHATSAPP_ACCESS_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID);
  }

  if (provider && provider !== 'stub') {
    console.warn(`[WHATSAPP] Unknown provider "${provider}" — using stub`);
  }
  return new StubWhatsAppProvider();
}

// ─── Normalize phone for WhatsApp ─────────────────────────────────────────
// WhatsApp requires E.164 format without the '+': 8801XXXXXXXXX
// Handles Bangladesh (880), Nepal (977), Sri Lanka (94), India (91)
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  // Already has a recognized South Asian country code
  if (digits.startsWith('880') || digits.startsWith('977') ||
      digits.startsWith('94')  || digits.startsWith('91')) {
    return digits;
  }

  // Bangladesh local: starts with 0 (e.g. 01712345678 → 8801712345678)
  if (digits.startsWith('0')) return `88${digits}`;

  // 10-digit number — assume Bangladesh mobile without leading 0
  if (digits.length === 10) return `880${digits}`;

  // Fallback: return as-is (caller should validate)
  return digits;
}

// ─── Pre-approved WhatsApp Template Messages ──────────────────────────────
// These templates must be registered and approved in Meta Business Suite.
// Template names are in snake_case matching the Meta registration names.
//
// Template parameter order MUST match the registered template exactly.
export const WhatsAppTemplates = {
  /**
   * appointment_reminder_bn
   * Body: "{{1}} ভাই/আপা, আপনার অ্যাপয়েন্টমেন্ট Dr. {{2}} এর সাথে {{3}} তারিখ {{4}} সময়।
   *        হাসপাতালে আসুন: {{5}}"
   * Params: [patientName, doctorName, date, time, hospitalName]
   */
  appointmentReminderBn: (
    patientName: string,
    doctorName: string,
    date: string,
    time: string,
    hospitalName: string
  ): WhatsAppTemplateParams => ({
    bodyParams: [patientName, doctorName, date, time, hospitalName],
  }),

  /**
   * lab_report_ready_bn
   * Body: "{{1}} ভাই/আপা, আপনার {{2}} পরীক্ষার রিপোর্ট প্রস্তুত।
   *        হাসপাতালে এসে সংগ্রহ করুন অথবা নিচের লিংক থেকে দেখুন।"
   * Params: [patientName, testName]
   */
  labReportReadyBn: (
    patientName: string,
    testName: string
  ): WhatsAppTemplateParams => ({
    bodyParams: [patientName, testName],
  }),

  /**
   * prescription_ready_bn
   * Body: "{{1}} ভাই/আপা, Dr. {{2}} আপনার প্রেসক্রিপশন দিয়েছেন।
   *        লিংক থেকে দেখুন ও ডাউনলোড করুন (৪৮ ঘণ্টা বৈধ):"
   * Button URL suffix: [shareToken]
   * Params: [patientName, doctorName]
   */
  prescriptionReadyBn: (
    patientName: string,
    doctorName: string,
    shareToken: string
  ): WhatsAppTemplateParams => ({
    bodyParams: [patientName, doctorName],
    buttonParams: [shareToken],
  }),

  /**
   * bill_due_bn
   * Body: "{{1}} ভাই/আপা, আপনার হাসপাতাল বিলের বকেয়া ৳{{2}} রয়েছে।
   *        বিল নং: {{3}}। bKash বা Nagad দিয়ে পরিশোধ করুন অথবা হাসপাতালে আসুন।"
   * Params: [patientName, dueAmount, billNo]
   */
  billDueBn: (
    patientName: string,
    dueAmount: number,
    billNo: string
  ): WhatsAppTemplateParams => ({
    bodyParams: [patientName, dueAmount.toLocaleString('en-BD'), billNo],
  }),

  /**
   * telemedicine_link_bn
   * Body: "{{1}} ভাই/আপা, Dr. {{2}} এর সাথে আপনার ভিডিও কনসালটেশন {{3}} সময়।
   *        নিচের লিংকে ক্লিক করে যোগ দিন:"
   * Button URL suffix: [roomPath]
   * Params: [patientName, doctorName, scheduledAt]
   */
  telemedicineLinkBn: (
    patientName: string,
    doctorName: string,
    scheduledAt: string,
    roomPath: string
  ): WhatsAppTemplateParams => ({
    bodyParams: [patientName, doctorName, scheduledAt],
    buttonParams: [roomPath],
  }),
};
