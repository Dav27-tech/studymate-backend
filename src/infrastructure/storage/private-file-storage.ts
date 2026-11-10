import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

const fileReferencePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|txt)$/;

export interface StoredUpload {
  id: string;
  filePath: string;
  extension: "pdf" | "png" | "jpg";
}

export interface PrivateFileStorage {
  saveUpload(extension: StoredUpload["extension"], data: Buffer): Promise<StoredUpload>;
  saveExtractedText(id: string, text: string): Promise<void>;
  readExtractedText(id: string): Promise<string>;
  readExtractedTextForUpload(filePath: string): Promise<string>;
  readUpload(filePath: string): Promise<Buffer>;
  remove(filePath: string): Promise<void>;
  removeDocument(filePath: string): Promise<void>;
  removeUpload(id: string, extension: StoredUpload["extension"]): Promise<void>;
}

/**
 * Sanitize the Original Filename.
 */
export function sanitizeOriginalFilename(filename: string): string {
  const fileName = basename(filename.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
  return fileName || "document";
}

/**
 * Explain the purpose of extension From Original Filename.
 */
export function extensionFromOriginalFilename(filename: string): string {
  return extname(sanitizeOriginalFilename(filename)).toLowerCase();
}

export class LocalPrivateFileStorage implements PrivateFileStorage {
  private readonly rootDirectory: string;

  /**
 * Create this instance.
 */
  constructor(storageDirectory: string) {
    this.rootDirectory = resolve(storageDirectory);
    if (!isAbsolute(this.rootDirectory)) {
      throw new Error("Storage directory must resolve to an absolute path.");
    }
  }

  /**
 * Save the Upload.
 */
  async saveUpload(
    extension: StoredUpload["extension"],
    data: Buffer,
  ): Promise<StoredUpload> {
    await mkdir(this.rootDirectory, { recursive: true });
    const id = randomUUID();
    const filePath = `${id}.${extension}`;
    await writeFile(this.resolveReference(filePath), data, {
      flag: "wx",
      mode: 0o600,
    });

    return { id, filePath, extension };
  }

  /**
 * Save the Extracted Text.
 */
  async saveExtractedText(id: string, text: string): Promise<void> {
    const filePath = `${id}.txt`;
    await writeFile(this.resolveReference(filePath), text, {
      flag: "w",
      mode: 0o600,
    });
  }

  readExtractedText(id: string): Promise<string> {
    return readFile(this.resolveReference(`${id}.txt`), "utf8");
  }

  readExtractedTextForUpload(filePath: string): Promise<string> {
    const match =
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|png|jpg)$/.exec(
        filePath,
      );
    if (!match?.[1]) {
      throw new Error("Invalid private document reference.");
    }

    return this.readExtractedText(match[1]);
  }

  readUpload(filePath: string): Promise<Buffer> {
    return readFile(this.resolveReference(filePath));
  }

  /**
   * Remove .
   */
  async remove(filePath: string): Promise<void> {
    await rm(this.resolveReference(filePath), { force: true });
  }

  /**
   * Remove Upload.
   */
  async removeUpload(
    id: string,
    extension: StoredUpload["extension"],
  ): Promise<void> {
    await this.remove(`${id}.${extension}`);
    await this.remove(`${id}.txt`);
  }

  /**
   * Remove Document.
   */
  async removeDocument(filePath: string): Promise<void> {
    const match =
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|png|jpg)$/.exec(
        filePath,
      );
    if (!match) {
      throw new Error("Invalid private document reference.");
    }

    const id = match[1];
    const extension = match[2];
    if (
      !id ||
      (extension !== "pdf" && extension !== "png" && extension !== "jpg")
    ) {
      throw new Error("Invalid private document reference.");
    }

    await this.removeUpload(id, extension);
  }

  /**
 * Resolve the Reference.
 */
  private resolveReference(filePath: string): string {
    if (!fileReferencePattern.test(filePath)) {
      throw new Error("Invalid private file reference.");
    }

    const resolved = resolve(this.rootDirectory, filePath);
    const relativePath = relative(this.rootDirectory, resolved);
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error("Invalid private file reference.");
    }

    return resolved;
  }
}
