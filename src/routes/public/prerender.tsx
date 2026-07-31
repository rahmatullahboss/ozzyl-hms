/** @jsxImportSource hono/jsx */
import type { Env } from '../../types';
import { SiteLayout } from './components/SiteLayout';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { DoctorList } from './components/DoctorCard';
import { ServiceList } from './components/ServiceCard';
import { BookingPage } from './components/BookingPage';
import { Footer } from './components/Footer';
import { SEOHead } from './components/SEOHead';
import { BlogList } from './components/BlogCard';
import { TestimonialSection } from './components/TestimonialCard';
import { DepartmentList } from './components/DepartmentCard';
import { buildSiteCacheKey } from './siteCacheKey';
import type { ThemeName } from './themes';

interface TenantData {
  tenant: Record<string, any>;
  config: Record<string, any>;
  doctors: any[];
  services: any[];
  schedules: any[];
  gallery: any[];
  blogPosts: any[];
  reviews: any[];
  departments: any[];
  hospitalLogoRow: { value: string } | null;
}

/**
 * Queries D1 for all data needed to render a tenant's website.
 */
async function fetchTenantData(db: D1Database, tenantId: number): Promise<TenantData | null> {
  const [tenant, config, doctorsResult, servicesResult, schedulesResult, galleryResult, blogResult, reviewsResult, deptResult, hospitalLogoRow] = await Promise.all([
    db.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first(),
    db.prepare('SELECT * FROM website_config WHERE tenant_id = ?').bind(tenantId).first(),
    db.prepare(
      'SELECT * FROM doctors WHERE tenant_id = ? AND is_public = 1 ORDER BY name'
    ).bind(tenantId).all(),
    db.prepare(
      'SELECT * FROM website_services WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order'
    ).bind(tenantId).all(),
    db.prepare(
      `SELECT ds.doctor_id, ds.day_of_week, ds.start_time, ds.end_time, ds.session_type, ds.chamber, ds.max_patients
       FROM doctor_schedules ds
       JOIN doctors d ON d.id = ds.doctor_id AND d.tenant_id = ds.tenant_id
       WHERE ds.tenant_id = ? AND ds.is_active = 1 AND d.is_public = 1
       ORDER BY ds.doctor_id, CASE ds.day_of_week
         WHEN 'sun' THEN 0 WHEN 'mon' THEN 1 WHEN 'tue' THEN 2
         WHEN 'wed' THEN 3 WHEN 'thu' THEN 4 WHEN 'fri' THEN 5 WHEN 'sat' THEN 6
       END, ds.start_time`
    ).bind(tenantId).all(),
    db.prepare(
      'SELECT * FROM website_gallery WHERE tenant_id = ? ORDER BY sort_order'
    ).bind(tenantId).all(),
    db.prepare(
      'SELECT * FROM website_blog_posts WHERE tenant_id = ? AND is_published = 1 ORDER BY published_at DESC'
    ).bind(tenantId).all(),
    db.prepare(
      'SELECT * FROM website_reviews WHERE tenant_id = ? AND is_approved = 1 ORDER BY created_at DESC'
    ).bind(tenantId).all(),
    db.prepare(
      'SELECT * FROM website_departments WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order'
    ).bind(tenantId).all(),
    db.prepare("SELECT value FROM settings WHERE key = 'hospital_logo' AND tenant_id = ?").bind(tenantId).first<{ value: string }>(),
  ]);

  if (!tenant || !config) return null;

  return {
    tenant: tenant as Record<string, any>,
    config: config as Record<string, any>,
    doctors: (doctorsResult.results || []) as any[],
    services: (servicesResult.results || []) as any[],
    schedules: (schedulesResult.results || []) as any[],
    gallery: (galleryResult.results || []) as any[],
    blogPosts: (blogResult.results || []) as any[],
    reviews: (reviewsResult.results || []) as any[],
    departments: (deptResult.results || []) as any[],
    hospitalLogoRow: hospitalLogoRow ?? null,
  };
}

/**
 * Renders all pages for a tenant and stores them in KV.
 * Called via waitUntil() after admin saves website config or doctor changes.
 *
 * URL pattern: /site/{slug}, /site/{slug}/doctors, etc.
 */
