import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("accepts same-origin relative paths", () => {
    expect(safeNextPath("/radar")).toBe("/radar");
    expect(safeNextPath("/procurements?status=open&page=2")).toBe(
      "/procurements?status=open&page=2",
    );
    expect(safeNextPath("/")).toBe("/");
  });

  it("rejects empty, missing or non-relative values", () => {
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath("radar")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
  });

  it("rejects protocol-relative targets (browser-normalised to //host)", () => {
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
  });

  it("rejects embedded control characters", () => {
    expect(safeNextPath("/a\nb")).toBeNull();
    expect(safeNextPath("/a\rb")).toBeNull();
    expect(safeNextPath("/\t/evil.com")).toBeNull();
  });

  it("rejects public-only or side-effecting targets", () => {
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/login?next=/logout")).toBeNull();
    expect(safeNextPath("/logout")).toBeNull();
    expect(safeNextPath("/logout#x")).toBeNull();
    expect(safeNextPath("/signup")).toBeNull();
    expect(safeNextPath("/signup/recebido")).toBeNull();
  });

  it("accepts paths that merely look similar to blocked targets", () => {
    // Percent-encoded backslash stays same-origin: browsers do not decode
    // %5C before resolving the URL against the current origin, so this
    // never becomes a protocol-relative target.
    expect(safeNextPath("/%5Cevil.com")).toBe("/%5Cevil.com");
    expect(safeNextPath("/loginx")).toBe("/loginx");
    expect(safeNextPath("/signups")).toBe("/signups");
    expect(safeNextPath("/radar?next=/login")).toBe("/radar?next=/login");
  });
});
