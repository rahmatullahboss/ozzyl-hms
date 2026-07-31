import { describe, expect, it } from 'vitest';
import { HeroSection } from '../../src/routes/public/components/HeroSection';
import { Navbar } from '../../src/routes/public/components/Navbar';
import { Footer } from '../../src/routes/public/components/Footer';

describe('public landing navbar', () => {
  it('renders a mobile hospital login CTA outside the collapsible nav links', async () => {
    const markup = await (Navbar({
      hospitalName: 'Demo Hospital',
      basePath: '/site/demo',
      subdomain: 'demo',
    }) as any).toString();

    expect(markup).toContain('href="/patient/login"');
    expect(markup).toContain('href="/login"');
    expect(markup).toContain('nav-hospital-login-mobile');
    expect(markup).toContain('nav-patient-login-desktop');
    expect(markup).toContain('nav-hospital-login');

    const mobileLoginIndex = markup.indexOf('nav-hospital-login nav-hospital-login-mobile');
    const navLinksIndex = markup.indexOf('class="nav-links"');
    const mobileToggleIndex = markup.indexOf('class="nav-mobile-toggle"');

    expect(mobileLoginIndex).toBeGreaterThan(-1);
    expect(navLinksIndex).toBeGreaterThan(-1);
    expect(mobileToggleIndex).toBeGreaterThan(-1);
    expect(mobileLoginIndex).toBeGreaterThan(navLinksIndex);
    expect(mobileLoginIndex).toBeLessThan(mobileToggleIndex);
    expect(markup).toContain('>Hospital Login<');
  });

  it('renders both patient and hospital portal links across the public site components', async () => {
    const heroMarkup = await (HeroSection({
      hospitalName: 'Demo Hospital',
      basePath: '/site/demo',
      subdomain: 'demo',
    }) as any).toString();
    const footerMarkup = await (Footer({
      hospitalName: 'Demo Hospital',
      basePath: '/site/demo',
      subdomain: 'demo',
    }) as any).toString();

    expect(heroMarkup).toContain('href="/patient/login"');
    expect(heroMarkup).toContain('href="/login"');
    expect(footerMarkup).toContain('href="/patient/login"');
    expect(footerMarkup).toContain('href="/login"');
  });
});
