import { AnalisePanel } from "@/components/analise-panel";
import { DocumentosList } from "@/components/documentos-list";
import { FitBadge } from "@/components/fit-badge";
import { ItensTable } from "@/components/itens-table";
import { StatusBadge } from "@/components/status-badge";
import { LinkButton } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { fetchAnalise } from "@/lib/analise-queries";
import {
  fetchDocumentos,
  fetchItens,
  fetchLicitacaoDetail,
  type LicitacaoDetail,
} from "@/lib/detail-queries";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import { computeStatus } from "@/lib/status";

// The route segment carries numero_controle_pncp, which contains a literal
// "/" (e.g. "11285282000137-1-000033/2026"). List links encode it with
// encodeURIComponent, so the segment arrives as "...%2F2026". Depending on
// how Next normalizes the path, `numeroControle` may still contain the
// literal "%2F" or may have already been decoded to "/" — handle both.
function decodeNumeroControle(raw: string): string {
  return /%2F/i.test(raw) ? decodeURIComponent(raw) : raw;
}

function buildPncpUrl(detail: LicitacaoDetail): string | null {
  if (!detail.orgao_cnpj || !detail.ano_compra || !detail.sequencial_compra) {
    return null;
  }
  return `https://pncp.gov.br/app/editais/${detail.orgao_cnpj}/${detail.ano_compra}/${detail.sequencial_compra}`;
}

export default async function LicitacaoDetailPage(
  props: PageProps<"/licitacao/[numeroControle]">,
) {
  const { numeroControle } = await props.params;
  const numeroControlePncp = decodeNumeroControle(numeroControle);

  const detail = await fetchLicitacaoDetail(numeroControlePncp);

  if (!detail) {
    return (
      <div className="page-wide flex flex-col gap-6">
        <BackLink />
        <p className="py-16 text-center text-sm text-ink-muted">
          Licitação não encontrada.
        </p>
      </div>
    );
  }

  const [itens, documentos, analise] = await Promise.all([
    fetchItens(numeroControlePncp),
    fetchDocumentos(numeroControlePncp),
    fetchAnalise(numeroControlePncp),
  ]);

  const status = computeStatus(
    detail.data_abertura_proposta,
    detail.data_encerramento_proposta,
  );
  const localizacao = [detail.municipio_nome, detail.uf]
    .filter(Boolean)
    .join("/");
  const orgaoUnidade = [detail.orgao_razao_social, detail.unidade_nome]
    .filter(Boolean)
    .join(" · ");
  const metaLine = [orgaoUnidade, localizacao, detail.modalidade_nome]
    .filter(Boolean)
    .join(" · ");
  const pncpUrl = buildPncpUrl(detail);

  return (
    <div className="page-wide flex flex-col gap-8">
      <BackLink />

      <header className="flex flex-col gap-3">
        <h1 className="font-display text-2xl leading-snug text-ink">
          {detail.objeto_compra || "—"}
        </h1>
        <p className="text-sm text-ink-muted">{metaLine || "—"}</p>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          <FitBadge
            verdict={analise?.deep_verdict ?? analise?.verdict}
            score={analise?.fit_score}
          />
        </div>

        <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          <Fact
            label="Valor estimado"
            value={formatCurrencyBRL(detail.valor_total_estimado)}
          />
          <Fact
            label="Abertura"
            value={formatDateBR(detail.data_abertura_proposta, true)}
          />
          <Fact
            label="Encerramento"
            value={formatDateBR(detail.data_encerramento_proposta, true)}
          />
          <Fact label="Nº controle" value={detail.numero_controle_pncp} />
        </dl>

        {(detail.link_sistema_origem || pncpUrl) && (
          <div className="flex flex-wrap gap-4 pt-1">
            {detail.link_sistema_origem && (
              <a
                href={detail.link_sistema_origem}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline"
              >
                Abrir no sistema de origem
              </a>
            )}
            {pncpUrl && (
              <a
                href={pncpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline"
              >
                Ver no PNCP
              </a>
            )}
          </div>
        )}
      </header>

      <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-10">
          <Section title="Itens">
            <ItensTable itens={itens} />
          </Section>

          <Section title="Documentos">
            <DocumentosList documentos={documentos} />
          </Section>
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <AnalisePanel analise={analise} />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <LinkButton
      href="/licitacoes"
      variant="ghost"
      size="sm"
      className="self-start"
    >
      ← Licitações
    </LinkButton>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}
