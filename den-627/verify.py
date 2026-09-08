#!/usr/bin/env python3
"""Offline provenance and policy verification for ORES CLI receipt recovery."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source"
PINS = ROOT / "pins.json"
EXPECTED_COMMIT = "69612d39ae838d2f999ce85bffb0d6ce97c014f6"
EXPECTED_BLOBS = {
    "reconcile-selected-orgs.sh": "82c0215b83bf7d0b20f97bc560091223b8c1fdef",
    "tests/reconcile_receipts.sh": "5b196f5d78e7ddf677c8bdf11e7243394254ca23",
}
EXPECTED_CASES = {
    "collision",
    "bad_root",
    "mktemp_failure",
    "date_failure",
    "invalid_date",
    "production_findings",
    "test_findings",
    "unavailable",
    "audit_findings",
    "create_findings",
    "runtime_failure",
    "creation_guard",
    "empty_findings",
}
CREDENTIAL = re.compile(
    r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
    r"lin_api_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|"
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def git_blob_sha(path: Path) -> str:
    data = path.read_bytes()
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()  # noqa: S324 - Git identity


def main() -> int:
    pins = json.loads(PINS.read_text(encoding="utf-8"))
    require(
        pins.get("$schema") == "ores.cli-test.receipt-integrity-pins/v1",
        "unexpected pin schema",
    )
    require(pins.get("linearIssue") == "DEN-627", "wrong recovery issue")
    source = pins.get("source", {})
    require(source.get("repository") == "ORESoftware/ores-cli", "wrong source repo")
    require(source.get("pullRequest") == 21, "wrong source PR")
    require(source.get("commit") == EXPECTED_COMMIT, "source head changed without review")
    require(source.get("blobs") == EXPECTED_BLOBS, "source blobs changed without review")
    require(
        pins.get("scope")
        == {
            "offline": True,
            "liveGitHub": False,
            "repositoryCreation": False,
            "rustCli": False,
            "macOS": False,
        },
        "test evidence scope drifted",
    )

    for relative, expected in EXPECTED_BLOBS.items():
        path = SOURCE / relative
        require(path.is_file() and not path.is_symlink(), f"missing regular snapshot: {relative}")
        actual = git_blob_sha(path)
        require(actual == expected, f"{relative} blob mismatch: {actual} != {expected}")

    wrapper = (SOURCE / "reconcile-selected-orgs.sh").read_text(encoding="utf-8")
    tests = (SOURCE / "tests" / "reconcile_receipts.sh").read_text(encoding="utf-8")
    require("RUN_ID=\"$(date -u +%Y%m%dT%H%M%SZ)\"" in wrapper, "UTC timestamp command missing")
    guard = '[[ "$RUN_ID" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail \'invalid receipt timestamp\''
    require(guard in wrapper, "strict receipt timestamp guard missing")
    require(wrapper.index(guard) < wrapper.index("mkdir -p -- \"$REPORT_ROOT\""), "guard must precede receipt-root creation")
    require(wrapper.index(guard) < wrapper.index("REPORT_DIR=\"$(mktemp -d"), "guard must precede mktemp")
    require("umask 077" in wrapper, "private receipt umask missing")
    require("--apply requires active gh user" in wrapper, "primary identity guard missing")

    match = re.search(r"for name in ([^;]+); do", tests)
    require(match is not None, "test case registry missing")
    actual_cases = set(match.group(1).split())
    require(actual_cases == EXPECTED_CASES, f"test case registry drifted: {sorted(actual_cases)}")
    require("FAKE_DATE_VALUE='../outside-receipt'" in tests, "path-shaped date regression missing")
    require("assert_empty \"$CALL_LOG\"" in tests, "no-operation assertions missing")
    require('export PATH="$TOOLS:$PATH" ORESC="$TOOLS/oresc"' in tests, "fake command isolation missing")
    require("unexpected fake gh call" in tests and "unexpected fake oresc call" in tests, "fake commands must fail closed")

    combined = wrapper + tests + PINS.read_text(encoding="utf-8")
    require(CREDENTIAL.search(combined) is None, "credential-shaped material entered test snapshot")
    require("<<<<<<< " not in combined and ">>>>>>> " not in combined, "merge conflict marker detected")

    print(
        "verified exact ores-cli#21 shell blobs, strict timestamp namespace, "
        "13 offline regressions, and no-live-GitHub scope"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
