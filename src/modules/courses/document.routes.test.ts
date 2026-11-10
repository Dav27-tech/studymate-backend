import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import sharp from "sharp";
import { createApp } from "../../app.js";
import type {
  AuthCredentials,
  AuthRepository,
  AuthSession,
  AuthUser,
  NewUserSession,
} from "../auth/auth.repository.js";
import { hashSessionToken } from "../auth/auth.service.js";
import type { PrivateFileStorage } from "../../infrastructure/storage/private-file-storage.js";
import type {
  ChapterInput,
  ChapterRecord,
  CourseInput,
  CourseRecord,
  CourseRepository,
  DocumentRecord,
  Pagination,
  UploadableDocument,
} from "./courses.repository.js";

const appOrigin = "http://localhost:5173";
const ownerId = randomUUID();
const courseId = randomUUID();

class TestAuthRepository implements AuthRepository {
  private readonly userByEmail = new Map<string, AuthCredentials>();
  private readonly sessions = new Map<string, AuthSession>();

  /**
   * Create User And Session.
   */
  async createUserAndSession(input: NewUserSession): Promise<AuthUser> {
    const user: AuthUser = {
      id: ownerId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      createdAt: new Date(),
    };
    this.userByEmail.set(user.email, { user, passwordHash: input.passwordHash });
    this.sessions.set(input.tokenHash, { user, expiresAt: input.expiresAt });
    return user;
  }

  /**
   * Find User By Email.
   */
  async findUserByEmail(email: string): Promise<AuthCredentials | null> {
    return this.userByEmail.get(email) ?? null;
  }

