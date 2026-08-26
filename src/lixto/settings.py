"""Runtime settings, sourced from environment variables (`LIXTO_` prefix).

No config file, no validation framework — just os.environ with a hardcoded
default matching docker-compose.yml (database/user/password `lixto`, 5433).
"""

import os

DEFAULT_DATABASE_URL = "postgresql://lixto:lixto@localhost:5433/lixto"
DEFAULT_WEB_INTERNAL_URL = "http://localhost:3000"


def get_database_url() -> str:
    return os.environ.get("LIXTO_DATABASE_URL", DEFAULT_DATABASE_URL)


def get_web_internal_url() -> str:
    """Base URL of the web app's internal batch endpoints (`/api/internal/...`,
    tickets 90/91) — the CLI is a thin trigger, not a second implementation.
    """
    return os.environ.get("LIXTO_WEB_INTERNAL_URL", DEFAULT_WEB_INTERNAL_URL)


def get_internal_token() -> str:
    """Shared secret sent as `x-lixto-internal-token` — same value on web and
    CLI. Required: raises with a clear message rather than sending an empty
    header and getting a confusing 401.
    """
    token = os.environ.get("LIXTO_INTERNAL_TOKEN")
    if not token:
        raise RuntimeError(
            "LIXTO_INTERNAL_TOKEN is not set — required to call the web app's "
            "internal batch endpoints (same value must be set on the web app)"
        )
    return token
