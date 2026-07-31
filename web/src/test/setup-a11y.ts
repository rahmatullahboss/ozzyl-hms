/**
 * Vitest setup file for accessibility (a11y) test infrastructure.
 * Imported via vitest.config.ts → setupFiles.
 *
 * Registers the toHaveNoViolations matcher so individual test files
 * don't need to import/extend it themselves.
 */
import { expect } from 'vitest';

// vitest-axe/matchers ships `toHaveNoViolations` as both a type alias and a
// runtime export, but the d.ts only re-exports the type. Force a value
// import via a single quoted-string name that won't be statically analyzed
// as a type-only path — and cast it for expect.extend's structural shape.
const modulePath = 'vitest-axe/matchers' as 'vitest-axe/matchers';
const matchers = (await import(/* @vite-ignore */ modulePath)) as unknown as { toHaveNoViolations: unknown };

expect.extend({ toHaveNoViolations: matchers.toHaveNoViolations as never });
