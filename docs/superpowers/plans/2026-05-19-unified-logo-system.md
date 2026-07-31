# Unified Logo System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the two separate logo systems (hospital logo + website logo) into one — the hospital logo uploaded in admin settings should be used everywhere: sidebar, invoices, reports, prescriptions, PWA, AND the public website.

**Architecture:** Remove the separate website logo upload. Make the website module's prerender fetch the hospital logo from the `settings` table as a fallback when `website_config.logo_key` is null. Also add logo support to PatientChartPrint and auto-populate PrintTemplateSettings logo URL.

**Tech Stack:** Hono (backend), React + TypeScript (frontend), D1 (database), R2 (file storage)

---

## File Map

### Backend (Server)
- `src/routes/tenant/settings.ts` — Hospital logo upload/serve/delete (already works)
- `src/routes/tenant/website.ts` — Website config API + website logo upload (to be modified)
- `src/routes/public/prerender.tsx` — Pre-renders website HTML (to be modified)
- `src/routes/public/renderBlogPost.tsx` — Renders blog post pages (to be modified)

### Frontend (Client)
- `web/src/pages/SettingsPage.tsx` — Hospital logo upload UI (already works)
- `web/src/pages/WebsiteSettings.tsx` — Website settings with separate logo upload (to be modified)
- `web/src/pages/PatientChartPrint.tsx` — Patient chart print (to be modified)
- `web/src/pages/PrintTemplateSettings.tsx` — Print template settings (to be modified)

---

### Task 1: Backend — Make prerender use hospital logo as fallback

**Files:**
- Modify: `src/routes/public/prerender.tsx:108`

- [ ] **Step 1: Update prerender to fetch hospital logo from settings when website logo is missing**

In `src/routes/public/prerender.tsx`, the `commonProps` object at line 108 currently only uses `config.logo_key`. Change it to also query the `settings` table for `hospital_logo` as a fallback.

```typescript
// In fetchTenantData function, add settings query
const [tenant, config, doctorsResult, servicesResult, schedulesResult, galleryResult, blogResult, reviewsResult, deptResult, hospitalLogoRow] = await Promise.all([
  // ... existing queries ...
  db.prepare("SELECT value FROM settings WHERE key = 'hospital_logo' AND tenant_id = ?").bind(tenantId).first<{ value: string }>(),
]);
```

Then update `commonProps` at line 108:

```typescript
// Resolve logo: website-specific logo takes priority, then hospital logo from settings
let logoUrl: string | undefined;
if (config.logo_key) {
  logoUrl = `/api/uploads/${config.logo_key}`;
} else if (hospitalLogoRow?.value) {
  logoUrl = `/api/settings/logo`;
}

const commonProps = {
  theme,
  primaryColor: config.primary_color ?? undefined,
  secondaryColor: config.secondary_color ?? undefined,
  hospitalName,
  logoUrl,
};
```

- [ ] **Step 2: Update renderBlogPost to use the same fallback**

In `src/routes/public/renderBlogPost.tsx:23`, change:

```typescript
const logoUrl = config.logo_key ? `/api/uploads/${config.logo_key}` : undefined;
```

To accept an optional `hospitalLogoUrl` parameter and use it as fallback. Update the function signature to accept it:

```typescript
export async function renderBlogPost(opts: {
  tenant: Record<string, any>;
  config: Record<string, any>;
  post: Record<string, any>;
  slug: string;
  lang: string;
  hospitalLogoUrl?: string;
}): Promise<string> {
  const { tenant, config, post, slug, lang, hospitalLogoUrl } = opts;
  // ...
  const logoUrl = config.logo_key
    ? `/api/uploads/${config.logo_key}`
    : hospitalLogoUrl;
```

- [ ] **Step 3: Update hospitalSite.ts to pass hospital logo URL to renderBlogPost**

In `src/routes/public/hospitalSite.ts`, around line 136-138, fetch the hospital logo and pass it:

```typescript
// After fetching config, also fetch hospital logo
const hospitalLogoRow = await db.$client.prepare(
  "SELECT value FROM settings WHERE key = 'hospital_logo' AND tenant_id = ?"
).bind(tenant.id).first<{ value: string }>();
const hospitalLogoUrl = hospitalLogoRow?.value ? '/api/settings/logo' : undefined;

const { renderBlogPost } = await import('./renderBlogPost');
const html = await renderBlogPost({ tenant, config, post, slug, lang, hospitalLogoUrl });
```

---

### Task 2: Backend — Update website config API to include hospital logo fallback

**Files:**
- Modify: `src/routes/tenant/website.ts:50-63`

- [ ] **Step 1: Add hospital logo URL to website config response**

In `src/routes/tenant/website.ts`, update the `GET /api/website/config` route to include a `hospital_logo_url` field:

```typescript
websiteRoutes.get('/config', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const config = await db.$client.prepare(
    'SELECT * FROM website_config WHERE tenant_id = ?'
  ).bind(tenantId).first();

  if (!config) {
    return c.json({ data: null, message: 'No website config found' });
  }

  // Check if hospital logo exists in settings
  const hospitalLogoRow = await db.$client.prepare(
    "SELECT value FROM settings WHERE key = 'hospital_logo' AND tenant_id = ?"
  ).bind(tenantId).first<{ value: string }>();

  const configWithLogo = {
    ...config,
    hospital_logo_url: hospitalLogoRow?.value ? '/api/settings/logo' : null,
  };

  return c.json({ data: configWithLogo });
});
```

