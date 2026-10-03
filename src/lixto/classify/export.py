"""CSV sample of classified tenders for the owner's manual review."""

from __future__ import annotations

import csv
from pathlib import Path

import psycopg

TEXT_CHARS = 300

COLUMNS = (
    "source_id",
    "modality_name",
    "description",
    "items",
    "cnaes",
    "segment",
    "segment_label",
    "nature",
    "keywords",
    "classified_at",
)

_SAMPLE_SQL = """
SELECT p.source_id,
       p.modality_name,
       p.description,
       coalesce(
           (SELECT array_agg(d.description ORDER BY d.description)
              FROM (SELECT DISTINCT i.description
                      FROM procurement_items i
                     WHERE i.procurement_id = p.id
                       AND btrim(coalesce(i.description, '')) <> ''
                     ORDER BY i.description
                     LIMIT 20) d),
           '{}'
       ) AS items,
       coalesce(
           (SELECT array_agg(pc.cnae_code || ':' || round(pc.confidence::numeric, 2)
                             ORDER BY pc.confidence DESC NULLS LAST)
              FROM procurement_cnaes pc
             WHERE pc.procurement_id = p.id AND pc.origin = 'ingest'),
           '{}'
       ) AS cnaes,
       c.segment,
       s.label AS segment_label,
       c.nature,
       c.keywords,
       c.classified_at
FROM procurement_classifications c
JOIN procurements p ON p.id = c.procurement_id
LEFT JOIN classification_segments s ON s.code = c.segment
WHERE c.status = 'done'
ORDER BY random()
LIMIT %(limit)s
"""


def export_sample(conn: psycopg.Connection, *, limit: int, out: Path) -> int:
    """Write up to `limit` random done classifications to `out`; returns the
    number of rows written."""
    with conn.cursor() as cur:
        cur.execute(_SAMPLE_SQL, {"limit": limit})
        rows = cur.fetchall()

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(COLUMNS)
        for (
            source_id,
            modality_name,
            description,
            items,
            cnaes,
            segment,
            segment_label,
            nature,
            keywords,
            classified_at,
        ) in rows:
            writer.writerow(
                [
                    source_id,
                    modality_name,
                    (description or "")[:TEXT_CHARS],
                    "; ".join(items or [])[:TEXT_CHARS],
                    " ".join(cnaes or []),
                    segment,
                    segment_label,
                    nature,
                    ", ".join(keywords or []),
                    classified_at.isoformat() if classified_at else "",
                ]
            )
    return len(rows)
