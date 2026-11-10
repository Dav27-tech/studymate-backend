import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  createRequireAuthentication,
  sessionCookieName,
} from "./auth.middleware.js";
import type { AuthRepository } from "./auth.repository.js";
import { AuthError, AuthService } from "./auth.service.js";

const sessionLifetimeSeconds = 7 * 24 * 60 * 60;

interface AuthRouteOptions {
  repository: AuthRepository;
  cookieSecure: boolean;
}

interface RegisterBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

interface LoginBody {
  email: string;
  password: string;
}

const emailSchema = {
  type: "string",
  minLength: 3,
  maxLength: 254,
  pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
} as const;

/**
 * Convert auth-domain errors into the API response shape used by the client.
 */
const authErrorResponse = (error: AuthError, reply: FastifyReply) =>
  reply.code(error.statusCode).send({
    success: false,
    error: { code: error.code, message: error.message, details: null },
  });

/**
 * Register the authentication routes used for sign-up, login, session checks,
 * and logout actions.
 */
const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  app,
  options,
) => {
  const service = new AuthService(options.repository);

  const requireAuthentication = createRequireAuthentication(
    service,
    sessionCookieName,
    options.cookieSecure,
  );
  const cookieOptions = {
    httpOnly: true,
    secure: options.cookieSecure,
    sameSite: "strict" as const,
    path: "/",
    maxAge: sessionLifetimeSeconds,
  };

  app.post<{ Body: RegisterBody }>(
    "/register",
    {
      config: { rateLimit: { max: 5, timeWindow: 60_000 } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "password", "firstName", "lastName"],
          properties: {
            email: emailSchema,
            password: { type: "string", minLength: 12, maxLength: 128 },
            firstName: {
              type: "string",
              minLength: 1,
              maxLength: 100,
              pattern: ".*\\S.*",
            },
            lastName: {
              type: "string",
              minLength: 1,
              maxLength: 100,
              pattern: ".*\\S.*",
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await service.register(request.body);
        reply.setCookie(sessionCookieName, session.token, cookieOptions);
        return reply.code(201).send({
          success: true,
          data: { user: session.user },
          meta: null,
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return authErrorResponse(error, reply);
        }

        throw error;
      }
    },
  );

  app.post<{ Body: LoginBody }>(
    "/login",
    {
      config: { rateLimit: { max: 5, timeWindow: 60_000 } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "password"],
          properties: {
            email: emailSchema,
            password: { type: "string", minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const session = await service.login(
          request.body.email,
          request.body.password,
        );
        reply.setCookie(sessionCookieName, session.token, cookieOptions);
        return {
          success: true,
          data: { user: session.user },
          meta: null,
        };
      } catch (error) {
        if (error instanceof AuthError) {
          return authErrorResponse(error, reply);
        }

        throw error;
      }
    },
  );

  app.get(
    "/me",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      if (!request.authenticatedUser) {
        return reply.code(401).send({
          success: false,
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication is required.",
            details: null,
          },
        });
      }

      return {
        success: true,
        data: { user: request.authenticatedUser },
        meta: null,
      };
    },
  );

  app.post("/logout", async (request, reply) => {
    await service.logout(request.cookies[sessionCookieName]);
    reply.clearCookie(sessionCookieName, {
      httpOnly: true,
      secure: options.cookieSecure,
      sameSite: "strict",
      path: "/",
    });

    return { success: true, data: null, meta: null };
  });
};

export default authRoutes;
