import path from "node:path";
import { describe, expect, it } from "vitest";
// Relative import (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable in .test.ts files.
import { resolveUpload, UPLOADS_DIR } from "./uploads";

describe("resolveUpload", () => {
  it("resolves a valid relative path under UPLOADS_DIR", () => {
    const result = resolveUpload("12/3fa8-uuid.pdf");
    expect(result).toBe(
      path.join(path.resolve(UPLOADS_DIR), "12", "3fa8-uuid.pdf"),
    );
  });

  it("rejects a path that escapes UPLOADS_DIR via ../", () => {
    expect(() => resolveUpload("../../etc/passwd")).toThrow(
      "Caminho de arquivo inválido.",
    );
  });

  it("rejects an absolute path outside UPLOADS_DIR", () => {
    expect(() => resolveUpload("/etc/passwd")).toThrow(
      "Caminho de arquivo inválido.",
    );
  });
});
