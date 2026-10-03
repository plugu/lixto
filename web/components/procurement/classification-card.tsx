import { Card } from "@/components/ui/card";
import {
  NATURE_LABELS,
  type ClassificationRow,
} from "@/lib/classification-queries";

const MAX_CNAES = 3;

function formatPercent(confidence: number | null): string | null {
  return confidence === null ? null : `${Math.round(confidence * 100)}%`;
}

export function ClassificationCard({
  classification,
}: {
  classification: ClassificationRow | null;
}) {
  if (!classification) return null;

  const { segment_label, nature, cnaes, keywords } = classification;

  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink">Classificação</h2>
      <dl className="mt-3 flex flex-col gap-3">
        {segment_label && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-ink-muted">Segmento</dt>
            <dd className="text-sm font-medium text-ink">{segment_label}</dd>
          </div>
        )}
        {nature && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-ink-muted">Natureza</dt>
            <dd className="text-sm font-medium text-ink">
              {NATURE_LABELS[nature]}
            </dd>
          </div>
        )}
        {cnaes.length > 0 && (
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-ink-muted">CNAEs</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {cnaes.slice(0, MAX_CNAES).map((cnae) => {
                  const percent = formatPercent(cnae.confidence);
                  return (
                    <li key={cnae.code} className="text-sm text-ink">
                      {cnae.description
                        ? `${cnae.code} — ${cnae.description}`
                        : cnae.code}
                      {percent && (
                        <span className="text-ink-muted"> ({percent})</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </dd>
          </div>
        )}
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((keyword) => (
              <span
                key={keyword}
                className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-ink-muted"
              >
                {keyword}
              </span>
            ))}
          </div>
        )}
      </dl>
    </Card>
  );
}
