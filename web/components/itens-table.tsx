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
    return (
      <p className="text-sm text-muted-foreground">Nenhum item encontrado.</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-subtle">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nº</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Descrição
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Quantidade
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Unidade
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Valor unitário
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Valor total
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Situação
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Benefício
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {itens.map((item) => (
              <tr key={item.numero_item} className="transition-colors hover:bg-muted/30">
                <td className="px-4 py-3 text-foreground">{item.numero_item}</td>
                <td className="px-4 py-3 text-foreground">
                  {item.descricao || "—"}
                </td>
                <td className="px-4 py-3 text-right text-foreground tabular-nums">
                  {formatQuantidade(item.quantidade)}
                </td>
                <td className="px-4 py-3 text-foreground">
                  {item.unidade_medida || "—"}
                </td>
                <td className="px-4 py-3 text-right text-foreground tabular-nums">
                  {formatCurrencyBRL(item.valor_unitario_estimado)}
                </td>
                <td className="px-4 py-3 text-right text-foreground tabular-nums">
                  {formatCurrencyBRL(item.valor_total)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {item.situacao_compra_item_nome || "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {item.tipo_beneficio_nome || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