const DEFAULT_WORKER_HOST = 'hms-saas.rahmatullahzisan.workers.dev';

export async function getCachePurgeHosts(
  subdomain: string,
  tenantId: number,
  db: D1Database,
  env: { WORKER_HOST?: string; [key: string]: any },
): Promise<string[]> {
  const hosts: string[] = [];

  // Always purge the actual worker domain
  hosts.push(env.WORKER_HOST || DEFAULT_WORKER_HOST);

  // Purge verified custom domain if tenant has one
  try {
    const tenant = await db.prepare(
      'SELECT custom_domain, custom_domain_verified FROM tenants WHERE id = ?',
    ).bind(tenantId).first<{ custom_domain: string | null; custom_domain_verified: number }>();
    if (tenant?.custom_domain && tenant.custom_domain_verified) {
      hosts.push(tenant.custom_domain);
    }
  } catch {
    // Non-fatal — custom domain purge is best-effort
  }

  return hosts;
}

export async function preRenderTenantSite(
  db: D1Database,
  kv: KVNamespace,
  tenantId: number,
  subdomain: string,
  env: { WORKER_HOST?: string; [key: string]: any } = {},
): Promise<void> {
  const data = await fetchTenantData(db, tenantId);
  if (!data || !data.config.is_enabled) return;

  const { tenant, config, doctors, services, schedules, gallery, blogPosts, reviews, departments, hospitalLogoRow } = data;
  const theme = (config.theme as ThemeName) || 'arogyaseva';
  const hospitalName = tenant.name || 'Hospital';

  // Slug-based basePath: /site/{slug}
  const BASE_PATH = `/site/${subdomain}`;

  let logoUrl: string | undefined;
  if (config.logo_key) {
    logoUrl = `/api/uploads/${config.logo_key}`;
  } else if (hospitalLogoRow?.value) {
    logoUrl = `/site/${subdomain}/logo`;
  }

  const commonProps = {
    theme,
    primaryColor: config.primary_color ?? undefined,
    secondaryColor: config.secondary_color ?? undefined,
    hospitalName,
    logoUrl,
  };

  const emergencyNumber = config.emergency_number || undefined;
  const ambulanceNumber = config.ambulance_number || undefined;

  // Shared footer props
  const footerBase = {
    hospitalName,
    address: tenant.address,
    phone: tenant.phone,
    email: tenant.email,
    whatsappNumber: config.whatsapp_number || undefined,
    facebookUrl: config.facebook_url || undefined,
    basePath: BASE_PATH,
    subdomain,
  };

  /** Renders all 6 pages for a given language */
  async function renderLang(lang: string): Promise<Record<string, string>> {
    const isBn = lang === 'bn';
    const suffix = isBn ? ':bn' : '';
    const navProps = { hospitalName, logoUrl: commonProps.logoUrl, basePath: BASE_PATH, subdomain, lang, emergencyNumber };
    const footerProps = { ...footerBase, lang, emergencyNumber, ambulanceNumber };
    const layoutProps = { ...commonProps, lang };

    const aboutText = isBn ? (config.about_text_bn || config.about_text) : config.about_text;
    const missionText = isBn ? (config.mission_text_bn || config.mission_text) : config.mission_text;

    const [homeHtml, doctorsHtml, servicesHtml, aboutHtml, contactHtml, bookHtml, blogHtml, deptHtml] = await Promise.all([
      // Home page
      renderToString(
        <SiteLayout {...layoutProps} title={config.seo_title || hospitalName}
          description={config.seo_description || `${hospitalName} — Your trusted healthcare partner`}>
          <SEOHead hospitalName={hospitalName} description={config.seo_description} doctors={doctors} />
          <Navbar {...navProps} />
          <HeroSection hospitalName={hospitalName} tagline={config.tagline}
            taglineBn={config.tagline_bn} basePath={BASE_PATH} subdomain={subdomain} lang={lang}
            heroImageUrl={config.hero_image_key ? `/api/uploads/${config.hero_image_key}` : undefined} />
          <section class="section section-alt">
            <div class="container">
              <h2 class="section-title text-center">{isBn ? 'আমাদের ডাক্তার' : 'Our Doctors'}</h2>
              <p class="section-subtitle text-center">{isBn ? 'আমাদের অভিজ্ঞ চিকিৎসক দল' : 'Meet our experienced medical team'}</p>
              <DoctorList doctors={doctors.slice(0, 6)} basePath={BASE_PATH} schedules={schedules} />
              {doctors.length > 6 && (
                <div class="text-center" style="margin-top:2rem">
                  <a href={`${BASE_PATH}/doctors`} class="btn btn-outline">
                    {isBn ? 'সকল ডাক্তার দেখুন →' : 'View All Doctors →'}
                  </a>
                </div>
              )}
            </div>
          </section>
          {services.length > 0 && (
            <section class="section">
              <div class="container">
                <h2 class="section-title text-center">{isBn ? 'আমাদের সেবাসমূহ' : 'Our Services'}</h2>
                <p class="section-subtitle text-center">{isBn ? 'সকলের জন্য ব্যাপক স্বাস্থ্যসেবা' : 'Comprehensive healthcare services'}</p>
                <ServiceList services={services.slice(0, 6)} />
              </div>
            </section>
          )}
          {gallery.length > 0 && (
            <section class="section section-alt">
              <div class="container">
                <h2 class="section-title text-center">{isBn ? 'গ্যালারি' : 'Gallery'}</h2>
                <p class="section-subtitle text-center">{isBn ? 'আমাদের সুবিধাসমূহের এক ঝলক' : 'A glimpse of our facilities'}</p>
                <div class="grid grid-3" style="gap:1rem;margin-top:2rem">
                  {gallery.slice(0, 6).map((img: any) => (
                    <div style="border-radius:0.75rem;overflow:hidden;aspect-ratio:4/3">
                      <img src={`/api/uploads/${img.image_key}`} alt={img.caption || 'Gallery'}
                        style="width:100%;height:100%;object-fit:cover" loading="lazy" />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
          {departments.length > 0 && (
            <section class="section">
              <div class="container">
                <h2 class="section-title text-center">{isBn ? 'বিভাগসমূহ' : 'Our Departments'}</h2>
                <p class="section-subtitle text-center">{isBn ? 'বিশেষায়িত চিকিৎসা বিভাগ' : 'Specialized medical departments'}</p>
                <DepartmentList departments={departments.slice(0, 6)} basePath={BASE_PATH} lang={lang} />
                {departments.length > 6 && (
                  <div class="text-center" style="margin-top:2rem">
                    <a href={`${BASE_PATH}/departments`} class="btn btn-outline">
                      {isBn ? 'সকল বিভাগ দেখুন →' : 'View All Departments →'}
                    </a>
                  </div>
                )}
              </div>
            </section>
          )}
          {blogPosts.length > 0 && (
            <section class="section section-alt">
              <div class="container">
                <h2 class="section-title text-center">{isBn ? 'স্বাস্থ্য তথ্য' : 'Health Articles'}</h2>
                <p class="section-subtitle text-center">{isBn ? 'স্বাস্থ্য সচেতনতা ও টিপস' : 'Health awareness and tips'}</p>
                <BlogList posts={blogPosts.slice(0, 3)} basePath={BASE_PATH} lang={lang} />
                {blogPosts.length > 3 && (
                  <div class="text-center" style="margin-top:2rem">
                    <a href={`${BASE_PATH}/blog`} class="btn btn-outline">
                      {isBn ? 'সব পোস্ট দেখুন →' : 'View All Articles →'}
                    </a>
                  </div>
                )}
              </div>
            </section>
          )}
          <TestimonialSection reviews={reviews} lang={lang} />
          <Footer {...footerProps} />
        </SiteLayout>
      ),

      // Doctors page
      renderToString(
        <SiteLayout {...layoutProps} title={`${isBn ? 'আমাদের ডাক্তার' : 'Our Doctors'} — ${hospitalName}`}
          description={`Meet the experienced doctors at ${hospitalName}`}>
          <SEOHead hospitalName={hospitalName} doctors={doctors} />
          <Navbar {...navProps} />
          <main id="main-content" class="section">
            <div class="container">
              <h1 class="section-title text-center">{isBn ? 'আমাদের ডাক্তার' : 'Our Doctors'}</h1>
              <p class="section-subtitle text-center">
                {isBn ? `${doctors.length} জন অভিজ্ঞ বিশেষজ্ঞ` : `${doctors.length} experienced specialists`}
              </p>
              <DoctorList doctors={doctors} basePath={BASE_PATH} schedules={schedules} />
            </div>
          </main>
          <Footer {...footerProps} />
        </SiteLayout>
      ),

      // Services page
      renderToString(
        <SiteLayout {...layoutProps} title={`${isBn ? 'সেবাসমূহ' : 'Services'} — ${hospitalName}`}
          description={`Healthcare services offered at ${hospitalName}`}>
          <Navbar {...navProps} />
          <main id="main-content" class="section">
            <div class="container">
              <h1 class="section-title text-center">{isBn ? 'আমাদের সেবাসমূহ' : 'Our Services'}</h1>
              <p class="section-subtitle text-center">{isBn ? 'আপনার এবং আপনার পরিবারের জন্য ব্যাপক স্বাস্থ্যসেবা' : 'Comprehensive healthcare for you and your family'}</p>
              <ServiceList services={services} />
            </div>
          </main>
          <Footer {...footerProps} />
        </SiteLayout>
      ),

      // About page
      renderToString(
        <SiteLayout {...layoutProps} title={`${isBn ? 'সম্পর্কে' : 'About'} — ${hospitalName}`}
          description={aboutText?.slice(0, 160) || `About ${hospitalName}`}>
          <Navbar {...navProps} />
          <main id="main-content" class="section">
            <div class="container" style="max-width:800px">
              <h1 class="section-title text-center">{isBn ? `${hospitalName} সম্পর্কে` : `About ${hospitalName}`}</h1>
              {config.founded_year && (
                <p class="section-subtitle text-center">
                  {isBn ? `${config.founded_year} সাল থেকে সেবা প্রদান` : `Serving since ${config.founded_year}`}
                </p>
              )}
              {aboutText && (
                <div style="font-size:1.1rem;line-height:1.8;opacity:0.85;margin-top:2rem">
                  {aboutText.split('\n').map((para: string) => <p style="margin-bottom:1rem">{para}</p>)}
                </div>
              )}
              {missionText && (
                <div style="margin-top:3rem;padding:2rem;border-radius:1rem;background:var(--color-bg-alt,#f0f4f8)">
                  <h2 style="font-size:1.25rem;font-weight:600;margin-bottom:1rem">
                    {isBn ? 'আমাদের লক্ষ্য' : 'Our Mission'}
                  </h2>
                  <p style="font-size:1.05rem;line-height:1.7;opacity:0.8">{missionText}</p>
                </div>
              )}
              <div class="grid grid-3" style="margin-top:3rem;text-align:center">
                {config.bed_count && (
                  <div class="card"><div class="card-body">
                    <div style="font-size:2rem;font-weight:800;color:var(--color-primary)">{config.bed_count}</div>
                    <p style="opacity:0.6">{isBn ? 'শয্যা' : 'Beds'}</p>
                  </div></div>
                )}
                <div class="card"><div class="card-body">
                  <div style="font-size:2rem;font-weight:800;color:var(--color-primary)">{doctors.length}</div>
                  <p style="opacity:0.6">{isBn ? 'ডাক্তার' : 'Doctors'}</p>
                </div></div>
                {services.length > 0 && (
                  <div class="card"><div class="card-body">
                    <div style="font-size:2rem;font-weight:800;color:var(--color-primary)">{services.length}</div>
                    <p style="opacity:0.6">{isBn ? 'সেবা' : 'Services'}</p>
                  </div></div>
                )}
              </div>
            </div>
          </main>
          <Footer {...footerProps} />
        </SiteLayout>
      ),

      // Contact page
      renderToString(
        <SiteLayout {...layoutProps} title={`${isBn ? 'যোগাযোগ' : 'Contact'} — ${hospitalName}`}
          description={`Contact ${hospitalName} for appointments and inquiries`}>
          <Navbar {...navProps} />
          <main id="main-content" class="section">
            <div class="container" style="max-width:800px">
              <h1 class="section-title text-center">{isBn ? 'যোগাযোগ করুন' : 'Contact Us'}</h1>
              <p class="section-subtitle text-center">{isBn ? 'আমরা আপনার কথা শুনতে চাই' : "We'd love to hear from you"}</p>
              <div class="grid grid-2" style="margin-top:2rem">
                <div class="card"><div class="card-body">
                  <h3 style="font-weight:600;margin-bottom:1rem">📍 {isBn ? 'ঠিকানা' : 'Address'}</h3>
                  <p style="opacity:0.7;line-height:1.6">{tenant.address || (isBn ? 'ঠিকানার জন্য যোগাযোগ করুন' : 'Contact us for address')}</p>
                </div></div>
                <div class="card"><div class="card-body">
                  <h3 style="font-weight:600;margin-bottom:1rem">📞 {isBn ? 'ফোন' : 'Phone'}</h3>
                  <p style="opacity:0.7">{tenant.phone || (isBn ? 'যোগাযোগ করুন' : 'Contact us')}</p>
                  {tenant.email && <p style="opacity:0.7;margin-top:0.5rem">✉️ {tenant.email}</p>}
                </div></div>
              </div>
              {config.operating_hours && (
                <div class="card" style="margin-top:1.5rem"><div class="card-body">
                  <h3 style="font-weight:600;margin-bottom:1rem">🕐 {isBn ? 'কর্মঘণ্টা' : 'Operating Hours'}</h3>
                  <p style="opacity:0.7">{config.operating_hours}</p>
                </div></div>
              )}
              {emergencyNumber && (
                <div class="card" style="margin-top:1.5rem;border:2px solid #dc2626"><div class="card-body">
                  <h3 style="font-weight:600;margin-bottom:1rem;color:#dc2626">🚨 {isBn ? 'জরুরি সেবা' : 'Emergency'}</h3>
                  <p style="font-size:1.1rem"><strong>{isBn ? 'জরুরি' : 'Emergency'}:</strong>{' '}
                    <a href={`tel:${emergencyNumber.replace(/\D/g, '')}`} style="font-weight:700;color:#dc2626">{emergencyNumber}</a>
                  </p>
                  {ambulanceNumber && (
                    <p style="font-size:1.1rem;margin-top:0.5rem"><strong>{isBn ? 'অ্যাম্বুলেন্স' : 'Ambulance'}:</strong>{' '}
                      <a href={`tel:${ambulanceNumber.replace(/\D/g, '')}`} style="font-weight:700;color:#dc2626">{ambulanceNumber}</a>
                    </p>
                  )}
                  {config.emergency_hours && <p style="opacity:0.7;margin-top:0.5rem">{config.emergency_hours}</p>}
                </div></div>
              )}
              {config.google_maps_embed && (
                <div style="margin-top:2rem;border-radius:1rem;overflow:hidden;height:350px">
                  <iframe src={config.google_maps_embed} width="100%" height="350"
                    sandbox="allow-scripts allow-same-origin"
                    style="border:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                    title={isBn ? 'হাসপাতালের অবস্থান' : 'Hospital Location'} />
                </div>
              )}
              <div class="text-center" style="margin-top:2rem">
                <div style="display:flex;justify-content:center;gap:1rem;flex-wrap:wrap">
                  <a href="/login" class="btn btn-primary">🏥 {isBn ? 'হাসপাতাল লগইন' : 'Hospital Login'}</a>
                  <a href="/patient/login" class="btn btn-outline">🔐 {isBn ? 'পেশেন্ট পোর্টাল' : 'Patient Portal Login'}</a>
                </div>
              </div>
            </div>
          </main>
          <Footer {...footerProps} />
        </SiteLayout>
      ),

      // Book appointment page
      renderToString(
        <SiteLayout {...layoutProps} title={`${isBn ? 'অ্যাপয়েন্টমেন্ট বুক করুন' : 'Book Appointment'} — ${hospitalName}`}
          description={`Book an appointment at ${hospitalName}`}>
          <Navbar {...navProps} />
          <BookingPage doctors={doctors} schedules={schedules} basePath={BASE_PATH}
            hospitalName={hospitalName} subdomain={subdomain} />
          <Footer {...footerProps} />
        </SiteLayout>
      ),

      // Blog list page
      renderToString(
        <SiteLayout {...layoutProps} title={`${isBn ? 'স্বাস্থ্য তথ্য' : 'Health Articles'} — ${hospitalName}`}
          description={`Health articles and tips from ${hospitalName}`}>
          <Navbar {...navProps} />
          <main id="main-content" class="section">
            <div class="container">
              <h1 class="section-title text-center">{isBn ? 'স্বাস্থ্য তথ্য' : 'Health Articles'}</h1>
              <p class="section-subtitle text-center">
                {isBn ? 'স্বাস্থ্য সচেতনতা ও টিপস' : 'Health awareness and tips from our experts'}
              </p>
              {blogPosts.length > 0 ? (
                <BlogList posts={blogPosts} basePath={BASE_PATH} lang={lang} />
              ) : (
                <p class="text-center" style="opacity:0.5;padding:3rem 0">
                  {isBn ? 'শীঘ্রই আসছে...' : 'Coming soon...'}
                </p>
              )}
            </div>
          </main>
          <Footer {...footerProps} />
        </SiteLayout>
      ),

      // Departments page
      renderToString(
        <SiteLayout {...layoutProps} title={`${isBn ? 'বিভাগসমূহ' : 'Departments'} — ${hospitalName}`}
          description={`Medical departments at ${hospitalName}`}>
          <Navbar {...navProps} />
          <main id="main-content" class="section">
            <div class="container">
              <h1 class="section-title text-center">{isBn ? 'বিভাগসমূহ' : 'Our Departments'}</h1>
              <p class="section-subtitle text-center">
                {isBn ? 'বিশেষায়িত চিকিৎসা বিভাগ' : 'Specialized medical departments'}
              </p>
              {departments.length > 0 ? (
                <DepartmentList departments={departments} basePath={BASE_PATH} lang={lang} />
              ) : (
                <p class="text-center" style="opacity:0.5;padding:3rem 0">
                  {isBn ? 'শীঘ্রই আসছে...' : 'Coming soon...'}
                </p>
              )}
            </div>
          </main>
          <Footer {...footerProps} />
        </SiteLayout>
      ),
    ]);

    return {
      [`/site/${subdomain}${suffix}`]: homeHtml,
      [`/site/${subdomain}/doctors${suffix}`]: doctorsHtml,
      [`/site/${subdomain}/services${suffix}`]: servicesHtml,
      [`/site/${subdomain}/about${suffix}`]: aboutHtml,
      [`/site/${subdomain}/contact${suffix}`]: contactHtml,
      [`/site/${subdomain}/book${suffix}`]: bookHtml,
      [`/site/${subdomain}/blog${suffix}`]: blogHtml,
      [`/site/${subdomain}/departments${suffix}`]: deptHtml,
    };
  }

  // ── Render both EN and BN versions in parallel ──
  const [enPages, bnPages] = await Promise.all([
    renderLang('en'),
    renderLang('bn'),
  ]);

  const pages: Record<string, string> = { ...enPages, ...bnPages };

  // Store all pages in KV with 24h TTL
  const kvPuts = Object.entries(pages).map(([path, html]) => {
    const isBnPath = path.endsWith(':bn');
    const normalizedPath = isBnPath ? path.slice(0, -3) : path;
    return kv.put(
      buildSiteCacheKey(subdomain, normalizedPath, isBnPath ? 'bn' : 'en'),
      html,
      { expirationTtl: 86400 },
    );
  });
  await Promise.all(kvPuts);

  // ── Purge CF Cache for instant updates ──
  try {
    const cache = caches.default;
    const hosts = await getCachePurgeHosts(subdomain, tenantId, db, env);
    const purgePromises: Promise<boolean>[] = [];
    for (const host of hosts) {
      for (const path of Object.keys(pages)) {
        purgePromises.push(cache.delete(new Request(`https://${host}${path}`)));
      }
    }
    await Promise.all(purgePromises);
  } catch {
    // Cache purge failure is non-fatal — pages will still update after s-maxage expires
    console.warn(`[prerender] Cache purge failed for slug "${subdomain}"`);
  }
}

/**
 * Renders JSX to HTML string. Hono JSX .toString() returns Promise<string>.
 * Must be awaited to get actual HTML content.
 */
async function renderToString(jsx: any): Promise<string> {
  const html = await (jsx as any).toString();
  return `<!DOCTYPE html>${html}`;
}
