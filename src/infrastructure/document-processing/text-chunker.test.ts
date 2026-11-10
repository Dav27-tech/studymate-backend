import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitTextIntoChunks } from "./text-chunker.js";

describe("splitTextIntoChunks", () => {
  it("preserves text order with bounded overlapping chunks", () => {
    const input = `${"alpha ".repeat(120)}ending`;
    const chunks = splitTextIntoChunks(input, 200, 30);

    assert.ok(chunks.length > 1);
    assert.deepEqual(chunks.map(({ position }) => position), chunks.map((_, i) => i));
    assert.ok(chunks.every(({ content }) => content.length <= 200));
    assert.ok(chunks.some(({ content }) => content.includes("ending")));
    assert.ok(chunks[0]?.content.includes(chunks[1]?.content.slice(0, 20) ?? ""));
  });

  it("rejects unsafe chunk parameters", () => {
    assert.throws(() => splitTextIntoChunks("text", 20, 2), RangeError);
    assert.throws(() => splitTextIntoChunks("text", 100, 100), RangeError);
  });
});
