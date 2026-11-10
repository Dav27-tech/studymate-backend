export interface TextChunk {
  position: number;
  content: string;
}

/**
 * Explain the purpose of split Text Into Chunks.
 */
export function splitTextIntoChunks(
  input: string,
  maximumCharacters = 1200,
  overlapCharacters = 160,
): TextChunk[] {
  if (
    !Number.isInteger(maximumCharacters) ||
    !Number.isInteger(overlapCharacters) ||
    maximumCharacters < 100 ||
    overlapCharacters < 0 ||
    overlapCharacters >= maximumCharacters
  ) {
    throw new RangeError("Invalid text chunk size.");
  }

  const text = input.replace(/\u0000/g, "").trim();
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maximumCharacters, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start + maximumCharacters * 0.6) {
        end = boundary;
      }
    }

    const content = text.slice(start, end).trim();
    if (content) {
      chunks.push({ position: chunks.length, content });
    }
    if (end >= text.length) {
      break;
    }
    start = Math.max(end - overlapCharacters, start + 1);
    while (/\s/.test(text[start] ?? "") && start < text.length) {
      start += 1;
    }
  }
  return chunks;
}
