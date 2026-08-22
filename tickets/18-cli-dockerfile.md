---
id: 18
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - Dockerfile.cli
  - .dockerignore
---
## Goal
Root-level `Dockerfile.cli` builds an image with the `plic` CLI installed, so Dokploy can keep a long-lived container (`sleep infinity`) and a Dokploy schedule can `docker exec` `plic sync incremental` into it.

## Context
Python 3.12 project managed by uv (`pyproject.toml`, `uv.lock`, hatchling build, `packages = ["src/plic"]`, script `plic = plic.cli:app`). Runtime deps: typer, psycopg[binary], httpx, openai. Settings: `PLIC_DATABASE_URL` env var (`src/plic/settings.py`).

**Critical path constraint:** `src/plic/db.py` resolves `MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "migrations"` — i.e. it expects `migrations/` three levels above `db.py`. So the package must run from the source tree, not from site-packages: install the project in editable mode with the tree at `/app` (`/app/src/plic/db.py` → `/app/migrations`). Copy `migrations/` into the image.

Dockerfile (single stage is fine):
```dockerfile
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/.venv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY migrations ./migrations
RUN uv sync --frozen --no-dev
RUN useradd --create-home --shell /usr/sbin/nologin appuser && chown -R appuser:appuser /app
USER appuser
ENV PATH="/app/.venv/bin:$PATH"
CMD ["sleep", "infinity"]
```
(`uv sync` installs the project editable by default — that is what keeps `MIGRATIONS_DIR` valid.)

Root `.dockerignore`: `.git`, `.venv`, `web`, `node_modules`, `.env*`, `__pycache__`, `*.pyc`, `tests`, `tickets`, `graphify-out`, `.codegraph`, `docs`, `*.md`, `.pytest_cache`, `.ruff_cache`.

Local Postgres for the runtime check: host `localhost:5433` → from inside the container `host.docker.internal:5433`.

## Checks (run in order — cheapest first)
1. `uv run ruff check src`
2. `docker build -f Dockerfile.cli -t plic-cli:local .`
3. `docker run --rm -e PLIC_DATABASE_URL=postgresql://plic:plic@host.docker.internal:5433/plic plic-cli:local plic status`
4. `docker run --rm -e PLIC_DATABASE_URL=postgresql://plic:plic@host.docker.internal:5433/plic plic-cli:local plic db init | grep -q "No pending migrations"`
5. `docker run --rm plic-cli:local id -u | grep -qv '^0$'`

## Done when
- `plic status` and `plic db init` run inside the image against the local DB; container default command idles; non-root.

## Not included
- No web image, no CI, no Dokploy calls, no changes to Python source or `pyproject.toml`. Don't bake any DB URL or API key into the image.
