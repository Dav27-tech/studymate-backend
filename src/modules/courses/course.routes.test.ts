import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createApp } from "../../app.js";
import { hashSessionToken } from "../auth/auth.service.js";
import type {
  AuthCredentials,
  AuthRepository,
  AuthSession,
  AuthUser,
  NewUserSession,
} from "../auth/auth.repository.js";
import {
  InvalidDocumentAssociationError,
  type ChapterInput,
  type ChapterRecord,
  type CourseInput,
  type CourseRecord,
  type CourseRepository,
  type DocumentRecord,
  type Pagination,
  type UploadableDocument,
} from "./courses.repository.js";
import type { PrivateFileStorage } from "../../infrastructure/storage/private-file-storage.js";

const appOrigin = "http://localhost:5173";

class InMemoryAuthRepository implements AuthRepository {
  private readonly users = new Map<string, AuthCredentials>();
  private readonly sessions = new Map<string, AuthSession>();

  /**
   * Create User And Session.
   */
  async createUserAndSession(input: NewUserSession): Promise<AuthUser> {
    const user: AuthUser = {
      id: randomUUID(),
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      createdAt: new Date(),
    };
    this.users.set(user.id, { user, passwordHash: input.passwordHash });
    this.sessions.set(input.tokenHash, { user, expiresAt: input.expiresAt });
    return user;
  }

  /**
   * Find User By Email.
   */
  async findUserByEmail(email: string): Promise<AuthCredentials | null> {
    return [...this.users.values()].find(({ user }) => user.email === email) ?? null;
  }

