import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

const courseSelect = {
  id: true,
  title: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      documents: true,
      chapters: true,
      summaries: true,
      questionSets: true,
    },
  },
} satisfies Prisma.CourseSelect;

const chapterSelect = {
  id: true,
  courseId: true,
  documentId: true,
  title: true,
  description: true,
  content: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChapterSelect;

const documentSelect = {
  id: true,
  courseId: true,
  name: true,
  filePath: true,
  fileType: true,
  fileSize: true,
  status: true,
  processingAttempts: true,
  processingError: true,
  processingStartedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DocumentSelect;

export type CourseRecord = Prisma.CourseGetPayload<{
  select: typeof courseSelect;
}>;
export type ChapterRecord = Prisma.ChapterGetPayload<{
  select: typeof chapterSelect;
}>;
export type DocumentRecord = Prisma.DocumentGetPayload<{
  select: typeof documentSelect;
}>;
export type UploadableDocument = Pick<
  DocumentRecord,
  "id" | "courseId" | "filePath"
>;
export interface DocumentJobRecord {
  id: string;
  courseId: string;
  filePath: string;
  fileType: string;
  processingAttempts: number;
}

export interface DocumentChunkInput {
  documentId: string;
  position: number;
  content: string;
  embedding: number[];
}

export interface CourseChunkRecord {
  documentId: string;
  documentName: string;
  position: number;
  content: string;
  embedding: Prisma.JsonValue;
}

export interface CourseInput {
  title: string;
  description?: string | null;
}

export interface ChapterInput {
  title: string;
  description?: string | null;
  content?: string | null;
  position?: number;
  documentId?: string | null;
}

export interface Pagination {
  skip: number;
  take: number;
}

export interface CourseRepository {
  ownsCourse(userId: string, courseId: string): Promise<boolean>;
  listCourses(
    userId: string,
    pagination: Pagination,
  ): Promise<{ items: CourseRecord[]; total: number }>;
  getCourse(userId: string, courseId: string): Promise<CourseRecord | null>;
  createCourse(userId: string, input: CourseInput): Promise<CourseRecord>;
  updateCourse(
    userId: string,
    courseId: string,
    input: Partial<CourseInput>,
  ): Promise<CourseRecord | null>;
  deleteCourse(userId: string, courseId: string): Promise<boolean>;
    listChapters(
    userId: string,
    courseId: string,
    pagination: Pagination,
  ): Promise<{ items: ChapterRecord[]; total: number } | null>;
  getChapter(
    userId: string,
    courseId: string,
    chapterId: string,
  ): Promise<ChapterRecord | null>;
  createChapter(
    userId: string,
    courseId: string,
    input: ChapterInput,
  ): Promise<ChapterRecord | null>;
  updateChapter(
    userId: string,
    courseId: string,
    chapterId: string,
    input: Partial<ChapterInput>,
  ): Promise<ChapterRecord | null>;
  deleteChapter(
    userId: string,
    courseId: string,
    chapterId: string,
  ): Promise<boolean>;
  listDocuments(
    userId: string,
    courseId: string,
  ): Promise<DocumentRecord[] | null>;
  getDocument(
    userId: string,
    courseId: string,
    documentId: string,
  ): Promise<DocumentRecord | null>;
  createDocument(input: {
    courseId: string;
    name: string;
    filePath: string;
    fileType: string;
    fileSize: number;
    status: "PENDING";
  }): Promise<DocumentRecord>;
  deleteDocument(
    userId: string,
    courseId: string,
    documentId: string,
  ): Promise<UploadableDocument | null>;
}

export interface DocumentIngestionRepository {
  claimPendingDocument(): Promise<DocumentJobRecord | null>;
  resetStaleDocuments(staleBefore: Date): Promise<void>;
  saveDocumentChunks(
    documentId: string,
    chunks: DocumentChunkInput[],
  ): Promise<void>;
  completeDocument(documentId: string): Promise<void>;
  failDocument(document: DocumentJobRecord, message: string): Promise<void>;
  listCourseChunks(
    userId: string,
    courseId: string,
    limit: number,
  ): Promise<CourseChunkRecord[] | null>;
}

export class PrismaCourseRepository
  implements CourseRepository, DocumentIngestionRepository
{
  /**
 * Create this instance.
 */
  constructor(private readonly prisma: PrismaClient) {}

  /**
 * Explain the purpose of owns Course.
 */
  async ownsCourse(userId: string, courseId: string): Promise<boolean> {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, userId, archivedAt: null },
      select: { id: true },
    });
    return course !== null;
  }

  /**
   * List Courses.
   */
  async listCourses(
    userId: string,
    pagination: Pagination,
  ): Promise<{ items: CourseRecord[]; total: number }> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where: { userId, archivedAt: null },
        select: courseSelect,
        orderBy: { updatedAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.course.count({ where: { userId, archivedAt: null } }),
    ]);

    return { items, total };
  }

  getCourse(userId: string, courseId: string): Promise<CourseRecord | null> {
    return this.prisma.course.findFirst({
      where: { id: courseId, userId, archivedAt: null },
      select: courseSelect,
    });
  }

  createCourse(userId: string, input: CourseInput): Promise<CourseRecord> {
    return this.prisma.course.create({
      data: { ...input, userId },
      select: courseSelect,
    });
  }

  /**
   * Update Course.
   */
  async updateCourse(
    userId: string,
    courseId: string,
    input: Partial<CourseInput>,
  ): Promise<CourseRecord | null> {
    const updated = await this.prisma.course.updateMany({
      where: { id: courseId, userId, archivedAt: null },
      data: input,
    });
    if (updated.count === 0) {
      return null;
    }

    return this.getCourse(userId, courseId);
  }

  /**
   * Delete Course.
   */
  async deleteCourse(userId: string, courseId: string): Promise<boolean> {
    const archived = await this.prisma.course.updateMany({
      where: { id: courseId, userId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return archived.count > 0;
  }

  /**
   * List Chapters.
   */
  async listChapters(
    userId: string,
    courseId: string,
    pagination: Pagination,
  ): Promise<{ items: ChapterRecord[]; total: number } | null> {
    const ownedCourse = await this.prisma.course.findFirst({
      where: { id: courseId, userId, archivedAt: null },
      select: { id: true },
    });
    if (!ownedCourse) {
      return null;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.chapter.findMany({
        where: { courseId },
        select: chapterSelect,
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.chapter.count({ where: { courseId } }),
    ]);
    return { items, total };
  }

  /**
   * Get Chapter.
   */
  async getChapter(
    userId: string,
    courseId: string,
    chapterId: string,
  ): Promise<ChapterRecord | null> {
    return this.prisma.chapter.findFirst({
      where: {
        id: chapterId,
        courseId,
        course: { userId, archivedAt: null },
      },
      select: chapterSelect,
    });
  }

  /**
   * Create Chapter.
   */
  async createChapter(
    userId: string,
    courseId: string,
    input: ChapterInput,
  ): Promise<ChapterRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const course = await transaction.course.findFirst({
        where: { id: courseId, userId, archivedAt: null },
        select: { id: true },
      });
      if (!course) {
        return null;
      }

      if (input.documentId) {
        const document = await transaction.document.findFirst({
          where: { id: input.documentId, courseId },
          select: { id: true },
        });
        if (!document) {
          throw new InvalidDocumentAssociationError();
        }
      }

      return transaction.chapter.create({
        data: { ...input, courseId },
        select: chapterSelect,
      });
    });
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
    return this.prisma.$transaction(async (transaction) => {
      const chapter = await transaction.chapter.findFirst({
        where: {
          id: chapterId,
          courseId,
          course: { userId, archivedAt: null },
        },
        select: { id: true },
      });
      if (!chapter) {
        return null;
      }

      if (input.documentId) {
        const document = await transaction.document.findFirst({
          where: { id: input.documentId, courseId },
          select: { id: true },
        });
        if (!document) {
          throw new InvalidDocumentAssociationError();
        }
      }

      return transaction.chapter.update({
        where: { id: chapterId },
        data: input,
        select: chapterSelect,
      });
    });
  }

  /**
   * Delete Chapter.
   */
  async deleteChapter(
    userId: string,
    courseId: string,
    chapterId: string,
  ): Promise<boolean> {
    const deleted = await this.prisma.chapter.deleteMany({
      where: {
        id: chapterId,
        courseId,
        course: { userId, archivedAt: null },
      },
    });
    return deleted.count > 0;
  }

/**
 * List Documents.
 */
async listDocuments(
    userId: string,
    courseId: string,
  ): Promise<DocumentRecord[] | null> {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, userId, archivedAt: null },
      select: { id: true },
    });
    if (!course) {
      return null;
    }

    return this.prisma.document.findMany({
      where: { courseId },
      select: documentSelect,
      orderBy: { createdAt: "desc" },
    });
  }

  getDocument(
    userId: string,
    courseId: string,
    documentId: string,
  ): Promise<DocumentRecord | null> {
    return this.prisma.document.findFirst({
      where: {
        id: documentId,
        courseId,
        course: { userId, archivedAt: null },
      },
      select: documentSelect,
    });
  }

  createDocument(input: {
    courseId: string;
    name: string;
    filePath: string;
    fileType: string;
    fileSize: number;
    status: "PENDING";
  }): Promise<DocumentRecord> {
    return this.prisma.document.create({
      data: { ...input, fileSize: BigInt(input.fileSize) },
      select: documentSelect,
    });
  }

  /**
 * Claim the Pending Document.
 */
  async claimPendingDocument(): Promise<DocumentJobRecord | null> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = await this.prisma.document.findFirst({
        where: { status: "PENDING" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (!candidate) {
        return null;
      }

      const claimed = await this.prisma.document.updateMany({
        where: { id: candidate.id, status: "PENDING" },
        data: {
          status: "PROCESSING",
          processingStartedAt: new Date(),
          processingAttempts: { increment: 1 },
          processingError: null,
        },
      });
      if (claimed.count === 0) {
        continue;
      }

      return this.prisma.document.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          courseId: true,
          filePath: true,
          fileType: true,
          processingAttempts: true,
        },
      });
    }

    return null;
  }

  /**
 * Reset the Stale Documents.
 */
  async resetStaleDocuments(staleBefore: Date): Promise<void> {
    await this.prisma.document.updateMany({
      where: {
        status: "PROCESSING",
        processingStartedAt: { lt: staleBefore },
      },
      data: {
        status: "PENDING",
        processingStartedAt: null,
        processingError: "Processing was interrupted; the document will be retried.",
      },
    });
  }

  /**
 * Save the Document Chunks.
 */
  async saveDocumentChunks(
    documentId: string,
    chunks: DocumentChunkInput[],
  ): Promise<void> {
    await this.prisma.documentChunk.deleteMany({ where: { documentId } });
    for (let start = 0; start < chunks.length; start += 100) {
      const batch = chunks.slice(start, start + 100);
      await this.prisma.documentChunk.createMany({
        data: batch.map((chunk) => ({
          ...chunk,
          embedding: chunk.embedding as Prisma.InputJsonValue,
        })),
      });
    }
  }

  /**
 * Complete the Document.
 */
  async completeDocument(documentId: string): Promise<void> {
    await this.prisma.document.updateMany({
      where: { id: documentId, status: "PROCESSING" },
      data: {
        status: "COMPLETED",
        processingStartedAt: null,
        processingError: null,
      },
    });
  }

  /**
 * Fail the Document.
 */
  async failDocument(
    document: DocumentJobRecord,
    message: string,
  ): Promise<void> {
    await this.prisma.document.updateMany({
      where: { id: document.id, status: "PROCESSING" },
      data: {
        status:
          document.processingAttempts < 3 ? "PENDING" : "FAILED",
        processingStartedAt: null,
        processingError: message,
      },
    });
  }

  /**
   * List Course Chunks.
   */
  async listCourseChunks(
    userId: string,
    courseId: string,
    limit: number,
  ): Promise<CourseChunkRecord[] | null> {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, userId, archivedAt: null },
      select: { id: true },
    });
    if (!course) {
      return null;
    }

    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        document: {
          courseId,
          status: "COMPLETED",
        },
      },
      select: {
        documentId: true,
        position: true,
        content: true,
        embedding: true,
        document: { select: { name: true } },
      },
      orderBy: [{ documentId: "asc" }, { position: "asc" }],
      take: limit,
    });
    return chunks.map((chunk) => ({
      documentId: chunk.documentId,
      documentName: chunk.document.name,
      position: chunk.position,
      content: chunk.content,
      embedding: chunk.embedding,
    }));
  }

  /**
   * Delete Document.
   */
  async deleteDocument(
    userId: string,
    courseId: string,
    documentId: string,
  ): Promise<UploadableDocument | null> {
    return this.prisma.$transaction(async (transaction) => {
      const document = await transaction.document.findFirst({
        where: {
          id: documentId,
          courseId,
          course: { userId, archivedAt: null },
        },
        select: { id: true, courseId: true, filePath: true },
      });
      if (!document) {
        return null;
      }

      await transaction.document.delete({ where: { id: documentId } });
      return document;
    });
  }
}

export class InvalidDocumentAssociationError extends Error {
  /**
 * Create this instance.
 */
  constructor() {
    super("The document must belong to the same course.");
    this.name = "InvalidDocumentAssociationError";
  }
}
