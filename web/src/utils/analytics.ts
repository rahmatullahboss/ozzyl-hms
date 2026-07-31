/**
 * Google Analytics 4 (GA4) — Lightweight wrapper for gtag.
 *
 * Usage:
 *   import { trackEvent, trackPageView } from '@/utils/analytics';
 *   trackEvent('patient_registered', { method: 'OPD' });
 *   trackPageView('/h/demo/patients');
 *
 * The GA4 Measurement ID is loaded via <script> in index.html.
 * Replace G-XXXXXXXXXX there with your real Measurement ID.
 */

// Extend Window with gtag
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

/** Safely call gtag — noop if GA4 script hasn't loaded (e.g. in tests or ad-blocked) */
function gtag(...args: unknown[]): void {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag(...args);
  }
}

// ─── HMS-specific event names ────────────────────────────────────────
export type HMSEvent =
  | 'patient_registered'
  | 'patient_searched'
  | 'visit_created'
  | 'bill_created'
  | 'payment_collected'
  | 'lab_order_created'
  | 'lab_result_entered'
  | 'prescription_written'
  | 'medicine_dispensed'
  | 'appointment_scheduled'
  | 'admission_created'
  | 'discharge_completed'
  | 'telemedicine_started'
  | 'ai_chat_sent'
  | 'notification_enabled'
  | 'language_changed'
  | 'report_viewed'
  | 'settings_updated'
  | 'staff_invited';

/**
 * Track a custom HMS event in GA4.
 * @param eventName — one of the predefined HMS event names
 * @param params — optional key-value pairs
 */
export function trackEvent(
  eventName: HMSEvent | string,
  params?: Record<string, string | number | boolean>,
): void {
  gtag('event', eventName, params);
}

/**
 * Track a virtual page view in the SPA.
 * Called automatically on route change (see useAnalytics hook).
 */
export function trackPageView(path: string, title?: string): void {
  gtag('event', 'page_view', {
    page_path: path,
    page_title: title ?? document.title,
  });
}

// ─── GA4 Measurement ID ──────────────────────────────────────────────
// TODO: Replace with your real Measurement ID from https://analytics.google.com
export const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';
