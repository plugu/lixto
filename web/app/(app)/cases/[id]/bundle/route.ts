// Downloads a zip of the session's company's currently valid habilitação
// documents for one case (ticket 171). This is a route handler, not a page:
// unlike the streaming pages under app/(app), there is no sibling
// `loading.tsx` here, so `new Response(null, { status: 404 })` really
// returns 404 to the client.
//
// Tenant rule (docs/TENANT.md): `getCase`/`listDocuments` scope by
// `session.company.id` — never a value from the request — so a foreign or
// unknown case id 404s exactly like the case detail page, and the zip can
// only ever contain the session's own company's files.
import fs from "node:fs";
import { requireSession } from "@/lib/auth";
import { bundleEntryName, buildBundle } from "@/lib/case-bundle";
import { getCase } from "@/lib/case-queries";
import { listDocuments } from "@/lib/document-queries";
import { resolveUpload } from "@/lib/uploads";

export const runtime = "nodejs";

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

  const caseRow = await getCase(session.company.id, id);
  if (!caseRow) {
    return new Response(null, { status: 404 });
  }

  const documents = (await listDocuments(session.company.id)).filter(
    (document) => !document.expired,
  );

  const entries: { name: string; data: Uint8Array }[] = [];
  for (const document of documents) {
    try {
      const data = await fs.promises.readFile(
        resolveUpload(document.storage_path),
      );
      entries.push({ name: bundleEntryName(entries.length, document), data });
    } catch (err) {
      console.warn(
        `case bundle: skipping unreadable document ${document.id} (${document.storage_path})`,
        err,
      );
    }
  }

  if (entries.length === 0) {
    return new Response("Nenhum documento válido para incluir.", {
      status: 404,
    });
  }

  return new Response(new Uint8Array(buildBundle(entries)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="caso-${id}-documentos.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
