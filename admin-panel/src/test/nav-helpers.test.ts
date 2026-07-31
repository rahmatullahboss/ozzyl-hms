import { describe, it, expect } from 'vitest';
import { isNavItemActive } from '../components/nav-helpers';

describe('isNavItemActive', () => {
  it('matches exact paths', () => {
    expect(isNavItemActive('/hospitals', '/hospitals')).toBe(true);
  });

  it('matches a child path under the nav item', () => {
    expect(isNavItemActive('/hospitals', '/hospitals/123')).toBe(true);
  });

  it('does not match other paths for the dashboard root', () => {
    expect(isNavItemActive('/', '/hospitals')).toBe(false);
    expect(isNavItemActive('/', '/users')).toBe(false);
  });

  it('does not falsely match a sibling path', () => {
    expect(isNavItemActive('/hospitals', '/hospitals-fake')).toBe(false);
    expect(isNavItemActive('/hospitals', '/users')).toBe(false);
  });

  it('treats empty / as the dashboard and matches only exact / for the dashboard nav item', () => {
    // '/' matches everything (handled above), so only navPath='/' should match '/hospitals'.
    expect(isNavItemActive('/', '/')).toBe(true);
  });
});
