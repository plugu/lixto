import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/icons";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <EmptyState
        icon={<Alert size={20} />}
        title="Página não encontrada"
        hint="O endereço acessado não existe ou foi movido."
        action={
          <LinkButton href="/" variant="primary" size="sm">
            Voltar ao início
          </LinkButton>
        }
      />
    </div>
  );
}
