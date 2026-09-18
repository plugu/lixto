"use client";

import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui/button";
import { useLastListUrl } from "@/lib/last-list-url";

/** "← Back to the list" for a detail page. Points at the bare list until
 * hydration, then at the list URL this tab last had open (see
 * `lib/last-list-url.ts`), so filters, sort and page survive the round trip. */
export function ListBackLink({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const href = useLastListUrl(path);
  return (
    <LinkButton href={href} variant="ghost" size="sm" className="self-start">
      {children}
    </LinkButton>
  );
}
