import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest resolves no path
// alias, mirroring web/app/api/internal/cases/run/route.test.ts. `embedText`
// is mocked so this test never calls a provider or a database; the real
// `buildProfileEmbeddingText` is kept so the "same text" comparison is real.
vi.mock("../../../../lib/auth", () => ({
  requireAdmin: vi.fn(),
}));
vi.mock("../../../../lib/profile-queries", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../lib/profile-queries")
  >("../../../../lib/profile-queries");
  return {
    ...actual,
    getProfile: vi.fn(),
    upsertProfile: vi.fn(),
  };
});
vi.mock("../../../../lib/agent/embed", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../lib/agent/embed")
  >("../../../../lib/agent/embed");
  return {
    ...actual,
    embedText: vi.fn(),
  };
});
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireAdmin } from "../../../../lib/auth";
import { getProfile, upsertProfile } from "../../../../lib/profile-queries";
import { embedText } from "../../../../lib/agent/embed";
import { updateProfileAction, type ProfileActionState } from "./actions";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const SESSION = { user: { companyId: 7 } };

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("products", overrides.products ?? "cadeiras");
  fd.set("keywords", overrides.keywords ?? "escritório");
  fd.set("exclusions", overrides.exclusions ?? "");
  fd.set("notes", overrides.notes ?? "");
  fd.set("minValue", overrides.minValue ?? "");
  fd.set("maxValue", overrides.maxValue ?? "");
  return fd;
}

const PREV: ProfileActionState = {};

beforeEach(() => {
  vi.clearAllMocks();
  mock(requireAdmin).mockResolvedValue(SESSION);
});

describe("updateProfileAction", () => {
  it("skips embedText when the embedding text is unchanged", async () => {
    // Same text buildProfileEmbeddingText would produce for the form below.
    const text = "produtos: cadeiras\npalavras-chave: escritório";
    mock(getProfile).mockResolvedValue({ embedding_text: text });

    const result = await updateProfileAction(PREV, makeFormData());

    expect(embedText).not.toHaveBeenCalled();
    expect(upsertProfile).toHaveBeenCalledWith(7, expect.any(Object), null);
    expect(result).toEqual({ ok: true });
  });

  it("re-embeds and forwards the vector when the text changed", async () => {
    mock(getProfile).mockResolvedValue({ embedding_text: "produtos: outra coisa" });
    mock(embedText).mockResolvedValue({ vector: [0.1, 0.2], model: "text-embedding-3-small" });

    const result = await updateProfileAction(PREV, makeFormData());

    expect(embedText).toHaveBeenCalledTimes(1);
    const text = "produtos: cadeiras\npalavras-chave: escritório";
    expect(embedText).toHaveBeenCalledWith(text);
    expect(upsertProfile).toHaveBeenCalledWith(7, expect.any(Object), {
      vector: [0.1, 0.2],
      model: "text-embedding-3-small",
      text,
    });
    expect(result).toEqual({ ok: true });
  });

  it("does not call embedText for an empty embedding text", async () => {
    mock(getProfile).mockResolvedValue(null);

    const result = await updateProfileAction(
      PREV,
      makeFormData({ products: "", keywords: "", notes: "" }),
    );

    expect(embedText).not.toHaveBeenCalled();
    expect(upsertProfile).toHaveBeenCalledWith(7, expect.any(Object), null);
    expect(result).toEqual({ ok: true });
  });

  it("still saves and warns when the provider fails on changed text", async () => {
    mock(getProfile).mockResolvedValue({ embedding_text: "produtos: outra coisa" });
    mock(embedText).mockResolvedValue(null);

    const result = await updateProfileAction(PREV, makeFormData());

    expect(embedText).toHaveBeenCalledTimes(1);
    expect(upsertProfile).toHaveBeenCalledWith(7, expect.any(Object), null);
    expect(result).toEqual({
      ok: true,
      warning: "Dados salvos; similaridade semântica indisponível no momento.",
    });
  });
});