  /**
   * Create Session.
   */
  async createSession(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    const credentials = [...this.userByEmail.values()].find(
      ({ user }) => user.id === userId,
    );
    if (!credentials) {
      throw new Error("Expected test user to exist.");
    }

    this.sessions.set(tokenHash, { user: credentials.user, expiresAt });
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

class TestDocumentRepository implements CourseRepository {
  private readonly documents = new Map<string, DocumentRecord>();

  /**
 * Create this instance.
 */
  constructor(private readonly courseOwnerId: string | null = ownerId) {}

  /**
 * Explain the purpose of owns Course.
 */
  async ownsCourse(userId: string, requestedCourseId: string): Promise<boolean> {
    return (
      userId === this.courseOwnerId &&
      requestedCourseId === courseId
    );
  }

  /**
   * List Courses.
   */
  async listCourses(
    _userId: string,
    _pagination: Pagination,
  ): Promise<{ items: CourseRecord[]; total: number }> {
    return { items: [], total: 0 };
  }

  /**
   * Get Course.
   */
  async getCourse(
    _userId: string,
    _courseId: string,
  ): Promise<CourseRecord | null> {
    return null;
  }

  /**
   * Create Course.
   */
  async createCourse(
    _userId: string,
    _input: CourseInput,
  ): Promise<CourseRecord> {
    throw new Error("Course creation is not used in document tests.");
  }

  /**
   * Update Course.
   */
  async updateCourse(
    _userId: string,
    _courseId: string,
    _input: Partial<CourseInput>,
  ): Promise<CourseRecord | null> {
    return null;
  }

  /**
   * Delete Course.
   */
  async deleteCourse(
    _userId: string,
    _courseId: string,
  ): Promise<boolean> {
    return false;
  }

  /**
   * List Chapters.
   */
  async listChapters(
    _userId: string,
    _courseId: string,
    _pagination: Pagination,
  ): Promise<{ items: ChapterRecord[]; total: number } | null> {
    return null;
  }

  /**
   * Get Chapter.
   */
  async getChapter(
    _userId: string,
    _courseId: string,
    _chapterId: string,
  ): Promise<ChapterRecord | null> {
    return null;
  }

  /**
   * Create Chapter.
   */
  async createChapter(
    _userId: string,
    _courseId: string,
    _input: ChapterInput,
  ): Promise<ChapterRecord | null> {
    return null;
  }

  /**
   * Update Chapter.
   */
  async updateChapter(
    _userId: string,
    _courseId: string,
    _chapterId: string,
    _input: Partial<ChapterInput>,
  ): Promise<ChapterRecord | null> {
    return null;
  }

  /**
   * Delete Chapter.
   */
  async deleteChapter(
    _userId: string,
    _courseId: string,
    _chapterId: string,
  ): Promise<boolean> {
    return false;
  }

  /**
   * List Documents.
   */
  async listDocuments(
    userId: string,
    requestedCourseId: string,
  ): Promise<DocumentRecord[] | null> {
    if (!(await this.ownsCourse(userId, requestedCourseId))) {
      return null;
    }

    return [...this.documents.values()].filter(
      (document) => document.courseId === requestedCourseId,
    );
  }

  /**
   * Create Document.
   */
  async createDocument(input: {
    courseId: string;
    name: string;
    filePath: string;
    fileType: string;
    fileSize: number;
    status: "PENDING";
  }): Promise<DocumentRecord> {
    const now = new Date();
    const document: DocumentRecord = {
      id: randomUUID(),
      courseId: input.courseId,
      name: input.name,
      filePath: input.filePath,
      fileType: input.fileType,
      fileSize: BigInt(input.fileSize),
      status: input.status,
      processingAttempts: 0,
      processingError: null,
      processingStartedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.documents.set(document.id, document);
    return document;
  }

  /**
   * Get Document.
   */
  async getDocument(
    userId: string,
    requestedCourseId: string,
    documentId: string,
  ): Promise<DocumentRecord | null> {
    if (!(await this.ownsCourse(userId, requestedCourseId))) {
      return null;
    }
    return this.documents.get(documentId) ?? null;
  }

  /**
   * Delete Document.
   */
  async deleteDocument(
    userId: string,
    requestedCourseId: string,
    documentId: string,
  ): Promise<UploadableDocument | null> {
    const document = await this.getDocument(
      userId,
      requestedCourseId,
      documentId,
    );
    if (!document) {
      return null;
    }
    this.documents.delete(documentId);
    return {
      id: document.id,
      courseId: document.courseId,
      filePath: document.filePath,
    };
  }
}

class TestStorage implements PrivateFileStorage {
  readonly files = new Map<string, Buffer>();
  readonly texts = new Map<string, string>();

  /**
 * Save the Upload.
 */
  async saveUpload(
    extension: "pdf" | "png" | "jpg",
    data: Buffer,
  ) {
    const id = randomUUID();
    const filePath = `${id}.${extension}`;
    this.files.set(filePath, data);
    return { id, filePath, extension };
  }

  /**
 * Save the Extracted Text.
 */
  async saveExtractedText(id: string, text: string): Promise<void> {
    this.texts.set(id, text);
  }

  /**
   * Read Extracted Text.
   */
  async readExtractedText(id: string): Promise<string> {
    const text = this.texts.get(id);
    if (!text) {
      throw new Error("Extracted text not found.");
    }
    return text;
  }

  /**
   * Read Extracted Text For Upload.
   */
  async readExtractedTextForUpload(filePath: string): Promise<string> {
    const id = filePath.split(".")[0];
    if (!id) {
      throw new Error("Invalid file path.");
    }
    return this.readExtractedText(id);
  }

  /**
   * Read Upload.
   */
  async readUpload(filePath: string): Promise<Buffer> {
    const data = this.files.get(filePath);
    if (!data) {
      throw new Error("Uploaded file not found.");
    }
    return data;
  }

  /**
   * Remove .
   */
  async remove(filePath: string): Promise<void> {
    this.files.delete(filePath);
  }

  /**
   * Remove Document.
   */
  async removeDocument(filePath: string): Promise<void> {
    const id = filePath.split(".")[0];
    this.files.delete(filePath);
    if (id) {
      this.texts.delete(id);
    }
  }

  /**
   * Remove Upload.
   */
  async removeUpload(
    id: string,
    extension: "pdf" | "png" | "jpg",
  ): Promise<void> {
    this.files.delete(`${id}.${extension}`);
    this.texts.delete(id);
  }
}

/**
 * Get Session Cookie.
 */
function getSessionCookie(setCookie: string | string[] | undefined): string {
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = first?.split(";")[0];
  if (!cookie) {
    throw new Error("Expected a session cookie.");
  }
  return cookie;
}

/**
 * Create Multipart Request.
 */
async function createMultipartRequest(
  filename: string,
  mimeType: string,
  data: Buffer,
): Promise<{ payload: Buffer; contentType: string }> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), filename);
  const request = new Request("http://localhost/upload", {
    method: "POST",
    body: form,
  });
  const contentType = request.headers.get("content-type");
  if (!contentType) {
    throw new Error("Expected multipart content type.");
  }

  return {
    payload: Buffer.from(await request.arrayBuffer()),
    contentType,
  };
}

/**
 * Create Authenticated App.
 */
