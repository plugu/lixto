"""Loads `company_profile.md`, the versioned config the agents score against.

mvp mode: a single markdown file, no schema/validation — agents just read it
as plain text and paste it into the LLM prompt.
"""

from __future__ import annotations

import os
from pathlib import Path

# src/plic/agents/profile.py -> agents -> plic -> src -> repo root
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_PROFILE_PATH = REPO_ROOT / "company_profile.md"


def get_profile_path() -> Path:
    override = os.environ.get("PLIC_PROFILE_PATH")
    return Path(override) if override else DEFAULT_PROFILE_PATH


def load_profile(path: Path | None = None) -> str:
    """Read the company profile markdown as plain text for prompt-building."""
    return (path or get_profile_path()).read_text()
