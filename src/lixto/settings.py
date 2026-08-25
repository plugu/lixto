"""Runtime settings, sourced from environment variables (`LIXTO_` prefix).

No config file, no validation framework — just os.environ with a hardcoded
default matching docker-compose.yml (database/user/password `lixto`, 5433).
"""

import os

DEFAULT_DATABASE_URL = "postgresql://lixto:lixto@localhost:5433/lixto"


def get_database_url() -> str:
    return os.environ.get("LIXTO_DATABASE_URL", DEFAULT_DATABASE_URL)
