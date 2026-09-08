// Inline citation links after a dossier statement: `Doc {sequence} · p.
// {page}`, linking to the PNCP document URL at that page. A citation whose
// document is missing or has no URL still renders as plain text — a citation
// is metadata about where the model read something, never a broken link.

import type { Citation } from "@/lib/analysis-queries";
import type { DocumentRow } from "@/lib/procurement-detail-queries";

export function CitationLinks({
  citations,
  documents,
}: {
  citations: Citation[];
  documents: DocumentRow[];
}) {
  if (citations.length === 0) return null;

  return (
    <span className="ml-1.5 inline-flex flex-wrap gap-1.5 align-middle text-xs text-ink-faint">
      {citations.map((citation, index) => {
        const document = documents.find(
          (doc) => doc.sequence === citation.sequence,
        );
        const text = `Doc ${citation.sequence} · p. ${citation.page}`;

        if (!document || !document.url) {
          return <span key={index}>{text}</span>;
        }

        return (
          <a
            key={index}
            href={`${document.url}#page=${citation.page}`}
            target="_blank"
            rel="noopener noreferrer"
            title={document.title ?? undefined}
            className="text-accent hover:underline"
          >
            {text}
          </a>
        );
      })}
    </span>
  );
}
