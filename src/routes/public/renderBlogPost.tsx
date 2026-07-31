/** @jsxImportSource hono/jsx */
import { SiteLayout } from './components/SiteLayout';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { BlogPostPage } from './components/BlogCard';
import type { ThemeName } from './themes';

/**
 * Renders a single blog post page to HTML string.
 * Called dynamically from hospitalSite.ts for individual post URLs.
 */
export async function renderBlogPost(opts: {
  tenant: Record<string, any>;
  config: Record<string, any>;
  post: Record<string, any>;
  slug: string;
  lang: string;
  hospitalLogoUrl?: string;
}): Promise<string> {
  const { tenant, config, post, slug, lang } = opts;
  const theme = (config.theme as ThemeName) || 'arogyaseva';
  const hospitalName = tenant.name || 'Hospital';
  const basePath = `/site/${slug}`;
  const logoUrl = config.logo_key ? `/api/uploads/${config.logo_key}` : opts.hospitalLogoUrl;
  const isBn = lang === 'bn';
  const title = isBn ? (post.title_bn || post.title) : post.title;

  const jsx = (
    <SiteLayout theme={theme} primaryColor={config.primary_color} secondaryColor={config.secondary_color}
      hospitalName={hospitalName} logoUrl={logoUrl}
      title={`${title} — ${hospitalName}`}
      description={post.excerpt || post.title}>
      <Navbar hospitalName={hospitalName} logoUrl={logoUrl}
        basePath={basePath} subdomain={slug} lang={lang} emergencyNumber={config.emergency_number} />
      <BlogPostPage post={post as any} basePath={basePath} lang={lang} />
      <Footer hospitalName={hospitalName} address={tenant.address} phone={tenant.phone}
        email={tenant.email} whatsappNumber={config.whatsapp_number} facebookUrl={config.facebook_url}
        basePath={basePath} subdomain={slug} lang={lang}
        emergencyNumber={config.emergency_number} ambulanceNumber={config.ambulance_number} />
    </SiteLayout>
  );

  return `<!DOCTYPE html>${await (jsx as any).toString()}`;
}