async function createAuthenticatedApp(
  repository: TestDocumentRepository,
  storage: TestStorage,
) {
  const authRepository = new TestAuthRepository();
  const app = createApp({
    checkDatabase: async () => {},
    logger: false,
    auth: { repository: authRepository, appOrigin, cookieSecure: false },
    resources: {
      repository,
      storage,
    },
  });
  const registration = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { origin: appOrigin },
    payload: {
      email: `upload-${randomUUID()}@example.com`,
      password: "strong-upload-test-password",
      firstName: "Upload",
      lastName: "Tester",
    },
  });
  assert.equal(registration.statusCode, 201);

  return {
    app,
    cookie: getSessionCookie(registration.headers["set-cookie"]),
  };
}

describe("document routes", () => {
  it("accepts a signed PDF, queues processing, and omits its storage path", async (t) => {
    const repository = new TestDocumentRepository();
    const storage = new TestStorage();
    const { app, cookie } = await createAuthenticatedApp(repository, storage);
    t.after(async () => app.close());
    const upload = await createMultipartRequest(
      "../course-notes.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.7\ncontent"),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/documents`,
      headers: {
        origin: appOrigin,
        cookie,
        "content-type": upload.contentType,
      },
      payload: upload.payload,
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().data.name, "course-notes.pdf");
    assert.equal(response.json().data.status, "PENDING");
    assert.equal(response.json().meta.processing, "queued");
    assert.equal("filePath" in response.json().data, false);
    assert.equal(storage.texts.size, 0);
  });

  it("rejects content with a forged PDF extension", async (t) => {
    const storage = new TestStorage();
    const { app, cookie } = await createAuthenticatedApp(
      new TestDocumentRepository(),
      storage,
    );
    t.after(async () => app.close());
    const upload = await createMultipartRequest(
      "malicious.pdf",
      "application/pdf",
      Buffer.from("not actually a PDF"),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/documents`,
      headers: {
        origin: appOrigin,
        cookie,
        "content-type": upload.contentType,
      },
      payload: upload.payload,
    });

    assert.equal(response.statusCode, 415);
    assert.equal(response.json().error.code, "UNSUPPORTED_FILE_TYPE");
    assert.equal(storage.files.size, 0);
  });

  it("rejects malformed image payloads after checking their signatures", async (t) => {
    const storage = new TestStorage();
    const { app, cookie } = await createAuthenticatedApp(
      new TestDocumentRepository(),
      storage,
    );
    t.after(async () => app.close());
    const upload = await createMultipartRequest(
      "invalid.png",
      "image/png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/documents`,
      headers: {
        origin: appOrigin,
        cookie,
        "content-type": upload.contentType,
      },
      payload: upload.payload,
    });

    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error.code, "INVALID_IMAGE");
    assert.equal(storage.files.size, 0);
  });

  it("requires ownership before upload and prevents cross-user downloads", async (t) => {
    const storage = new TestStorage();
    const { app, cookie } = await createAuthenticatedApp(
      new TestDocumentRepository(randomUUID()),
      storage,
    );
    t.after(async () => app.close());
    const upload = await createMultipartRequest(
      "notes.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.7\ncontent"),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/documents`,
      headers: {
        origin: appOrigin,
        cookie,
        "content-type": upload.contentType,
      },
      payload: upload.payload,
    });

    assert.equal(response.statusCode, 404);
    assert.equal(storage.files.size, 0);
  });

  it("rejects oversized uploads without storing partial content", async (t) => {
    const storage = new TestStorage();
    const { app, cookie } = await createAuthenticatedApp(
      new TestDocumentRepository(),
      storage,
    );
    t.after(async () => app.close());
    const upload = await createMultipartRequest(
      "large.pdf",
      "application/pdf",
      Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(10 * 1024 * 1024)]),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/documents`,
      headers: {
        origin: appOrigin,
        cookie,
        "content-type": upload.contentType,
      },
      payload: upload.payload,
    });

    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, "FILE_TOO_LARGE");
    assert.equal(storage.files.size, 0);
  });

  it("validates actual image decoding and leaves it pending for OCR", async (t) => {
    const storage = new TestStorage();
    const { app, cookie } = await createAuthenticatedApp(
      new TestDocumentRepository(),
      storage,
    );
    t.after(async () => app.close());
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 1, g: 100, b: 200 },
      },
    })
      .png()
      .toBuffer();
    const upload = await createMultipartRequest("pixel.png", "image/png", png);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/documents`,
      headers: {
        origin: appOrigin,
        cookie,
        "content-type": upload.contentType,
      },
      payload: upload.payload,
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().data.status, "PENDING");
    assert.equal(response.json().meta.processing, "queued");
  });
});
