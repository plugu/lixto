// Server component: the one-line summary of the last global match run for
// this company, shown at the top of `/lixto`, `/opportunities` and
// `/dashboard`. Muted card, `accent-soft` accent line (docs/WEB_STYLE.md).
import Link from "next/link";
import { formatDateBR } from "@/lib/format";
import type { Digest } from "@/lib/digest-queries";

export function DigestBanner({
  digest,
  showLink = true,
}: {
  digest: Digest;
  showLink?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[10px] border-l-2 border-accent bg-accent-soft/40 px-4 py-3.5">
      <div className="flex-1 text-sm leading-6 text-ink">
        {digest.run ? (
          <p>
            Lixto analisou <strong>{digest.newCount}</strong> novas
            oportunidades desde {formatDateBR(digest.run.started_at, true)}.{" "}
            <strong>{digest.matchedCount}</strong> combinam com sua empresa.{" "}
            <strong>{digest.attentionCount}</strong> merecem atenção.
          </p>
        ) : (
          <p>Lixto ainda não analisou oportunidades para sua empresa.</p>
        )}
      </div>
      {showLink && digest.run ? (
        <Link
          href="/opportunities"
          className="shrink-0 text-[13px] font-medium text-accent hover:underline"
        >
          Ver oportunidades
        </Link>
      ) : null}
    </div>
  );
}
