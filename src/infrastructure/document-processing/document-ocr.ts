import { createRequire } from "node:module";
import { PDFParse } from "pdf-parse";
import { createWorker, type Worker } from "tesseract.js";

const require = createRequire(import.meta.url);
const englishLanguage = require("@tesseract.js-data/eng") as {
  code: string;
  gzip: boolean;
  langPath: string;
};
const maximumOcrPages = 30;
const maximumOcrTextBytes = 5 * 1024 * 1024;
const maximumPdfPageSide = 14_400;
const maximumRenderedPageSide = 2_200;
const maximumRenderedPagePixels = 4_000_000;

export class OcrProcessingError extends Error {
  /**
 * Create this instance.
 */
  constructor(
    public readonly code:
      | "PDF_TOO_MANY_OCR_PAGES"
      | "INVALID_PDF_PAGE_SIZE"
      | "OCR_TEXT_TOO_LARGE"
      | "NO_TEXT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "OcrProcessingError";
  }
}

export class DocumentOcr {
  private workerPromise: Promise<Worker> | undefined;

  /**
 * Explain the purpose of extract Image Text.
 */
  async extractImageText(image: Buffer): Promise<string> {
    const worker = await this.getWorker();
    const result = await worker.recognize(image);
    return this.normalizeText(result.data.text);
  }

  /**
 * Explain the purpose of extract Pdf Image Text.
 */
  async extractPdfImageText(data: Buffer): Promise<string> {
    const parser = new PDFParse({
      data: new Uint8Array(data),
      isEvalSupported: false,
      stopAtErrors: true,
      useWorkerFetch: false,
    });
    try {
      const info = await parser.getInfo({ parsePageInfo: true });
      if (info.total > maximumOcrPages) {
        throw new OcrProcessingError(
          "PDF_TOO_MANY_OCR_PAGES",
          `Scanned PDFs are limited to ${maximumOcrPages} pages for OCR.`,
        );
      }

      const worker = await this.getWorker();
      const pages: string[] = [];
      let totalBytes = 0;
      for (let pageNumber = 1; pageNumber <= info.total; pageNumber += 1) {
        const pageInfo = info.pages[pageNumber - 1];
        if (
          !pageInfo ||
          !Number.isFinite(pageInfo.width) ||
          !Number.isFinite(pageInfo.height) ||
          pageInfo.width <= 0 ||
          pageInfo.height <= 0 ||
          pageInfo.width > maximumPdfPageSide ||
          pageInfo.height > maximumPdfPageSide
        ) {
          throw new OcrProcessingError(
            "INVALID_PDF_PAGE_SIZE",
            "A PDF page exceeds the supported OCR dimensions.",
          );
        }

        const scale = Math.min(
          1.5,
          maximumRenderedPageSide / Math.max(pageInfo.width, pageInfo.height),
          Math.sqrt(
            maximumRenderedPagePixels / (pageInfo.width * pageInfo.height),
          ),
        );
        const screenshot = await parser.getScreenshot({
          partial: [pageNumber],
          scale,
          imageBuffer: true,
          imageDataUrl: false,
        });
        const page = screenshot.pages[0]?.data;
        if (!page) {
          continue;
        }
        const result = await worker.recognize(Buffer.from(page));
        const text = this.normalizeText(result.data.text);
        totalBytes += Buffer.byteLength(text, "utf8");
        if (totalBytes > maximumOcrTextBytes) {
          throw new OcrProcessingError(
            "OCR_TEXT_TOO_LARGE",
            "Extracted document text exceeds the processing limit.",
          );
        }
        if (text) {
          pages.push(text);
        }
      }

      return this.normalizeText(pages.join("\n\n"));
    } finally {
      await parser.destroy();
    }
  }

  /**
 * Close the underlying resource and release cleanup work.
 */
  async close(): Promise<void> {
    if (this.workerPromise) {
      const worker = await this.workerPromise;
      await worker.terminate();
      this.workerPromise = undefined;
    }
  }

  /**
   * Get Worker.
   */
  private getWorker(): Promise<Worker> {
    this.workerPromise ??= createWorker(englishLanguage.code, 1, {
      langPath: englishLanguage.langPath,
      gzip: englishLanguage.gzip,
      cacheMethod: "none",
    });
    return this.workerPromise;
  }

  /**
 * Normalize the Text.
 */
  private normalizeText(text: string): string {
    const normalized = text
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (Buffer.byteLength(normalized, "utf8") > maximumOcrTextBytes) {
      throw new OcrProcessingError(
        "OCR_TEXT_TOO_LARGE",
        "Extracted document text exceeds the processing limit.",
      );
    }
    return normalized;
  }
}
