import type { Env } from '../types';

export type UploadObjectForResponse = {
  body: BodyInit | null;
  contentType: string | null;
};

export function normalizeUploadKey(rawKey: string): string | null {
  const key = decodeURIComponent(rawKey).trim().replace(/^\/+/, '');
  if (!key || key.includes('..') || key.includes('\\') || key.length > 500) return null;
  return key;
}

export function isPublicUploadKey(key: string): boolean {
  return /^\d+\/hospital-logo$/.test(key) || /^\d+\/website\/(?:hero|gallery|blog)\/[^/]+$/.test(key);
}

export async function getUploadObjectForResponse(env: Env, key: string): Promise<UploadObjectForResponse | null> {
  const localObject = await env.UPLOADS.get(key);
  if (localObject) {
    return {
      body: localObject.body,
      contentType: localObject.httpMetadata?.contentType ?? null,
    };
  }

  if (env.ENVIRONMENT !== 'local_server') return null;
  const cloudBaseUrl = env.CLOUD_SYNC_BASE_URL?.trim().replace(/\/+$/, '');
  const token = env.CLOUD_SYNC_TOKEN?.trim();
  if (!cloudBaseUrl || !token) return null;

  const response = await fetch(`${cloudBaseUrl}/api/sync/uploads?key=${encodeURIComponent(key)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: '*/*',
    },
  }).catch(() => null);
  if (!response?.ok) return null;

  const contentType = response.headers.get('Content-Type');
  const buffer = await response.arrayBuffer();
  await env.UPLOADS.put(key, buffer, {
    httpMetadata: contentType ? { contentType } : undefined,
  });

  return {
    body: buffer,
    contentType,
  };
}
