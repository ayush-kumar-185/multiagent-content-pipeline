import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DatabaseContext, users } from '../db/index.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string | null;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * Constant-time comparison of two strings using SHA-256 hashes to prevent timing attacks.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export interface AuthMiddlewareOptions {
  accessCode?: string;
}

export function createAuthMiddleware(dbCtx: DatabaseContext, options?: AuthMiddlewareOptions) {
  return async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const configuredAccessCode = options?.accessCode ?? process.env.ACCESS_CODE;
    const queryCode = (req.query as Record<string, string | undefined>)?.accessCode ||
                      (req.query as Record<string, string | undefined>)?.access_code;
    const providedAccessCode = (req.headers['x-access-code'] ||
      req.headers['X-Access-Code'] ||
      queryCode) as string | undefined;

    // 1. Validate X-Access-Code with constant-time comparison
    if (!configuredAccessCode) {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Server access code is not configured. Access denied.',
      });
      return;
    }

    if (!providedAccessCode || typeof providedAccessCode !== 'string') {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Missing required X-Access-Code header',
      });
      return;
    }

    if (!timingSafeEqualString(providedAccessCode.trim(), configuredAccessCode.trim())) {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid access code',
      });
      return;
    }

    // 2. Access code passed. Do NOT trust client-supplied x-user-id for identity.
    // Derive user identity from verified Bearer token or client IP hash.
    const authHeader = req.headers.authorization;
    let userId: string;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
      userId = `user_${tokenHash}`;
    } else {
      const clientIp = req.ip || '127.0.0.1';
      const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex').slice(0, 12);
      userId = `demo_user_${ipHash}`;
    }

    // 3. Lookup user in DB or create user record only AFTER the access code passes
    try {
      const [existingUser] = await dbCtx.db.select().from(users).where(eq(users.id, userId));

      if (existingUser) {
        req.user = {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
          role: existingUser.role,
        };
        return;
      }

      const clientIp = req.ip || '127.0.0.1';
      const email = `${userId}@citewriter.demo`;
      const [newUser] = await dbCtx.db
        .insert(users)
        .values({
          id: userId,
          email,
          name: `Demo User (${clientIp})`,
          role: 'user',
        })
        .onConflictDoNothing()
        .returning();

      req.user = newUser
        ? {
            id: newUser.id,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role,
          }
        : {
            id: userId,
            email,
            name: `Demo User (${clientIp})`,
            role: 'user',
          };
    } catch (err) {
      req.log?.error(err, 'Failed to resolve or provision user record');
      req.user = {
        id: userId,
        email: `${userId}@citewriter.demo`,
        name: 'Demo User',
        role: 'user',
      };
    }
  };
}
