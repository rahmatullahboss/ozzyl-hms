/**
 * Base CSS shared across all hospital website themes.
 * Provides reset, layout utilities, typography, and responsive grid.
 */
export const baseCSS = `
/* ─── Reset ──────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px;scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{line-height:1.6;-webkit-font-smoothing:antialiased}
img,svg{display:block;max-width:100%}
a{text-decoration:none;color:inherit}
ul,ol{list-style:none}

/* ─── Typography ─────────────────────────────────────── */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap');
body{font-family:'Inter','Noto Sans Bengali',system-ui,-apple-system,sans-serif}

/* ─── Layout ─────────────────────────────────────────── */
.container{width:100%;max-width:1200px;margin:0 auto;padding:0 1.5rem}
.section{padding:4rem 0}
.section-title{font-size:2rem;font-weight:700;margin-bottom:0.5rem}
.section-subtitle{font-size:1.125rem;opacity:0.7;margin-bottom:2.5rem}
.text-center{text-align:center}

/* ─── Grid ───────────────────────────────────────────── */
.grid{display:grid;gap:1.5rem}
.grid-2{grid-template-columns:repeat(2,1fr)}
.grid-3{grid-template-columns:repeat(3,1fr)}
.grid-4{grid-template-columns:repeat(4,1fr)}
@media(max-width:768px){
  .grid-2,.grid-3,.grid-4{grid-template-columns:1fr}
}
@media(min-width:769px) and (max-width:1024px){
  .grid-3,.grid-4{grid-template-columns:repeat(2,1fr)}
}

/* ─── Flex ───────────────────────────────────────────── */
.flex{display:flex}.flex-col{flex-direction:column}
.items-center{align-items:center}.justify-between{justify-content:space-between}
.gap-1{gap:0.5rem}.gap-2{gap:1rem}.gap-3{gap:1.5rem}

/* ─── Cards ──────────────────────────────────────────── */
.card{border-radius:1rem;overflow:hidden;transition:transform 0.2s,box-shadow 0.2s}
.card:hover{transform:translateY(-4px)}
.doctor-card{cursor:default}
.doctor-card:hover{transform:none;box-shadow:none}
.card-body{padding:1.5rem}

/* ─── Buttons ────────────────────────────────────────── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;
  padding:0.75rem 1.75rem;border-radius:0.75rem;font-weight:600;font-size:1rem;
  border:none;cursor:pointer;transition:all 0.2s}
.btn:hover{transform:translateY(-1px)}
.btn-outline{background:transparent;border:2px solid currentColor}

/* ─── Badge ──────────────────────────────────────────── */
.badge{display:inline-block;padding:0.25rem 0.75rem;border-radius:99px;
  font-size:0.8rem;font-weight:500}

/* ─── Emergency Bar ─────────────────────────────────── */
.emergency-bar{background:#dc2626;color:#fff;padding:0.4rem 0;font-weight:600;text-align:center}
.emergency-bar a{color:#fff;font-weight:700;text-decoration:underline}
.emergency-bar a:hover{opacity:0.9}

/* ─── Navbar ─────────────────────────────────────────── */
.navbar{position:sticky;top:0;z-index:100;backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);padding:0.75rem 0;
  border-bottom:1px solid rgba(255,255,255,0.08)}
.navbar .container{display:flex;align-items:center;justify-content:space-between}
.nav-brand{font-size:1.25rem;font-weight:700;display:flex;align-items:center;gap:0.5rem}
.nav-brand img{width:36px;height:36px;border-radius:8px;object-fit:cover}
.nav-links{display:flex;gap:1.5rem;align-items:center}
.nav-links a{font-size:0.95rem;font-weight:500;opacity:0.8;transition:opacity 0.2s}
.nav-links a:hover{opacity:1}
.nav-patient-login{opacity:1!important}
.nav-hospital-login{opacity:1!important}
.nav-patient-login-mobile{display:none;white-space:nowrap}
.nav-hospital-login-mobile{display:none;white-space:nowrap}
@media(max-width:768px){
  .nav-links{display:none;position:absolute;top:100%;left:0;right:0;
    flex-direction:column;padding:1rem;gap:0.75rem;background:inherit;
    border-bottom:1px solid rgba(255,255,255,0.08);
    transition:opacity 0.3s ease,transform 0.3s ease}
  .nav-links.nav-open{display:flex;animation:navSlideDown 0.3s ease}
  .nav-patient-login-desktop{display:none}
  .nav-patient-login-mobile{display:none}
  .nav-hospital-login-mobile{display:inline-flex;flex-shrink:0}
  .nav-mobile-toggle{display:block;background:none;border:none;cursor:pointer;
    font-size:1.5rem;color:inherit}
  .navbar{position:relative}
}
@media(min-width:769px){
  .nav-patient-login-mobile{display:none}
  .nav-hospital-login-mobile{display:none}
  .nav-mobile-toggle{display:none}
}

/* ─── Hero ───────────────────────────────────────────── */
.hero{padding:5rem 0 4rem;text-align:center}
.hero h1{font-size:2.75rem;font-weight:800;line-height:1.2;margin-bottom:1rem}
.hero p{font-size:1.2rem;opacity:0.8;max-width:640px;margin:0 auto 2rem}
.hero-cta{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap}
@media(max-width:768px){
  .hero h1{font-size:2rem}
  .hero p{font-size:1rem}
}

/* ─── Footer ─────────────────────────────────────────── */
.footer{padding:3rem 0 2rem;border-top:1px solid rgba(255,255,255,0.08)}
.footer-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:2rem}
.footer-brand h3{font-size:1.125rem;font-weight:700;margin-bottom:0.5rem}
.footer-brand p{font-size:0.9rem;opacity:0.6;line-height:1.6}
.footer-links h4{font-size:0.9rem;font-weight:600;margin-bottom:1rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.5}
.footer-links a{display:block;font-size:0.9rem;opacity:0.7;padding:0.25rem 0;transition:opacity 0.2s}
.footer-links a:hover{opacity:1}
.footer-bottom{margin-top:2rem;padding-top:1.5rem;border-top:1px solid rgba(255,255,255,0.06);
  text-align:center;font-size:0.8rem;opacity:0.4}
@media(max-width:768px){
  .footer-grid{grid-template-columns:1fr}
}

/* ─── Skip to Content (Accessibility) ───────────────── */
.skip-link{position:absolute;top:-100%;left:1rem;z-index:9999;
  padding:0.75rem 1.5rem;background:var(--color-primary,#0891b2);color:#fff;
  font-weight:600;font-size:0.9rem;border-radius:0 0 0.5rem 0.5rem;
  transition:top 0.2s ease}
.skip-link:focus{top:0}

/* ─── Focus Visible (Accessibility) ─────────────────── */
:focus-visible{outline:3px solid var(--color-primary,#0891b2);outline-offset:2px;border-radius:4px}
a:focus-visible,button:focus-visible,.btn:focus-visible,.card:focus-visible{
  outline:3px solid var(--color-primary,#0891b2);outline-offset:2px}

/* ─── Reduced Motion ────────────────────────────────── */
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;
    transition-duration:0.01ms!important;scroll-behavior:auto!important}
  .card:hover{transform:none}
  .btn:hover{transform:none}
}

/* ─── Utilities ──────────────────────────────────────── */
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ─── Animations ─────────────────────────────────────── */
@keyframes navSlideDown{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
`;
