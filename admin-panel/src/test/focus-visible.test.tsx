import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

function TestButton() {
  return <button className="btn-test">Focus me</button>;
}

describe('Global focus-visible styles', () => {
  it('exposes a focus-visible CSS rule targeting buttons and links', () => {
    // Smoke-test the presence of the rule by reading the stylesheet.
    // We can't import a CSS file in jsdom, so we assert the rule text exists in
    // the source file instead.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const css = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline:\s*2px solid/);
  });

  it('renders a focusable button', () => {
    render(<TestButton />);
    const btn = screen.getByRole('button', { name: /focus me/i });
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });
});
