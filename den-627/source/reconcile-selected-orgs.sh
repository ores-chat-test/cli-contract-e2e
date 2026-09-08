#!/usr/bin/env bash
set -uo pipefail
IFS=$'\n\t'
umask 077

PROGRAM_NAME="ores-cli selected-org reconciliation"
APPLY=0
RUN_AUDIT=1
RUN_PRODUCTION=1
RUN_TESTS=1
STRICT=0
VISIBILITY="private"
REPORT_ROOT="${ORES_CLI_REPORT_ROOT:-.ores/reconcile}"
PRIMARY_LOGIN="${ORES_PRIMARY_GITHUB_LOGIN:-ORESoftware}"

usage() {
  cat <<'USAGE'
Usage: ./reconcile-selected-orgs.sh [options]

Preview, create, and audit the canonical repository topology for the selected
ORES production organizations and their focused *-test organizations. Preview
is the default. Repository creation requires --apply and an active ORESoftware
gh login unless ORES_ALLOW_NONPRIMARY=1 is set explicitly.

Options:
  --apply              Create repositories that oresc reports as missing
  --production-only    Process only production organizations
  --tests-only         Process only focused *-test organizations
  --no-audit           Skip the post-preview/post-create organization audits
  --visibility VALUE   private, internal, or public (default: private)
  --report-root DIR    Store command receipts below DIR
  --strict             Exit 2 for unavailable owners/findings, 70 for failures
  -h, --help           Show this help

Examples:
  ./reconcile-selected-orgs.sh
  ./reconcile-selected-orgs.sh --apply
  ./reconcile-selected-orgs.sh --apply --production-only
  ./reconcile-selected-orgs.sh --apply --tests-only
USAGE
}

log() {
  printf '[ores-fleet] %s\n' "$*"
}

finding() {
  printf '[ores-fleet] finding: %s\n' "$*"
}

warn() {
  printf '[ores-fleet] warning: %s\n' "$*" >&2
}

fail() {
  printf '[ores-fleet] error: %s\n' "$*" >&2
  exit 70
}

require_value() {
  local option="$1"
  local value="${2:-}"
  [[ -n "$value" ]] || fail "$option requires a value"
}

while (($# > 0)); do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --production-only)
      RUN_PRODUCTION=1
      RUN_TESTS=0
      shift
      ;;
    --tests-only)
      RUN_PRODUCTION=0
      RUN_TESTS=1
      shift
      ;;
    --no-audit)
      RUN_AUDIT=0
      shift
      ;;
    --visibility)
      require_value "$1" "${2:-}"
      VISIBILITY="$2"
      shift 2
      ;;
    --report-root)
      require_value "$1" "${2:-}"
      REPORT_ROOT="$2"
      shift 2
      ;;
    --strict)
      STRICT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

case "$VISIBILITY" in
  private|internal|public) ;;
  *) fail "--visibility must be private, internal, or public" ;;
esac

command -v gh >/dev/null 2>&1 || fail 'GitHub CLI `gh` is required'
gh auth status --active --hostname github.com >/dev/null 2>&1 || \
  fail 'GitHub CLI is not authenticated; run `gh auth login`'

ORESC_COMMAND=()
if [[ -n "${ORESC:-}" ]]; then
  ORESC_COMMAND=("$ORESC")
elif command -v oresc >/dev/null 2>&1; then
  ORESC_COMMAND=("$(command -v oresc)")
elif [[ -x "${HOME:-}/.cargo/bin/oresc" ]]; then
  ORESC_COMMAND=("$HOME/.cargo/bin/oresc")
else
  fail 'oresc was not found; run ./post-install.sh first'
fi

if ((APPLY)); then
  active_login="$(gh api user --jq .login 2>/dev/null || true)"
  if [[ "$active_login" != "$PRIMARY_LOGIN" && "${ORES_ALLOW_NONPRIMARY:-0}" != "1" ]]; then
    fail "--apply requires active gh user $PRIMARY_LOGIN; active user is ${active_login:-unknown}"
  fi
fi