---

### Task 3: Frontend — Update WebsiteSettings to use hospital logo

**Files:**
- Modify: `web/src/pages/WebsiteSettings.tsx:427-433`

- [ ] **Step 1: Remove separate website logo upload, show hospital logo**

In `web/src/pages/WebsiteSettings.tsx`, replace the website logo `ImageUpload` component with a display of the hospital logo from settings. Around line 431:

Change:
```tsx
<ImageUpload label="Logo" endpoint="/api/website/upload-logo" deleteEndpoint="/api/website/logo" onUpload={invalidateAll} />
```

To:
```tsx
<div>
  <label className="label">Logo</label>
  <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg p-4 text-center">
    {config.hospital_logo_url ? (
      <div className="flex flex-col items-center gap-2">
        <img src={config.hospital_logo_url} alt="Hospital Logo" className="max-h-24 mx-auto rounded" />
        <p className="text-xs text-[var(--color-text-muted)]">
          Logo is managed in Settings → Hospital Logo
        </p>
      </div>
    ) : (
      <div>
        <Upload className="w-6 h-6 mx-auto text-[var(--color-text-muted)] mb-1" />
        <p className="text-xs text-[var(--color-text-muted)]">
          Upload logo in Settings → Hospital Logo
        </p>
      </div>
    )}
  </div>
</div>
```

Make sure `config.hospital_logo_url` is typed in the `WebsiteConfig` interface.

- [ ] **Step 2: Update WebsiteConfig interface to include hospital_logo_url**

Add to the interface:

```typescript
interface WebsiteConfig {
  // ... existing fields ...
  hospital_logo_url?: string | null;
}
```

---

### Task 4: Frontend — Add logo to PatientChartPrint

**Files:**
- Modify: `web/src/pages/PatientChartPrint.tsx:175-214`

- [ ] **Step 1: Fetch hospital settings and display logo in patient chart print**

Add settings query and logo display. At the top of the component, add:

```typescript
const { data: settingsData } = useApiQuery<{ settings?: { hospital_logo_url?: string } }>(
  ['settings'],
  '/api/settings',
);
const logoUrl = settingsData?.settings?.hospital_logo_url ?? null;
```

Then in the JSX, around line 206-209, add the logo before the patient name:

```tsx
<div className="flex items-start justify-between gap-6 border-b pb-5 border-slate-200">
  <div className="flex items-start gap-4">
    {logoUrl && (
      <img src={logoUrl} alt="Hospital Logo" className="w-14 h-14 object-contain rounded-lg shrink-0" />
    )}
    <div>
      <p className="text-xs uppercase tracking-[0.28em] text-slate-500 font-bold">{t('chart.medicalProfile')}</p>
      <h1 className="text-3xl font-bold mt-2">{patient.name}</h1>
```

---

### Task 5: Frontend — Auto-populate PrintTemplateSettings logo URL

**Files:**
- Modify: `web/src/pages/PrintTemplateSettings.tsx:27,153`

- [ ] **Step 1: Fetch hospital logo and auto-populate the logo_url field**

Add a settings query to fetch the hospital logo URL. When the form's `logo_url` is empty, show the hospital logo URL as placeholder/hint.

Around line 153, change the logo URL input:

```tsx
<div>
  <label className="label">Logo URL</label>
  <input
    className="input w-full"
    value={form.logo_url}
    onChange={e => setForm({...form, logo_url: e.target.value})}
    placeholder={settingsData?.settings?.hospital_logo_url || t("settings.https")}
  />
  {settingsData?.settings?.hospital_logo_url && !form.logo_url && (
    <p className="text-xs text-[var(--color-text-muted)] mt-1">
      Hospital logo from settings will be used if left empty
    </p>
  )}
</div>
```

Add the settings query at the top of the component:

```typescript
const { data: settingsData } = useApiQuery<{ settings?: { hospital_logo_url?: string } }>(
  ['settings'],
  '/api/settings',
);
```

---

### Task 6: Cleanup — Remove unused website logo upload endpoints

**Files:**
- Modify: `src/routes/tenant/website.ts:212-291`

- [ ] **Step 1: Remove or deprecate the website-specific logo upload/delete endpoints**

Remove these routes from `src/routes/tenant/website.ts`:
- `POST /api/website/upload-logo` (lines 212-251)
- `DELETE /api/website/logo` (lines 273-291)

Keep the `logo_key` column in `website_config` for backward compatibility (existing websites may have a logo_key set). The prerender already handles the fallback logic.

---

## Verification

After implementation:
1. Upload a hospital logo in Settings → it should appear in sidebar, all prints, AND the public website
2. Delete the hospital logo → website should show emoji fallback (🏥)
3. PatientChartPrint should show the hospital logo
4. PrintTemplateSettings should show hospital logo URL as placeholder
5. Website settings should no longer show a separate logo upload
6. Run `pnpm build` to verify no TypeScript errors
