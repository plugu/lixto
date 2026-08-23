// Verdict badge for the /licitacoes rows and the detail page header, now a
// wrapper over the kit's Badge (cycle 8): soft bg + strong text, score as a
// `· 82` suffix. Props are frozen (`{verdict, score}`).
import { Badge, type BadgeTone } from "@/components/ui/badge";

const TONES: Record<string, BadgeTone> = {
  fit: "ok",
  borderline: "warn",
  no_fit: "neutral",
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

  const tone = TONES[verdict] ?? "warn";
  const label = LABELS[verdict] ?? verdict;

  return (
    <Badge tone={tone}>
      {label}
      {score !== null && score !== undefined ? ` · ${score}` : ""}
    </Badge>
  );
}
