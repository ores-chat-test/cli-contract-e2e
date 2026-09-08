# DEN-627 ORES CLI receipt-integrity recovery

This directory executes the two shell files from `ORESoftware/ores-cli#21` at source commit `791939fa54d9a8a2884583732742376bedea86f4`.

The snapshots are bound twice: `pins.json` records the source identities, while `verify.py` contains independently reviewed expected commit and Git blob values. A change to either source file must update both approval layers and rerun the complete suite.

## Executed scope

The tests use private temporary directories and replace `gh`, `oresc`, `date`, and `mktemp` through an isolated `PATH`. No GitHub organization or repository API is contacted. The suite verifies:

- unique private receipt directories and mode `0700`/`0600` behavior;
- failure before any reconciliation operation when the receipt root, timestamp, or `mktemp` is invalid;
- strict `YYYYMMDDTHHMMSSZ` receipt run identifiers, including a path-shaped malicious timestamp regression;
- production/test/audit/create finding counts and strict exit codes;
- unavailable-organization and operational-failure separation;
- the primary GitHub identity guard before `--apply`;
- no false success message for empty output paired with a finding exit;
- rejection of unknown test selectors.

CI runs all 13 cases together and independently, verifies the two Git blob identities, checks Bash syntax, and scans the recovery surface for conflict markers and credential-shaped material. Workflow permissions are read-only and checkout credentials are not persisted.

## Claim boundary

This is credential-free external shell evidence. It does not compile or certify the Rust `oresc` binary, execute the interactive organization picker, contact GitHub, create repositories, run on macOS, or establish that the selected organization catalog is complete. Those scopes remain in `ORESoftware/ores-cli#18`, `#19`, and the live reconciliation workflow.

Source PR: https://github.com/ORESoftware/ores-cli/pull/21  
Linear: DEN-627
