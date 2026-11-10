import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { OllamaClient } from "../../infrastructure/ai/ollama-client.js";
import { createApp } from "../../app.js";
import type {
  AuthCredentials,
  AuthRepository,
  AuthSession,
  AuthUser,
  NewUserSession,
} from "../auth/auth.repository.js";
import type { CourseRepository } from "../courses/courses.repository.js";
import type { PrivateFileStorage } from "../../infrastructure/storage/private-file-storage.js";
import { RagService } from "./rag.service.js";

const appOrigin = "http://localhost:5173";
const userId = randomUUID();
const courseId = randomUUID();
const conversationId = randomUUID();
const transcript = "What do mitochondria do?";

class VoiceTestAuthRepository implements AuthRepository {
  private credentials: AuthCredentials | null = null;
  private readonly sessions = new Map<string, AuthSession>();

  /**
   * Create User And Session.
   */
  async createUserAndSession(input: NewUserSession): Promise<AuthUser> {
    const user: AuthUser = {
      id: userId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      createdAt: new Date(),
    };
    this.credentials = { user, passwordHash: input.passwordHash };
    this.sessions.set(input.tokenHash, { user, expiresAt: input.expiresAt });
    return user;
  }

  /**
   * Find User By Email.
   */
  async findUserByEmail(): Promise<AuthCredentials | null> {
    return this.credentials;
  }

  /**
   * Create Session.
   */
  async createSession(
    requestedUserId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    if (!this.credentials || this.credentials.user.id !== requestedUserId) {
      throw new Error("Expected test user to exist.");
    }
    this.sessions.set(tokenHash, { user: this.credentials.user, expiresAt });
  }

  /**
   * Find Active Session.
   */
  async findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<AuthSession | null> {
    const session = this.sessions.get(tokenHash);
    return session && session.expiresAt > now ? session : null;
  }

  /**
   * Delete Session.
   */
  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }
}

class UnusedStorage implements PrivateFileStorage {
  /**
 * Save the Upload.
 */
  async saveUpload(): Promise<never> {
    throw new Error("Voice audio must not be stored.");
  }
  /**
 * Save the Extracted Text.
 */
  async saveExtractedText(): Promise<void> {}
  /**
   * Read Extracted Text.
   */
  async readExtractedText(): Promise<string> {
    throw new Error("Unused.");
  }
  /**
   * Read Extracted Text For Upload.
   */
  async readExtractedTextForUpload(): Promise<string> {
    throw new Error("Unused.");
  }
  /**
   * Read Upload.
   */
  async readUpload(): Promise<Buffer> {
    throw new Error("Unused.");
  }
  /**
   * Remove .
   */
  async remove(): Promise<void> {}
  /**
   * Remove Document.
   */
  async removeDocument(): Promise<void> {}
  /**
   * Remove Upload.
   */
  async removeUpload(): Promise<void> {}
}

/**
 * Create Wav.
 */
function createWav(): Buffer {
  const sampleRate = 16000;
  const channels = 1;
  const bits = 16;
  const dataLength = sampleRate * channels * (bits / 8);
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  buffer.writeUInt16LE(channels * (bits / 8), 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

/**
 * Explain the purpose of multipart.
 */
async function multipart(
  fieldName: string,
  filename: string,
  data: Buffer,
  type = "audio/wav",
): Promise<{ payload: Buffer; contentType: string }> {
  const form = new FormData();
  form.append(
    fieldName,
    new Blob([new Uint8Array(data)], { type }),
    filename,
  );
  const request = new Request("http://localhost/voice", {
    method: "POST",
    body: form,
  });
  return {
    payload: Buffer.from(await request.arrayBuffer()),
    contentType: request.headers.get("content-type")!,
  };
}

/**
 * Create Voice App.
 */
async function createVoiceApp(
  options: { authorized?: boolean; transcription?: string } = {},
): Promise<{
  app: FastifyInstance;
  cookie: string;
  storedMessages: Array<Record<string, unknown>>;
  transcribedInputs: Array<{ audio: Buffer; language: string | undefined }>;
}> {
  const storedMessages: Array<Record<string, unknown>> = [];
  const transcribedInputs: Array<{
    audio: Buffer;
    language: string | undefined;
  }> = [];
  const authRepository = new VoiceTestAuthRepository();
  const fakePrisma = {
    conversation: {
      findFirst: async () =>
        options.authorized === false
          ? null
          : { id: conversationId },
      update: async () => ({ id: conversationId }),
    },
    $transaction: async <T>(
      operation: (transaction: {
        message: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
        conversation: { update: () => Promise<unknown> };
      }) => Promise<T>,
    ): Promise<T> =>
      operation({
        message: {
          create: async ({ data }) => {
            storedMessages.push(data);
            return {
              id: randomUUID(),
              ...data,
              createdAt: new Date(),
            };
          },
        },
        conversation: { update: async () => ({ id: conversationId }) },
      }),
  };
  const ai = {
    chat: async () => "unused",
    embed: async () => [[1, 0]],
    transcribeAudio: async (audio: Buffer, language?: string) => {
      transcribedInputs.push({ audio, language });
      return options.transcription ?? transcript;
    },
  };
  const app = createApp({
    checkDatabase: async () => {},
    logger: false,
    auth: {
      repository: authRepository,
      appOrigin,
      cookieSecure: false,
    },
    resources: {
      repository: {
        ownsCourse: async () => true,
      } as unknown as CourseRepository,
      storage: new UnusedStorage(),
      study: {
        prisma: fakePrisma as unknown as PrismaClient,
        rag: new RagService(
          { listCourseChunks: async () => [] },
          { embed: async () => [[1, 0]] },
        ),
        ai: ai as Pick<OllamaClient, "chat" | "embed" | "transcribeAudio">,
      },
    },
  });
  const registration = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin: appOrigin },
    payload: {
      email: `voice-${randomUUID()}@example.com`,
      password: "strong-voice-test-password",
      firstName: "Voice",
      lastName: "Tester",
    },
  });
  assert.equal(registration.statusCode, 201);
  const cookie = String(registration.headers["set-cookie"]).split(";")[0];
  assert.ok(cookie);
  return { app, cookie, storedMessages, transcribedInputs };
}

