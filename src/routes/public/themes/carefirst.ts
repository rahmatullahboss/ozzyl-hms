/**
 * CareFirst — Soft Green + Warm theme
 * Ideal for: Community clinics, rural health centres
 */
export function getCarefirstCSS(overrides?: { primary?: string; secondary?: string }): string {
  const primary = overrides?.primary || '#16a34a';
  const secondary = overrides?.secondary || '#ea580c';

  return `
:root {
  --color-primary: ${primary};
  --color-secondary: ${secondary};
  --color-bg: #fefefe;
  --color-bg-alt: #f0fdf4;
  --color-surface: #ffffff;
  --color-text: #1a2e1a;
  --color-text-secondary: #6b7280;
  --color-border: #dcfce7;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 16px rgba(22,163,74,0.1);
  --shadow-lg: 0 8px 32px rgba(22,163,74,0.14);
  --radius: 1.25rem;
}
body { background: var(--color-bg); color: var(--color-text); }
.navbar { background: rgba(255,255,255,0.92); border-bottom-color: var(--color-border); }
.nav-brand { color: var(--color-primary); }
.hero { background: linear-gradient(160deg, #f0fdf4 0%, #fefce8 100%); }
.hero h1 { color: var(--color-primary); }
.btn-primary { background: var(--color-primary); color: #fff; border-radius: 99px; box-shadow: 0 4px 14px rgba(22,163,74,0.25); }
.btn-primary:hover { box-shadow: 0 6px 20px rgba(22,163,74,0.35); }
.btn-outline { color: var(--color-primary); border-color: var(--color-primary); border-radius: 99px; }
.btn-outline:hover { background: var(--color-primary); color: #fff; }
.card { background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm); border-radius: var(--radius); }
.card:hover { box-shadow: var(--shadow-md); }
.section-alt { background: var(--color-bg-alt); }
.doctor-card .doctor-specialty { color: var(--color-primary); }
.doctor-card .doctor-fee { color: var(--color-secondary); }
.badge { background: #fef3c7; color: #b45309; }
.footer { background: #14532d; color: #dcfce7; }
.footer a { color: #86efac; }
.footer a:hover { color: #fff; }
.footer-bottom { border-top-color: rgba(255,255,255,0.1); color: #86efac; }
`;
}
