import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import sharp from "sharp";
import {
  extensionFromOriginalFilename,
  sanitizeOriginalFilename,
  type PrivateFileStorage,
  type StoredUpload,
} from "../../infrastructure/storage/private-file-storage.js";
import type { CourseRepository } from "./courses.repository.js";

const maximumUploadBytes = 10 * 1024 * 1024;
type DocumentRepository = Pick<
  CourseRepository,
  | "ownsCourse"
  | "listDocuments"
  | "createDocument"
  | "getDocument"
  | "deleteDocument"
>;
const uuidPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

interface DocumentRouteOptions {
  repository: DocumentRepository;
  storage: PrivateFileStorage;
  requireAuthentication: preHandlerHookHandler;
}

interface DocumentParams {
  courseId: string;
  documentId: string;
}

interface CourseParams {
  courseId: string;
}

interface DocumentType {
  extension: StoredUpload["extension"];
  mimeType: string;
  signature: (data: Buffer) => boolean;
}

const documentTypes: DocumentType[] = [
  {
    extension: "pdf",
    mimeType: "application/pdf",
    signature: (data) => data.subarray(0, 5).toString("ascii") === "%PDF-",
  },
  {
    extension: "png",
    mimeType: "image/png",
    signature: (data) =>
      data.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
  },
  {
    extension: "jpg",
    mimeType: "image/jpeg",
    signature: (data) =>
      data.length >= 3 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[2] === 0xff,
  },
];

const courseParamsSchema = {
  type: "object",
  required: ["courseId"],
  properties: { courseId: { type: "string", pattern: uuidPattern } },
} as const;

const documentParamsSchema = {
  type: "object",
  required: ["courseId", "documentId"],
  properties: {
    courseId: { type: "string", pattern: uuidPattern },
    documentId: { type: "string", pattern: uuidPattern },
  },
} as const;

/**
 * Get User Id.
 */
function getUserId(request: FastifyRequest): string {
  const userId = request.authenticatedUser?.id;
  if (!userId) {
    const error = new Error("Authentication is required.") as Error & {
      statusCode: number;
    };
    error.statusCode = 401;
    throw error;
  }

  return userId;
}

/**
 * Handle the document Response.
 */
