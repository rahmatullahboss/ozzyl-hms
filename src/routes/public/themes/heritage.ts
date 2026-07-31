/**
 * Heritage — Traditional Maroon + Cream theme
 * Ideal for: Government hospitals, established institutions
 */
export function getHeritageCSS(overrides?: { primary?: string; secondary?: string }): string {
  const primary = overrides?.primary || '#7c2d12';
  const secondary = overrides?.secondary || '#b45309';

  return `
:root {
  --color-primary: ${primary};
  --color-secondary: ${secondary};
  --color-bg: #fefce8;
  --color-bg-alt: #fef9c3;
  --color-surface: #fffef5;
  --color-text: #422006;
  --color-text-secondary: #92400e;
  --color-border: #fde68a;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 16px rgba(124,45,18,0.08);
  --shadow-lg: 0 8px 32px rgba(124,45,18,0.12);
  --radius: 0.5rem;
}
body { background: var(--color-bg); color: var(--color-text); }
.navbar { background: rgba(254,252,232,0.95); border-bottom-color: var(--color-border); }
.nav-brand { color: var(--color-primary); }
.nav-links a { color: var(--color-text); }
.nav-links a:hover { color: var(--color-primary); }
.hero { background: linear-gradient(135deg, ${primary} 0%, #991b1b 100%); color: #fff; }
.hero h1 { color: #fff; -webkit-text-fill-color: #fff; }
.hero p { color: rgba(255,255,255,0.85); }
.btn-primary { background: ${secondary}; color: #fff; box-shadow: 0 4px 14px rgba(180,83,9,0.25); }
.btn-primary:hover { box-shadow: 0 6px 20px rgba(180,83,9,0.35); }
.btn-outline { color: #fff; border-color: rgba(255,255,255,0.5); }
.btn-outline:hover { background: rgba(255,255,255,0.15); }
.card { background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm); }
.card:hover { box-shadow: var(--shadow-md); border-color: var(--color-secondary); }
.section-alt { background: var(--color-bg-alt); }
.section-title { color: var(--color-text); }
.section-subtitle { color: var(--color-text-secondary); }
.doctor-card .doctor-specialty { color: var(--color-primary); }
.doctor-card .doctor-fee { color: var(--color-secondary); font-weight: 700; }
.badge { background: #fef3c7; color: #78350f; }
.footer { background: ${primary}; color: #fde68a; border-top-color: transparent; }
.footer a { color: #fbbf24; }
.footer a:hover { color: #fff; }
.footer-bottom { border-top-color: rgba(255,255,255,0.1); color: #d97706; }
`;
}
