// Compact card for a `LicitacaoRef` cited by the agent (ticket 69). Same
// visual language as `components/licitacao-card.tsx`, plus the match score
// ("Aderência") and up to 4 motivo chips when the ref came from a match tool.
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import type { LicitacaoRef } from "@/lib/agent/types";
import type { Motivo, MotivoCodigo } from "@/lib/match-engine";

// The match engine clamps the score to 0..100 but never actually reaches it
// (see match-engine.ts) — 90 is the real ceiling, so the UI never renders a
// "/100" suffix that would misrepresent the scale.
function scoreTone(score: number): BadgeTone {
  if (score >= 70) return "ok";
  if (score >= 40) return "warn";
  return "neutral";
}

const MOTIVO_LABELS: Record<MotivoCodigo, string> = {
  cnae_principal: "CNAE principal",
  cnae_secundario: "CNAE secundário",
  termo_enriquecimento: "termos",
  termo_texto: "texto",
  uf_ok: "UF",
  uf_fora: "fora da UF",
  valor_ok: "valor",
  valor_fora: "fora da faixa",
  valor_desconhecido: "valor desconhecido",
  me_epp_exclusivo: "exclusivo ME/EPP",
  exige_certificacao: "exige certificação",
  exige_atestado: "exige atestado",
  exclusao: "exclusão",
  semantico_alto: "similar ao perfil",
  semantico: "afinidade semântica",
  sem_perfil: "sem perfil",
};

function motivoLabel(motivo: Motivo): string {
  return MOTIVO_LABELS[motivo.codigo] ?? motivo.codigo;
}

function MotivoChip({ motivo }: { motivo: Motivo }) {
  const label = motivoLabel(motivo);

  if (motivo.peso < 0) {
    // Exclusão is a hard negative — call it out with `danger`, a token the
    // shared Badge component doesn't expose a tone for. Other negatives
    // (uf/valor fora, ME/EPP exclusivo, exigências) get the softer `warn`.
    if (motivo.codigo === "exclusao") {
      return (
        <span
          title={motivo.detalhe}
          className="inline-flex h-6 items-center rounded-[9999px] bg-danger/10 px-2.5 text-[13px] font-medium text-danger"
        >
          {label}
        </span>
      );
    }
    return (
      <span title={motivo.detalhe}>
        <Badge tone="warn">{label}</Badge>
      </span>
    );
  }

  return (
    <span title={motivo.detalhe}>
      <Badge tone="neutral">{label}</Badge>
    </span>
  );
}

export function LicitacaoRefCard({
  item,
  index,
}: {
  item: LicitacaoRef;
  index: number;
}) {
  const localizacao = [item.municipio, item.uf].filter(Boolean).join("/");
  const motivos = (item.motivos ?? []).slice(0, 4);

  return (
    <Link
      href={`/licitacao/${encodeURIComponent(item.numero_controle_pncp)}`}
      className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3.5 hover:bg-surface-raised"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-xs font-semibold tabular-nums text-ink-faint">
          #{index}
        </span>
        <p className="line-clamp-2 text-sm font-medium text-ink">
          {item.objeto || "—"}
        </p>
      </div>

      <p className="truncate text-xs text-ink-muted">
        {item.orgao || "—"}
        {localizacao ? ` · ${localizacao}` : ""}
        {item.modalidade ? ` · ${item.modalidade}` : ""}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={item.status} />
        {item.score !== undefined ? (
          <Badge tone={scoreTone(item.score)}>Aderência {item.score}</Badge>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span className="tabular-nums text-ink">
          {formatCurrencyBRL(item.valor_estimado)}
        </span>
        <span className="tabular-nums">{formatDateBR(item.encerramento)}</span>
      </div>

      {motivos.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {motivos.map((motivo, idx) => (
            <MotivoChip key={`${motivo.codigo}-${idx}`} motivo={motivo} />
          ))}
        </div>
      ) : null}
    </Link>
  );
}
