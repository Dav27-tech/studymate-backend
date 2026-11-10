import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import { InvalidDocumentAssociationError } from "./courses.repository.js";
import type {
  ChapterInput,
  CourseInput,
  CourseRepository,
  Pagination,
} from "./courses.repository.js";

interface CourseRouteOptions {
  repository: CourseRepository;
  requireAuthentication: preHandlerHookHandler;
}

interface CourseParams {
  courseId: string;
}

interface ChapterParams extends CourseParams {
  chapterId: string;
}

interface ListQuery {
  page: number;
  pageSize: number;
}

interface ApiErrorShape {
  statusCode: number;
  code: string;
  message: string;
}

class ResourceError extends Error implements ApiErrorShape {
  /**
 * Create this instance.
 */
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ResourceError";
  }
}

const uuidPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

const courseParamsSchema = {
  type: "object",
  required: ["courseId"],
  properties: { courseId: { type: "string", pattern: uuidPattern } },
} as const;

const chapterParamsSchema = {
  type: "object",
  required: ["courseId", "chapterId"],
  properties: {
    courseId: { type: "string", pattern: uuidPattern },
    chapterId: { type: "string", pattern: uuidPattern },
  },
} as const;

const paginationQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
} as const;

/**
 * Get User Id.
 */
function getUserId(request: FastifyRequest): string {
  const userId = request.authenticatedUser?.id;
  if (!userId) {
    throw new ResourceError(401, "UNAUTHENTICATED", "Authentication is required.");
  }

  return userId;
}

/**
 * Get Pagination.
 */
function getPagination(query: ListQuery): {
  pagination: Pagination;
  page: number;
  pageSize: number;
} {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return {
    pagination: { skip: (page - 1) * pageSize, take: pageSize },
    page,
    pageSize,
  };
}

/**
 * Explain the purpose of page Meta.
 */
function pageMeta(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    hasNextPage: page * pageSize < total,
  };
}

/**
 * Explain the purpose of error Response.
 */
function errorResponse(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidDocumentAssociationError) {
    return reply.code(400).send({
      success: false,
      error: {
        code: "INVALID_DOCUMENT_ASSOCIATION",
        message: error.message,
        details: null,
      },
    });
  }

  if (error instanceof ResourceError) {
    return reply.code(error.statusCode).send({
      success: false,
      error: { code: error.code, message: error.message, details: null },
    });
  }

throw error;
}

/**
 * Handle the course Routes.
 */
