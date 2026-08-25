import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { requireSession } from "@/lib/auth";
import { getDocument } from "@/lib/document-queries";
import { resolveUpload } from "@/lib/uploads";

/** Streams a document's file, scoped to the session's company — a document
 * id belonging to another company 404s (never 403, so it doesn't confirm the
 * id exists). */
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

  const document = await getDocument(session.company.id, id);
  if (!document) {
    return new Response(null, { status: 404 });
  }

  const absolutePath = resolveUpload(document.storage_path);
  const stream = createReadStream(absolutePath);

  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      "Content-Type": document.mime_type,
      "Content-Disposition": buildContentDisposition(document.file_name),
    },
  });
}

/** attachment; filename="<ascii fallback>"; filename*=UTF-8''<RFC 5987
 * percent-encoded> — so non-ASCII original filenames (e.g. "certidão.pdf")
 * still download with the right name in browsers that honor filename*. */
function buildContentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
