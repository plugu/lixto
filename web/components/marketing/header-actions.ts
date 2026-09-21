// Pure header action list for the marketing header. No React/Next imports —
// this is plain data logic so it can be unit-tested without a DOM or a
// server component tree.

export type HeaderAction = {
  href: string;
  label: string;
  variant: "link" | "primary";
};

export function headerActions(loggedIn: boolean): HeaderAction[] {
  if (loggedIn) {
    return [{ href: "/dashboard", label: "Ir para o painel", variant: "primary" }];
  }
  return [
    { href: "/login", label: "Entrar", variant: "link" },
    { href: "/signup", label: "Criar conta", variant: "primary" },
  ];
}
