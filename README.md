# cli-contract-e2e

Status: **contract-only**. This suite specifies command-line configuration, trust-plane routing, structured output, exit-code behavior, and the selected production/test organization reconciliation plan.

The reviewed values are in `contracts/oresc-selected-fleet.v1.json`. The independent TypeSpec authority is `contracts/oresc-selected-fleet.v1.tsp`; the independent JSON Schema Draft 2020-12 authority is `contracts/oresc-selected-fleet.v1.schema.json`. CI invokes `ORESoftware/typespec-json-schema-validator` at an immutable commit, executes both authorities over the committed instance corpus, and requires a passed deterministic receipt plus an admissible, complete Contract IR. Neither authority is generated from or ranked below the other.

`scripts/verify-oresc-selected-fleet.mjs` separately validates all seven organization pairs, the non-obvious `ores-rl` and `ores-lru-redis` prefixes, focused test-repository sets, explicit mutation gating, private receipt handling, and credential-free argv behavior. Its self-test includes matrix-drift, prefix-drift, duplicate, and secret-shaped-name negative controls. This value-level gate complements TJSV; it does not replace compiler-backed structural and differential parity.

Pull requests run without private source or credentials. A manual `workflow_dispatch` can use the approved `ORES_CLI_READ_TOKEN` secret to check an exact `ORESoftware/ores-cli` ref, execute the source repository's reconciliation smoke suite, and verify that `post-install.sh --dry-run` prints the guarded handoff. Absence of that secret fails the private-source job closed.

This repository remains contract-only until the private-source job and the relevant live organization probes pass at an exact ref. It does not claim that missing organizations or focused repositories exist. Public, customer, administrator, and internal-service identities are never interchangeable, and retained output must not contain bearer tokens, provider credentials, prompts, answers, database URLs, or cache values.
