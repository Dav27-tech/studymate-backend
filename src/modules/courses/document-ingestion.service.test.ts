import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OllamaClient } from "../../infrastructure/ai/ollama-client.js";
import type { PrivateFileStorage } from "../../infrastructure/storage/private-file-storage.js";
import type {
  DocumentChunkInput,
  DocumentIngestionRepository,
  DocumentJobRecord,
} from "./courses.repository.js";
import {
  DocumentIngestionService,
  type DocumentProcessorLogger,
  type OcrProcessor,
} from "./document-ingestion.service.js";

class TestRepository
  implements
    Pick<
      DocumentIngestionRepository,
      | "claimPendingDocument"
      | "resetStaleDocuments"
      | "saveDocumentChunks"
      | "completeDocument"
      | "failDocument"
    >
{
  claimed: DocumentJobRecord | null;
  readonly chunks: DocumentChunkInput[] = [];
  readonly failures: string[] = [];
  completed = false;
  resetBefore: Date | undefined;

  /**
 * Create this instance.
 */
  constructor(document: DocumentJobRecord | null) {
    this.claimed = document;
  }

  /**
 * Claim the Pending Document.
 */
  async claimPendingDocument(): Promise<DocumentJobRecord | null> {
    const document = this.claimed;
    this.claimed = null;
    return document;
  }

  /**
 * Reset the Stale Documents.
 */
  async resetStaleDocuments(staleBefore: Date): Promise<void> {
    this.resetBefore = staleBefore;
  }

  /**
 * Save the Document Chunks.
 */
  async saveDocumentChunks(
    _documentId: string,
    chunks: DocumentChunkInput[],
  ): Promise<void> {
    this.chunks.push(...chunks);
  }

  /**
 * Complete the Document.
 */
  async completeDocument(): Promise<void> {
    this.completed = true;
  }

  /**
 * Fail the Document.
 */
  async failDocument(
    _document: DocumentJobRecord,
    message: string,
  ): Promise<void> {
    this.failures.push(message);
  }
}

class TestStorage implements Pick<
  PrivateFileStorage,
  "readUpload" | "saveExtractedText" | "remove"
> {
  readonly savedTexts: Array<{ id: string; text: string }> = [];
  readonly removed: string[] = [];

  /**
   * Read Upload.
   */
  async readUpload(): Promise<Buffer> {
    return Buffer.from("test input");
  }

  /**
 * Save the Extracted Text.
 */
  async saveExtractedText(id: string, text: string): Promise<void> {
    this.savedTexts.push({ id, text });
  }

  /**
   * Remove .
   */
  async remove(filePath: string): Promise<void> {
    this.removed.push(filePath);
  }
}

class TestOcr implements OcrProcessor {
  imageText = "Image study notes with enough words to index.";
  pdfText = "Scanned study notes with enough words to index.";
  imageCalls = 0;
  pdfCalls = 0;
  closed = false;

  /**
 * Explain the purpose of extract Image Text.
 */
  async extractImageText(): Promise<string> {
    this.imageCalls += 1;
    return this.imageText;
  }

  /**
 * Explain the purpose of extract Pdf Image Text.
 */
  async extractPdfImageText(): Promise<string> {
    this.pdfCalls += 1;
    return this.pdfText;
  }

  /**
 * Close the underlying resource and release cleanup work.
 */
  async close(): Promise<void> {
    this.closed = true;
  }
}

class TestAi implements Pick<OllamaClient, "embed"> {
  readonly batches: string[][] = [];

  /**
 * Embed the input text so it can be searched semantically.
 */
  async embed(inputs: string[]): Promise<number[][]> {
    this.batches.push(inputs);
    return inputs.map(() => [0.25, 0.75]);
  }
}

const logger: DocumentProcessorLogger = {
  info() {},
  error() {},
};

const pdfDocument: DocumentJobRecord = {
  id: "document-id",
  courseId: "course-id",
  filePath: "12345678-1234-4234-8234-123456789012.pdf",
  fileType: "application/pdf",
  processingAttempts: 1,
};

/**
 * Wait for the For.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), "Expected background document processing to finish.");
}

describe("DocumentIngestionService", () => {
  it("extracts, chunks, embeds, and completes a text-based PDF", async () => {
    const repository = new TestRepository(pdfDocument);
    const storage = new TestStorage();
    const ocr = new TestOcr();
    const ai = new TestAi();
    const service = new DocumentIngestionService({
      repository,
      storage,
      ocr,
      ai,
      extractPdfText: async () => "Text-based study material with clear definitions.",
    });

    await service.start(logger);
    await waitFor(() => repository.completed || repository.failures.length > 0);
    await service.stop();

    assert.equal(repository.completed, true);
    assert.deepEqual(repository.failures, []);
    assert.equal(repository.chunks.length, 1);
    assert.equal(repository.chunks[0]?.embedding.length, 2);
    assert.equal(storage.savedTexts[0]?.id, "12345678-1234-4234-8234-123456789012");
    assert.equal(ocr.pdfCalls, 0);
    assert.equal(ocr.closed, true);
    assert.ok(repository.resetBefore instanceof Date);
  });

  it("falls back to page OCR for scanned PDFs and OCRs image uploads", async () => {
    const scannedRepository = new TestRepository(pdfDocument);
    const scannedOcr = new TestOcr();
    const scannedService = new DocumentIngestionService({
      repository: scannedRepository,
      storage: new TestStorage(),
      ocr: scannedOcr,
      ai: new TestAi(),
      extractPdfText: async () => "",
    });
    await scannedService.start(logger);
    await waitFor(() => scannedRepository.completed || scannedRepository.failures.length > 0);
    await scannedService.stop();
    assert.equal(scannedRepository.completed, true);
    assert.equal(scannedOcr.pdfCalls, 1);

    const imageRepository = new TestRepository({
      ...pdfDocument,
      filePath: "12345678-1234-4234-8234-123456789012.png",
      fileType: "image/png",
    });
    const imageOcr = new TestOcr();
    const imageService = new DocumentIngestionService({
      repository: imageRepository,
      storage: new TestStorage(),
      ocr: imageOcr,
      ai: new TestAi(),
      extractPdfText: async () => "",
    });
    await imageService.start(logger);
    await waitFor(() => imageRepository.completed || imageRepository.failures.length > 0);
    await imageService.stop();
    assert.equal(imageRepository.completed, true);
    assert.equal(imageOcr.imageCalls, 1);
  });

  it("records safe processing errors rather than leaving jobs stuck", async () => {
    const repository = new TestRepository(pdfDocument);
    const service = new DocumentIngestionService({
      repository,
      storage: new TestStorage(),
      ocr: new TestOcr(),
      ai: {
        embed: async () => {
          throw new Error("sensitive provider detail");
        },
      },
      extractPdfText: async () => "Text with enough length for chunking.",
    });

    await service.start(logger);
    await waitFor(() => repository.completed || repository.failures.length > 0);
    await service.stop();

    assert.equal(repository.completed, false);
    assert.deepEqual(repository.failures, ["Document processing failed."]);
  });
});