function documentResponse(document: {
  id: string;
  courseId: string;
  name: string;
  filePath: string;
  fileType: string;
  fileSize: bigint;
  status: string;
  processingError: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: document.id,
    courseId: document.courseId,
    name: document.name,
    fileType: document.fileType,
    fileSize: Number(document.fileSize),
    status: document.status,
    processingError: document.processingError,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

/**
 * Explain the purpose of content Disposition.
 */
function contentDisposition(filename: string): string {
  const safeAscii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Explain the purpose of invalid Upload.
 */
function invalidUpload(reply: FastifyReply) {
  return reply.code(415).send({
    success: false,
    error: {
      code: "UNSUPPORTED_FILE_TYPE",
      message: "Only PDF, PNG, and JPEG files are supported.",
      details: null,
    },
  });
}

/**
 * Validate Image.
 */
async function validateImage(data: Buffer, expectedExtension: string): Promise<boolean> {
  try {
    const metadata = await sharp(data, {
      failOn: "error",
      limitInputPixels: 40_000_000,
    }).metadata();
    const expectedFormat = expectedExtension === ".png" ? "png" : "jpeg";
    return (
      metadata.format === expectedFormat &&
      metadata.width !== undefined &&
      metadata.height !== undefined &&
      (metadata.pages === undefined || metadata.pages === 1)
    );
  } catch {
    return false;
  }
}

/**
 * Handle the document Routes.
 */
const documentRoutes: FastifyPluginAsync<DocumentRouteOptions> = async (
  app,
  { repository, storage, requireAuthentication },
) => {
  app.get<{ Params: CourseParams }>(
    "/courses/:courseId/documents",
    {
      preHandler: requireAuthentication,
      schema: { params: courseParamsSchema },
    },
    async (request, reply) => {
      const documents = await repository.listDocuments(
        getUserId(request),
        request.params.courseId,
      );
      if (!documents) {
        return reply.code(404).send({
          success: false,
          error: {
            code: "COURSE_NOT_FOUND",
            message: "Course not found.",
            details: null,
          },
        });
      }

      return {
        success: true,
        data: documents.map(documentResponse),
        meta: null,
      };
    },
  );

  app.post<{ Params: CourseParams }>(
    "/courses/:courseId/documents",
    {
      preHandler: requireAuthentication,
      schema: { params: courseParamsSchema },
    },
    async (request, reply) => {
      const userId = getUserId(request);
      if (!(await repository.ownsCourse(userId, request.params.courseId))) {
        return reply.code(404).send({
          success: false,
          error: {
            code: "COURSE_NOT_FOUND",
            message: "Course not found.",
            details: null,
          },
        });
      }

      const upload = await request.file({
        limits: { files: 1, fields: 0, parts: 1, fileSize: maximumUploadBytes },
      });
      if (!upload) {
        return reply.code(400).send({
          success: false,
          error: {
            code: "FILE_REQUIRED",
            message: "Provide one file in the multipart field named file.",
            details: null,
          },
        });
      }

      if (upload.fieldname !== "file") {
        upload.file.resume();
        return reply.code(400).send({
          success: false,
          error: {
            code: "FILE_REQUIRED",
            message: "The uploaded file must use the multipart field named file.",
            details: null,
          },
        });
      }

      let data: Buffer;
      try {
        data = await upload.toBuffer();
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          error.statusCode === 413
        ) {
          return reply.code(413).send({
            success: false,
            error: {
              code: "FILE_TOO_LARGE",
              message: "The maximum upload size is 10 MiB.",
              details: null,
            },
          });
        }

        throw error;
      }
      if (upload.file.truncated || data.length > maximumUploadBytes) {
        return reply.code(413).send({
          success: false,
          error: {
            code: "FILE_TOO_LARGE",
            message: "The maximum upload size is 10 MiB.",
            details: null,
          },
        });
      }

      const extension = extensionFromOriginalFilename(upload.filename);
      const detectedType = documentTypes.find((type) =>
        type.signature(data),
      );
      const extensionMatches =
        (detectedType?.extension === "jpg" && extension === ".jpeg") ||
        `.${detectedType?.extension}` === extension;
      if (!detectedType || !extensionMatches) {
        return invalidUpload(reply);
      }
      if (
        detectedType.extension !== "pdf" &&
        !(await validateImage(data, extension))
      ) {
        return reply.code(422).send({
          success: false,
          error: {
            code: "INVALID_IMAGE",
            message: "The uploaded image is malformed or exceeds processing limits.",
            details: null,
          },
        });
      }

      const originalName = sanitizeOriginalFilename(upload.filename);
      const stored = await storage.saveUpload(detectedType.extension, data);
      try {
        const document = await repository.createDocument({
          courseId: request.params.courseId,
          name: originalName,
          filePath: stored.filePath,
          fileType: detectedType.mimeType,
          fileSize: data.length,
          status: "PENDING",
        });

        return reply.code(201).send({
          success: true,
          data: documentResponse(document),
          meta: { processing: "queued" },
        });
      } catch (error) {
        await storage.removeUpload(stored.id, stored.extension);
        throw error;
      }
    },
  );

  app.get<{ Params: DocumentParams }>(
    "/courses/:courseId/documents/:documentId",
    {
      preHandler: requireAuthentication,
      schema: { params: documentParamsSchema },
    },
    async (request, reply) => {
      const document = await repository.getDocument(
        getUserId(request),
        request.params.courseId,
        request.params.documentId,
      );
      if (!document) {
        return reply.code(404).send({
          success: false,
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "Document not found.",
            details: null,
          },
        });
      }

      const data = await storage.readUpload(document.filePath);
      return reply
        .type(document.fileType)
        .header("content-disposition", contentDisposition(document.name))
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, no-store")
        .send(data);
    },
  );

  app.delete<{ Params: DocumentParams }>(
    "/courses/:courseId/documents/:documentId",
    {
      preHandler: requireAuthentication,
      schema: { params: documentParamsSchema },
    },
    async (request, reply) => {
      const document = await repository.deleteDocument(
        getUserId(request),
        request.params.courseId,
        request.params.documentId,
      );
      if (!document) {
        return reply.code(404).send({
          success: false,
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "Document not found.",
            details: null,
          },
        });
      }

      await storage.removeDocument(document.filePath);
      return { success: true, data: null, meta: null };
    },
  );
};

export default documentRoutes;
