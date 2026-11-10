import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { DocumentOcr } from "./document-ocr.js";

/**
 * Create Text Pdf.
 */
function createTextPdf(text: string): Buffer {
  const stream = `BT /F1 30 Tf 20 60 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
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
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    document += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  document += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
}

describe("DocumentOcr", () => {
  it("uses the packaged English model to recognize images and rendered PDF pages", async (t) => {
    const ocr = new DocumentOcr();
    t.after(async () => ocr.close());

    const image = await sharp(
      Buffer.from(
        '<svg width="1000" height="180"><rect width="100%" height="100%" fill="white"/><text x="35" y="120" font-size="72" font-family="Arial" fill="black">STUDYMATE OCR</text></svg>',
      ),
    )
      .png()
      .toBuffer();
    const imageText = await ocr.extractImageText(image);
    assert.match(imageText.toUpperCase(), /STUDYMATE/);

    const pdfText = await ocr.extractPdfImageText(
      createTextPdf("STUDYMATE PDF OCR"),
    );
    assert.match(pdfText.toUpperCase(), /STUDYMATE/);
  });
});
