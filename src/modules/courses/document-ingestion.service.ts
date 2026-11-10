import { AIProviderError, OllamaClient } from "../../infrastructure/ai/ollama-client.js";
import {
  DocumentOcr,
  OcrProcessingError,
} from "../../infrastructure/document-processing/document-ocr.js";
import {
  PdfProcessingError,
} from "../../infrastructure/document-processing/pdf-text-extractor.js";
import { splitTextIntoChunks } from "../../infrastructure/document-processing/text-chunker.js";
import type { PrivateFileStorage } from "../../infrastructure/storage/private-file-storage.js";
import type {
  DocumentChunkInput,
  DocumentIngestionRepository,
  DocumentJobRecord,
} from "./courses.repository.js";

const maximumDocumentChunks = 2000;
const embeddingBatchSize = 16;
const pollingIntervalMs = 2000;
const abandonedJobAgeMs = 30 * 60 * 1000;

export interface DocumentProcessorLogger {
  info(data: object, message: string): void;
  error(data: object, message: string): void;
}

export interface OcrProcessor {
  extractImageText(image: Buffer): Promise<string>;
  extractPdfImageText(data: Buffer): Promise<string>;
  close(): Promise<void>;
}

export interface DocumentIngestionDependencies {
  repository: Pick<
    DocumentIngestionRepository,
    | "claimPendingDocument"
    | "resetStaleDocuments"
    | "saveDocumentChunks"
    | "completeDocument"
    | "failDocument"
  >;
  storage: Pick<
    PrivateFileStorage,
    "readUpload" | "saveExtractedText" | "remove"
  >;
  ai: Pick<OllamaClient, "embed">;
  ocr: OcrProcessor;
  extractPdfText: (data: Buffer) => Promise<string>;
}

export class DocumentIngestionService {
  private interval: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private running = false;

  constructor(private readonly dependencies: DocumentIngestionDependencies) {}

  /**
   * Start the document worker so it can claim pending jobs and process them in the background.
   */
  async start(logger: DocumentProcessorLogger): Promise<void> {
    if (this.running) {
      return;
    }

    await this.dependencies.repository.resetStaleDocuments(
      new Date(Date.now() - abandonedJobAgeMs),
    );
    this.running = true;
    this.poll(logger);
    this.interval = setInterval(
      () => this.poll(logger),
      pollingIntervalMs,
    ).unref();
  }

  /**
   * Stop the polling loop and clean up the OCR resources used by the worker.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    await this.inFlight;
    await this.dependencies.ocr.close();
  }

  /**
   * Poll the queue for pending work while the worker is running.
   */
  private poll(logger: DocumentProcessorLogger): void {
    if (!this.running || this.inFlight) {
      return;
    }

    this.inFlight = this.processOne(logger)
      .catch((error: unknown) => {
        logger.error(
          {
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
          "Document queue polling failed",
        );
      })
      .finally(() => {
        this.inFlight = undefined;
      });
  }

  private async processOne(logger: DocumentProcessorLogger): Promise<void> {
    // Process exactly one queued document at a time to avoid duplicate work while the worker is active.
    const document = await this.dependencies.repository.claimPendingDocument();
    if (!document) {
      return;
    }

    try {
      await this.processDocument(document);
      await this.dependencies.repository.completeDocument(document.id);
      logger.info({ documentId: document.id }, "Document processing completed");
    } catch (error) {
      const message = this.getSafeErrorMessage(error);
      await this.dependencies.repository.failDocument(document, message);
      logger.error(
        {
          documentId: document.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
          attempt: document.processingAttempts,
        },
        "Document processing failed",
      );
    }
  }

  private async processDocument(document: DocumentJobRecord): Promise<void> {
    const upload = await this.dependencies.storage.readUpload(document.filePath);
    let text: string;
    if (document.fileType === "application/pdf") {
      text = await this.dependencies.extractPdfText(upload);
      if (text.trim().length < 20) {
        text = await this.dependencies.ocr.extractPdfImageText(upload);
      }
    } else {
      text = await this.dependencies.ocr.extractImageText(upload);
    }

    text = text.trim();
    if (text.length < 3) {
      throw new OcrProcessingError(
        "NO_TEXT_FOUND",
        "No readable text was found in the document.",
      );
    }

    const documentId = document.id;
    const storageId = document.filePath.slice(0, document.filePath.lastIndexOf("."));
    await this.dependencies.storage.saveExtractedText(storageId, text);

    const textChunks = splitTextIntoChunks(text);
    if (textChunks.length > maximumDocumentChunks) {
      await this.dependencies.storage.remove(`${storageId}.txt`);
      throw new OcrProcessingError(
        "NO_TEXT_FOUND",
        `Document exceeds the ${maximumDocumentChunks}-chunk indexing limit.`,
      );
    }

    const indexedChunks: DocumentChunkInput[] = [];
    for (let start = 0; start < textChunks.length; start += embeddingBatchSize) {
      const batch = textChunks.slice(start, start + embeddingBatchSize);
      const embeddings = await this.dependencies.ai.embed(
        batch.map((chunk) => chunk.content),
      );
      indexedChunks.push(
        ...batch.map((chunk, index) => {
          const embedding = embeddings[index];
          if (!embedding) {
            throw new AIProviderError(
              "The AI provider returned an incomplete embedding batch.",
            );
          }
          return {
            documentId,
            position: chunk.position,
            content: chunk.content,
            embedding,
          };
        }),
      );
    }

    await this.dependencies.repository.saveDocumentChunks(
      documentId,
      indexedChunks,
    );
  }

  /**
   * Return a safe, user-facing error message for document processing failures.
   */
  private getSafeErrorMessage(error: unknown): string {
    if (error instanceof PdfProcessingError || error instanceof OcrProcessingError) {
      return error.message;
    }
    if (error instanceof AIProviderError) {
      return "AI processing is temporarily unavailable.";
    }
    return "Document processing failed.";
  }
}
