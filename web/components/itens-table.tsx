// Itens table for the licitação detail page (ticket 34, cycle 8 restyle) —
// built on the kit's compact-density Table (no card wrapper, hairline rows).

import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { ItemRow } from "@/lib/detail-queries";
import { formatCurrencyBRL } from "@/lib/format";

const quantidadeFormatter = new Intl.NumberFormat("pt-BR");

function formatQuantidade(value: string | null): string {
  if (value === null) return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return "—";
  return quantidadeFormatter.format(num);
}

export function ItensTable({ itens }: { itens: ItemRow[] }) {
  if (itens.length === 0) {
    return <p className="text-sm text-ink-muted">Nenhum item encontrado.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table density="compact">
        <THead>
          <TH>Nº</TH>
          <TH>Descrição</TH>
          <TH align="right">Quantidade</TH>
          <TH>Unidade</TH>
          <TH align="right">Valor unitário</TH>
          <TH align="right">Valor total</TH>
          <TH>Situação</TH>
          <TH>Benefício</TH>
        </THead>
        <TBody>
          {itens.map((item) => (
            <TR key={item.numero_item}>
              <TD>{item.numero_item}</TD>
              <TD>{item.descricao || "—"}</TD>
              <TD align="right" numeric>
                {formatQuantidade(item.quantidade)}
              </TD>
              <TD>{item.unidade_medida || "—"}</TD>
              <TD align="right" numeric>
                {formatCurrencyBRL(item.valor_unitario_estimado)}
              </TD>
              <TD align="right" numeric>
                {formatCurrencyBRL(item.valor_total)}
              </TD>
              <TD className="text-ink-muted">
                {item.situacao_compra_item_nome || "—"}
              </TD>
              <TD className="text-ink-muted">
                {item.tipo_beneficio_nome || "—"}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
