// Local-disk storage for empresa habilitação documents (ticket 28). No S3 in
// this cycle — files live on a plain volume; in production (Dokploy) that
// volume is mounted at UPLOADS_DIR so files survive redeploys (ticket 29
// wires the actual volume + env var into docker-compose.yml).

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
   * stored in documento_empresa.caminho, never an absolute path. */
  caminho: string;
  mime: string;
  tamanho: number;
};

/** Validates and writes an uploaded File under UPLOADS_DIR/<empresaId>/.
 * Throws a pt-BR message on invalid mime/size. */
export async function saveUpload(
  empresaId: number,
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
  const dir = path.join(UPLOADS_DIR, String(empresaId));
  await fs.promises.mkdir(dir, { recursive: true });

  const filename = `${crypto.randomUUID()}${ext}`;
  const destino = path.join(dir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.promises.writeFile(destino, buffer);

  return {
    caminho: `${empresaId}/${filename}`,
    mime: file.type,
    tamanho: file.size,
  };
}

/** Removes a previously saved upload. Silently ignores "already gone"
 * (ENOENT) so cleanup after a failed DB write never throws a second error. */
export async function deleteUpload(caminho: string): Promise<void> {
  try {
    await fs.promises.unlink(resolveUpload(caminho));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Resolves a stored relative `caminho` to an absolute path, refusing to
 * leave UPLOADS_DIR (defense against a `caminho` containing `../`). */
export function resolveUpload(caminho: string): string {
  const root = path.resolve(UPLOADS_DIR);
  const absolute = path.resolve(root, caminho);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error("Caminho de arquivo inválido.");
  }
  return absolute;
}
