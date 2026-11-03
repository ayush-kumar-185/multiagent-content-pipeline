import { FastifyRequest, FastifyReply } from 'fastify';
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

export function createAuthMiddleware(dbCtx: DatabaseContext) {
  return async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const authHeader = req.headers.authorization;
    const devUserId = req.headers['x-user-id'] as string | undefined;

    let userId: string | null = null;

    if (devUserId) {
      userId = devUserId;
    } else if (authHeader?.startsWith('Bearer ')) {
      // In production / with Auth.js, tokens can be session tokens or JWTs
      // For now, extract token as user ID or bearer identity
      userId = authHeader.slice(7).trim();
    }

    if (!userId) {
      reply.status(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid authentication credentials (Bearer token or x-user-id)',
      });
      return;
    }

    // Lookup user in DB
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

    // Auto-provision demo/dev user if in test or dev environment
    if (process.env.NODE_ENV !== 'production') {
      const email = `${userId}@citewriter.local`;
      const [newUser] = await dbCtx.db
        .insert(users)
        .values({
          id: userId,
          email,
          name: `User ${userId}`,
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
            name: `User ${userId}`,
            role: 'user',
          };
      return;
    }

    reply.status(401).send({
      error: 'Unauthorized',
      message: 'User does not exist',
    });
  };
}
