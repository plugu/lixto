import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { requireSession } from "@/lib/auth";
import { getDocumento } from "@/lib/documento-queries";
import { resolveUpload } from "@/lib/uploads";

/** Streams a documento's file, scoped to the session's empresa — a
 * documento id belonging to another empresa 404s (never 403, so it doesn't
 * confirm the id exists). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return new Response(null, { status: 404 });
  }

  const documento = await getDocumento(session.empresa.id, id);
  if (!documento) {
    return new Response(null, { status: 404 });
  }

  const absolutePath = resolveUpload(documento.caminho);
  const stream = createReadStream(absolutePath);

  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      "Content-Type": documento.mime,
      "Content-Disposition": buildContentDisposition(documento.nome_arquivo),
    },
  });
}

/** attachment; filename="<ascii fallback>"; filename*=UTF-8''<RFC 5987
 * percent-encoded> — so non-ASCII original filenames (e.g. "certidão.pdf")
 * still download with the right name in browsers that honor filename*. */
function buildContentDisposition(nomeArquivo: string): string {
  const ascii = nomeArquivo.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(nomeArquivo).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
