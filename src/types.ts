/**
 * Shared Cloudflare Worker environment bindings.
 * All routes and middleware should use this type.
 */
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  UPLOADS: R2Bucket;
  // Static assets binding — serves React SPA via [assets] in wrangler.toml
  ASSETS: Fetcher;
  JWT_SECRET: string;
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  CDB101_FINANCIAL_SMOKE_GUARD?: string;
  RBAC_CENTRAL_ROUTE_MODE?: 'off' | 'shadow' | 'enforce';
  LOCAL_SERVER_ID?: string;
  LOCAL_TENANT_ID?: string;
  LOCAL_TENANT_SUBDOMAIN?: string;
  CLOUD_SYNC_BASE_URL?: string;
  CLOUD_SYNC_TOKEN?: string;
  // Dedicated service secret for local LIS/analyzer bridge agents.
  // Configure with `wrangler secret put LIS_BRIDGE_API_KEY` and pass it as `X-LIS-Bridge-Key`.
  LIS_BRIDGE_API_KEY?: string;
  // Required positive user ID used as the accountable audit actor for bridge-ingested results.
  LIS_BRIDGE_USER_ID?: string;
  // JSON map of per-agent HMAC keys. Store as a Worker secret, not plain wrangler config.
  LIS_BRIDGE_KEYS_JSON?: string;
  // Temporary compatibility switch for X-LIS-Bridge-Key during signed-key rollout.
  LIS_BRIDGE_ALLOW_LEGACY_KEY?: string;
  HMS_LOCAL_SCHEMA_SYNC_ENABLED?: string;
  HMS_LOCAL_SCHEMA_SYNC_INTERVAL_SECONDS?: string;
  HMS_LOCAL_SCHEMA_SYNC_MAX_PER_CYCLE?: string;
  HMS_LOCAL_SCHEMA_SYNC_DRY_RUN?: string;
  HMS_LOCAL_CLOUD_PULL_TABLES?: string;
  // Optional tenant to D1 binding map for shard-ready routing.
  // Example value maps a tenant ID to DB_SHARD_01.
  HMS_TENANT_DB_ROUTES_JSON?: string;
  DB_SHARD_01?: D1Database;
  DB_SHARD_02?: D1Database;
  DB_SHARD_03?: D1Database;
  // Per-tenant HMAC secret used to authenticate /api/local-server/schema-sync POSTs.
  // Configured via `wrangler secret put HMS_LOCAL_SERVER_SYNC_SECRET`.
  HMS_LOCAL_SERVER_SYNC_SECRET?: string;
  // Backwards-compatible alias (older tenants may still set this).
  LOCAL_SERVER_SYNC_SECRET?: string;
  // ─── Email (Brevo/Resend) ─────────────────────────────────────────────
  EMAIL_PROVIDER?: 'brevo' | 'resend' | 'stub' | string;
  BREVO_API_KEY?: string;         // wrangler secret put BREVO_API_KEY
  BREVO_FROM_EMAIL?: string;      // e.g. "Ozzyl Health <noreply@ozzyl.com>"
  RESEND_API_KEY?: string;        // wrangler secret put RESEND_API_KEY
  RESEND_FROM_EMAIL?: string;     // e.g. "Ozzyl Health <noreply@yourhospital.com>"
  // ─── Patient Portal URL (for email links) ───────────────────────────
  PATIENT_PORTAL_URL?: string;    // e.g. "https://hms-saas.rahmatullahzisan.workers.dev/patient-portal"
  // ─── HMS App Base URL (hospital frontend for staff invite links) ────
  HMS_APP_URL?: string;           // e.g. "https://hms-saas.rahmatullahzisan.workers.dev"
  // ─── Worker hostname for cache purge (defaults to hms-saas.rahmatullahzisan.workers.dev) ──
  WORKER_HOST?: string;
  // ─── SMS ─────────────────────────────────────────────────────────────
  SMS_PROVIDER?: string;          // "sslwireless" | "bnotify" | "disabled" | "stub"
  SMS_API_KEY?: string;           // wrangler secret put SMS_API_KEY
  SMS_SENDER_ID?: string;         // wrangler secret put SMS_SENDER_ID
  // ─── WhatsApp Business API (Meta Cloud) ─────────────────────────────
  WHATSAPP_PROVIDER?: string;           // "meta" | "stub" (default: stub)
  WHATSAPP_ACCESS_TOKEN?: string;       // wrangler secret put WHATSAPP_ACCESS_TOKEN
  WHATSAPP_PHONE_NUMBER_ID?: string;    // wrangler secret put WHATSAPP_PHONE_NUMBER_ID
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string; // wrangler secret put WHATSAPP_BUSINESS_ACCOUNT_ID
  // ─── bKash Payment Gateway ───────────────────────────────────────────
  BKASH_APP_KEY?: string;
  BKASH_APP_SECRET?: string;
  BKASH_USERNAME?: string;
  BKASH_PASSWORD?: string;
  BKASH_BASE_URL?: string;        // default: sandbox URL
  // ─── Nagad Payment Gateway ───────────────────────────────────────────
  NAGAD_MERCHANT_ID?: string;
  NAGAD_MERCHANT_PRIVATE_KEY?: string;
  NAGAD_BASE_URL?: string;        // default: sandbox URL
  // ─── Telemedicine (Cloudflare Realtime SFU) ─────────────────────────
  // Dashboard → Realtime SFU → Create App → copy App ID + Secret
  CF_REALTIME_APP_ID?:     string;  // wrangler secret put CF_REALTIME_APP_ID
  CF_REALTIME_APP_SECRET?: string;  // wrangler secret put CF_REALTIME_APP_SECRET
  CF_CALLS_APP_ID?:        string;  // legacy secret name still used in production
  CF_CALLS_APP_SECRET?:    string;  // legacy secret name still used in production
  CF_ACCOUNT_ID?:          string;  // your Cloudflare account ID (optional, for admin APIs)
  // ─── AI (OpenRouter) ──────────────────────────────────────────────
  OPENROUTER_API_KEY?: string;    // wrangler secret put OPENROUTER_API_KEY
  AI_MODEL?: string;              // optional override, default: openrouter/healer-alpha
  PATIENT_AI_MODEL?: string;      // optional override for patient planner, default: @cf/moonshotai/kimi-k2.5
  OLLAMA_API_KEY?: string;        // wrangler secret put OLLAMA_API_KEY (Ollama Cloud fallback)
  PATIENT_AI_FALLBACK_MODEL?: string; // optional override for patient planner fallback, default: glm-5.1:cloud
  OCR_SPACE_API_KEY?: string;     // wrangler secret put OCR_SPACE_API_KEY (OCR.space for scanned PDFs)
  // ─── AI Memory (Vectorize + Workers AI) ───────────────────────────
  VECTORIZE?: Vectorize;          // wrangler.toml [[vectorize]] binding
  AI?: Ai;                        // wrangler.toml [ai] binding — Workers AI for embeddings
  // ─── Web Push Notifications (VAPID) ─────────────────────────────────
  VAPID_PUBLIC_KEY?: string;      // wrangler secret put VAPID_PUBLIC_KEY
  VAPID_PRIVATE_KEY?: string;     // wrangler secret put VAPID_PRIVATE_KEY
  VAPID_SUBJECT?: string;         // wrangler secret put VAPID_SUBJECT (e.g. "mailto:admin@hmssaas.com")
  // ─── Google Sign-In (GIS — only Client ID, no secret) ───────────────
  GOOGLE_CLIENT_ID?: string;      // Google Cloud Console → OAuth 2.0 Client ID
  // ─── Wallet Export (Google Wallet / Apple Wallet source packaging) ──
  GOOGLE_WALLET_ISSUER_ID?: string;
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_WALLET_PRIVATE_KEY?: string;
  APPLE_WALLET_PASS_TYPE_ID?: string;
  APPLE_WALLET_TEAM_ID?: string;
}

/**
 * Shared Variables set on Hono context by middleware.
 */
export interface Variables {
  tenantId?: string;
  userId?: string;
  role?: string;
  permissions?: string[];
  lisBridgeAuth?: boolean;
}
