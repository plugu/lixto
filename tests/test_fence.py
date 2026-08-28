"""Unit tests for src/lixto/fence.py — env parsing and SQL fragment shape.

No network, no database: `Fence.sql()` returns raw SQL text and a params
dict, both asserted directly.
"""

from lixto.fence import Fence, get_fence

# --- Fence.is_active / sql ---------------------------------------------------


def test_inactive_fence_returns_empty_sql_and_params():
    fence = Fence(portals=(), modalities=(), open_only=False)

    assert fence.is_active() is False
    sql, params = fence.sql()
    assert sql == ""
    assert params == {}


def test_active_fence_includes_both_predicates_and_params():
    fence = Fence(
        portals=("Compras.gov.br", "IPM Sistemas"),
        modalities=(6, 8),
        open_only=True,
    )

    assert fence.is_active() is True
    sql, params = fence.sql()

    assert "procurements.origin_system = ANY(%(fence_portals)s)" in sql
    assert "procurements.modality_id = ANY(%(fence_modalities)s)" in sql
    assert (
        "(procurements.proposal_closes_at >= now() OR procurements.proposal_opens_at > now())"
        in sql
    )
    assert sql.startswith(" AND (")
    assert params["fence_portals"] == ["Compras.gov.br", "IPM Sistemas"]
    assert params["fence_modalities"] == [6, 8]


def test_sql_uses_custom_alias():
    fence = Fence(portals=("Compras.gov.br",), modalities=(), open_only=False)

    sql, _params = fence.sql(alias="p")

    assert "p.origin_system = ANY(%(fence_portals)s)" in sql


def test_open_only_alone_still_active():
    fence = Fence(portals=(), modalities=(), open_only=True)

    assert fence.is_active() is True
    sql, params = fence.sql()
    assert "proposal_closes_at >= now()" in sql
    assert params == {}


def test_describe_inactive():
    fence = Fence(portals=(), modalities=(), open_only=False)

    assert "inactive" in fence.describe()


def test_describe_active_lists_portals_and_modalities():
    fence = Fence(portals=("Compras.gov.br",), modalities=(6, 8), open_only=True)

    description = fence.describe()

    assert "Compras.gov.br" in description
    assert "6" in description and "8" in description
    assert "open_only=True" in description


# --- get_fence / env parsing -------------------------------------------------


def test_get_fence_unset_env_is_inactive(monkeypatch):
    monkeypatch.delenv("LIXTO_FENCE_PORTALS", raising=False)
    monkeypatch.delenv("LIXTO_FENCE_MODALITIES", raising=False)
    monkeypatch.delenv("LIXTO_FENCE_OPEN_ONLY", raising=False)

    fence = get_fence()

    assert fence == Fence(portals=(), modalities=(), open_only=False)
    assert fence.is_active() is False
    sql, params = fence.sql()
    assert sql == ""
    assert params == {}


def test_get_fence_parses_comma_separated_portals_trimmed(monkeypatch):
    monkeypatch.setenv(
        "LIXTO_FENCE_PORTALS",
        "Compras.gov.br, ECustomize Consultoria em Software S.A ,IPM Sistemas",
    )
    monkeypatch.delenv("LIXTO_FENCE_MODALITIES", raising=False)
    monkeypatch.delenv("LIXTO_FENCE_OPEN_ONLY", raising=False)

    fence = get_fence()

    assert fence.portals == (
        "Compras.gov.br",
        "ECustomize Consultoria em Software S.A",
        "IPM Sistemas",
    )


def test_get_fence_parses_comma_separated_modalities_as_ints(monkeypatch):
    monkeypatch.delenv("LIXTO_FENCE_PORTALS", raising=False)
    monkeypatch.setenv("LIXTO_FENCE_MODALITIES", "6,8")
    monkeypatch.delenv("LIXTO_FENCE_OPEN_ONLY", raising=False)

    fence = get_fence()

    assert fence.modalities == (6, 8)


def test_get_fence_open_only_defaults_true_when_portals_set(monkeypatch):
    monkeypatch.setenv("LIXTO_FENCE_PORTALS", "Compras.gov.br")
    monkeypatch.delenv("LIXTO_FENCE_MODALITIES", raising=False)
    monkeypatch.delenv("LIXTO_FENCE_OPEN_ONLY", raising=False)

    fence = get_fence()

    assert fence.open_only is True


def test_get_fence_open_only_defaults_true_when_modalities_set(monkeypatch):
    monkeypatch.delenv("LIXTO_FENCE_PORTALS", raising=False)
    monkeypatch.setenv("LIXTO_FENCE_MODALITIES", "6")
    monkeypatch.delenv("LIXTO_FENCE_OPEN_ONLY", raising=False)

    fence = get_fence()

    assert fence.open_only is True


def test_get_fence_open_only_defaults_false_when_neither_list_set(monkeypatch):
    monkeypatch.delenv("LIXTO_FENCE_PORTALS", raising=False)
    monkeypatch.delenv("LIXTO_FENCE_MODALITIES", raising=False)
    monkeypatch.delenv("LIXTO_FENCE_OPEN_ONLY", raising=False)

    fence = get_fence()

    assert fence.open_only is False


def test_get_fence_open_only_explicit_override(monkeypatch):
    monkeypatch.setenv("LIXTO_FENCE_PORTALS", "Compras.gov.br")
    monkeypatch.delenv("LIXTO_FENCE_MODALITIES", raising=False)
    monkeypatch.setenv("LIXTO_FENCE_OPEN_ONLY", "0")

    fence = get_fence()

    assert fence.open_only is False


def test_get_fence_open_only_accepts_true_string(monkeypatch):
    monkeypatch.delenv("LIXTO_FENCE_PORTALS", raising=False)
    monkeypatch.delenv("LIXTO_FENCE_MODALITIES", raising=False)
    monkeypatch.setenv("LIXTO_FENCE_OPEN_ONLY", "true")

    fence = get_fence()

    assert fence.open_only is True


def test_full_fence_matches_ticket_env_example(monkeypatch):
    monkeypatch.setenv(
        "LIXTO_FENCE_PORTALS",
        "Compras.gov.br,ECustomize Consultoria em Software S.A,IPM Sistemas",
    )
    monkeypatch.setenv("LIXTO_FENCE_MODALITIES", "6,8")
    monkeypatch.delenv("LIXTO_FENCE_OPEN_ONLY", raising=False)

    fence = get_fence()
    sql, params = fence.sql()

    assert "origin_system = ANY(%(fence_portals)s)" in sql
    assert "modality_id = ANY(%(fence_modalities)s)" in sql
    assert "proposal_closes_at >= now() OR" in sql
    assert params["fence_portals"] == [
        "Compras.gov.br",
        "ECustomize Consultoria em Software S.A",
        "IPM Sistemas",
    ]
    assert params["fence_modalities"] == [6, 8]
