import { OllamaClient } from "../../infrastructure/ai/ollama-client.js";
import type {
  CourseChunkRecord,
  DocumentIngestionRepository,
} from "../courses/courses.repository.js";

const maximumCourseChunks = 2000;
const minimumCosineSimilarity = 0.12;

export interface RetrievedSource {
  citation: string;
  documentId: string;
  documentName: string;
  chunkPosition: number;
  content: string;
  similarity: number;
}

export class RagService {
  /**
 * Create this instance.
 */
  constructor(
    private readonly repository: Pick<
      DocumentIngestionRepository,
      "listCourseChunks"
    >,
    private readonly ai: Pick<OllamaClient, "embed">,
  ) {}

  /**
 * Explain the purpose of retrieve.
 */
  async retrieve(
    userId: string,
    courseId: string,
    query: string,
    limit = 5,
  ): Promise<RetrievedSource[] | null> {
    const storedChunks = await this.repository.listCourseChunks(
      userId,
      courseId,
      maximumCourseChunks,
    );
    if (storedChunks === null) {
      return null;
    }
    if (storedChunks.length === 0) {
      return [];
    }

    const [queryEmbedding] = await this.ai.embed([query]);
    if (!queryEmbedding) {
      return [];
    }

    const ranked = storedChunks
      .map((chunk) => ({
        chunk,
        similarity: cosineSimilarity(
          queryEmbedding,
          parseEmbedding(chunk),
        ),
      }))
      .filter(
        (item): item is { chunk: CourseChunkRecord; similarity: number } =>
          item.similarity >= minimumCosineSimilarity,
      )
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, Math.max(1, Math.min(10, limit)));

    return ranked.map(({ chunk, similarity }, index) => ({
      citation: `S${index + 1}`,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      chunkPosition: chunk.position,
      content: chunk.content,
      similarity,
    }));
  }
}

/**
 * Parse Embedding.
 */
function parseEmbedding(chunk: CourseChunkRecord): number[] {
  const value = chunk.embedding;
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }
  const coordinates: number[] = [];
  for (const coordinate of value) {
    if (
      typeof coordinate !== "number" ||
      !Number.isFinite(coordinate)
    ) {
      return [];
    }
    coordinates.push(coordinate);
  }
  return coordinates;
}

/**
 * Explain the purpose of cosine Similarity.
 */
function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return -1;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return -1;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
