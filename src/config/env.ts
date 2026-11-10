import "dotenv/config";

export type AppEnvironment = "development" | "test" | "production";

export interface AppConfig {
  APP_ORIGIN: string;
  AI_BASE_URL: string;
  AI_CHAT_MODEL: string;
  AI_EMBEDDING_MODEL: string;
  AI_VOICE_MODEL: string;
  AI_TIMEOUT_MS: number;
  DATABASE_URL: string;
  FILE_STORAGE_DIR: string;
  HOST: string;
  NODE_ENV: AppEnvironment;
  PORT: number;
  COOKIE_SECURE: boolean;
}

/**
 * Validate environment variables and normalize the runtime configuration
 * for the application, database, and AI services.
 */
export function parseEnvironment(
  environment: NodeJS.ProcessEnv,
): AppConfig {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Invalid environment: DATABASE_URL is required.");
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Invalid environment: DATABASE_URL must be a valid URL.");
  }

  if (
    !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol) ||
    !parsedDatabaseUrl.hostname
  ) {
    throw new Error(
      "Invalid environment: DATABASE_URL must use a PostgreSQL connection URL.",
    );
  }

  const port = Number(environment.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "Invalid environment: PORT must be an integer from 1 to 65535.",
    );
  }

  const nodeEnvironment = environment.NODE_ENV ?? "development";
  if (
    nodeEnvironment !== "development" &&
    nodeEnvironment !== "test" &&
    nodeEnvironment !== "production"
  ) {
    throw new Error(
      "Invalid environment: NODE_ENV must be development, test, or production.",
    );
  }

  // Keep the host explicitly configurable while preserving a sensible local default.
  const host = (environment.HOST ?? "localhost").trim();
  if (!host) {
    throw new Error("Invalid environment: HOST cannot be empty.");
  }

  const appOrigin = environment.APP_ORIGIN ?? "http://localhost:5173";
  let parsedAppOrigin: URL;
  try {
    parsedAppOrigin = new URL(appOrigin);
  } catch {
    throw new Error("Invalid environment: APP_ORIGIN must be a valid URL origin.");
  }

  if (
    !["http:", "https:"].includes(parsedAppOrigin.protocol) ||
    parsedAppOrigin.origin !== appOrigin
  ) {
    throw new Error(
      "Invalid environment: APP_ORIGIN must be an HTTP(S) origin without a path.",
    );
  }

  if (
    nodeEnvironment === "production" &&
    parsedAppOrigin.protocol !== "https:"
  ) {
    throw new Error(
      "Invalid environment: APP_ORIGIN must use HTTPS in production.",
    );
  }

  const aiBaseUrl = environment.AI_BASE_URL ?? "http://127.0.0.1:11434";
  let parsedAiBaseUrl: URL;
  try {
    parsedAiBaseUrl = new URL(aiBaseUrl);
  } catch {
    throw new Error("Invalid environment: AI_BASE_URL must be a valid URL.");
  }
  if (
    !["http:", "https:"].includes(parsedAiBaseUrl.protocol) ||
    parsedAiBaseUrl.username ||
    parsedAiBaseUrl.password ||
    parsedAiBaseUrl.search ||
    parsedAiBaseUrl.hash
  ) {
    throw new Error(
      "Invalid environment: AI_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment.",
    );
  }

  const aiTimeoutMs = Number(environment.AI_TIMEOUT_MS ?? "120000");
  if (!Number.isInteger(aiTimeoutMs) || aiTimeoutMs < 1000 || aiTimeoutMs > 600000) {
    throw new Error(
      "Invalid environment: AI_TIMEOUT_MS must be an integer from 1000 to 600000.",
    );
  }
  // These model names map to the local Ollama runtime and can be overridden per environment.
  const aiChatModel = (environment.AI_CHAT_MODEL ?? "qwen2.5:1.5b").trim();
  const aiEmbeddingModel = (
    environment.AI_EMBEDDING_MODEL ?? "embeddinggemma:300m"
  ).trim();
  const aiVoiceModel = (environment.AI_VOICE_MODEL ?? "lfm3-audio:2b").trim();
  if (!aiChatModel || !aiEmbeddingModel || !aiVoiceModel) {
    throw new Error(
      "Invalid environment: AI model names cannot be empty.",
    );
  }

  const fileStorageDir = environment.FILE_STORAGE_DIR?.trim();
  if (environment.FILE_STORAGE_DIR !== undefined && !fileStorageDir) {
    throw new Error(
      "Invalid environment: FILE_STORAGE_DIR cannot be empty.",
    );
  }

  return {
    APP_ORIGIN: appOrigin,
    AI_BASE_URL: parsedAiBaseUrl.toString().replace(/\/$/, ""),
    AI_CHAT_MODEL: aiChatModel,
    AI_EMBEDDING_MODEL: aiEmbeddingModel,
    AI_VOICE_MODEL: aiVoiceModel,
    AI_TIMEOUT_MS: aiTimeoutMs,
    DATABASE_URL: databaseUrl,
    FILE_STORAGE_DIR: fileStorageDir ?? "var/uploads",
    HOST: host,
    NODE_ENV: nodeEnvironment,
    PORT: port,
    COOKIE_SECURE: nodeEnvironment === "production",
  };
}

export const config = parseEnvironment(process.env);
