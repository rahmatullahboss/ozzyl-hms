/**
 * Nature — Earth tones, warm greens + browns
 * Ideal for: Ayurvedic centers, alternative medicine, wellness clinics
 */
export function getNatureCSS(overrides?: { primary?: string; secondary?: string }): string {
  const primary = overrides?.primary || '#4d7c0f';
  const secondary = overrides?.secondary || '#92400e';

  return `
:root {
  --color-primary: ${primary};
  --color-secondary: ${secondary};
  --color-bg: #fefdf8;
  --color-bg-alt: #f5f0e8;
  --color-surface: #fffef9;
  --color-text: #292524;
  --color-text-secondary: #78716c;
  --color-border: #e7e0d5;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 16px rgba(77,124,15,0.08);
  --shadow-lg: 0 8px 32px rgba(77,124,15,0.12);
  --radius: 1rem;
}
body { background: var(--color-bg); color: var(--color-text); }
.navbar { background: rgba(254,253,248,0.94); border-bottom-color: var(--color-border); }
.nav-brand { color: var(--color-primary); }
.hero { background: linear-gradient(160deg, #f5f0e8 0%, #ecfccb 50%, #fefdf8 100%); }
.hero h1 { color: #365314; }
.btn-primary { background: var(--color-primary); color: #fff; border-radius: 99px; box-shadow: 0 4px 14px rgba(77,124,15,0.2); }
.btn-primary:hover { box-shadow: 0 6px 20px rgba(77,124,15,0.3); }
.btn-outline { color: var(--color-primary); border-color: var(--color-primary); border-radius: 99px; }
.btn-outline:hover { background: var(--color-primary); color: #fff; }
.card { background: var(--color-surface); border: 1px solid var(--color-border); box-shadow: var(--shadow-sm); border-radius: var(--radius); }
.card:hover { box-shadow: var(--shadow-md); }
.section-alt { background: var(--color-bg-alt); }
.doctor-card .doctor-specialty { color: var(--color-primary); }
.doctor-card .doctor-fee { color: var(--color-secondary); }
.badge { background: #fef3c7; color: #92400e; }
.footer { background: #1c1917; color: #d6d3d1; }
.footer a { color: #a3e635; }
.footer a:hover { color: #fff; }
.footer-bottom { border-top-color: rgba(255,255,255,0.08); color: #a8a29e; }
`;
}
