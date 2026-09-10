// Server component: "Oportunidades de hoje" — the answer-first block. Rendered
// outside <Suspense> by the page (awaited before the header+today paint), so
// it never shows a skeleton of its own.
import { DigestBanner } from "@/components/digest-banner";
import { OpportunityCard } from "@/components/opportunity-card";
import { LinkButton } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { getDigest } from "@/lib/digest-queries";

/** Cards shown on the dashboard itself — `/opportunities` has the full list. */
const PREVIEW_LIMIT = 3;

export async function TodaySection({ companyId }: { companyId: number }) {
  const digest = await getDigest(companyId);
  const attention = digest.attention.slice(0, PREVIEW_LIMIT);

  return (
    <Section
      title="Oportunidades de hoje"
      actions={
        <LinkButton href="/opportunities" variant="secondary" size="sm">
          Ver todas
        </LinkButton>
      }
    >
      <DigestBanner digest={digest} showLink={false} />
      {attention.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {attention.map((opportunity) => (
            <OpportunityCard key={opportunity.id} opportunity={opportunity} />
          ))}
        </div>
      ) : null}
    </Section>
  );
}
