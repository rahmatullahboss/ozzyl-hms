import { Hono } from 'hono';
import type { Env } from '../../types';

const healthArticlesRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /api/v1/public/health-articles
 * Public endpoint — no auth required
 * Query params: category, limit, offset
 */
healthArticlesRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const category = c.req.query('category');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  let query = `
    SELECT id, title, summary, content, category, image_url, published_at, read_time_min
    FROM health_articles
    WHERE is_published = 1
  `;
  const params: any[] = [];

  if (category && category !== 'all') {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY published_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.prepare(query).bind(...params).all();

  // Get total count for pagination
  let countQuery = 'SELECT COUNT(*) as total FROM health_articles WHERE is_published = 1';
  const countParams: any[] = [];
  if (category && category !== 'all') {
    countQuery += ' AND category = ?';
    countParams.push(category);
  }
  const countRow = await db.prepare(countQuery).bind(...countParams).first<{ total: number }>();

  return c.json({
    articles: results || [],
    total: countRow?.total ?? 0,
    limit,
    offset,
  });
});

/**
 * GET /api/v1/public/health-articles/:id
 * Public endpoint — no auth required
 */
healthArticlesRoutes.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'), 10);

  if (isNaN(id)) {
    return c.json({ error: 'Invalid article ID' }, 400);
  }

  const article = await db.prepare(
    'SELECT id, title, summary, content, category, image_url, published_at, read_time_min FROM health_articles WHERE id = ? AND is_published = 1'
  ).bind(id).first();

  if (!article) {
    return c.json({ error: 'Article not found' }, 404);
  }

  return c.json({ article });
});

/**
 * GET /api/v1/public/health-articles/categories
 * List all available categories
 */
healthArticlesRoutes.get('/categories', async (c) => {
  const db = c.env.DB;

  const { results } = await db.prepare(
    'SELECT DISTINCT category FROM health_articles WHERE is_published = 1 ORDER BY category'
  ).all();

  const categories = (results || []).map((r: any) => r.category);

  return c.json({ categories });
});

export default healthArticlesRoutes;
