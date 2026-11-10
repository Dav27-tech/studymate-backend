import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEnvironment } from "./env.js";

describe("parseEnvironment", () => {
  it("provides safe defaults for optional settings", () => {
    assert.deepEqual(
      parseEnvironment({
        DATABASE_URL: "postgresql://user:password@localhost:5432/studymate",
      }),
      {
        APP_ORIGIN: "http://localhost:5173",
        AI_BASE_URL: "http://127.0.0.1:11434",
        AI_CHAT_MODEL: "qwen2.5:1.5b",
        AI_EMBEDDING_MODEL: "embeddinggemma:300m",
        AI_VOICE_MODEL: "lfm3-audio:2b",
        AI_TIMEOUT_MS: 120000,
        DATABASE_URL: "postgresql://user:password@localhost:5432/studymate",
        FILE_STORAGE_DIR: "var/uploads",
        HOST: "localhost",
        NODE_ENV: "development",
        PORT: 3000,
        COOKIE_SECURE: false,
      },
    );
  });

  it("rejects a missing database URL", () => {
    assert.throws(() => parseEnvironment({}), /DATABASE_URL is required/);
  });

  it("rejects non-PostgreSQL database URLs", () => {
    assert.throws(
      () => parseEnvironment({ DATABASE_URL: "mysql://localhost/studymate" }),
      /must use a PostgreSQL connection URL/,
    );
  });

  it("rejects invalid ports", () => {
    assert.throws(
      () =>
        parseEnvironment({
          DATABASE_URL: "postgresql://localhost/studymate",
          PORT: "70000",
        }),
      /PORT must be an integer/,
    );
  });

it("requires an HTTPS app origin in production", () => {
    assert.throws(
      () =>
        parseEnvironment({
          DATABASE_URL: "postgresql://localhost/studymate",
          NODE_ENV: "production",
        }),
      /APP_ORIGIN must use HTTPS in production/,
    );
  });

  it("rejects an empty upload directory", () => {
    assert.throws(
      () =>
        parseEnvironment({
          DATABASE_URL: "postgresql://localhost/studymate",
          FILE_STORAGE_DIR: "  ",
        }),
      /FILE_STORAGE_DIR cannot be empty/,
    );
  });

  it("rejects invalid AI provider URLs and timeouts", () => {
    assert.throws(
      () =>
        parseEnvironment({
          DATABASE_URL: "postgresql://localhost/studymate",
          AI_BASE_URL: "file:///tmp/ollama",
        }),
      /AI_BASE_URL must be an HTTP\(S\) URL/,
    );
    assert.throws(
      () =>
        parseEnvironment({
          DATABASE_URL: "postgresql://localhost/studymate",
          AI_TIMEOUT_MS: "50",
        }),
      /AI_TIMEOUT_MS must be an integer/,
    );
  });
});
