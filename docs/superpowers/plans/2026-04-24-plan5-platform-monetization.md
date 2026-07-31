# Plan 5: Platform Monetization — Subscriptions, Payments & Quality Metrics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the monetization layer — subscription tiers for hospitals, payment gateway integration (bKash/Nagad/card), transaction fee engine, platform revenue dashboard, and hospital quality scoring.

**Architecture:** Subscriptions are tenant-scoped. Payments use external gateways via Cloudflare Workers (server-side only). Transaction fees are computed at booking time. Quality metrics run as a scheduled job.

**Tech Stack:** Hono, Zod, Drizzle, bKash/Nagad APIs, Cloudflare Scheduled Jobs

**Depends on:** Plans 1-4 completed (hospital marketplace, bookings, auth)

---

## Task 1: Subscription System

### Database Schema

**Migration:** `migrations/0157_subscription_tables.sql`

```sql
-- Subscription tiers definition
CREATE TABLE IF NOT EXISTS subscription_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_bn TEXT,
  description TEXT,
  monthly_fee INTEGER NOT NULL, -- in paisa (smallest currency unit)
  yearly_fee INTEGER NOT NULL,
  max_doctors INTEGER,
  max_branches INTEGER,
  max_patients INTEGER,
  features_json TEXT NOT NULL, -- JSON array of feature keys
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Hospital subscription status
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  tier_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'trialing', -- trialing, active, past_due, cancelled, expired
  billing_cycle TEXT NOT NULL DEFAULT 'monthly', -- monthly, yearly
  current_period_start TEXT,
  current_period_end TEXT,
  trial_ends_at TEXT,
  cancelled_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tier_id) REFERENCES subscription_tiers(id)
);

-- Feature usage tracking (for hard limits)
CREATE TABLE IF NOT EXISTS tenant_feature_usage (
  tenant_id TEXT PRIMARY KEY,
  doctor_count INTEGER DEFAULT 0,
  branch_count INTEGER DEFAULT 0,
  patient_count INTEGER DEFAULT 0,
  appointment_count_month INTEGER DEFAULT 0,
  storage_bytes INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Seed default tiers
INSERT INTO subscription_tiers (id, name, name_bn, description, monthly_fee, yearly_fee, max_doctors, max_branches, max_patients, features_json) VALUES
('free', 'Free', 'ফ্রি', 'Basic features for small clinics', 0, 0, 3, 1, 500, '["basic_dashboard", "patient_management", "appointments", "billing_basic"]'),
('pro', 'Pro', 'প্রো', 'Full features for growing hospitals', 499900, 4999900, 15, 3, 5000, '["basic_dashboard", "patient_management", "appointments", "billing_advanced", "pharmacy", "laboratory", "reports", "marketplace", "telemedicine", "analytics"]'),
('enterprise', 'Enterprise', 'এন্টারপ্রাইজ', 'Unlimited everything + priority support', 1499900, 14999900, NULL, NULL, NULL, '["all_features", "priority_support", "custom_integrations", "dedicated_account_manager", "white_label"]');
```

### Backend Routes: `src/routes/tenant/subscriptions.ts`

```typescript
// GET /api/subscriptions/tiers — list all tiers (public)
// GET /api/subscriptions/current — get current subscription (hospital admin)
// POST /api/subscriptions/subscribe — subscribe/upgrade (hospital admin)
// POST /api/subscriptions/cancel — cancel subscription (hospital admin)
// GET /api/subscriptions/usage — get feature usage (hospital admin)
// GET /api/subscriptions/invoices — list invoices (hospital admin)
```

### Feature Gating Middleware

Modify `tenantMiddleware` or create `subscriptionMiddleware`:

```typescript
// Middleware that checks subscription tier and blocks access to premium features
// Example: if tier is 'free' and feature is 'pharmacy' → 403 with upgrade prompt
```

### Web Platform UI

- `web/src/pages/SubscriptionManagement.tsx` — Hospital admin subscription dashboard
- Show current tier, usage bars, upgrade/downgrade buttons, billing history
- Integrate with Stripe/bKash checkout

---

## Task 2: Payment Gateway Integration

### Database Schema

