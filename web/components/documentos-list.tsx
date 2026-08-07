import type { DocumentoRow } from "@/lib/detail-queries";

const EDITAL_TIPO_DOCUMENTO_ID = 2;

export function DocumentosList({ documentos }: { documentos: DocumentoRow[] }) {
  if (documentos.length === 0) {
    return <p className="text-sm text-gray-500">Nenhum documento disponível.</p>;
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
    <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-900">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {documentos.map((doc) => (
          <li key={doc.sequencial_documento} className="text-sm">
            {doc.url ? (
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {doc.titulo || doc.tipo_documento_nome || "Documento"}
              </a>
            ) : (
              <span className="text-gray-900">
                {doc.titulo || doc.tipo_documento_nome || "Documento"}
              </span>
            )}
            {doc.tipo_documento_nome && (
              <span className="ml-2 text-xs text-gray-500">
                {doc.tipo_documento_nome}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
