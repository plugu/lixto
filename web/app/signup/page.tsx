import Link from "next/link";
import { SignupForm } from "@/components/signup-form";

export default function SignupPage() {
  return (
    <div className="mx-auto mt-16 max-w-2xl rounded-lg border border-border bg-card p-8 shadow-subtle">
      <h1 className="font-display text-2xl font-bold tracking-tight">
        Criar conta
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Cadastre sua empresa na Plataforma Licitante.
      </p>

      <SignupForm />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
