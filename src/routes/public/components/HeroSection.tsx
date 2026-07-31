/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';

interface HeroSectionProps {
  hospitalName: string;
  tagline?: string;
  taglineBn?: string;
  heroImageUrl?: string;
  basePath: string;
  subdomain?: string;
  lang?: string;
}

export const HeroSection: FC<HeroSectionProps> = ({ hospitalName, tagline, taglineBn, heroImageUrl, basePath, subdomain, lang }) => {
  const isBn = lang === 'bn';
  const staffLoginPath = '/login';
  const displayTagline = isBn
    ? (taglineBn || tagline || 'আপনার স্বাস্থ্যসেবার বিশ্বস্ত সঙ্গী — আধুনিক প্রযুক্তি, যত্নশীল সেবা')
    : (tagline || 'Your trusted healthcare partner — Modern technology, compassionate care');

  return (
    <main id="main-content" class="hero" role="main">
      {heroImageUrl && (
        <div class="hero-bg" style={`background-image:url(${heroImageUrl})`} aria-hidden="true" />
      )}
      <div class="container">
        <h1>{hospitalName}</h1>
        <p>{displayTagline}</p>
        <div class="hero-cta">
          <a href={`${basePath}/book`} class="btn btn-primary">
            {isBn ? '📅 অ্যাপয়েন্টমেন্ট বুক করুন' : '📅 Book Appointment'}
          </a>
          <a href={staffLoginPath} class="btn btn-outline">
            {isBn ? '🏥 হাসপাতাল লগইন' : '🏥 Hospital Login'}
          </a>
          <a href="/patient/login" class="btn btn-outline">
            {isBn ? '🔐 পেশেন্ট পোর্টাল' : '🔐 Patient Portal'}
          </a>
          <a href={`${basePath}/doctors`} class="btn btn-outline">
            {isBn ? '👨‍⚕️ আমাদের ডাক্তার' : '👨‍⚕️ Our Doctors'}
          </a>
        </div>
      </div>
    </main>
  );
};
