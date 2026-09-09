# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Pull `summary` for done-enriched procurements into data/summaries.csv (cycle 26, 139).

`pull.py` (137) didn't export `summary` — 139 needs it to rebuild the canonical
embedding text (`build_embedding_text` in src/lixto/enrich/embed.py) for the
embed bench. Same SSH/psql COPY approach as pull.py, scoped the same way
(procurement_enrichments.status = 'done'); this is a small, single-purpose
add-on rather than a change to pull.py's TABLE_SPECS.

Usage:
    uv run experiments/ml-facets/pull_summaries.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SSH_HOST = "plugu-prod01"
DATA_DIR = Path(__file__).parent / "data"

SELECT_SQL = "SELECT procurement_id, summary FROM procurement_enrichments WHERE status = 'done'"


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    dest = DATA_DIR / "summaries.csv"
    copy_sql = f"COPY ({SELECT_SQL}) TO STDOUT WITH CSV HEADER"
    remote_cmd = (
        "set -euo pipefail; "
        "CID=$(docker ps -qf name=pg-shared); "
        f'docker exec "$CID" psql -U shared -d lixto -c "{copy_sql}"'
    )
    with dest.open("wb") as fh:
        subprocess.run(
            ["ssh", "-o", "BatchMode=yes", SSH_HOST, remote_cmd],
            stdout=fh,
            check=True,
        )
    with dest.open() as fh:
        rows = max(sum(1 for _ in fh) - 1, 0)
    print(f"summaries.csv: {rows} rows")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: remote command failed (exit {exc.returncode}): {exc}", file=sys.stderr)
        sys.exit(1)
