/**
 * Oceanic — Deep Blue theme
 * Ideal for: Multi-specialty hospitals, research institutions
 */
export function getOceanicCSS(overrides?: { primary?: string; secondary?: string }): string {
  const primary = overrides?.primary || '#1d4ed8';
  const secondary = overrides?.secondary || '#06b6d4';

  return `
:root {
  --color-primary: ${primary};
  --color-secondary: ${secondary};
  --color-bg: #f8faff;
  --color-bg-alt: #eff6ff;
  --color-surface: #ffffff;
  --color-text: #1e293b;
  --color-text-secondary: #3b82f6;
  --color-border: #bfdbfe;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 16px rgba(29,78,216,0.1);
  --shadow-lg: 0 8px 32px rgba(29,78,216,0.14);
  --radius: 0.875rem;
}
body { background: var(--color-bg); color: var(--color-text); }
.navbar { background: rgba(248,250,255,0.95); border-bottom-color: var(--color-border); }
.nav-brand { color: var(--color-primary); }
.nav-links a { color: var(--color-text); }
.nav-links a:hover { color: var(--color-primary); }
.hero { background: linear-gradient(135deg, ${primary} 0%, #0e7490 100%); color: #fff; }
.hero h1 { color: #fff; -webkit-text-fill-color: #fff; }
.hero p { color: rgba(255,255,255,0.85); }
.btn-primary { background: linear-gradient(135deg, ${secondary}, ${primary}); color: #fff; box-shadow: 0 4px 14px rgba(29,78,216,0.25); }
.btn-primary:hover { box-shadow: 0 6px 20px rgba(29,78,216,0.35); }
.btn-outline { color: #fff; border-color: rgba(255,255,255,0.5); }
.btn-outline:hover { background: rgba(255,255,255,0.15); }
.card { background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm); }
.card:hover { box-shadow: var(--shadow-md); border-color: var(--color-primary); }
.section-alt { background: var(--color-bg-alt); }
.section-title { color: var(--color-text); }
.section-subtitle { color: var(--color-text-secondary); }
.doctor-card .doctor-specialty { color: var(--color-primary); }
.doctor-card .doctor-fee { color: var(--color-secondary); font-weight: 700; }
.badge { background: #dbeafe; color: #1e40af; }
.footer { background: #0f172a; color: #94a3b8; border-top-color: transparent; }
.footer a { color: ${secondary}; }
.footer a:hover { color: #fff; }
.footer-bottom { border-top-color: rgba(255,255,255,0.06); color: #475569; }
`;
}
