// The case document bundle (PRODUCT, cycle 30): zips the company's own
// currently valid habilitação documents for one case. Pure module — no
// database, no filesystem — so it is fully unit-testable; the route handler
// (app/(app)/cases/[id]/bundle/route.ts) is the only caller that touches
// disk. Relative imports (not "@/lib/...") like the rest of lib/.

import { zipSync } from "fflate";
import { documentKindLabel } from "./case-labels";
import type { DocumentKind } from "./types";

/** Lowercase, accent-free, hyphenated — safe as a path segment in a zip
 * entry name. Mirrors case-verdict.ts's `normalizeText` accent stripping
 * (NFD decomposition + stripping the combining-diacritical-marks block),
 * plus collapsing anything that isn't `[a-z0-9]` into a single `-`. */
function slug(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The file's basename only — `/` and `\` (and anything before the last one)
 * are dropped, so a crafted `file_name` can never inject a path segment into
 * the zip. Control characters are replaced with `_` so the entry name stays
 * a plain, single-line filename. */
function safe(fileName: string): string {
  const basename = fileName.split(/[/\\]/).pop() ?? fileName;
  return basename.replace(/[\x00-\x1f\x7f]/g, "_");
}

/** `NN-<kind slug>-<original file name>`, e.g.
 * `01-certidao-de-regularidade-do-fgts-crf.pdf`. `index` is the entry's
 * position in the bundle (0-based in, 1-based out) — it alone guarantees two
 * documents of the same kind never collide. */
export function bundleEntryName(
  index: number,
  doc: { kind: DocumentKind; file_name: string },
): string {
  const prefix = String(index + 1).padStart(2, "0");
  return `${prefix}-${slug(documentKindLabel(doc.kind))}-${safe(doc.file_name)}`;
}

/** Zips already-named entries with no compression: PDFs and images are
 * already compressed, so level 0 just avoids spending CPU for nothing. */
export function buildBundle(
  entries: { name: string; data: Uint8Array }[],
): Uint8Array {
  return zipSync(
    Object.fromEntries(entries.map((entry) => [entry.name, entry.data])),
    { level: 0 },
  );
}
