import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { prisma } from "./database/prisma.js";
import { PrismaAuthRepository } from "./modules/auth/auth.repository.js";
import { PrismaCourseRepository } from "./modules/courses/courses.repository.js";
import { LocalPrivateFileStorage } from "./infrastructure/storage/private-file-storage.js";
import { extractPdfText } from "./infrastructure/document-processing/pdf-text-extractor.js";
import { DocumentOcr } from "./infrastructure/document-processing/document-ocr.js";
import { OllamaClient } from "./infrastructure/ai/ollama-client.js";
import { DocumentIngestionService } from "./modules/courses/document-ingestion.service.js";
import { RagService } from "./modules/study/rag.service.js";

const authRepository = new PrismaAuthRepository(prisma);
const courseRepository = new PrismaCourseRepository(prisma);
const storage = new LocalPrivateFileStorage(config.FILE_STORAGE_DIR);
const ai = new OllamaClient({
  baseUrl: config.AI_BASE_URL,
  chatModel: config.AI_CHAT_MODEL,
  embeddingModel: config.AI_EMBEDDING_MODEL,
  voiceModel: config.AI_VOICE_MODEL,
  timeoutMs: config.AI_TIMEOUT_MS,
});
const ocr = new DocumentOcr();
const ingestion = new DocumentIngestionService({
  repository: courseRepository,
  storage,
  ai,
  ocr,
  extractPdfText,
});
const rag = new RagService(courseRepository, ai);
const app = createApp({
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  auth: {
    repository: authRepository,
    appOrigin: config.APP_ORIGIN,
    cookieSecure: config.COOKIE_SECURE,
  },
  checkAI: () => ai.checkHealth(),
  resources: {
    repository: courseRepository,
    storage,
    ingestion,
    study: { prisma, rag, ai },
  },
});

app.addHook("onClose", async () => {
  await prisma.$disconnect();
});

let isShuttingDown = false;
/**
 * Explain the purpose of shutdown.
 */
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  app.log.info({ signal }, "Shutting down server");
  try {
    await app.close();
  } catch (error) {
    app.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Server shutdown failed",
    );
    process.exitCode = 1;
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

/**
 * Start .
 */
const start = async (): Promise<void> => {
  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    app.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Server startup failed",
    );
    await app.close();
    process.exitCode = 1;
  }
};

void start();
