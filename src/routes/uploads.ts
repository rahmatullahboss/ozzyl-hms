import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { getUploadObjectForResponse, isPublicUploadKey, normalizeUploadKey } from '../lib/upload-objects';

const uploadRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

uploadRoutes.get('/:key{.+}', async (c) => {
  const key = normalizeUploadKey(c.req.param('key'));
  if (!key || !isPublicUploadKey(key)) return c.notFound();

  const object = await getUploadObjectForResponse(c.env, key);
  if (!object) return c.notFound();

  const headers = new Headers();
  headers.set('Content-Type', object.contentType ?? 'application/octet-stream');
  headers.set('Cache-Control', c.env.ENVIRONMENT === 'local_server'
    ? 'private, max-age=3600'
    : 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
});

export default uploadRoutes;
