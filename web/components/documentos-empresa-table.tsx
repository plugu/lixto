import Link from "next/link";
import { removerDocumentoAction } from "@/app/empresa/documentos/actions";
import { Button } from "@/components/ui/button";
import { X } from "@/components/ui/icons";
import { StatusDot, type StatusDotTone } from "@/components/ui/status-dot";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
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

const STATUS_TONES: Record<StatusDocumento, StatusDotTone> = {
  vencido: "off",
  vence_em_breve: "warn",
  valido: "ok",
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
    <Table density="compact">
      <THead>
        <TH>Tipo</TH>
        <TH>Arquivo</TH>
        <TH>Validade</TH>
        <TH>Status</TH>
        <TH>Enviado em</TH>
        {isAdmin ? <TH>Ações</TH> : null}
      </THead>
      <TBody>
        {documentos.map((doc) => {
          const status = statusOf(doc);
          return (
            <TR key={doc.id}>
              <TD>{TIPO_LABELS[doc.tipo] ?? doc.tipo}</TD>
              <TD>
                <Link
                  href={`/empresa/documentos/${doc.id}/download`}
                  className="text-accent hover:underline"
                >
                  {doc.nome_arquivo}
                </Link>
              </TD>
              <TD>{formatDateBR(doc.validade)}</TD>
              <TD>
                {status ? (
                  <StatusDot tone={STATUS_TONES[status]} label={STATUS_LABELS[status]} />
                ) : (
                  "—"
                )}
              </TD>
              <TD>{formatDateBR(doc.created_at)}</TD>
              {isAdmin ? (
                <TD>
                  <form action={removerDocumentoAction}>
                    <input type="hidden" name="id" value={doc.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remover ${doc.nome_arquivo}`}
                    >
                      <X size={16} />
                    </Button>
                  </form>
                </TD>
              ) : null}
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
