"""Unit tests for the scheduler module (src/plic/schedule.py).

These tests verify plist generation and paths without requiring launchctl/macOS.
"""

import plistlib
from unittest.mock import MagicMock, patch

from plic.schedule import generate_plist, get_launchd_agent_path, get_log_path


def test_generate_plist_has_required_keys():
    """Verify the plist dict has all required launchd keys."""
    plist = generate_plist()

    assert "Label" in plist
    assert plist["Label"] == "com.plic.sync"
    assert "ProgramArguments" in plist
    assert "StartCalendarInterval" in plist
    assert "StandardOutPath" in plist
    assert "StandardErrorPath" in plist


def test_generate_plist_program_arguments():
    """Verify program arguments contain uv run ... plic sync incremental."""
    plist = generate_plist()
    args = plist["ProgramArguments"]

    assert len(args) >= 5
    # Should be: [uv_path, "run", "--project", repo_path, "plic", "sync", "incremental"]
    assert "run" in args
    assert "--project" in args
    assert "plic" in args
    assert "sync" in args
    assert "incremental" in args


def test_generate_plist_start_calendar_intervals():
    """Verify the job is scheduled for 07:00 and 19:00."""
    plist = generate_plist()
    intervals = plist["StartCalendarInterval"]

    assert len(intervals) == 2
    hours = sorted([interval["Hour"] for interval in intervals])
    minutes = [interval["Minute"] for interval in intervals]

    assert hours == [7, 19]
    assert all(m == 0 for m in minutes)


def test_generate_plist_logs_to_home_library_logs():
    """Verify log paths point to ~/Library/Logs/plic-sync.log."""
    plist = generate_plist()
    stdout_path = plist["StandardOutPath"]
    stderr_path = plist["StandardErrorPath"]

    assert "plic-sync.log" in stdout_path
    assert "plic-sync.log" in stderr_path
    assert "Library/Logs" in stdout_path
    assert "Library/Logs" in stderr_path


def test_generate_plist_is_xml_serializable():
    """Verify the plist dict can be serialized to XML (valid plist format)."""
    plist = generate_plist()
    plist_bytes = plistlib.dumps(plist)

    # Verify it can be read back
    parsed = plistlib.loads(plist_bytes)
    assert parsed["Label"] == "com.plic.sync"


def test_get_launchd_agent_path():
    """Verify the agent path is correct."""
    path = get_launchd_agent_path()
    assert "Library/LaunchAgents" in str(path)
    assert "com.plic.sync.plist" in str(path)


def test_get_log_path():
    """Verify the log path is correct."""
    path = get_log_path()
    assert "Library/Logs" in str(path)
    assert "plic-sync.log" in str(path)


@patch("plic.schedule.subprocess.run")
@patch("plic.schedule.get_launchd_agent_path")
def test_install_dry_run_prints_but_does_not_write(mock_path, mock_run, capsys):
    """Verify --dry-run prints plist but doesn't call launchctl."""
    mock_path.return_value = MagicMock()

    from plic.schedule import install

    install(dry_run=True)

    captured = capsys.readouterr()
    assert "<?xml" in captured.out or "<!DOCTYPE" in captured.out
    assert "com.plic.sync" in captured.out
    # Should not call launchctl
    mock_run.assert_not_called()