# Receipts may name private repositories. Never reuse a timestamp directory or
# proceed to GitHub operations when the receipt destination cannot be prepared.
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)" || fail 'cannot determine receipt timestamp'
[[ -n "$RUN_ID" ]] || fail 'empty receipt timestamp'
[[ "$RUN_ID" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail 'invalid receipt timestamp'
case "$REPORT_ROOT" in
  -*) REPORT_ROOT="./$REPORT_ROOT" ;;
esac
mkdir -p -- "$REPORT_ROOT" || fail 'cannot create receipt root'
REPORT_DIR="$(mktemp -d "$REPORT_ROOT/$RUN_ID.XXXXXX")" || \
  fail 'cannot create unique receipt directory'
[[ -d "$REPORT_DIR" ]] || fail 'receipt directory was not created'

available_count=0
unavailable_count=0
finding_count=0
failure_count=0
creation_count=0

owner_available() {
  local owner="$1"
  gh api "orgs/$owner" --silent >/dev/null 2>&1
}

run_with_receipt() {
  local label="$1"
  local stdout_path="$2"
  local stderr_path="$3"
  shift 3

  log "$label"
  "$@" >"$stdout_path" 2>"$stderr_path"
  local status=$?

  [[ ! -s "$stdout_path" ]] || cat "$stdout_path"
  [[ ! -s "$stderr_path" ]] || cat "$stderr_path" >&2
  return "$status"
}

record_unavailable() {
  local owner="$1"
  local note="$2"
  unavailable_count=$((unavailable_count + 1))
  finding "$owner is not an accessible GitHub organization; $note"
  printf '%s\t%s\n' "$owner" "$note" >>"$REPORT_DIR/unavailable.tsv" || \
    fail 'cannot append unavailable-organization receipt'
}

process_production() {
  local owner="$1"
  local prefix="$2"
  local slug="production-$owner"
  local status=0

  printf '\n===== production: %s (prefix: %s) =====\n' "$owner" "$prefix"

  if ! owner_available "$owner"; then
    case "$owner" in
      ores-middleware)
        record_unavailable "$owner" 'the existing repository is ORESoftware/ores-middleware; create or grant access to the dedicated organization before fleet creation'
        ;;
      pal-trace)
        record_unavailable "$owner" 'create or grant access to github.com/pal-trace before fleet creation'
        ;;
      *)
        record_unavailable "$owner" 'verify organization existence and gh access'
        ;;
    esac
    return 0
  fi

  available_count=$((available_count + 1))
  run_with_receipt \
    "listing missing canonical repositories for $owner" \
    "$REPORT_DIR/$slug-missing.stdout" \
    "$REPORT_DIR/$slug-missing.stderr" \
    "${ORESC_COMMAND[@]}" org \
      --name "$owner" \
      --family-prefix "$prefix" \
      list-missing-repos
  status=$?
  case "$status" in
    0) ;;
    2)
      finding_count=$((finding_count + 1))
      finding "$owner missing-repository listing completed with policy findings"
      ;;
    *)
      failure_count=$((failure_count + 1))
      warn "$owner missing-repository listing failed with exit $status"
      return 0
      ;;
  esac

  if [[ "$status" -eq 0 && ! -s "$REPORT_DIR/$slug-missing.stdout" ]]; then
    log "$owner has no missing canonical repositories"
  fi

  if ((APPLY)); then
    run_with_receipt \
      "creating missing canonical repositories for $owner" \
      "$REPORT_DIR/$slug-create.stdout" \
      "$REPORT_DIR/$slug-create.stderr" \
      "${ORESC_COMMAND[@]}" org \
        --name "$owner" \
        --family-prefix "$prefix" \
        create-missing-repos \
        --all \
        --visibility "$VISIBILITY"
    status=$?
    creation_count=$((creation_count + 1))
    case "$status" in
      0) ;;
      2)
        finding_count=$((finding_count + 1))
        finding "$owner creation completed with findings"
        ;;
      *)
        failure_count=$((failure_count + 1))
        warn "$owner creation failed with exit $status"
        ;;
    esac
  fi

  if ((RUN_AUDIT)); then
    run_with_receipt \
      "auditing organization topology and repository layouts for $owner" \
      "$REPORT_DIR/$slug-audit.stdout" \
      "$REPORT_DIR/$slug-audit.stderr" \
      "${ORESC_COMMAND[@]}" --no-json audit org \
        --org "$owner" \
        --family-prefix "$prefix" \
        --repo-limit 1000 \
        --max-layout-repos 1000
    status=$?
    case "$status" in
      0) ;;
      2)
        finding_count=$((finding_count + 1))
        finding "$owner audit completed with policy findings"
        ;;
      *)
        failure_count=$((failure_count + 1))
        warn "$owner audit failed operationally with exit $status"
        ;;
    esac
  fi
}

