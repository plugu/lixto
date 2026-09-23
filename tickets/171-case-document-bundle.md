---
id: 171
status: done
model: sonnet
depends_on: [169]
max_attempts: 3
files:
  - web/package.json
  - web/package-lock.json
  - web/lib/case-bundle.ts
  - web/lib/case-bundle.test.ts
  - web/app/(app)/cases/[id]/bundle/route.ts
  - web/app/(app)/cases/[id]/page.tsx
---
## Goal
From a case page the operator downloads one zip with every currently valid document of the company, named by kind, scoped to the session's company.

## Context
Documents: `listDocuments(companyId)` (`web/lib/document-queries.ts`) → rows with `kind`, `file_name`, `storage_path`, `mime_type`, `expired` (SQL-computed `valid_until < CURRENT_DATE`). Files live under `UPLOADS_DIR` (`web/lib/uploads.ts`: default `<cwd>/uploads`, i.e. `web/uploads` in dev, gitignored); `resolveUpload(storage_path)` gives the absolute path. Streaming/route conventions and the tenant 404 rule: `web/app/(app)/company/documents/[id]/download/route.ts`. Case lookup: `getCase(companyId, id)` (ticket 168). No zip library exists in `web/package.json`; add `fflate` (pure JS, `zipSync`/`unzipSync`) pinned exactly. `LinkButton` lives in `web/components/ui/button.tsx`.

### Work
1. `cd web && npm install --save-exact fflate@0.8.2` (commit both `package.json` and `package-lock.json`).
2. `web/lib/case-bundle.ts` (pure): `bundleEntryName(index: number, doc: {kind: DocumentKind; file_name: string}): string` → `${String(index + 1).padStart(2, "0")}-${slug(documentKindLabel)}-${safe(file_name)}` where `slug` = lowercase, accents stripped (NFD + `̀-ͯ` removal), non `[a-z0-9]` runs → `-`, trimmed; `safe` keeps the basename only (`/`, `\` removed) and replaces control chars with `_`. Kind labels from `DOCUMENT_KINDS` in `./types`. `buildBundle(entries: {name: string; data: Uint8Array}[]): Uint8Array` → `zipSync(Object.fromEntries(entries.map(e => [e.name, e.data])), { level: 0 })` (PDFs and images are already compressed). Tests: names are unique for two docs of the same kind, contain no `/`, strip accents ("Certidão" → "certidao"); `unzipSync(buildBundle([...]))` round-trips the bytes.
3. `web/app/(app)/cases/[id]/bundle/route.ts` (`export async function GET(_req, {params})`, `runtime = "nodejs"`): `requireSession()`; id parse (`404` if not an integer); `getCase(session.company.id, id)` → `404` when null; `listDocuments(session.company.id)` filtered `!doc.expired`; read each with `fs.promises.readFile(resolveUpload(doc.storage_path))` — a missing file is `console.warn`ed and skipped; zero readable files → `new Response("Nenhum documento válido para incluir.", { status: 404 })`; otherwise `new Response(buildBundle(entries), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="caso-${id}-documentos.zip"`, "Cache-Control": "no-store" } })`.
4. `web/app/(app)/cases/[id]/page.tsx`: load `listDocuments(session.user.companyId)` alongside the other queries; in the header card's actions render `<LinkButton href={`/cases/${id}/bundle`}>Baixar documentos (zip)</LinkButton>` when at least one document is not expired, else a muted line "Nenhum documento válido em Documentos." linking to `/company/documents`.

Runtime probe preconditions: as ticket 169. The fixture's document points at `fixtures/crf-fgts.pdf`; check 5 creates that file under `web/uploads`.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/case-bundle.test.ts`
3. `cd web && npx tsc --noEmit`
4. `cd web && npm test && npm run build`
5. `mkdir -p web/uploads/fixtures && printf '%%PDF-1.4\n%% fixture\n' > web/uploads/fixtures/crf-fgts.pdf && docker exec -i plataforma-licitante-db-1 psql -U lixto -d lixto -q < scripts/dev/case-fixture.sql && tok=$(grep -E '^LIXTO_INTERNAL_TOKEN=' web/.env.local | cut -d= -f2- | tr -d '"') && curl -s -X POST -H "x-lixto-internal-token: $tok" localhost:3000/api/internal/cases/run | grep -q '"runId"'`
6. `id=$(docker exec plataforma-licitante-db-1 psql -U lixto -d lixto -At -c "select id from cases where company_id = 1 order by id desc limit 1") && z=$(mktemp) && curl -s -b lixto_session=devprobe -D "$z.h" -o "$z" localhost:3000/cases/$id/bundle && grep -qi 'content-type: application/zip' "$z.h" && unzip -l "$z" | grep -q 'crf-fgts.pdf'`
7. `id=$(docker exec plataforma-licitante-db-1 psql -U lixto -d lixto -At -c "select id from cases where company_id = 1 order by id desc limit 1") && curl -s -b lixto_session=devprobe localhost:3000/cases/$id | grep -q 'Baixar documentos (zip)'`
8. `curl -s -o /dev/null -w '%{http_code}' -b lixto_session=devprobe localhost:3000/cases/999999/bundle | grep -qx 404`

## Done when
- All eight checks green: the zip downloads with the fixture document inside, the page shows the button, and an unknown case 404s.

## Not included
- Per-check document selection, declarations, or any generated text inside the zip; streaming for very large sets (all files are read into memory; 20 MB per document cap already applies at upload).
- Expired documents (they are excluded; the verdict table already flags them).
