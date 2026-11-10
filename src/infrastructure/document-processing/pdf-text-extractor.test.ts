import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractPdfText,
  PdfProcessingError,
} from "./pdf-text-extractor.js";

/**
 * Create Text Pdf.
 */
function createTextPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 10 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
  ];

  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document, "ascii"));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objects.length + 1}\n`;
  document += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    document += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  document += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
}

describe("extractPdfText", () => {
  it("extracts text from a valid PDF", async () => {
    const result = await extractPdfText(createTextPdf("StudyMate PDF test"));
    assert.equal(result, "StudyMate PDF test");
  });

  it("rejects malformed or non-PDF input with a safe processing error", async () => {
    await assert.rejects(
      extractPdfText(Buffer.from("not a PDF")),
      (error: unknown) =>
        error instanceof PdfProcessingError && error.code === "INVALID_PDF",
    );
  });
});