test_expected_repositories() {
  case "$1" in
    ores-chat-test)
      printf '%s' '.github,contract-conformance-tests,security-boundary-tests,chaos-recovery-tests,upgrade-compatibility-tests,cli-contract-e2e,mcp-contract-e2e,telemetry-redaction-e2e,dual-auth-supabase-neon-e2e,sign-in-link-e2e,redis-lru-pubsub-e2e,rate-limit-integration-e2e,sops-secret-redaction-e2e'
      ;;
    ores-legal-test)
      printf '%s' '.github,contract-conformance-tests,signature-workflow-e2e,audit-trail-integrity-e2e,consent-evidence-e2e,signer-auth-e2e,multi-party-routing-e2e,webhook-replay-e2e,webhook-idempotency-e2e,document-retention-e2e,erasure-and-legal-hold-e2e,security-boundary-tests,chaos-recovery-tests,upgrade-compatibility-tests'
      ;;
    ores-middleware-test)
      printf '%s' '.github,contract-conformance-tests,middleware-ordering-e2e,dual-auth-routing-e2e,admin-db-isolation-e2e,rate-limit-integration-e2e,redis-lru-integration-e2e,otel-context-propagation-e2e,sops-secret-redaction-e2e,security-boundary-tests,chaos-recovery-tests,upgrade-compatibility-tests'
      ;;
    ores-rate-limit-test)
      printf '%s' '.github,token-bucket-conformance-tests,sliding-window-conformance-tests,distributed-consistency-e2e,redis-pubsub-e2e,clock-skew-e2e,fairness-e2e,burst-control-e2e,tenant-isolation-e2e,failover-e2e,security-boundary-tests,chaos-recovery-tests,upgrade-compatibility-tests'
      ;;
    ores-otel-test)
      printf '%s' '.github,contract-conformance-tests,security-boundary-tests,chaos-recovery-tests,upgrade-compatibility-tests,trace-context-propagation-e2e,sampling-policy-e2e,collector-failover-e2e,pii-redaction-e2e,otlp-http-grpc-parity-e2e,async-context-propagation-e2e,redis-lru-correlation-e2e'
      ;;
    ores-redis-lru-cache-test)
      printf '%s' '.github,ores-redis-lru-e2e-test,contract-conformance-tests,cross-language-conformance-tests,redis-pubsub-fanout-e2e,three-minute-reconciliation-e2e,stale-write-fencing-e2e,redis-outage-recovery-e2e,memory-pressure-eviction-e2e,process-restart-recovery-e2e,duplicate-message-idempotency-e2e,security-boundary-tests,chaos-recovery-tests,upgrade-compatibility-tests'
      ;;
    pal-trace-test)
      printf '%s' '.github,contract-conformance-tests,trace-ingestion-e2e,trace-query-e2e,tenant-isolation-e2e,privacy-redaction-e2e,collector-failover-e2e,offline-sync-e2e,retention-erasure-e2e,otel-correlation-e2e,security-boundary-tests,chaos-recovery-tests,upgrade-compatibility-tests'
      ;;
    *)
      return 64
      ;;
  esac
}

