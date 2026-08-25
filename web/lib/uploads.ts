// Local-disk storage for the company's habilitação documents. No S3 in this
// cycle — files live on a plain volume; in production (Dokploy) that volume
// is mounted at UPLOADS_DIR so files survive redeploys.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");

export const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

export type SavedUpload = {
  /** Relative to UPLOADS_DIR, e.g. "12/3fa..-uuid.pdf" — this is what gets
   * stored in company_documents.storage_path, never an absolute path. */
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
};

/** Validates and writes an uploaded File under UPLOADS_DIR/<companyId>/.
 * Throws a pt-BR message on invalid mime/size. */
export async function saveUpload(
  companyId: number,
  file: File,
): Promise<SavedUpload> {
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    throw new Error(
      "Tipo de arquivo não permitido. Envie um PDF, JPG ou PNG.",
    );
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Arquivo muito grande. O limite é 20 MB.");
  }

  const ext = EXT_BY_MIME[file.type] ?? "";
  const dir = path.join(UPLOADS_DIR, String(companyId));
  await fs.promises.mkdir(dir, { recursive: true });

  const filename = `${crypto.randomUUID()}${ext}`;
  const destination = path.join(dir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.promises.writeFile(destination, buffer);

  return {
    storagePath: `${companyId}/${filename}`,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}

/** Removes a previously saved upload. Silently ignores "already gone"
 * (ENOENT) so cleanup after a failed DB write never throws a second error. */
export async function deleteUpload(storagePath: string): Promise<void> {
  try {
    await fs.promises.unlink(resolveUpload(storagePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Resolves a stored relative `storagePath` to an absolute path, refusing to
 * leave UPLOADS_DIR (defense against a path containing `../`). */
export function resolveUpload(storagePath: string): string {
  const root = path.resolve(UPLOADS_DIR);
  const absolute = path.resolve(root, storagePath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error("Caminho de arquivo inválido.");
  }
  return absolute;
}
