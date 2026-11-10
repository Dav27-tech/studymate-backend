import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CourseChunkRecord } from "../courses/courses.repository.js";
import { RagService } from "./rag.service.js";

const chunks: CourseChunkRecord[] = [
  {
    documentId: "doc-1",
    documentName: "biology.pdf",
    position: 0,
    content: "Cell biology and mitochondria.",
    embedding: [1, 0],
  },
  {
    documentId: "doc-2",
    documentName: "history.pdf",
    position: 4,
    content: "The Roman republic.",
    embedding: [0, 1],
  },
];

describe("RagService", () => {
  it("retrieves only authorized, relevant course chunks with citations", async () => {
    const service = new RagService(
      { listCourseChunks: async () => chunks },
      { embed: async () => [[1, 0]] },
    );

    assert.deepEqual(
      await service.retrieve("user-1", "course-1", "mitochondria"),
      [
        {
          citation: "S1",
          documentId: "doc-1",
          documentName: "biology.pdf",
          chunkPosition: 0,
          content: "Cell biology and mitochondria.",
          similarity: 1,
        },
      ],
    );
  });

  it("returns null for unavailable courses and empty results for unindexed ones", async () => {
    const unavailable = new RagService(
      { listCourseChunks: async () => null },
      { embed: async () => [[1, 0]] },
    );
    const unindexed = new RagService(
      { listCourseChunks: async () => [] },
      { embed: async () => [[1, 0]] },
    );

    assert.equal(await unavailable.retrieve("user-1", "other", "query"), null);
    assert.deepEqual(await unindexed.retrieve("user-1", "course-1", "query"), []);
  });

  it("ignores malformed and dimension-mismatched vectors", async () => {
    const service = new RagService(
      {
        listCourseChunks: async () => [
          ...chunks,
          { ...chunks[0]!, embedding: [Number.NaN, 0] },
        ],
      },
      { embed: async () => [[0, 1, 2]] },
    );

    assert.deepEqual(
      await service.retrieve("user-1", "course-1", "query"),
      [],
    );
  });
});
