---
id: 107
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - src/lixto/enrich/documents.py
  - src/lixto/enrich/worker.py
  - migrations/002_document_texts_ocr.sql
  - Dockerfile.cli
  - pyproject.toml
  - uv.lock
  - tests/test_enrich_documents.py
  - tests/test_enrich_worker.py
---
## Goal
Scanned (image-only) editais are OCR'd deterministically with Tesseract into `procurement_document_texts` so every procurement takes the text path; the vision/doc LLM tier becomes a last resort instead of the default for `insufficient` PDFs.

## Context

`documents.py`: `extract_for_procurement` downloads ≤2 edital PDFs, runs pypdf, stores `(method, pages, chars, text)` per sequence in `procurement_document_texts` and returns dicts with `pdf_bytes` for fresh downloads. Quality gate `_classify`: `< MIN_TOTAL_CHARS (500)` or `< MIN_CHARS_PER_PAGE (200)` → `method='insufficient'`. `worker.enrich_one`: any doc with `method == 'pypdf'` → `input_kind='text'`; else `_collect_pdfs` → `input_kind='pdf'` → `llm.complete_json_pdf` (vision; fails on the local Ollama primary and on Gemini). Today ~1.2 % of rows are `pdf` class; they are the only rows that need a cloud model.

Add OCR:
1. Deps (`pyproject.toml` + `uv lock`): `pypdfium2>=4` (renders pages to PIL images, wheels only) and `Pillow>=10`. Tesseract is a **system binary**: `Dockerfile.cli` gets `RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por && rm -rf /var/lib/apt/lists/*` before the `uv sync` layers. Locally it is already installed (`/opt/homebrew/bin/tesseract`, lang `por`).
2. `documents.py`: new `ocr_pdf(pdf_bytes: bytes) -> tuple[str, int]` — render up to `MAX_OCR_PAGES = 40` pages at `OCR_DPI = 200` with pypdfium2, run `tesseract <png> stdout -l por --psm 6` via `subprocess.run` (timeout `OCR_PAGE_TIMEOUT = 60` s per page), join pages with `\n\n`, return `(text, pages_rendered)`. If the `tesseract` binary is missing (`shutil.which` is None) log once and return `("", 0)`. When pypdf output classifies as `insufficient` **and** OCR is available, run OCR on the same bytes; re-classify with the same gate; persist `method='ocr'` on success, otherwise keep `insufficient`. Cached rows whose `method='insufficient'` are retried through OCR **once**: re-download the PDF (bytes aren't stored), OCR, upsert; to avoid infinite retries, a failed OCR upserts `method='insufficient'` with `chars=-1` as the "OCR already tried" marker (document this in the module docstring; the loader treats `chars=-1` as final).
3. `worker.py`: `input_kind = "text"` when any doc has `method in ("pypdf", "ocr")` (one-line change); everything else untouched.
4. `migrations/002_document_texts_ocr.sql`: `ALTER TABLE procurement_document_texts DROP CONSTRAINT procurement_document_texts_method_check; ALTER TABLE procurement_document_texts ADD CONSTRAINT procurement_document_texts_method_check CHECK (method IN ('pypdf','ocr','insufficient','not_pdf','failed'));` The runner (`db.run_migrations`) applies pending files by name on `lixto db init` (runs on every cli deploy). No other DDL.
5. Tests: `tests/test_enrich_documents.py` — mock `subprocess.run` + `pypdfium2` (monkeypatch a fake `PdfDocument` yielding N fake pages with `.render().to_pil()` returning a PIL image) : insufficient→ocr success persists `method='ocr'`; OCR failure persists `insufficient` with `chars=-1`; cached `insufficient` with `chars=-1` is not retried; missing binary → no OCR, no crash; page cap respected. `tests/test_enrich_worker.py` — `method='ocr'` doc yields `input_kind='text'`.

Live check (after unit tests): pick any PDF, rasterize it (e.g. print a page to PDF as image) and run `uv run python -c "from lixto.enrich.documents import ocr_pdf; print(ocr_pdf(open('x.pdf','rb').read())[0][:200])"` — must print Portuguese text.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest tests/test_enrich_documents.py tests/test_enrich_worker.py -q`
3. `uv run pytest -q`
4. `grep -q "tesseract-ocr-por" Dockerfile.cli && grep -q "'ocr'" migrations/002_document_texts_ocr.sql`

## Done when
- An image-only PDF goes through `extract_for_procurement` and comes back `method='ocr'` with text; `enrich_one` treats it as `input_kind='text'`.
- Migration 002 applies cleanly on a DB at 001 (`lixto db init` locally).

## Not included
- Removing `complete_json_pdf` / the doc tier (stays as fallback when OCR is also insufficient).
- OCR for non-edital attachments beyond the existing ≤2-doc cap.
- Docs/README (one line in ARCHITECTURE can come with the next docs ticket).
