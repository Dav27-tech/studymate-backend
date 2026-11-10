export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatFormat = "json" | Record<string, unknown>;

export class AIProviderError extends Error {
  /**
 * Create this instance.
 */
  constructor(
    message: string,
    public readonly statusCode = 503,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

interface OllamaClientOptions {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  voiceModel: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
}

interface OllamaChatResponse {
  message?: { content?: unknown };
  error?: unknown;
}

interface OllamaEmbedResponse {
  embeddings?: unknown;
  error?: unknown;
}

export class OllamaClient {
  private readonly fetchImplementation: typeof fetch;

  /**
 * Create this instance.
 */
  constructor(private readonly options: OllamaClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  /**
 * Send the prompt to the AI chat provider and return the response.
 */
  async chat(messages: ChatMessage[], format?: ChatFormat): Promise<string> {
    const response = await this.request<OllamaChatResponse>("/api/chat", {
      model: this.options.chatModel,
      stream: false,
      messages,
      ...(format === undefined ? {} : { format }),
    });
    const content = response.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new AIProviderError("The AI provider returned an empty response.");
    }

    return content.trim();
  }

  /**
 * Embed the input text so it can be searched semantically.
 */
  async embed(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0 || inputs.length > 32) {
      throw new RangeError("Embedding batches must contain between 1 and 32 inputs.");
    }

    const response = await this.request<OllamaEmbedResponse>("/api/embed", {
      model: this.options.embeddingModel,
      input: inputs,
    });
    if (
      !Array.isArray(response.embeddings) ||
      response.embeddings.length !== inputs.length
    ) {
      throw new AIProviderError("The AI provider returned invalid embeddings.");
    }

    let dimensions: number | undefined;
    const embeddings = response.embeddings.map((value) => {
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every((coordinate) =>
          typeof coordinate === "number" && Number.isFinite(coordinate),
        )
      ) {
        throw new AIProviderError("The AI provider returned invalid embeddings.");
      }

      dimensions ??= value.length;
      if (value.length !== dimensions) {
        throw new AIProviderError("The AI provider returned inconsistent embeddings.");
      }
      return value as number[];
    });
    return embeddings;
  }

  /**
 * Transcribe the input audio into text.
 */
  async transcribeAudio(audio: Buffer, language = "English"): Promise<string> {
    if (audio.length === 0) {
      throw new RangeError("Audio input cannot be empty.");
    }

    const response = await this.request<OllamaChatResponse>("/api/chat", {
      model: this.options.voiceModel,
      stream: false,
      messages: [
        { role: "system", content: `Perform ASR in ${language}.` },
        { role: "user", content: "", images: [audio.toString("base64")] },
      ],
      options: { temperature: 0, num_predict: 1024 },
    });
    const content = response.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new AIProviderError("The voice model returned an empty transcript.");
    }
    return content.trim();
  }

  /**
 * Check the Health.
 */
  async checkHealth(): Promise<void> {
    const response = await this.request<{
      models?: Array<{ name?: unknown; model?: unknown }>;
    }>("/api/tags", undefined, "GET");
    const installedModels = new Set(
      response.models?.flatMap((model) =>
        [model.name, model.model].filter(
          (name): name is string => typeof name === "string",
        ),
      ),
    );
    if (
      !installedModels.has(this.options.chatModel) ||
      !installedModels.has(this.options.embeddingModel) ||
      !installedModels.has(this.options.voiceModel)
    ) {
      throw new AIProviderError(
        "The configured AI models are not available.",
      );
    }
  }

  private async request<T>(
    path: string,
    body?: unknown,
    method: "GET" | "POST" = "POST",
  ): Promise<T> {
    let response: Response;
    try {
      const requestInit: RequestInit =
        body === undefined
          ? {
              method,
              signal: AbortSignal.timeout(this.options.timeoutMs),
            }
          : {
              method,
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(this.options.timeoutMs),
            };
      response = await this.fetchImplementation(
        `${this.options.baseUrl}${path}`,
        requestInit,
      );
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "The AI provider request timed out."
          : "The AI provider is unavailable.";
      throw new AIProviderError(message);
    }

    let payload: T & { error?: unknown };
    try {
      payload = (await response.json()) as T & { error?: unknown };
    } catch {
      throw new AIProviderError("The AI provider returned an invalid response.");
    }
    if (!response.ok || payload.error !== undefined) {
      throw new AIProviderError("The AI provider could not complete the request.");
    }
    return payload;
  }
}