const courseRoutes: FastifyPluginAsync<CourseRouteOptions> = async (
  app,
  { repository, requireAuthentication },
) => {
  app.get<{ Querystring: ListQuery }>(
    "/courses",
    {
      preHandler: requireAuthentication,
      schema: { querystring: paginationQuerySchema },
    },
    async (request) => {
      const { pagination, page, pageSize } = getPagination(request.query);
      const result = await repository.listCourses(
        getUserId(request),
        pagination,
      );
      return {
        success: true,
        data: result.items,
        meta: pageMeta(page, pageSize, result.total),
      };
    },
  );

  app.post<{ Body: CourseInput }>(
    "/courses",
    {
      preHandler: requireAuthentication,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["title"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 5000 },
          },
        },
      },
    },
    async (request, reply) => {
      const title = request.body.title.trim();
      if (!title) {
        return reply.code(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Course title cannot be empty.",
            details: null,
          },
        });
      }



      const course = await repository.createCourse(getUserId(request), {
        ...request.body,
        title,
      });
      return reply.code(201).send({ success: true, data: course, meta: null });
    },
  );

  app.get<{ Params: CourseParams }>(
    "/courses/:courseId",
    {
      preHandler: requireAuthentication,
      schema: { params: courseParamsSchema },
    },
    async (request, reply) => {
      const course = await repository.getCourse(
        getUserId(request),
        request.params.courseId,
      );
      if (!course) {
        return reply.code(404).send({
          success: false,
          error: { code: "COURSE_NOT_FOUND", message: "Course not found.", details: null },
        });
      }

return { success: true, data: course, meta: null };
    },
  );

  app.patch<{ Params: CourseParams; Body: Partial<CourseInput> }>(
    "/courses/:courseId",
    {
      preHandler: requireAuthentication,
      schema: {
        params: courseParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 5000 },
          },
        },
      },
    },
    async (request, reply) => {
      const input = { ...request.body };
      if (input.title !== undefined) {
        input.title = input.title.trim();
        if (!input.title) {
          return reply.code(400).send({
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Course title cannot be empty.",
              details: null,
            },
          });
        }
      }

      const course = await repository.updateCourse(
        getUserId(request),
        request.params.courseId,
        input,
      );
      if (!course) {
        return reply.code(404).send({
          success: false,
          error: { code: "COURSE_NOT_FOUND", message: "Course not found.", details: null },
        });
      }
      return { success: true, data: course, meta: null };
    },
  );

  app.delete<{ Params: CourseParams }>(
    "/courses/:courseId",
    {
      preHandler: requireAuthentication,
      schema: { params: courseParamsSchema },
    },
    async (request, reply) => {
      const archived = await repository.deleteCourse(
        getUserId(request),
        request.params.courseId,
      );
      if (!archived) {
        return reply.code(404).send({
          success: false,
          error: { code: "COURSE_NOT_FOUND", message: "Course not found.", details: null },
        });
      }

      return { success: true, data: { archived: true }, meta: null };
    },
  );

  app.get<{ Params: CourseParams; Querystring: ListQuery }>(
    "/courses/:courseId/chapters",
    {
      preHandler: requireAuthentication,
      schema: { params: courseParamsSchema, querystring: paginationQuerySchema },
    },
    async (request, reply) => {
      const { pagination, page, pageSize } = getPagination(request.query);
      const result = await repository.listChapters(
        getUserId(request),
        request.params.courseId,
        pagination,
      );
      if (!result) {
        return reply.code(404).send({
          success: false,
          error: { code: "COURSE_NOT_FOUND", message: "Course not found.", details: null },
        });
      }

      return {
        success: true,
        data: result.items,
        meta: pageMeta(page, pageSize, result.total),
      };
    },
  );

  app.post<{ Params: CourseParams; Body: ChapterInput }>(
    "/courses/:courseId/chapters",
    {
      preHandler: requireAuthentication,
      schema: {
        params: courseParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["title"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 5000 },
            content: { type: ["string", "null"], maxLength: 1000000 },
            position: { type: "integer", minimum: 0, maximum: 1000000 },
            documentId: { type: ["string", "null"], pattern: uuidPattern },
          },
        },
      },
    },
    async (request, reply) => {
      const input = { ...request.body, title: request.body.title.trim() };
      if (!input.title) {
        return reply.code(400).send({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Chapter title cannot be empty.",
            details: null,
          },
        });
      }

      try {
        const chapter = await repository.createChapter(
          getUserId(request),
          request.params.courseId,
          input,
        );
        if (!chapter) {
          return reply.code(404).send({
            success: false,
            error: { code: "COURSE_NOT_FOUND", message: "Course not found.", details: null },
          });
        }

        return reply.code(201).send({
          success: true,
          data: chapter,
          meta: null,
        });
      } catch (error) {
        return errorResponse(error, reply);
      }
    },
  );

  app.get<{ Params: ChapterParams }>(
    "/courses/:courseId/chapters/:chapterId",
    {
      preHandler: requireAuthentication,
      schema: { params: chapterParamsSchema },
    },
    async (request, reply) => {
      const chapter = await repository.getChapter(
        getUserId(request),
        request.params.courseId,
        request.params.chapterId,
      );
      if (!chapter) {
        return reply.code(404).send({
          success: false,
          error: { code: "CHAPTER_NOT_FOUND", message: "Chapter not found.", details: null },
        });
      }

      return { success: true, data: chapter, meta: null };
    },
  );

  app.patch<{ Params: ChapterParams; Body: Partial<ChapterInput> }>(
    "/courses/:courseId/chapters/:chapterId",
    {
      preHandler: requireAuthentication,
      schema: {
        params: chapterParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 5000 },
            content: { type: ["string", "null"], maxLength: 1000000 },
            position: { type: "integer", minimum: 0, maximum: 1000000 },
            documentId: { type: ["string", "null"], pattern: uuidPattern },
          },
        },
      },
    },
    async (request, reply) => {
      const input = { ...request.body };
      if (input.title !== undefined) {
        input.title = input.title.trim();
        if (!input.title) {
          return reply.code(400).send({
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Chapter title cannot be empty.",
              details: null,
            },
          });
        }
      }

      try {
        const chapter = await repository.updateChapter(
          getUserId(request),
          request.params.courseId,
          request.params.chapterId,
          input,
        );
        if (!chapter) {
          return reply.code(404).send({
            success: false,
            error: { code: "CHAPTER_NOT_FOUND", message: "Chapter not found.", details: null },
          });
        }
        return { success: true, data: chapter, meta: null };
      } catch (error) {
        return errorResponse(error, reply);
      }
    },
  );

  app.delete<{ Params: ChapterParams }>(
    "/courses/:courseId/chapters/:chapterId",
    {
      preHandler: requireAuthentication,
      schema: { params: chapterParamsSchema },
    },
    async (request, reply) => {
      const deleted = await repository.deleteChapter(
        getUserId(request),
        request.params.courseId,
        request.params.chapterId,
      );
      if (!deleted) {
        return reply.code(404).send({
          success: false,
          error: { code: "CHAPTER_NOT_FOUND", message: "Chapter not found.", details: null },
        });
      }
      return { success: true, data: null, meta: null };
    },
  );
};

export default courseRoutes;
