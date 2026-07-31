/**
 * Sunrise — Orange + Warm theme
 * Ideal for: Women & children hospitals, maternity centres
 */
export function getSunriseCSS(overrides?: { primary?: string; secondary?: string }): string {
  const primary = overrides?.primary || '#ea580c';
  const secondary = overrides?.secondary || '#db2777';

  return `
:root {
  --color-primary: ${primary};
  --color-secondary: ${secondary};
  --color-bg: #fffbf5;
  --color-bg-alt: #fff7ed;
  --color-surface: #ffffff;
  --color-text: #431407;
  --color-text-secondary: #9a3412;
  --color-border: #fed7aa;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 16px rgba(234,88,12,0.1);
  --shadow-lg: 0 8px 32px rgba(234,88,12,0.14);
  --radius: 1rem;
}
body { background: var(--color-bg); color: var(--color-text); }
.navbar { background: rgba(255,251,245,0.95); border-bottom-color: var(--color-border); }
.nav-brand { color: var(--color-primary); }
.nav-links a { color: var(--color-text); }
.nav-links a:hover { color: var(--color-primary); }
.hero { background: linear-gradient(135deg, #fff7ed 0%, #fce7f3 100%); }
.hero h1 { background: linear-gradient(135deg, ${primary} 0%, ${secondary} 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.btn-primary { background: linear-gradient(135deg, ${primary}, ${secondary}); color: #fff; box-shadow: 0 4px 14px rgba(234,88,12,0.25); }
.btn-primary:hover { box-shadow: 0 6px 20px rgba(234,88,12,0.35); }
.btn-outline { color: var(--color-primary); border-color: var(--color-primary); }
.btn-outline:hover { background: var(--color-primary); color: #fff; }
.card { background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm); }
.card:hover { box-shadow: var(--shadow-md); border-color: var(--color-primary); }
.section-alt { background: var(--color-bg-alt); }
.section-title { color: var(--color-text); }
.section-subtitle { color: var(--color-text-secondary); }
.doctor-card .doctor-specialty { color: var(--color-primary); }
.doctor-card .doctor-fee { color: var(--color-secondary); font-weight: 700; }
.badge { background: #fef3c7; color: #92400e; }
.footer { background: #431407; color: #fed7aa; border-top-color: transparent; }
.footer a { color: #fb923c; }
.footer a:hover { color: #fff; }
.footer-bottom { border-top-color: rgba(255,255,255,0.1); color: #9a3412; }
`;
}