process_test_org() {
  local owner="$1"
  local expected
  expected="$(test_expected_repositories "$owner")" || fail "missing test repository policy for $owner"
  local slug="test-$owner"
  local status=0

  printf '\n===== test organization: %s =====\n' "$owner"

  if ! owner_available "$owner"; then
    record_unavailable "$owner" 'create or grant access to the test organization before focused test-repository creation'
    return 0
  fi

  available_count=$((available_count + 1))
  run_with_receipt \
    "listing missing focused test repositories for $owner" \
    "$REPORT_DIR/$slug-missing.stdout" \
    "$REPORT_DIR/$slug-missing.stderr" \
    "${ORESC_COMMAND[@]}" org \
      --name "$owner" \
      --no-standard-family \
      --expected-repos "$expected" \
      list-missing-repos
  status=$?
  case "$status" in
    0) ;;
    2)
      finding_count=$((finding_count + 1))
      finding "$owner missing-repository listing completed with policy findings"
      ;;
    *)
      failure_count=$((failure_count + 1))
      warn "$owner test-repository listing failed with exit $status"
      return 0
      ;;
  esac

  if [[ "$status" -eq 0 && ! -s "$REPORT_DIR/$slug-missing.stdout" ]]; then
    log "$owner has no missing focused test repositories"
  fi

  if ((APPLY)); then
    run_with_receipt \
      "creating missing focused test repositories for $owner" \
      "$REPORT_DIR/$slug-create.stdout" \
      "$REPORT_DIR/$slug-create.stderr" \
      "${ORESC_COMMAND[@]}" org \
        --name "$owner" \
        --no-standard-family \
        --expected-repos "$expected" \
        create-missing-repos \
        --all \
        --visibility "$VISIBILITY"
    status=$?
    creation_count=$((creation_count + 1))
    case "$status" in
      0) ;;
      2)
        finding_count=$((finding_count + 1))
        finding "$owner focused test creation completed with findings"
        ;;
      *)
        failure_count=$((failure_count + 1))
        warn "$owner focused test creation failed with exit $status"
        ;;
    esac
  fi

  if ((RUN_AUDIT)); then
    run_with_receipt \
      "auditing focused test repository topology and layouts for $owner" \
      "$REPORT_DIR/$slug-audit.stdout" \
      "$REPORT_DIR/$slug-audit.stderr" \
      "${ORESC_COMMAND[@]}" --no-json audit org \
        --org "$owner" \
        --expected-repos "$expected" \
        --no-require-docs-repo \
        --repo-limit 1000 \
        --max-layout-repos 1000
    status=$?
    case "$status" in
      0) ;;
      2)
        finding_count=$((finding_count + 1))
        finding "$owner test audit completed with policy findings"
        ;;
      *)
        failure_count=$((failure_count + 1))
        warn "$owner test audit failed operationally with exit $status"
        ;;
    esac
  fi
}

log "$PROGRAM_NAME"
log "mode: $([[ $APPLY -eq 1 ]] && printf apply || printf preview)"
log "report directory: $REPORT_DIR"

if ((RUN_PRODUCTION)); then
  process_production ores-chat ores-chat
  process_production ores-legal ores-legal
  process_production ores-middleware ores-middleware
  process_production ores-rate-limit ores-rl
  process_production ores-otel ores-otel
  process_production ores-redis-lru-cache ores-lru-redis
  process_production pal-trace pal-trace
fi

if ((RUN_TESTS)); then
  process_test_org ores-chat-test
  process_test_org ores-legal-test
  process_test_org ores-middleware-test
  process_test_org ores-rate-limit-test
  process_test_org ores-otel-test
  process_test_org ores-redis-lru-cache-test
  process_test_org pal-trace-test
fi

printf '\n===== reconciliation summary =====\n'
printf 'available organizations: %d\n' "$available_count"
printf 'unavailable organizations: %d\n' "$unavailable_count"
printf 'creation operations attempted: %d\n' "$creation_count"
printf 'commands with policy findings: %d\n' "$finding_count"
printf 'operational failures: %d\n' "$failure_count"
printf 'receipts: %s\n' "$REPORT_DIR"

if ((STRICT)); then
  if ((failure_count > 0)); then
    exit 70
  fi
  if ((unavailable_count > 0 || finding_count > 0)); then
    exit 2
  fi
fi

exit 0