  /**
   * Create Session.
   */
  async createSession(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    const credentials = this.users.get(userId);
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

class InMemoryCourseRepository implements CourseRepository {
  private readonly courses = new Map<
    string,
    { ownerId: string; course: CourseRecord; archived: boolean }
  >();
  private readonly chapters = new Map<string, ChapterRecord>();

  /**
 * Explain the purpose of owns Course.
 */
  async ownsCourse(userId: string, courseId: string): Promise<boolean> {
    const item = this.courses.get(courseId);
    return item?.ownerId === userId && !item.archived;
  }

  /**
   * List Courses.
   */
  async listCourses(
    userId: string,
    pagination: Pagination,
  ): Promise<{ items: CourseRecord[]; total: number }> {
    const all = [...this.courses.values()]
      .filter((item) => item.ownerId === userId && !item.archived)
      .map((item) => item.course);
    return {
      items: all.slice(pagination.skip, pagination.skip + pagination.take),
      total: all.length,
    };
  }

  /**
   * Get Course.
   */
  async getCourse(
    userId: string,
    courseId: string,
  ): Promise<CourseRecord | null> {
    const item = this.courses.get(courseId);
    return item?.ownerId === userId && !item.archived ? item.course : null;
  }

  /**
   * Create Course.
   */
  async createCourse(
    userId: string,
    input: CourseInput,
  ): Promise<CourseRecord> {
    const now = new Date();
    const course: CourseRecord = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
      _count: { documents: 0, chapters: 0, summaries: 0, questionSets: 0 },
    };
    this.courses.set(course.id, { ownerId: userId, course, archived: false });
    return course;
  }

  /**
   * Update Course.
   */
  async updateCourse(
    userId: string,
    courseId: string,
    input: Partial<CourseInput>,
  ): Promise<CourseRecord | null> {
    const item = this.courses.get(courseId);
    if (!item || item.ownerId !== userId || item.archived) {
      return null;
    }
    item.course = { ...item.course, ...input, updatedAt: new Date() };
    return item.course;
  }

  /**
   * Delete Course.
   */
  async deleteCourse(userId: string, courseId: string): Promise<boolean> {
    const item = this.courses.get(courseId);
    if (!item || item.ownerId !== userId || item.archived) {
      return false;
    }
    item.archived = true;
    return true;
  }

  /**
   * List Chapters.
   */
  async listChapters(
    userId: string,
    courseId: string,
    pagination: Pagination,
  ): Promise<{ items: ChapterRecord[]; total: number } | null> {
    if (!(await this.ownsCourse(userId, courseId))) {
      return null;
    }
    const all = [...this.chapters.values()].filter(
      (chapter) => chapter.courseId === courseId,
    );
    return {
      items: all.slice(pagination.skip, pagination.skip + pagination.take),
      total: all.length,
    };
  }

  /**
   * Get Chapter.
   */
  async getChapter(
    userId: string,
    courseId: string,
    chapterId: string,
  ): Promise<ChapterRecord | null> {
    if (!(await this.ownsCourse(userId, courseId))) {
      return null;
    }
    const chapter = this.chapters.get(chapterId);
    return chapter?.courseId === courseId ? chapter : null;
  }

  /**
   * Create Chapter.
   */
  async createChapter(
    userId: string,
    courseId: string,
    input: ChapterInput,
  ): Promise<ChapterRecord | null> {
    if (!(await this.ownsCourse(userId, courseId))) {
      return null;
    }
    if (input.documentId) {
      throw new InvalidDocumentAssociationError();
    }

    const now = new Date();
    const chapter: ChapterRecord = {
      id: randomUUID(),
      courseId,
      documentId: input.documentId ?? null,
      title: input.title,
      description: input.description ?? null,
      content: input.content ?? null,
      position: input.position ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    this.chapters.set(chapter.id, chapter);
    const item = this.courses.get(courseId);
    if (item) {
      item.course._count.chapters += 1;
    }
    return chapter;
  }

  /**
   * Update Chapter.
   */
  async updateChapter(
    userId: string,
    courseId: string,
    chapterId: string,
    input: Partial<ChapterInput>,
  ): Promise<ChapterRecord | null> {
    const chapter = await this.getChapter(userId, courseId, chapterId);
    if (!chapter) {
      return null;
    }
    if (input.documentId) {
      throw new InvalidDocumentAssociationError();
    }
    const updated = { ...chapter, ...input, updatedAt: new Date() };
    this.chapters.set(chapterId, updated);
    return updated;
  }

  /**
   * Delete Chapter.
   */
  async deleteChapter(
    userId: string,
    courseId: string,
    chapterId: string,
  ): Promise<boolean> {
    if (!(await this.getChapter(userId, courseId, chapterId))) {
      return false;
    }
    this.chapters.delete(chapterId);
    const item = this.courses.get(courseId);
    if (item) {
      item.course._count.chapters -= 1;
    }
    return true;
  }

  /**
   * List Documents.
   */
  async listDocuments(
    userId: string,
    courseId: string,
  ): Promise<DocumentRecord[] | null> {
    return (await this.ownsCourse(userId, courseId)) ? [] : null;
  }

  /**
   * Get Document.
   */
  async getDocument(): Promise<DocumentRecord | null> {
    return null;
  }

  /**
   * Create Document.
   */
  async createDocument(): Promise<DocumentRecord> {
    throw new Error("Document creation is not used in this test.");
  }

  /**
   * Delete Document.
   */
  async deleteDocument(): Promise<UploadableDocument | null> {
    return null;
  }
}

const unusedStorage: PrivateFileStorage = {
  saveUpload: async () => {
    throw new Error("Storage is not used in this test.");
  },
  saveExtractedText: async () => {},
  readExtractedText: async () => "",
  readExtractedTextForUpload: async () => "",
  readUpload: async () => Buffer.alloc(0),
  remove: async () => {},
  removeDocument: async () => {},
  removeUpload: async () => {},
};

/**
 * Get Cookie.
 */
function getCookie(setCookie: string | string[] | undefined): string {
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const pair = first?.split(";")[0];
  if (!pair) {
    throw new Error("Expected a session cookie.");
  }
  return pair;
}

describe("course and chapter routes", () => {
  it("scopes course access to its owner and supports archive", async (t) => {
    const authRepository = new InMemoryAuthRepository();
    const courseRepository = new InMemoryCourseRepository();
    const app = createApp({
      checkDatabase: async () => {},
      logger: false,
      auth: {
        repository: authRepository,
        appOrigin,
        cookieSecure: false,
      },
      resources: {
        repository: courseRepository,
        storage: unusedStorage,
      },
    });
    t.after(async () => app.close());

    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin: appOrigin },
      payload: {
        email: "owner@example.com",
        password: "a-strong-password",
        firstName: "Ada",
        lastName: "Lovelace",
      },
    });
    const ownerCookie = getCookie(registration.headers["set-cookie"]);

    const secondRegistration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin: appOrigin },
      payload: {
        email: "other@example.com",
        password: "another-strong-password",
        firstName: "Grace",
        lastName: "Hopper",
      },
    });
    const otherCookie = getCookie(secondRegistration.headers["set-cookie"]);

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/courses",
      headers: { origin: appOrigin, cookie: ownerCookie },
      payload: { title: "Compilers", description: "Course notes" },
    });
    assert.equal(create.statusCode, 201);
    const courseId = create.json().data.id as string;
    assert.equal(create.json().data.title, "Compilers");

    const ownerRead = await app.inject({
      method: "GET",
      url: `/api/v1/courses/${courseId}`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(ownerRead.statusCode, 200);

    const crossUserRead = await app.inject({
      method: "GET",
      url: `/api/v1/courses/${courseId}`,
      headers: { cookie: otherCookie },
    });
    assert.equal(crossUserRead.statusCode, 404);

    const archive = await app.inject({
      method: "DELETE",
      url: `/api/v1/courses/${courseId}`,
      headers: { origin: appOrigin, cookie: ownerCookie },
    });
    assert.equal(archive.statusCode, 200);
    assert.equal(archive.json().data.archived, true);

    const hidden = await app.inject({
      method: "GET",
      url: "/api/v1/courses",
      headers: { cookie: ownerCookie },
    });
    assert.deepEqual(hidden.json().data, []);
  });

  it("validates chapter input, pagination, and document-course association", async (t) => {
    const repository = new InMemoryCourseRepository();
    const authRepository = new InMemoryAuthRepository();
    const app = createApp({
      checkDatabase: async () => {},
      logger: false,
      auth: {
        repository: authRepository,
        appOrigin,
        cookieSecure: false,
      },
      resources: {
        repository,
        storage: unusedStorage,
      },
    });
    t.after(async () => app.close());

    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin: appOrigin },
      payload: {
        email: "chapter@example.com",
        password: "a-strong-password",
        firstName: "Katherine",
        lastName: "Johnson",
      },
    });
    const cookie = getCookie(registration.headers["set-cookie"]);
    const courseResponse = await app.inject({
      method: "POST",
      url: "/api/v1/courses",
      headers: { origin: appOrigin, cookie },
      payload: { title: "Mathematics" },
    });
    const courseId = courseResponse.json().data.id as string;

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/courses/${courseId}/chapters`,
      headers: { origin: appOrigin, cookie },
      payload: {
        title: "Linear algebra",
        content: "Vectors and matrices",
        position: 2,
      },
    });
    assert.equal(created.statusCode, 201);
    const chapterId = created.json().data.id as string;

    const invalidAssociation = await app.inject({
      method: "PATCH",
      url: `/api/v1/courses/${courseId}/chapters/${chapterId}`,
      headers: { origin: appOrigin, cookie },
      payload: { documentId: randomUUID() },
    });
    assert.equal(invalidAssociation.statusCode, 400);
    assert.equal(
      invalidAssociation.json().error.code,
      "INVALID_DOCUMENT_ASSOCIATION",
    );

    const invalidPagination = await app.inject({
      method: "GET",
      url: `/api/v1/courses/${courseId}/chapters?pageSize=101`,
      headers: { cookie },
    });
    assert.equal(invalidPagination.statusCode, 400);

    const chapters = await app.inject({
      method: "GET",
      url: `/api/v1/courses/${courseId}/chapters?page=1&pageSize=1`,
      headers: { cookie },
    });
    assert.equal(chapters.statusCode, 200);
    assert.equal(chapters.json().meta.total, 1);
    assert.equal(chapters.json().data[0].id, chapterId);
  });

  it("requires authentication for course routes", async (t) => {
    const app = createApp({
      checkDatabase: async () => {},
      logger: false,
      auth: {
        repository: new InMemoryAuthRepository(),
        appOrigin,
        cookieSecure: false,
      },
      resources: {
        repository: new InMemoryCourseRepository(),
        storage: unusedStorage,
      },
    });
    t.after(async () => app.close());

    const response = await app.inject({ method: "GET", url: "/api/v1/courses" });
    assert.equal(response.statusCode, 401);
  });
});
