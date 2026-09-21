import { describe, expect, it } from "vitest";
import { headerActions } from "./header-actions";

describe("headerActions", () => {
  it("logged in: exactly one action, to /dashboard", () => {
    const actions = headerActions(true);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      href: "/dashboard",
      label: "Ir para o painel",
      variant: "primary",
    });
    expect(actions.some((a) => a.href === "/login")).toBe(false);
    expect(actions.some((a) => a.href === "/signup")).toBe(false);
  });

  it("logged out: exactly the two actions, in order", () => {
    const actions = headerActions(false);
    expect(actions).toEqual([
      { href: "/login", label: "Entrar", variant: "link" },
      { href: "/signup", label: "Criar conta", variant: "primary" },
    ]);
  });
});
