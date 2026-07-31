/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';

interface NavbarProps {
  hospitalName: string;
  logoUrl?: string;
  basePath: string;
  subdomain?: string;
  lang?: string;
  emergencyNumber?: string;
}

export const Navbar: FC<NavbarProps> = ({ hospitalName, logoUrl, basePath, subdomain, lang, emergencyNumber }) => {
  const staffLoginPath = '/login';

  return (
  <header>
    <nav class="navbar" role="navigation" aria-label={lang === 'bn' ? 'প্রধান নেভিগেশন' : 'Main navigation'}>
      {emergencyNumber && (
        <div class="emergency-bar" role="alert">
          <div class="container" style="display:flex;align-items:center;justify-content:center;gap:0.75rem;font-size:0.85rem">
            <span>🚨 {lang === 'bn' ? 'জরুরি' : 'Emergency'}:</span>
            <a href={`tel:${emergencyNumber.replace(/\D/g, '')}`} style="font-weight:700;text-decoration:underline"
              aria-label={`${lang === 'bn' ? 'জরুরি নম্বরে কল করুন' : 'Call emergency number'} ${emergencyNumber}`}>
              {emergencyNumber}
            </a>
          </div>
        </div>
      )}
      <div class="container">
        <a href={basePath} class="nav-brand" aria-label={`${hospitalName} ${lang === 'bn' ? 'হোমপেজ' : 'homepage'}`}>
          {logoUrl ? (
            <img src={logoUrl} alt={`${hospitalName} logo`} width="36" height="36" />
          ) : (
            <span style="font-size:1.5rem" aria-hidden="true">🏥</span>
          )}
          <span>{hospitalName}</span>
        </a>
        <div class="nav-links" id="nav-menu" role="menubar">
          <a href={`${basePath}/doctors`} role="menuitem">{lang === 'bn' ? 'ডাক্তার' : 'Doctors'}</a>
          <a href={`${basePath}/services`} role="menuitem">{lang === 'bn' ? 'সেবা' : 'Services'}</a>
          <a href={`${basePath}/about`} role="menuitem">{lang === 'bn' ? 'সম্পর্কে' : 'About'}</a>
          <a href={`${basePath}/contact`} role="menuitem">{lang === 'bn' ? 'যোগাযোগ' : 'Contact'}</a>
          <a href={`${basePath}/departments`} role="menuitem">{lang === 'bn' ? 'বিভাগ' : 'Departments'}</a>
          <a href={`${basePath}/blog`} role="menuitem">{lang === 'bn' ? 'ব্লগ' : 'Blog'}</a>
          <a class="lang-switch" href={`${basePath}?lang=${lang === 'bn' ? 'en' : 'bn'}`}
            style="font-size:0.85rem;opacity:0.7;border:1px solid currentColor;padding:0.25rem 0.5rem;border-radius:4px"
            aria-label={lang === 'bn' ? 'Switch to English' : 'বাংলায় দেখুন'}>
            {lang === 'bn' ? 'EN' : 'বাং'}
          </a>
          <a
            href={staffLoginPath}
            class="btn btn-outline nav-hospital-login"
            style="padding:0.5rem 1.1rem;font-size:0.9rem"
          >
            {lang === 'bn' ? 'হাসপাতাল লগইন' : 'Hospital Login'}
          </a>
          <a
            href="/patient/login"
            class="btn btn-primary nav-patient-login nav-patient-login-desktop"
            style="padding:0.5rem 1.25rem;font-size:0.9rem"
          >
            {lang === 'bn' ? 'পেশেন্ট পোর্টাল →' : 'Patient Portal →'}
          </a>
        </div>
        <a
          href={staffLoginPath}
          class="btn btn-outline nav-hospital-login nav-hospital-login-mobile"
          style="padding:0.45rem 0.9rem;font-size:0.85rem"
        >
          {lang === 'bn' ? 'হাসপাতাল লগইন' : 'Hospital Login'}
        </a>
        <button class="nav-mobile-toggle" aria-label={lang === 'bn' ? 'মেনু খুলুন' : 'Toggle menu'}
          aria-expanded="false" aria-controls="nav-menu">☰</button>
      </div>
    </nav>
  </header>
  );
};
