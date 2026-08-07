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
    return <p className="text-sm text-gray-500">Nenhum item encontrado.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs font-medium text-gray-500 uppercase">
            <th className="py-2 pr-4">Nº</th>
            <th className="py-2 pr-4">Descrição</th>
            <th className="py-2 pr-4 text-right">Quantidade</th>
            <th className="py-2 pr-4">Unidade</th>
            <th className="py-2 pr-4 text-right">Valor unitário</th>
            <th className="py-2 pr-4 text-right">Valor total</th>
            <th className="py-2 pr-4">Situação</th>
            <th className="py-2">Benefício</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item) => (
            <tr key={item.numero_item} className="border-b border-gray-200">
              <td className="py-2 pr-4 text-gray-900">{item.numero_item}</td>
              <td className="py-2 pr-4 text-gray-900">
                {item.descricao || "—"}
              </td>
              <td className="py-2 pr-4 text-right text-gray-900 tabular-nums">
                {formatQuantidade(item.quantidade)}
              </td>
              <td className="py-2 pr-4 text-gray-900">
                {item.unidade_medida || "—"}
              </td>
              <td className="py-2 pr-4 text-right text-gray-900 tabular-nums">
                {formatCurrencyBRL(item.valor_unitario_estimado)}
              </td>
              <td className="py-2 pr-4 text-right text-gray-900 tabular-nums">
                {formatCurrencyBRL(item.valor_total)}
              </td>
              <td className="py-2 pr-4 text-gray-900">
                {item.situacao_compra_item_nome || "—"}
              </td>
              <td className="py-2 text-gray-900">
                {item.tipo_beneficio_nome || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
