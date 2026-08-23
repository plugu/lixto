// Documentos list for the licitação detail page (ticket 34, cycle 8 restyle).
// Rows: FileText icon, nome, tipo badge, Download icon link at the right —
// grouped Edital (tipo_documento_id === 2) vs Anexos, separated by hairlines.

import { Badge } from "@/components/ui/badge";
import { Download, FileText } from "@/components/ui/icons";
import type { DocumentoRow } from "@/lib/detail-queries";

const EDITAL_TIPO_DOCUMENTO_ID = 2;

export function DocumentosList({
  documentos,
}: {
  documentos: DocumentoRow[];
}) {
  if (documentos.length === 0) {
    return (
      <p className="text-sm text-ink-muted">Nenhum documento disponível.</p>
    );
  }

  const edital = documentos.filter(
    (doc) => doc.tipo_documento_id === EDITAL_TIPO_DOCUMENTO_ID,
  );
  const anexos = documentos.filter(
    (doc) => doc.tipo_documento_id !== EDITAL_TIPO_DOCUMENTO_ID,
  );

  return (
    <div className="flex flex-col gap-6">
      <DocumentGroup title="Edital" documentos={edital} />
      <DocumentGroup title="Anexos" documentos={anexos} />
    </div>
  );
}

function DocumentGroup({
  title,
  documentos,
}: {
  title: string;
  documentos: DocumentoRow[];
}) {
  if (documentos.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
        {title}
      </p>
      <ul className="flex flex-col">
        {documentos.map((doc) => (
          <li
            key={doc.sequencial_documento}
            className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
          >
            <FileText size={16} className="shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {doc.titulo || doc.tipo_documento_nome || "Documento"}
            </span>
            {doc.tipo_documento_nome ? (
              <Badge tone="neutral">{doc.tipo_documento_nome}</Badge>
            ) : null}
            {doc.url ? (
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Baixar documento"
                className="shrink-0 text-ink-muted transition-colors hover:text-ink"
              >
                <Download size={16} />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
