# DEN-2843 infra-profile acceptance

This directory is independent test-org evidence for the `oresc audit repo --profile infra` contract. It is not a copy of the private `ores-cli` implementation and does not turn this repository into a provider schema authority.

The corpus verifies the fleet invariants that matter across implementations:

- baseline repository evidence is explicit;
- Supabase and Neon each expose split `auth/migrations` and `admin/migrations` lanes;
- a lane contains either reviewed SQL or a strong deferred-migration ownership policy;
- provider trees reject plaintext credential-shaped artifacts and symlinks;
- executable/opaque artifacts left under legacy `provider/migrations/` fail closed while a README-only umbrella runbook may remain;
- retired `.db-providers.json` fields (`supabase.sharedOrg`, `schemaNamespace`, `migrationTarget`) fail closed rather than bypassing the current provider schema;
- migration SQL rejects embedded PostgreSQL URLs and generic `DATABASE_URL` coupling.

`verify-infra-profile.mjs` is intentionally an independent acceptance oracle. TypeSpec and independently authored JSON Schema remain peer authorities where domain contracts exist; TJSV remains their cross-authority admission engine.

The workflow also inspects the exact public `flags-2-env/flags-2-env-infra` merge revision used by this tranche. It currently permits exactly one known structural blocker: the repository does not yet carry a root `LICENSE`. Any additional drift fails the test.
