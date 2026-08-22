---
id: 28
status: done
model: sonnet
depends_on: [24]
max_attempts: 3
files:
  - web/lib/uploads.ts
  - web/lib/documento-queries.ts
  - web/lib/documento-queries.test.ts
  - web/app/empresa/documentos/page.tsx
  - web/app/empresa/documentos/actions.ts
  - web/app/empresa/documentos/[id]/download/route.ts
  - web/components/documentos-empresa-table.tsx
  - web/components/documento-upload-form.tsx
---
## Goal
Admin uploads habilitação documents (typed, optional validade); all empresa users list/download them; expired certidões are flagged "Vencido".

## Context
Auth `@/lib/auth` (`requireSession`, `requireAdmin`). Schema `documento_empresa` in `migrations/007_tenant.sql`; `DOCUMENTO_TIPOS` labels in `@/lib/tenant-types`. Existing `components/documentos-list.tsx` is for PNCP edital files — do NOT touch or reuse it. Style `docs/WEB_STYLE.md`. Tenant rule: `empresaId` only from session; download route must check the row's `empresa_id` equals session's.

`web/lib/uploads.ts`: `UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads")` (document in code comment that Dokploy mounts a volume here); `ALLOWED_MIME = ["application/pdf","image/jpeg","image/png"]`; `MAX_BYTES = 20 * 1024 * 1024`; `saveUpload(empresaId, file: File): Promise<{ caminho, mime, tamanho }>` — validate mime + size (throw pt-BR message), dir `UPLOADS_DIR/<empresaId>/`, filename `<randomUUID()><ext>` (ext from mime), `fs.promises.mkdir recursive` + `writeFile(Buffer.from(await file.arrayBuffer()))`; returns `caminho` relative (`<empresaId>/<uuid>.pdf`). `deleteUpload(caminho)` ignores ENOENT. `resolveUpload(caminho)` → absolute path, throws if normalized path escapes `UPLOADS_DIR`.

`web/lib/documento-queries.ts`: `listDocumentos(empresaId)` → rows + `vencido: validade < current_date` computed in SQL (`validade IS NOT NULL AND validade < CURRENT_DATE`), order by tipo, created_at desc; `insertDocumento(empresaId, usuarioId, { tipo, nomeArquivo, caminho, mime, tamanho, validade })`; `getDocumento(empresaId, id)` (`WHERE id=$ AND empresa_id=$`); `deleteDocumento(empresaId, id)` returns deleted `caminho` or null. Builders exported: `buildListDocumentos`, `buildGetDocumento`, `buildDeleteDocumento`, `buildInsertDocumento`.
`web/lib/documento-queries.test.ts`: every builder binds `empresa_id`; list SQL contains `CURRENT_DATE` vencido expression; insert rejects tipo not in `DOCUMENTO_TIPOS` (validate helper `assertTipo`).

`web/app/empresa/documentos/actions.ts`: `"use server"` `uploadDocumentoAction(prev, formData)` → `requireAdmin()`; fields `tipo`, `validade` (optional `YYYY-MM-DD`), `arquivo: File`; `saveUpload` → `insertDocumento`; on DB error `deleteUpload`; `revalidatePath`. `removerDocumentoAction(fd)` → `requireAdmin()` → `deleteDocumento` → `deleteUpload`.

`web/app/empresa/documentos/[id]/download/route.ts`: `GET` → `requireSession()` → `getDocumento(session.empresa.id, id)`; 404 if null; stream file via `fs.createReadStream` → `new Response(Readable.toWeb(stream))` with `Content-Type: mime`, `Content-Disposition: attachment; filename="<nomeArquivo>"` (RFC 5987 encode non-ASCII).

`web/components/documento-upload-form.tsx` (`"use client"`): tipo `<select DOCUMENTO_TIPOS>`, validade `<input type=date>`, file input `accept=".pdf,.jpg,.jpeg,.png"`, submit "Enviar"; inline erro.
`web/components/documentos-empresa-table.tsx`: columns Tipo (label), Arquivo (link to download route), Validade (pt-BR date or "—"), Status badge (`Vencido` red `bg-destructive/10`-style using existing `--color-unclear`/`--color-partial` tokens: vencido → slate "Vencido", validade within 30 days → amber "Vence em breve", else green "Válido"; no validade → "—"), Enviado em, Ações (Remover, admin only).

`web/app/empresa/documentos/page.tsx`: `requireSession()`; title "Documentos"; upload card only if admin; table; empty state per style guide.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit && npm run lint`
2. `cd web && npx vitest run lib/documento-queries.test.ts`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && test "$(curl -s -o /dev/null -w '%{http_code}' localhost:3100/empresa/documentos/1/download)" = "307" && pkill -f "next-server"`

## Done when
- Admin uploads PDF with past validade → row shows "Vencido"; member sees table, can download, sees no upload/remove; 25 MB file rejected with message; download of another empresa's id → 404.

## Not included
- No S3, no virus scan, no preview/thumbnail, no edit of metadata after upload, no `proxy.ts` or `docker-compose.yml` changes (ticket 29).
