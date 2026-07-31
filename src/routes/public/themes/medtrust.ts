/**
 * MedTrust — Navy + Gold theme
 * Ideal for: Established hospitals, medical centres
 */
export function getMedtrustCSS(overrides?: { primary?: string; secondary?: string }): string {
  const primary = overrides?.primary || '#1e3a5f';
  const secondary = overrides?.secondary || '#d4a024';

  return `
:root {
  --color-primary: ${primary};
  --color-secondary: ${secondary};
  --color-bg: #fafbfd;
  --color-bg-alt: #f0f4f8;
  --color-surface: #ffffff;
  --color-text: #1a2332;
  --color-text-secondary: #64748b;
  --color-border: #e2e8f0;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 16px rgba(30,58,95,0.1);
  --shadow-lg: 0 8px 32px rgba(30,58,95,0.15);
  --radius: 0.75rem;
}
body { background: var(--color-bg); color: var(--color-text); }
.navbar { background: rgba(255,255,255,0.95); border-bottom-color: var(--color-border); }
.nav-brand { color: var(--color-primary); }
.hero { background: linear-gradient(135deg, ${primary} 0%, #2d5a8e 100%); color: #fff; }
.hero h1 { color: #fff; -webkit-text-fill-color: #fff; }
.hero p { color: rgba(255,255,255,0.85); }
.btn-primary { background: ${secondary}; color: #1a2332; font-weight: 700; box-shadow: 0 4px 14px rgba(212,160,36,0.3); }
.btn-primary:hover { box-shadow: 0 6px 20px rgba(212,160,36,0.45); }
.btn-outline { color: #fff; border-color: rgba(255,255,255,0.5); }
.btn-outline:hover { background: rgba(255,255,255,0.15); }
.card { background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm); }
.card:hover { box-shadow: var(--shadow-md); border-color: var(--color-secondary); }
.section-alt { background: var(--color-bg-alt); }
.doctor-card .doctor-specialty { color: var(--color-primary); }
.doctor-card .doctor-fee { color: var(--color-secondary); }
.badge { background: #fef3c7; color: #92400e; }
.footer { background: ${primary}; color: #e2e8f0; }
.footer a { color: ${secondary}; }
.footer a:hover { color: #fff; }
.footer-bottom { border-top-color: rgba(255,255,255,0.1); color: #94a3b8; }
`;
}
