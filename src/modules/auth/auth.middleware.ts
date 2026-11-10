import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthUser } from "./auth.repository.js";
import type { AuthService } from "./auth.service.js";

declare module "fastify" {
  interface FastifyRequest {
    authenticatedUser: AuthUser | null;
  }
}

export const sessionCookieName = "studymate_session";

/**
 * Create a Fastify hook that validates the session cookie and attaches
 * the authenticated user to the request before protected routes run.
 */
export function createRequireAuthentication(
  authService: AuthService,
  sessionCookieName: string,
  cookieSecure: boolean,
) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const token = request.cookies[sessionCookieName];
    if (!token) {
      reply.code(401).send({
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required.",
          details: null,
        },
      });
      return;
    }

    const session = await authService.authenticate(token);
    if (!session) {
      reply.clearCookie(sessionCookieName, {
        path: "/",
        sameSite: "strict",
        httpOnly: true,
        secure: cookieSecure,
      });
      reply.code(401).send({
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required.",
          details: null,
        },
      });
      return;
    }

    request.authenticatedUser = session.user;
  };
}
