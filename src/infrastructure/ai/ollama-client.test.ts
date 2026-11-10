import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AIProviderError, OllamaClient } from "./ollama-client.js";

/**
 * Create Client.
 */
function createClient(fetchImplementation: typeof fetch): OllamaClient {
  return new OllamaClient({
    baseUrl: "http://localhost:11434",
    chatModel: "chat-model",
    embeddingModel: "embedding-model",
    voiceModel: "voice-model",
    timeoutMs: 1000,
    fetchImplementation,
  });
}

describe("OllamaClient", () => {
  it("returns chat responses and validates embedding batches", async () => {
    /**
 * Explain the purpose of fetch Implementation.
 */
    const fetchImplementation: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/api/chat")) {
        assert.equal(init?.method, "POST");
        return Response.json({ message: { content: "  grounded response  " } });
      }

      return Response.json({ embeddings: [[0.1, 0.2], [0.3, 0.4]] });
    };
    const client = createClient(fetchImplementation);

    assert.equal(
      await client.chat([{ role: "user", content: "question" }]),
      "grounded response",
    );
    assert.deepEqual(await client.embed(["first", "second"]), [
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it("sends voice audio through the LFM audio model as a multimodal image payload", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = createClient(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        message: { content: "The spoken question is about mitochondria." },
      });
    });

    assert.equal(
      await client.transcribeAudio(Buffer.from("wave bytes"), "English"),
      "The spoken question is about mitochondria.",
    );
    assert.equal(requestBody?.model, "voice-model");
    const messages = requestBody?.messages as Array<{
      role: string;
      content: string;
      images?: string[];
    }>;
    assert.equal(messages[0]?.content, "Perform ASR in English.");
    assert.equal(messages[1]?.content, "");
    assert.deepEqual(messages[1]?.images, [
      Buffer.from("wave bytes").toString("base64"),
    ]);
  });

  it("surfaces provider failures without leaking response details", async () => {
    const client = createClient(async () =>
      Response.json({ error: "private provider detail" }, { status: 500 }),
    );

    await assert.rejects(client.chat([]), (error: unknown) => {
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.statusCode, 503);
      assert.doesNotMatch(error.message, /private provider detail/);
      return true;
    });
  });

  it("rejects invalid embedding dimensions and empty AI responses", async () => {
    const client = createClient(async (input) =>
      String(input).endsWith("/api/chat")
        ? Response.json({ message: { content: " " } })
        : Response.json({ embeddings: [[0.1], [0.2, 0.3]] }),
    );

    await assert.rejects(client.chat([]), AIProviderError);
    await assert.rejects(client.embed(["a", "b"]), AIProviderError);
    await assert.rejects(client.embed([]), RangeError);
  });

  it("maps provider transport failures to an unavailable error", async () => {
    const client = createClient(async () => {
      throw new Error("internal network detail");
    });

    await assert.rejects(client.checkHealth(), (error: unknown) => {
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.message, "The AI provider is unavailable.");
      return true;
    });
  });

  it("reports configured models missing from the local Ollama registry", async () => {
    const client = createClient(async () =>
      Response.json({ models: [{ name: "chat-model", model: "chat-model" }] }),
    );

    await assert.rejects(client.checkHealth(), (error: unknown) => {
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.message, "The configured AI models are not available.");
      return true;
    });
  });

  it("accepts a healthy Ollama registry with both configured models", async () => {
    const client = createClient(async () =>
      Response.json({
        models: [
          { name: "chat-model", model: "chat-model" },
          { name: "embedding-model", model: "embedding-model" },
          { name: "voice-model", model: "voice-model" },
        ],
      }),
    );

    await assert.doesNotReject(client.checkHealth());
  });
});
