import { describe, it, expect } from 'vitest';
import { parsePagination } from '../../src/utils/pagination';

describe('parsePagination', () => {
  it('should use default values when no queries are provided', () => {
    const mockContext = {
      req: {
        query: () => undefined,
      },
    };

    const result = parsePagination(mockContext as any);

    expect(result).toEqual({
      page: 1,
      limit: 20,
      offset: 0,
    });
  });

  it('should parse valid page and limit values', () => {
    const mockContext = {
      req: {
        query: (key: string) => {
          if (key === 'page') return '3';
          if (key === 'limit') return '15';
          return undefined;
        },
      },
    };

    const result = parsePagination(mockContext as any);

    expect(result).toEqual({
      page: 3,
      limit: 15,
      offset: 30, // (3 - 1) * 15
    });
  });

  it('should clamp page and limit to minimums if negative or zero', () => {
    const mockContext = {
      req: {
        query: (key: string) => {
          if (key === 'page') return '0';
          if (key === 'limit') return '-5';
          return undefined;
        },
      },
    };

    const result = parsePagination(mockContext as any);

    expect(result).toEqual({
      page: 1,
      limit: 1,
      offset: 0, // (1 - 1) * 1
    });
  });

  it('should clamp limit to maximum of 100', () => {
    const mockContext = {
      req: {
        query: (key: string) => {
          if (key === 'page') return '2';
          if (key === 'limit') return '500';
          return undefined;
        },
      },
    };

    const result = parsePagination(mockContext as any);

    expect(result).toEqual({
      page: 2,
      limit: 100,
      offset: 100, // (2 - 1) * 100
    });
  });

  it('should fallback to defaults if string cannot be parsed as a number', () => {
    const mockContext = {
      req: {
        query: (key: string) => {
          if (key === 'page') return 'invalid';
          if (key === 'limit') return 'nan';
          return undefined;
        },
      },
    };

    const result = parsePagination(mockContext as any);

    expect(result).toEqual({
      page: 1,
      limit: 20,
      offset: 0,
    });
  });
});
