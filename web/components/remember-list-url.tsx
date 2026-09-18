"use client";

import { useSearchParams } from "next/navigation";
import { useRememberListUrl } from "@/lib/last-list-url";

/** Mounted by a list page: records its current query string (filters, sort,
 * page) for this tab so `<ListBackLink>` on the detail page can bring the
 * visitor back to the same view. Renders nothing. */
export function RememberListUrl({ path }: { path: string }) {
  const searchParams = useSearchParams();
  useRememberListUrl(path, searchParams.toString());
  return null;
}
