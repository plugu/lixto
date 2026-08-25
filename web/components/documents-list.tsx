// Documents list for the procurement detail page. Rows: FileText icon, nome,
// tipo badge, Download icon link at the right — grouped Edital (type_id === 2)
// vs Anexos, separated by hairlines.

import { Badge } from "@/components/ui/badge";
import { Download, FileText } from "@/components/ui/icons";
import type { DocumentRow } from "@/lib/procurement-detail-queries";

const EDITAL_TYPE_ID = 2;

export function DocumentsList({ documents }: { documents: DocumentRow[] }) {
  if (documents.length === 0) {
    return (
      <p className="text-sm text-ink-muted">Nenhum documento disponível.</p>
    );
  }

  const edital = documents.filter((doc) => doc.type_id === EDITAL_TYPE_ID);
  const anexos = documents.filter((doc) => doc.type_id !== EDITAL_TYPE_ID);

  return (
    <div className="flex flex-col gap-6">
      <DocumentGroup title="Edital" documents={edital} />
      <DocumentGroup title="Anexos" documents={anexos} />
    </div>
  );
}

function DocumentGroup({
  title,
  documents,
}: {
  title: string;
  documents: DocumentRow[];
}) {
  if (documents.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
        {title}
      </p>
      <ul className="flex flex-col">
        {documents.map((doc) => (
          <li
            key={doc.sequence}
            className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
          >
            <FileText size={16} className="shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {doc.title || doc.type_name || "Documento"}
            </span>
            {doc.type_name ? <Badge tone="neutral">{doc.type_name}</Badge> : null}
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
