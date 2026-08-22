import Link from "next/link";
import { removerDocumentoAction } from "@/app/empresa/documentos/actions";
import type { DocumentoRow } from "@/lib/documento-queries";
import { formatDateBR } from "@/lib/format";
import { DOCUMENTO_TIPOS } from "@/lib/tenant-types";

const TIPO_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENTO_TIPOS.map((tipo) => [tipo.value, tipo.label]),
);

const DIAS_ALERTA_VENCIMENTO = 30;

type StatusDocumento = "vencido" | "vence_em_breve" | "valido";

const STATUS_LABELS: Record<StatusDocumento, string> = {
  vencido: "Vencido",
  vence_em_breve: "Vence em breve",
  valido: "Válido",
};

// Reuses the existing --color-unclear/--color-partial/--color-met tokens
// (docs/WEB_STYLE.md) instead of introducing a new palette for this badge.
const STATUS_STYLES: Record<StatusDocumento, string> = {
  vencido: "border-unclear/30 bg-unclear/10 text-unclear",
  vence_em_breve: "border-partial/30 bg-partial/10 text-partial",
  valido: "border-met/30 bg-met/10 text-met",
};

function statusOf(doc: DocumentoRow): StatusDocumento | null {
  if (!doc.validade) return null;
  if (doc.vencido) return "vencido";

  const limite = new Date();
  limite.setDate(limite.getDate() + DIAS_ALERTA_VENCIMENTO);
  return new Date(doc.validade) <= limite ? "vence_em_breve" : "valido";
}

export function DocumentosEmpresaTable({
  documentos,
  isAdmin,
}: {
  documentos: DocumentoRow[];
  isAdmin: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-subtle">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Tipo
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Arquivo
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Validade
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Status
            </th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
              Enviado em
            </th>
            {isAdmin ? (
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Ações
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {documentos.map((doc) => {
            const status = statusOf(doc);
            return (
              <tr key={doc.id} className="transition-colors hover:bg-muted/30">
                <td className="px-4 py-3">{TIPO_LABELS[doc.tipo] ?? doc.tipo}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/empresa/documentos/${doc.id}/download`}
                    className="text-accent hover:underline"
                  >
                    {doc.nome_arquivo}
                  </Link>
                </td>
                <td className="px-4 py-3">{formatDateBR(doc.validade)}</td>
                <td className="px-4 py-3">
                  {status ? (
                    <span
                      className={`inline-flex shrink-0 items-center self-start rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">{formatDateBR(doc.created_at)}</td>
                {isAdmin ? (
                  <td className="px-4 py-3">
                    <form action={removerDocumentoAction}>
                      <input type="hidden" name="id" value={doc.id} />
                      <button
                        type="submit"
                        className="text-sm text-accent hover:underline"
                      >
                        Remover
                      </button>
                    </form>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