```sql
-- Platform transactions (bookings, subscriptions, refunds)
CREATE TABLE IF NOT EXISTS platform_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  patient_id INTEGER,
  type TEXT NOT NULL, -- subscription, booking_fee, refund, payout
  amount INTEGER NOT NULL, -- in paisa
  currency TEXT DEFAULT 'BDT',
  gateway TEXT NOT NULL, -- bkash, nagad, card, bank_transfer
  gateway_transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, completed, failed, refunded
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Platform revenue summary (pre-computed for dashboard)
CREATE TABLE IF NOT EXISTS platform_revenue_daily (
  date TEXT PRIMARY KEY,
  total_gmv INTEGER DEFAULT 0, -- gross merchandise value
  total_fees INTEGER DEFAULT 0,
  total_payouts INTEGER DEFAULT 0,
  booking_count INTEGER DEFAULT 0,
  subscription_revenue INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### Backend Routes

**File:** `src/routes/tenant/payments.ts`

```typescript
// POST /api/payments/bkash/create — Create bKash payment
// POST /api/payments/bkash/execute — Execute bKash payment
// POST /api/payments/bkash/query — Query bKash payment status
// POST /api/payments/nagad/create — Create Nagad payment
// POST /api/payments/nagad/verify — Verify Nagad payment
// POST /api/payments/card/create — Card payment intent (via Stripe/Paddle)
// GET /api/payments/history — Payment history for tenant
// POST /api/payments/refund — Request refund (admin only)
```

### bKash Integration

```typescript
// bKash sandbox/production API wrapper
// 1. Grant token
// 2. Create payment
// 3. Execute payment
// 4. Query payment
```

### Transaction Fee Engine

```typescript
// On marketplace booking:
// - Patient pays doctor fee + platform fee (e.g., 5%)
// - Platform fee goes to platform revenue
// - Doctor/hospital gets remainder minus gateway fee
// - Fee structure configurable per tier
```

---

## Task 3: Platform Revenue Dashboard (Admin)

### Backend Routes

**File:** `src/routes/admin/revenue.ts`

```typescript
// GET /api/admin/revenue/summary — Total GMV, fees, payouts
// GET /api/admin/revenue/daily — Daily revenue chart data
// GET /api/admin/revenue/by-hospital — Revenue per hospital
// GET /api/admin/revenue/by-gateway — Revenue by payment method
// GET /api/admin/revenue/bookings — Marketplace booking revenue
// GET /api/admin/revenue/subscriptions — Subscription revenue
```

### Admin Panel UI

- `admin-panel/src/pages/RevenueDashboard.tsx`
- Charts: daily revenue line chart, revenue by category pie chart, top hospitals table
- Filter by date range, hospital, gateway

---

## Task 4: Hospital Quality Metrics

### Algorithm

```typescript
// Quality Score = weighted average of:
// - Patient satisfaction (reviews) — 30%
// - Wait time (appointment actual vs scheduled) — 20%
// - Doctor response time — 15%
// - Completion rate (appointments completed / total) — 20%
// - Complaint resolution rate — 15%
```

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS hospital_quality_scores (
  tenant_id TEXT PRIMARY KEY,
  overall_score REAL DEFAULT 0,
  satisfaction_score REAL DEFAULT 0,
  wait_time_score REAL DEFAULT 0,
  response_time_score REAL DEFAULT 0,
  completion_rate_score REAL DEFAULT 0,
  complaint_resolution_score REAL DEFAULT 0,
  computed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quality_badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  badge_type TEXT NOT NULL, -- top_rated, fast_response, high_completion, patient_choice
  awarded_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);
```

### Scheduled Job

Add to `src/scheduled.ts`:

```typescript
// Daily: compute quality scores for all hospitals
// Weekly: award/remove badges based on scores
```

### Backend Routes

**File:** `src/routes/public/quality.ts` (or add to marketplace)

```typescript
// GET /api/v1/marketplace/hospitals/:id/quality — Quality score breakdown
// GET /api/v1/marketplace/hospitals/top-rated — Top-rated hospitals
```

### Marketplace UI

- Show quality badges on hospital cards
- Show quality score on hospital profile
- Add "Top Rated" filter to hospital search

---

## Implementation Order

```
1. Subscription tables + seed migration
2. Subscription backend API + feature gating middleware
3. Subscription management UI (hospital admin)
4. Payment tables + bKash/Nagad integration
5. Payment backend API + transaction fee engine
6. Platform revenue dashboard (admin backend + UI)
7. Quality metrics tables + scheduled job
8. Quality score backend + marketplace UI badges
```

## Files to Create

| File | Description |
|------|-------------|
| `migrations/0157_subscription_tables.sql` | DB schema |
| `src/routes/tenant/subscriptions.ts` | Subscription API |
| `src/routes/tenant/payments.ts` | Payment API |
| `src/routes/admin/revenue.ts` | Revenue dashboard API |
| `src/lib/payments/bkash.ts` | bKash SDK wrapper |
| `src/lib/payments/nagad.ts` | Nagad SDK wrapper |
| `src/lib/quality-scoring.ts` | Quality score algorithm |
| `src/middleware/subscription.ts` | Feature gating |
| `web/src/pages/SubscriptionManagement.tsx` | Hospital subscription UI |
| `admin-panel/src/pages/RevenueDashboard.tsx` | Admin revenue UI |

## Commit Messages

```bash
git add migrations/ src/routes/tenant/subscriptions.ts
git commit -m "feat(subscriptions): add subscription tiers, tenant subscriptions, feature gating"

git add src/routes/tenant/payments.ts src/lib/payments/
git commit -m "feat(payments): add bKash/Nagad integration, transaction fee engine"

git add src/routes/admin/revenue.ts admin-panel/src/pages/RevenueDashboard.tsx
git commit -m "feat(revenue): add platform revenue dashboard for admin"

git add src/lib/quality-scoring.ts src/routes/public/quality.ts
git commit -m "feat(quality): add hospital quality scoring algorithm and badges"
```
