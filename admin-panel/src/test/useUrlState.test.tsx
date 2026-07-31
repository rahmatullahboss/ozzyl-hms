import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import useUrlState from '../hooks/useUrlState';

function renderWithRouter(initialPath: string) {
  return renderHook(() => useUrlState(), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>,
  });
}

describe('useUrlState', () => {
  beforeEach(() => {
    // JSDOM uses about:blank by default; force a controlled origin so useSearchParams
    // returns the same value that React Router parsed.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: new URL('http://localhost/'),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('reads existing page and search from the URL on mount', () => {
    const { result } = renderWithRouter('/hospitals?page=3&search=city');
    const [page, setPage, search, setSearch] = result.current;
    expect(page).toBe(3);
    expect(search).toBe('city');
    expect(typeof setPage).toBe('function');
    expect(typeof setSearch).toBe('function');
  });

  it('defaults page to 1 and search to empty string when params are missing', () => {
    const { result } = renderWithRouter('/hospitals');
    const [page, , search] = result.current;
    expect(page).toBe(1);
    expect(search).toBe('');
  });

  it('updates search state and resets page when search is set', () => {
    const { result } = renderWithRouter('/hospitals?page=2');
    act(() => result.current[3]('general'));
    const [page, , search] = result.current;
    expect(search).toBe('general');
    expect(page).toBe(1);
  });

  it('resets page to 1 when search is set after a non-first page', () => {
    const { result } = renderWithRouter('/hospitals?page=4');
    act(() => result.current[3]('clinic'));
    const [page, , search] = result.current;
    expect(search).toBe('clinic');
    expect(page).toBe(1);
  });

  it('keeps page when page is set explicitly', () => {
    const { result } = renderWithRouter('/hospitals?search=city');
    act(() => result.current[1](5));
    const [page, , search] = result.current;
    expect(page).toBe(5);
    expect(search).toBe('city');
  });

  it('clears search state when search is set to empty', () => {
    const { result } = renderWithRouter('/hospitals?page=2&search=city');
    act(() => result.current[3](''));
    const [, , search] = result.current;
    expect(search).toBe('');
  });
});