describe("voice messages", () => {
  it("transcribes PCM WAV with the voice model and stores only the transcript", async (t) => {
    const { app, cookie, storedMessages, transcribedInputs } =
      await createVoiceApp();
    t.after(async () => app.close());
    const file = await multipart("audio", "question.wav", createWav());

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/conversations/${conversationId}/voice-messages?language=es`,
      headers: {
        origin: appOrigin,
        cookie,
        "content-type": file.contentType,
      },
      payload: file.payload,
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().data.content, transcript);
    assert.equal(response.json().data.transcription, transcript);
    assert.equal(response.json().data.inputType, "AUDIO");
    assert.equal(response.json().meta.audioStored, false);
    assert.equal(transcribedInputs[0]?.language, "Spanish");
    assert.equal(storedMessages.length, 1);
    assert.equal(storedMessages[0]?.role, "USER");
    assert.equal(storedMessages[0]?.content, transcript);
    assert.equal(storedMessages[0]?.transcription, transcript);
    assert.equal(storedMessages[0]?.audioPath, undefined);
  });

  it("rejects unsupported, invalid, and unauthorized audio without storing a message", async (t) => {
    const unsupported = await createVoiceApp();
    t.after(async () => unsupported.app.close());
    const mp3 = await multipart("audio", "question.mp3", Buffer.from("audio"));
    const unsupportedResponse = await unsupported.app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/conversations/${conversationId}/voice-messages`,
      headers: {
        origin: appOrigin,
        cookie: unsupported.cookie,
        "content-type": mp3.contentType,
      },
      payload: mp3.payload,
    });
    assert.equal(unsupportedResponse.statusCode, 415);
    assert.equal(unsupported.transcribedInputs.length, 0);
    assert.equal(unsupported.storedMessages.length, 0);

    const invalid = await createVoiceApp();
    t.after(async () => invalid.app.close());
    const invalidWav = await multipart("audio", "invalid.wav", Buffer.from("not WAV"));
    const invalidResponse = await invalid.app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/conversations/${conversationId}/voice-messages`,
      headers: {
        origin: appOrigin,
        cookie: invalid.cookie,
        "content-type": invalidWav.contentType,
      },
      payload: invalidWav.payload,
    });
    assert.equal(invalidResponse.statusCode, 422);
    assert.equal(invalid.transcribedInputs.length, 0);
    assert.equal(invalid.storedMessages.length, 0);

    const unauthorized = await createVoiceApp({ authorized: false });
    t.after(async () => unauthorized.app.close());
    const file = await multipart("audio", "question.wav", createWav());
    const unauthorizedResponse = await unauthorized.app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/conversations/${conversationId}/voice-messages`,
      headers: {
        origin: appOrigin,
        cookie: unauthorized.cookie,
        "content-type": file.contentType,
      },
      payload: file.payload,
    });
    assert.equal(unauthorizedResponse.statusCode, 404);
    assert.equal(unauthorized.transcribedInputs.length, 0);
    assert.equal(unauthorized.storedMessages.length, 0);
  });

  it("does not save a voice message when the model produces no transcript", async (t) => {
    const { app, cookie, storedMessages } = await createVoiceApp({
      transcription: "   ",
    });
    t.after(async () => app.close());
    const file = await multipart("audio", "question.wav", createWav());

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/conversations/${conversationId}/voice-messages`,
      headers: {
        origin: appOrigin,
        cookie,
        "content-type": file.contentType,
      },
      payload: file.payload,
    });

    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error.code, "TRANSCRIPTION_EMPTY");
    assert.equal(storedMessages.length, 0);
  });
});
