"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  deleteDocument,
  insertDocument,
  type NewDocument,
} from "@/lib/document-queries";
import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/types";
import { deleteUpload, saveUpload } from "@/lib/uploads";

const DOCUMENTS_PATH = "/company/documents";

export type UploadState = { error?: string };

function isDocumentKind(value: string): value is DocumentKind {
  return DOCUMENT_KINDS.some((k) => k.value === value);
}

/** Admin-only: validates + saves the file to disk, then inserts the row. If
 * the DB insert fails, the just-saved file is deleted (no orphan on disk). */
export async function uploadDocumentAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const session = await requireAdmin();

  const kind = String(formData.get("kind") ?? "");
  if (!isDocumentKind(kind)) {
    return { error: "Selecione um tipo de documento válido." };
  }

  const validUntilRaw = String(formData.get("validUntil") ?? "").trim();
  const validUntil = validUntilRaw.length > 0 ? validUntilRaw : null;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecione um arquivo para enviar." };
  }

  let upload;
  try {
    upload = await saveUpload(session.company.id, file);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Falha ao enviar o arquivo.",
    };
  }

  try {
    const newDocument: NewDocument = {
      kind,
      fileName: file.name,
      storagePath: upload.storagePath,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      validUntil,
    };
    await insertDocument(session.company.id, session.user.id, newDocument);
  } catch (err) {
    await deleteUpload(upload.storagePath);
    return {
      error: err instanceof Error ? err.message : "Falha ao salvar o documento.",
    };
  }

  revalidatePath(DOCUMENTS_PATH);
  return {};
}

/** Admin-only: deletes the DB row (tenant-scoped) then the file on disk. */
export async function removeDocumentAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;

  const storagePath = await deleteDocument(session.company.id, id);
  if (storagePath) await deleteUpload(storagePath);

  revalidatePath(DOCUMENTS_PATH);
}
