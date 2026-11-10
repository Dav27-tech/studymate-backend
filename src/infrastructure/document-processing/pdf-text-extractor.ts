import { PDFParse } from "pdf-parse";

const maximumPdfPages = 500;
const maximumExtractedTextBytes = 5 * 1024 * 1024;

export class PdfProcessingError extends Error {
  /**
 * Create this instance.
 */
  constructor(
    public readonly code: "INVALID_PDF" | "PDF_TOO_MANY_PAGES" | "PDF_TEXT_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "PdfProcessingError";
  }
}

/**
 * Explain the purpose of extract Pdf Text.
 */
export async function extractPdfText(data: Buffer): Promise<string> {
  const parser = new PDFParse({
    data: new Uint8Array(data),
    isEvalSupported: false,
    stopAtErrors: true,
    useWorkerFetch: false,
  });

  try {
    const info = await parser.getInfo();
    if (info.total > maximumPdfPages) {
      throw new PdfProcessingError(
        "PDF_TOO_MANY_PAGES",
        `PDF exceeds the ${maximumPdfPages}-page processing limit.`,
      );
    }

    const result = await parser.getText();
    const text = result.text
      .replace(/\u0000/g, "")
      .replace(/\n-- \d+ of \d+ --\s*$/g, "")
      .trim();
    if (Buffer.byteLength(text, "utf8") > maximumExtractedTextBytes) {
      throw new PdfProcessingError(
        "PDF_TEXT_TOO_LARGE",
        "Extracted PDF text exceeds the processing limit.",
      );
    }

    return text;
  } catch (error) {
    if (error instanceof PdfProcessingError) {
      throw error;
    }

    throw new PdfProcessingError(
      "INVALID_PDF",
      "The PDF is invalid, encrypted, or could not be processed.",
    );
  } finally {
    await parser.destroy();
  }
}
