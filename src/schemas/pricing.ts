/**
 * Central pricing configuration for Ozzyl Health.
 *
 * All plan definitions, feature flags, add-on prices, and trial config
 * are defined here so both backend logic and API responses use the
 * same source of truth.
 */

import { z } from 'zod';

// ─── Plan Types ─────────────────────────────────────────────────────────────
export type PlanId = 'starter' | 'professional' | 'enterprise';
export type AddonId = 'ai' | 'telemedicine';
export type BillingCycle = 'monthly' | 'annual';
export type SubscriptionAction =
  | 'trial_start'
  | 'subscribe'
  | 'upgrade'
  | 'downgrade'
  | 'cancel'
  | 'addon_add'
  | 'addon_remove';

// ─── Plan Definitions ──────────────────────────────────────────────────────
export interface PlanDefinition {
  id: PlanId;
  name: string;
  nameBn: string;
  priceMonthly: number; // BDT per month
  priceAnnual: number;  // BDT per month (when billed annually)
  maxUsers: number;
  maxBeds: number;
  features: string[];
  availableAddons: AddonId[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    nameBn: 'স্টার্টার',
    priceMonthly: 3000,
    priceAnnual: 2500, // 10 months for 12 = ~2500/mo
    maxUsers: 5,
    maxBeds: 25,
    features: [
      'opd', 'reception', 'billing', 'laboratory', 'pharmacy',
      'patient_management', 'prescriptions', 'reports_basic',
      'notifications', 'pwa', 'i18n',
    ],
    availableAddons: ['ai', 'telemedicine'],
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    nameBn: 'প্রফেশনাল',
    priceMonthly: 7000,
    priceAnnual: 5833,
    maxUsers: 20,
    maxBeds: 100,
    features: [
      'opd', 'reception', 'billing', 'laboratory', 'pharmacy',
      'patient_management', 'prescriptions', 'reports_basic',
      'notifications', 'pwa', 'i18n',
      'ipd', 'nurse_station', 'vitals', 'discharge_summary',
      'accounting_full', 'reports_advanced', 'doctor_scheduling',
      'multi_branch', 'ai', 'telemedicine', 'patient_portal',
    ],
    availableAddons: [], // Everything included
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    nameBn: 'এন্টারপ্রাইজ',
    priceMonthly: 15000,
    priceAnnual: 12500,
    maxUsers: Infinity,
    maxBeds: Infinity,
    features: ['*'], // All features
    availableAddons: [],
  },
} as const;

// ─── Add-on Definitions ────────────────────────────────────────────────────
export interface AddonDefinition {
  id: AddonId;
  name: string;
  nameBn: string;
  priceMonthly: number; // BDT per month
}

export const ADDONS: Record<AddonId, AddonDefinition> = {
  ai: {
    id: 'ai',
    name: 'AI Medical Assistant',
    nameBn: 'এআই মেডিকেল সহকারী',
    priceMonthly: 1500,
  },
  telemedicine: {
    id: 'telemedicine',
    name: 'Telemedicine',
    nameBn: 'টেলিমেডিসিন',
    priceMonthly: 2000,
  },
} as const;

// ─── Trial Configuration ───────────────────────────────────────────────────
export const TRIAL_DAYS = 30;
export const ANNUAL_DISCOUNT_MONTHS = 2; // 2 months free on annual billing

// ─── Payment Methods ───────────────────────────────────────────────────────
export const PAYMENT_METHODS = ['bkash', 'nagad', 'bank_transfer', 'card'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

// ─── Zod Schemas ───────────────────────────────────────────────────────────
export const planIdSchema = z.enum(['starter', 'professional', 'enterprise']);
export const addonIdSchema = z.enum(['ai', 'telemedicine']);
export const billingCycleSchema = z.enum(['monthly', 'annual']);

export const subscribeSchema = z.object({
  plan: planIdSchema,
  billingCycle: billingCycleSchema.default('monthly'),
  addons: z.array(addonIdSchema).default([]),
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Check if a feature is enabled for a given plan + addons */
export function hasFeature(planId: PlanId, activeAddons: AddonId[], feature: string): boolean {
  const plan = PLANS[planId];
  if (!plan) return false;

  // Enterprise has all features
  if (plan.features.includes('*')) return true;

  // Check plan features
  if (plan.features.includes(feature)) return true;

  // Check add-ons (e.g., 'ai' add-on enables 'ai' feature)
  return activeAddons.includes(feature as AddonId);
}

/** Calculate total monthly price for a plan + addons */
export function calculateMonthlyPrice(
  planId: PlanId,
  billingCycle: BillingCycle,
  addons: AddonId[] = [],
): number {
  const plan = PLANS[planId];
  if (!plan) return 0;

  const basePrice = billingCycle === 'annual' ? plan.priceAnnual : plan.priceMonthly;
  const addonTotal = addons.reduce((sum, addonId) => {
    const addon = ADDONS[addonId];
    return sum + (addon?.priceMonthly || 0);
  }, 0);

  return basePrice + addonTotal;
}

/** Check if trial has expired */
export function isTrialExpired(trialEndsAt: string | null): boolean {
  if (!trialEndsAt) return true;
  return new Date(trialEndsAt) < new Date();
}

/** Get the default plan for self-signup */
export function getDefaultSignupPlan(): {
  plan: PlanId;
  trialDays: number;
  price: number;
} {
  return {
    plan: 'starter',
    trialDays: TRIAL_DAYS,
    price: 0, // $0 during trial
  };
}
