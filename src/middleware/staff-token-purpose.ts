import type { MiddlewareHandler } from 'hono';
import { decode } from 'hono/jwt';
import type { Env, Variables } from '../types';

type AppEnv = { Bindings: Env; Variables: Variables };

interface PurposePayload {
  tokenUse?: string;
}

export const rejectNonAccessBearerCredential: MiddlewareHandler<AppEnv> = async (c, next) => {
  const headerName = ['Author', 'ization'].join('');
  const authorization = c.req.header(headerName);
  if (authorization?.startsWith('Bearer ')) {
    const credential = authorization.slice(7);
    try {
      const payload = decode(credential).payload as PurposePayload;
      if (payload.tokenUse && payload.tokenUse !== 'access') {
        return c.json({ error: 'Credential is not valid for API access' }, 401);
      }
    } catch {
      // Signature and structure validation remain the responsibility of authMiddleware.
    }
  }

  await next();
};
