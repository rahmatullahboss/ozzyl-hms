/**
 * ArogyaSeva — Clean Teal + White theme
 * Ideal for: Modern clinics, diagnostic centres
 */
export function getArogyasevaCSS(overrides?: { primary?: string; secondary?: string }): string {
  const primary = overrides?.primary || '#0891b2';
  const secondary = overrides?.secondary || '#059669';

  return `
:root {
  --color-primary: ${primary};
  --color-secondary: ${secondary};
  --color-bg: #f8fffe;
  --color-bg-alt: #f0fdfa;
  --color-surface: #ffffff;
  --color-surface-hover: #f0fdfa;
  --color-text: #134e4a;
  --color-text-secondary: #5eead4;
  --color-border: #ccfbf1;
  --color-accent: ${primary};
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 16px rgba(8,145,178,0.08);
  --shadow-lg: 0 8px 32px rgba(8,145,178,0.12);
  --radius: 1rem;
}
body { background: var(--color-bg); color: var(--color-text); }
.navbar { background: rgba(255,255,255,0.92); border-bottom-color: var(--color-border); }
.nav-brand { color: var(--color-primary); }
.nav-links a { color: var(--color-text); }
.nav-links a:hover { color: var(--color-primary); }
.hero { background: linear-gradient(135deg, var(--color-bg-alt) 0%, var(--color-bg) 100%); }
.hero h1 { color: var(--color-text); background: linear-gradient(135deg, ${primary} 0%, ${secondary} 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.btn-primary { background: linear-gradient(135deg, ${primary}, ${secondary}); color: #fff; box-shadow: 0 4px 14px rgba(8,145,178,0.25); }
.btn-primary:hover { box-shadow: 0 6px 20px rgba(8,145,178,0.35); }
.btn-outline { color: var(--color-primary); border-color: var(--color-primary); }
.btn-outline:hover { background: var(--color-primary); color: #fff; }
.card { background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm); }
.card:hover { box-shadow: var(--shadow-md); border-color: var(--color-primary); }
.section-alt { background: var(--color-bg-alt); }
.section-title { color: var(--color-text); }
.section-subtitle { color: #5eead4; }
.doctor-card .doctor-specialty { color: var(--color-primary); font-weight: 600; }
.doctor-card .doctor-fee { color: var(--color-secondary); font-weight: 700; }
.badge { background: var(--color-bg-alt); color: var(--color-primary); }
.footer { background: #134e4a; color: #ccfbf1; border-top-color: transparent; }
.footer a { color: #5eead4; }
.footer a:hover { color: #fff; }
.footer-bottom { border-top-color: rgba(255,255,255,0.1); color: #5eead4; }
`;
}
