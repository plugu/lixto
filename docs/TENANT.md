# Multi-Tenant Architecture (Cycle 7)

## Data Model

| Table | Purpose |
|-------|---------|
| **empresa** | Bidder company (CNPJ, razão social, endereço, etc.) |
| **usuario** | Login accounts (email, senha_hash, role: admin/member) — owns empresa_id |
| **empresa_cnae** | Activity codes (CNAE) per empresa with principal flag |
| **sessao** | Auth sessions — cookie plic_session, 30-day expiry |
| **documento_empresa** | Habilitação documents — arquivo, validade, vencido flag |

**Relationships:** empresa ← usuário (many); empresa ← documento_empresa (many); empresa ← empresa_cnae (many).

## Roles

- **admin:** Edit empresa profile, manage users (invite/remove), manage documents.
- **member:** Read-only view of empresa data; cannot edit or invite.

## Session & Auth

- Cookie: `plic_session` (httpOnly, lax SameSite, 30-day max-age).
- Table: `sessao` stores `token_hash` (sha256), `usuario_id`, `expira_em`.
- Login: email + scrypt password hash.
- Invite flow: admin invites by email → temporary token (7-day expiry) → invitee sets password on accept.

## Tenant Scoping Rule

**Golden rule:** `empresa_id` is ONLY sourced from the session (`requireSession()`, `requireAdmin()`), never from request body/params. All query builders bind `empresa_id` as a parameterized placeholder (`$1`, `$2`, etc.).

## Document Storage

- **Local dev:** `./web/uploads/<empresa_id>/<uuid>.<ext>` (gitignored).
- **Production (Dokploy):** Named volume `plataforma-licitante-uploads` mounted at `/app/uploads` in the app container.

Mount instruction for Dokploy:
```
Volume Name: plataforma-licitante-uploads
Mount Path: /app/uploads
```

## Public Routes

Routes accessible without login (no session cookie required):

- `/login` — Email/password login form.
- `/signup` — New empresa + admin user registration (auto-fills from BrasilAPI on CNPJ).
- `/convite?token=...` — Invite acceptance form (sets password, accepts role).
- `/_next/*` — Next.js internals.
- `/favicon.ico` — Favicon.

All other routes require a valid session cookie and redirect to `/login?next=...` if missing.
