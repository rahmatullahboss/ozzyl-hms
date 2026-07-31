/**
 * Minimal — Black + White, clean typography
 * Ideal for: Modern private clinics, aesthetic practices
 */
export function getMinimalCSS(overrides?: { primary?: string; secondary?: string }): string {
  const primary = overrides?.primary || '#171717';
  const secondary = overrides?.secondary || '#525252';

  return `
:root {
  --color-primary: ${primary};
  --color-secondary: ${secondary};
  --color-bg: #ffffff;
  --color-bg-alt: #fafafa;
  --color-surface: #ffffff;
  --color-text: #171717;
  --color-text-secondary: #737373;
  --color-border: #e5e5e5;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.06);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.08);
  --radius: 0.75rem;
}
body { background: var(--color-bg); color: var(--color-text); }
.navbar { background: rgba(255,255,255,0.96); border-bottom: 1px solid var(--color-border); }
.nav-brand { color: var(--color-text); }
.hero { background: #fafafa; border-bottom: 1px solid var(--color-border); }
.hero h1 { color: var(--color-text); letter-spacing: -0.02em; }
.btn-primary { background: var(--color-primary); color: #fff; border-radius: 0.5rem; }
.btn-primary:hover { background: #404040; }
.btn-outline { color: var(--color-primary); border-color: var(--color-border); border-radius: 0.5rem; }
.btn-outline:hover { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.card { background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: none; border-radius: var(--radius); }
.card:hover { box-shadow: var(--shadow-md); }
.section-alt { background: var(--color-bg-alt); }
.doctor-card .doctor-specialty { color: var(--color-secondary); }
.doctor-card .doctor-fee { color: var(--color-primary); }
.badge { background: #f5f5f5; color: #525252; }
.footer { background: #171717; color: #a3a3a3; }
.footer a { color: #d4d4d4; }
.footer a:hover { color: #fff; }
.footer-bottom { border-top-color: rgba(255,255,255,0.08); color: #737373; }
`;
}
