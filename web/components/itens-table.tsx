// Itens table for the licitação detail page (ticket 34, cycle 8 restyle;
// responsive card reflow added ticket 44) — built on the kit's
// compact-density Table (no card wrapper, hairline rows) for md and up.
// Below md, the same data renders as a stacked card list so no column is
// silently lost at narrow widths.

import { Badge } from "@/components/ui/badge";
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
    <>
      <div className="hidden overflow-x-auto md:block -mx-4 px-4 sm:-mx-6 sm:px-6">
        <Table density="compact">
          <THead bg="surface">
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
                <TD className="max-w-[28rem] whitespace-normal break-words align-top">
                  {item.descricao || "—"}
                </TD>
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

      <ul className="flex flex-col gap-2.5 md:hidden">
        {itens.map((item) => (
          <li
            key={item.numero_item}
            className="flex flex-col gap-2 rounded-lg border border-line px-3 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-xs font-medium text-ink-muted">
                Item {item.numero_item}
              </span>
            </div>
            <p className="line-clamp-2 text-sm text-ink">
              {item.descricao || "—"}
            </p>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
              <span className="text-ink-muted">
                {formatQuantidade(item.quantidade)}{" "}
                {item.unidade_medida || "—"}
              </span>
              <span className="tabular-nums text-ink-muted">
                {formatCurrencyBRL(item.valor_unitario_estimado)} / un
              </span>
            </div>
            <p className="text-sm font-medium tabular-nums text-ink">
              {formatCurrencyBRL(item.valor_total)}
            </p>
            {(item.situacao_compra_item_nome || item.tipo_beneficio_nome) && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {item.situacao_compra_item_nome ? (
                  <Badge tone="neutral">{item.situacao_compra_item_nome}</Badge>
                ) : null}
                {item.tipo_beneficio_nome ? (
                  <Badge tone="neutral">{item.tipo_beneficio_nome}</Badge>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
