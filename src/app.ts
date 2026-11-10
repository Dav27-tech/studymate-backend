import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import authRoutes from "./modules/auth/auth.routes.js";
import type { AuthRepository } from "./modules/auth/auth.repository.js";
import { createRequireAuthentication, sessionCookieName } from "./modules/auth/auth.middleware.js";
import { AuthService } from "./modules/auth/auth.service.js";
import courseRoutes from "./modules/courses/course.routes.js";
import documentRoutes from "./modules/courses/document.routes.js";
import type { CourseRepository } from "./modules/courses/courses.repository.js";
import type { PrivateFileStorage } from "./infrastructure/storage/private-file-storage.js";
import type { DocumentIngestionService } from "./modules/courses/document-ingestion.service.js";
import studyRoutes from "./modules/study/study.routes.js";
import type { RagService } from "./modules/study/rag.service.js";
import type { OllamaClient } from "./infrastructure/ai/ollama-client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { AIProviderError } from "./infrastructure/ai/ollama-client.js";

export interface AppOptions {
  checkDatabase: () => Promise<void>;
  checkAI?: () => Promise<void>;
  auth?: {
    repository: AuthRepository;
    appOrigin: string;
    cookieSecure: boolean;
  };
  resources?: {
    repository: CourseRepository;
    storage: PrivateFileStorage;
    ingestion?: DocumentIngestionService;
    study?: {
      prisma: PrismaClient;
      rag: RagService;
      ai: Pick<OllamaClient, "chat" | "embed" | "transcribeAudio">;
    };
  };
  logger?: FastifyServerOptions["logger"];
}

/**
 * Build the Fastify application with authentication, route plugins,
 * health checks, and the optional AI/document ingestion services.
 */
export function createApp({
  checkDatabase,
  checkAI,
  auth,
  resources,
  logger = true,
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: 11 * 1024 * 1024 });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AIProviderError) {
      request.log.error({ errorName: error.name }, "AI provider request failed");
      return reply.code(503).send({
        success: false,
        error: {
          code: "AI_UNAVAILABLE",
          message: "The AI provider is temporarily unavailable.",
          details: null,
        },
      });
    }

    if (error.validation) {
      return reply.code(400).send({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: null,
        },
      });
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.statusCode === 429 ? "RATE_LIMITED" : "REQUEST_ERROR",
          message: error.statusCode === 404 ? "Route not found." : "Request failed.",
          details: null,
        },
      });
    }

    request.log.error(
      { errorName: error.name },
      "Request failed unexpectedly",
    );
    return reply.code(500).send({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
        details: null,
      },
    });
  });

  if (auth) {
    app.decorateRequest("authenticatedUser", null);
    void app.register(cors, {
      origin: auth.appOrigin,
      credentials: true,
    });
    void app.register(cookie);
    void app.register(rateLimit, { global: false });
    void app.register(multipart, {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    });

    app.addHook("onRequest", async (request, reply) => {
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
        request.headers.origin !== auth.appOrigin
      ) {
        return reply.code(403).send({
          success: false,
          error: {
            code: "INVALID_ORIGIN",
            message: "Request origin is not allowed.",
            details: null,
          },
        });
      }
    });

    void app.register(authRoutes, {
      prefix: "/api/v1/auth",
      repository: auth.repository,
      cookieSecure: auth.cookieSecure,
    });

    if (resources) {
      const requireAuthentication = createRequireAuthentication(
        new AuthService(auth.repository),
        sessionCookieName,
        auth.cookieSecure,
      );
      void app.register(courseRoutes, {
        prefix: "/api/v1",
        repository: resources.repository,
        requireAuthentication,
      });
      void app.register(documentRoutes, {
        prefix: "/api/v1",
        repository: resources.repository,
        storage: resources.storage,
        requireAuthentication,
      });
      if (resources.study) {
        void app.register(studyRoutes, {
          prefix: "/api/v1",
          repository: resources.repository,
          prisma: resources.study.prisma,
          rag: resources.study.rag,
          ai: resources.study.ai,
          requireAuthentication,
        });
      }
      if (resources.ingestion) {
        app.addHook("onReady", async () => {
          await resources.ingestion?.start(app.log);
        });
        app.addHook("onClose", async () => {
          await resources.ingestion?.stop();
        });
      }
    }
  }

  app.get("/health/live", async () => ({ status: "ok" }));

  if (checkAI) {
    app.get("/health/ai", async (_request, reply) => {
      try {
        await checkAI();
        return { status: "ok", dependencies: { ai: "available" } };
      } catch (error) {
        app.log.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "AI readiness check failed",
        );
        return reply
          .code(503)
          .send({ status: "error", dependencies: { ai: "unavailable" } });
      }
    });
  }

  app.get("/health/ready", async (_request, reply) => {
    try {
      await checkDatabase();
      return { status: "ok", dependencies: { database: "available" } };
    } catch (error) {
      app.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Database readiness check failed",
      );
      return reply
        .code(503)
        .send({ status: "error", dependencies: { database: "unavailable" } });
    }
  });

  return app;
}
