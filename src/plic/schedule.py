"""macOS launchd job scheduler for twice-daily incremental syncs."""

import os
import plistlib
import shutil
import subprocess
from pathlib import Path


def get_uv_path() -> str:
    """Resolve absolute path to uv binary."""
    uv_path = shutil.which("uv")
    if not uv_path:
        raise RuntimeError("uv not found in PATH")
    return uv_path


def get_repo_path() -> str:
    """Get absolute path to the repository root."""
    # Get the path to this module, then go up 2 levels (plic -> src -> repo root)
    return str(Path(__file__).parent.parent.parent.resolve())


def get_uid() -> int:
    """Get the current user's UID for launchctl."""
    return os.getuid()


def get_launchd_agent_path() -> Path:
    """Get the path to the launchd agent plist."""
    home = Path.home()
    return home / "Library" / "LaunchAgents" / "com.plic.sync.plist"


def get_log_path() -> Path:
    """Get the path to the log file."""
    home = Path.home()
    return home / "Library" / "Logs" / "plic-sync.log"


def generate_plist(dry_run: bool = False) -> dict:
    """Generate the launchd plist dict for the sync job.

    The job runs `uv run --project <repo> plic sync incremental` at 07:00 and 19:00.
    """
    uv_path = get_uv_path()
    repo_path = get_repo_path()
    log_path = get_log_path()

    return {
        "Label": "com.plic.sync",
        "ProgramArguments": [
            uv_path,
            "run",
            "--project",
            repo_path,
            "plic",
            "sync",
            "incremental",
        ],
        "StartCalendarInterval": [
            {"Hour": 7, "Minute": 0},
            {"Hour": 19, "Minute": 0},
        ],
        "StandardOutPath": str(log_path),
        "StandardErrorPath": str(log_path),
        "RunAtLoad": False,
    }


def install(dry_run: bool = False) -> None:
    """Install the launchd job.

    If dry_run=True, print the plist and return without writing/loading.
    Otherwise, write the plist, bootstrap it with launchctl, and verify it's loaded.
    """
    plist_dict = generate_plist(dry_run=dry_run)
    plist_path = get_launchd_agent_path()
    uid = get_uid()
    label = plist_dict["Label"]

    # Output the plist (for dry-run or logging)
    plist_bytes = plistlib.dumps(plist_dict, sort_keys=True)
    plist_str = plist_bytes.decode("utf-8")
    print(plist_str)

    if dry_run:
        return

    # Ensure the directory exists
    plist_path.parent.mkdir(parents=True, exist_ok=True)

    # Write the plist to disk
    with open(plist_path, "wb") as f:
        f.write(plist_bytes)

    # Bootstrap the job with launchctl (after bootout if it's already loaded)
    try:
        subprocess.run(
            ["launchctl", "bootout", f"gui/{uid}/{label}"],
            capture_output=True,
            timeout=5,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass  # OK if already unloaded or launchctl doesn't work

    # Load the job
    result = subprocess.run(
        ["launchctl", "bootstrap", f"gui/{uid}", str(plist_path)],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"launchctl bootstrap failed: {result.stderr or result.stdout}"
        )


def uninstall() -> None:
    """Uninstall (bootout) the launchd job."""
    plist_path = get_launchd_agent_path()
    uid = get_uid()
    label = "com.plic.sync"

    # Bootout the job
    subprocess.run(
        ["launchctl", "bootout", f"gui/{uid}/{label}"],
        capture_output=True,
        timeout=10,
        check=False,
    )

    # Remove the plist file if it exists
    if plist_path.exists():
        plist_path.unlink()
