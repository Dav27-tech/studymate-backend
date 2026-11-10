import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "./app.js";

describe("health endpoints", () => {
  it("reports liveness without depending on PostgreSQL", async (t) => {
    const app = createApp({
      checkDatabase: async () => {
        throw new Error("The database check should not run for liveness.");
      },
      logger: false,
    });
    t.after(async () => app.close());

    const response = await app.inject({ method: "GET", url: "/health/live" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  });

  it("reports readiness when PostgreSQL is available", async (t) => {
    const app = createApp({ checkDatabase: async () => {}, logger: false });
    t.after(async () => app.close());

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "ok",
      dependencies: { database: "available" },
    });
  });

  it("returns a sanitized unavailable response when PostgreSQL is down", async (t) => {
    const app = createApp({
      checkDatabase: async () => {
        throw new Error("Sensitive connection details");
      },
      logger: false,
    });
    t.after(async () => app.close());

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: "error",
      dependencies: { database: "unavailable" },
    });
    assert.equal(response.body.includes("Sensitive connection details"), false);
  });

  it("reports local AI availability without exposing provider details", async (t) => {
    const app = createApp({
      checkDatabase: async () => {},
      checkAI: async () => {
        throw new Error("local model server details");
      },
      logger: false,
    });
    t.after(async () => app.close());

    const response = await app.inject({ method: "GET", url: "/health/ai" });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: "error",
      dependencies: { ai: "unavailable" },
    });
    assert.equal(response.body.includes("local model server details"), false);
  });
});
