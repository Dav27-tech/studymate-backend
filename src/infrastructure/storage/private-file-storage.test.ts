import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { LocalPrivateFileStorage } from "./private-file-storage.js";

describe("LocalPrivateFileStorage", () => {
  it("uses generated private references and removes uploaded and extracted data", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "studymate-storage-test-"));
    t.after(async () => rm(root, { recursive: true, force: true }));
    const storage = new LocalPrivateFileStorage(root);

    const stored = await storage.saveUpload("pdf", Buffer.from("%PDF-test"));
    assert.match(
      stored.filePath,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
    );
    assert.deepEqual(await storage.readUpload(stored.filePath), Buffer.from("%PDF-test"));

    await storage.saveExtractedText(stored.id, "Extracted course text");
    assert.equal(
      await storage.readExtractedText(stored.id),
      "Extracted course text",
    );
    assert.equal(
      await storage.readExtractedTextForUpload(stored.filePath),
      "Extracted course text",
    );
    await storage.removeDocument(stored.filePath);
    await assert.rejects(storage.readUpload(stored.filePath), {
      code: "ENOENT",
    });
    await assert.rejects(storage.readExtractedText(stored.id), {
      code: "ENOENT",
    });
  });

  it("rejects path traversal references", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "studymate-storage-test-"));
    t.after(async () => rm(root, { recursive: true, force: true }));
    const storage = new LocalPrivateFileStorage(root);

    assert.throws(
      () => storage.readUpload("../secret.pdf"),
      /Invalid private file reference/,
    );
    await assert.rejects(
      storage.remove("../secret.pdf"),
      /Invalid private file reference/,
    );
  });
});
