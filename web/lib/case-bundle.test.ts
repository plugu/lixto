import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

// Relative imports (not "@/lib/...") on purpose, matching case-verdict.test.ts:
// vitest runs without a path alias for lib tests. case-bundle.ts is pure —
// nothing is mocked here because nothing touches a database or the disk.
import type { DocumentKind } from "./types";
import { bundleEntryName, buildBundle } from "./case-bundle";

function doc(kind: DocumentKind, file_name: string) {
  return { kind, file_name };
}

describe("bundleEntryName", () => {
  it("is unique for two documents of the same kind", () => {
    const first = bundleEntryName(0, doc("fgts_clearance", "crf.pdf"));
    const second = bundleEntryName(1, doc("fgts_clearance", "crf.pdf"));
    expect(first).not.toBe(second);
    expect(first).toBe("01-certidao-de-regularidade-do-fgts-crf.pdf");
    expect(second).toBe("02-certidao-de-regularidade-do-fgts-crf.pdf");
  });

  it("never contains a path separator, even from a crafted file name", () => {
    const name = bundleEntryName(
      0,
      doc("technical_capacity_certificate", "../../etc/passwd.pdf"),
    );
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
  });

  it("strips accents from the kind label", () => {
    // "Certidão de regularidade do FGTS" -> "certidao-de-regularidade-do-fgts"
    const name = bundleEntryName(0, doc("fgts_clearance", "doc.pdf"));
    expect(name).toContain("certidao");
  });
});

describe("buildBundle", () => {
  it("round-trips bytes through unzipSync", () => {
    const entries = [
      { name: "01-a.pdf", data: new TextEncoder().encode("hello") },
      { name: "02-b.pdf", data: new TextEncoder().encode("world") },
    ];

    const zipped = buildBundle(entries);
    const unzipped = unzipSync(zipped);

    expect(new TextDecoder().decode(unzipped["01-a.pdf"])).toBe("hello");
    expect(new TextDecoder().decode(unzipped["02-b.pdf"])).toBe("world");
  });
});
