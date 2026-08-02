"""Runtime settings, sourced from environment variables.

mvp mode: no config file, no validation framework — just os.environ with a
hardcoded default matching docker-compose.yml.
"""

import os

DEFAULT_DATABASE_URL = "postgresql://plic:plic@localhost:5433/plic"


def get_database_url() -> str:
    return os.environ.get("PLIC_DATABASE_URL", DEFAULT_DATABASE_URL)
