export function parsePagination(c: { req: { query: (key: string) => string | undefined } }): { page: number; limit: number; offset: number } {
  const rawPage = Number(c.req.query('page') ?? '1');
  const rawLimit = Number(c.req.query('limit') ?? '20');
  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);
  const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
  return { page, limit, offset: (page - 1) * limit };
}
