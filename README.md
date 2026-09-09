# cli-contract-e2e

Status: **contract-only**. This suite specifies command-line configuration, trust-plane routing, structured output, exit-code behavior, and the selected production/test organization reconciliation plan.

The independent consumer contract is `contracts/oresc-selected-fleet.v1.json`. `scripts/verify-oresc-selected-fleet.mjs` validates all seven organization pairs, the non-obvious `ores-rl` and `ores-lru-redis` prefixes, focused test-repository sets, explicit mutation gating, private receipt handling, and credential-free argv behavior. Its self-test includes matrix-drift, prefix-drift, duplicate, and secret-shaped-name negative controls.

Pull requests run without private source or credentials. A manual `workflow_dispatch` can use the approved `ORES_CLI_READ_TOKEN` secret to check an exact `ORESoftware/ores-cli` ref, execute the source repository's reconciliation smoke suite, and verify that `post-install.sh --dry-run` prints the guarded handoff. Absence of that secret fails the private-source job closed.

This repository remains contract-only until the private-source job and the relevant live organization probes pass at an exact ref. It does not claim that missing organizations or focused repositories exist. Public, customer, administrator, and internal-service identities are never interchangeable, and retained output must not contain bearer tokens, provider credentials, prompts, answers, database URLs, or cache values.
