"""Unit tests for the CLI auto-discovery contract (src/lixto/cli/__init__.py).

Fake modules are written into a temp package so the contract is exercised
without touching the real command modules.
"""

import sys

import typer
from typer.testing import CliRunner

from lixto.cli import app as real_app
from lixto.cli import discover

runner = CliRunner()


def _make_package(tmp_path, monkeypatch, name, modules: dict[str, str]):
    """Create an importable package `name` under tmp_path with the given
    module sources, and return its __path__ list."""
    pkg_dir = tmp_path / name
    pkg_dir.mkdir()
    (pkg_dir / "__init__.py").write_text("")
    for module_name, source in modules.items():
        (pkg_dir / f"{module_name}.py").write_text(source)
    monkeypatch.syspath_prepend(str(tmp_path))
    for mod in [m for m in sys.modules if m == name or m.startswith(f"{name}.")]:
        del sys.modules[mod]
    return [str(pkg_dir)]


GROUP_MODULE = """
import typer

name = "widgets"
app = typer.Typer(help="Widget commands")


@app.command("list")
def list_widgets() -> None:
    typer.echo("widgets listed")
"""

COMMAND_ALIAS_MODULE = """
import typer

name = "gadgets"
command = typer.Typer(help="Gadget commands")


@command.command("poke")
def poke() -> None:
    typer.echo("gadget poked")
"""

REGISTER_MODULE = """
import typer


def register(root: typer.Typer) -> None:
    @root.command("status")
    def status() -> None:
        typer.echo("all good")
"""

HELPER_MODULE = """
CONSTANT = 1
"""


def test_discovers_group_command_alias_and_register(tmp_path, monkeypatch):
    path = _make_package(
        tmp_path,
        monkeypatch,
        "fake_cli_pkg",
        {
            "group": GROUP_MODULE,
            "alias": COMMAND_ALIAS_MODULE,
            "toplevel": REGISTER_MODULE,
            "helper": HELPER_MODULE,
            "_private": GROUP_MODULE,
        },
    )
    root = typer.Typer()

    mounted = discover(root, package="fake_cli_pkg", path=path)

    # helper (nothing exposed) and _private (underscore) are skipped.
    assert mounted == ["alias", "group", "toplevel"]

    assert runner.invoke(root, ["widgets", "list"]).stdout.strip() == "widgets listed"
    assert runner.invoke(root, ["gadgets", "poke"]).stdout.strip() == "gadget poked"
    assert runner.invoke(root, ["status"]).stdout.strip() == "all good"


def test_module_without_name_is_not_mounted(tmp_path, monkeypatch):
    path = _make_package(
        tmp_path,
        monkeypatch,
        "nameless_cli_pkg",
        {"anon": GROUP_MODULE.replace('name = "widgets"', "")},
    )
    root = typer.Typer()

    assert discover(root, package="nameless_cli_pkg", path=path) == []


def test_real_cli_mounts_the_db_group():
    result = runner.invoke(real_app, ["--help"])

    assert result.exit_code == 0
    assert "db" in result.stdout


def test_real_cli_db_group_has_init():
    result = runner.invoke(real_app, ["db", "--help"])

    assert result.exit_code == 0
    assert "init" in result.stdout
