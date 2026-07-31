import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Touch-action + safe-area polish', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');

  it('sets touch-action: manipulation on body for faster taps', () => {
    expect(css).toMatch(/body[\s\S]*?touch-action:\s*manipulation/);
  });

  it('sets overscroll-behavior: contain on modal overlays to prevent scroll chaining', () => {
    // We test by source inspection because jsdom doesn't compute scroll.
    expect(css).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('includes safe-area-inset padding for notched devices', () => {
    expect(css).toMatch(/env\(safe-area-inset-/);
  });
});
