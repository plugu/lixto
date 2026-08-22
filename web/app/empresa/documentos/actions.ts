"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  deleteDocumento,
  insertDocumento,
  type NovoDocumento,
} from "@/lib/documento-queries";
import { DOCUMENTO_TIPOS, type DocumentoTipo } from "@/lib/tenant-types";
import { deleteUpload, saveUpload } from "@/lib/uploads";

const DOCUMENTOS_PATH = "/empresa/documentos";

export type UploadState = { error?: string };

function isDocumentoTipo(value: string): value is DocumentoTipo {
  return DOCUMENTO_TIPOS.some((t) => t.value === value);
}

/** Admin-only: validates + saves the file to disk, then inserts the row. If
 * the DB insert fails, the just-saved file is deleted (no orphan on disk). */
export async function uploadDocumentoAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const session = await requireAdmin();

  const tipo = String(formData.get("tipo") ?? "");
  if (!isDocumentoTipo(tipo)) {
    return { error: "Selecione um tipo de documento válido." };
  }

  const validadeRaw = String(formData.get("validade") ?? "").trim();
  const validade = validadeRaw.length > 0 ? validadeRaw : null;

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { error: "Selecione um arquivo para enviar." };
  }

  let upload;
  try {
    upload = await saveUpload(session.empresa.id, arquivo);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Falha ao enviar o arquivo.",
    };
  }

  try {
    const novoDocumento: NovoDocumento = {
      tipo,
      nomeArquivo: arquivo.name,
      caminho: upload.caminho,
      mime: upload.mime,
      tamanho: upload.tamanho,
      validade,
    };
    await insertDocumento(session.empresa.id, session.usuario.id, novoDocumento);
  } catch (err) {
    await deleteUpload(upload.caminho);
    return {
      error: err instanceof Error ? err.message : "Falha ao salvar o documento.",
    };
  }

  revalidatePath(DOCUMENTOS_PATH);
  return {};
}

/** Admin-only: deletes the DB row (tenant-scoped) then the file on disk. */
export async function removerDocumentoAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;

  const caminho = await deleteDocumento(session.empresa.id, id);
  if (caminho) await deleteUpload(caminho);

  revalidatePath(DOCUMENTOS_PATH);
}
