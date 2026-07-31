/**
 * Test helpers for accessibility (a11y) testing.
 *
 * Wraps axe-core + vitest-axe so widget tests can assert
 * "no WCAG 2.1 AA violations" with a single call.
 */
import { render, RenderOptions } from '@testing-library/react';
import { configureAxe } from 'vitest-axe';
import type { ReactElement } from 'react';

const configuredAxe = configureAxe({
  rules: {
    // Color contrast can't be measured in jsdom (no color rendering).
    'color-contrast': { enabled: false },
    // Disable region rule — single-widget renders don't have a landmark.
    'region': { enabled: false },
  },
});

/**
 * Renders a component for accessibility testing.
 * Returns the same RenderResult so callers can pass `container` to runAxe().
 */
export function renderForA11y(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'queries'>,
) {
  return render(ui, options);
}

/**
 * Runs axe-core against an already-rendered DOM container.
 *
 *   import { runAxe } from '../../test/a11y-helpers';
 *   it('is accessible', async () => {
 *     const { container } = render(<MyWidget />);
 *     const results = await runAxe(container);
 *     expect(results).toHaveNoViolations();
 *   });
 */
export async function runAxe(container: HTMLElement) {
  return configuredAxe(container);
}
