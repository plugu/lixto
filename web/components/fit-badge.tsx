// Small verdict badge for the /licitacoes list rows and the detail page
// header (ticket 15). Pattern mirrors status-badge.tsx; colors per
// docs/WEB_STYLE.md: fit=met (green), borderline=partial (amber),
// no_fit=unclear/muted.

const STYLES: Record<string, string> = {
  fit: "border-met/30 bg-met/10 text-met",
  borderline: "border-partial/30 bg-partial/10 text-partial",
  no_fit: "border-unclear/30 bg-unclear/10 text-muted-foreground",
};

const LABELS: Record<string, string> = {
  fit: "Fit",
  borderline: "Borderline",
  no_fit: "No fit",
};

export function FitBadge({
  verdict,
  score,
}: {
  verdict: string | null | undefined;
  score: number | null | undefined;
}) {
  if (!verdict) return null;

  const style = STYLES[verdict] ?? STYLES.borderline;
  const label = LABELS[verdict] ?? verdict;

  return (
    <span
      className={`inline-flex shrink-0 items-center self-start gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style}`}
    >
      {label}
      {score !== null && score !== undefined ? ` · ${score}` : ""}
    </span>
  );
}
