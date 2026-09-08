#!/usr/bin/env bash
# Offline regression coverage: no live GitHub access or repository creation.
set -Eeuo pipefail
IFS=$'\n\t'

REPO_ROOT="$(CDPATH= cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SCRIPT="$REPO_ROOT/reconcile-selected-orgs.sh"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ores-cli-receipts.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT
TOOLS="$TEMP_ROOT/tools"
mkdir -p "$TOOLS"
REAL_MKTEMP="$(command -v mktemp)"
export REAL_MKTEMP

cat >"$TOOLS/gh" <<'GH'
#!/bin/sh
set -eu
case "$*" in
  'auth status --active --hostname github.com') exit 0 ;;
  'api user --jq .login') printf '%s\n' "${FAKE_LOGIN:-ORESoftware}" ;;
  api\ orgs/*\ --silent) exit "${FAKE_UNAVAILABLE:-0}" ;;
  *) printf 'unexpected fake gh call\n' >&2; exit 70 ;;
esac
GH
cat >"$TOOLS/oresc" <<'ORESC'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"${CALL_LOG:?}"
case "$*" in
  *list-missing-repos*)
    if [ "${FAKE_EMPTY:-0}" != 1 ]; then printf '%s\n' "${MARKER:-missing-repo}"; fi
    exit "${FAKE_LIST_EXIT:-0}" ;;
  *create-missing-repos*) exit "${FAKE_CREATE_EXIT:-0}" ;;
  *'audit org'*)
    if [ "${FAKE_AUDIT_EXIT:-0}" = 70 ]; then printf 'fake runtime failure\n' >&2; fi
    exit "${FAKE_AUDIT_EXIT:-0}" ;;
  *) printf 'unexpected fake oresc call\n' >&2; exit 70 ;;
esac
ORESC
cat >"$TOOLS/date" <<'DATE'
#!/bin/sh
[ "${FAKE_DATE_FAIL:-0}" = 0 ] || exit 1
printf '%s\n' "${FAKE_DATE_VALUE:-20260908T120000Z}"
DATE
cat >"$TOOLS/mktemp" <<'MKTEMP'
#!/bin/sh
[ "${FAKE_MKTEMP_FAIL:-0}" = 0 ] || exit 1
exec "$REAL_MKTEMP" "$@"
MKTEMP
chmod 0755 "$TOOLS/gh" "$TOOLS/oresc" "$TOOLS/date" "$TOOLS/mktemp"
export PATH="$TOOLS:$PATH" ORESC="$TOOLS/oresc"
export CALL_LOG="$TEMP_ROOT/calls"

assert_eq() {
  [[ "$1" == "$2" ]] || { printf 'expected %s, got %s\n' "$2" "$1" >&2; exit 1; }
}
assert_has() {
  grep -F -- "$2" "$1" >/dev/null || { printf 'missing expected text: %s\n' "$2" >&2; exit 1; }
}
assert_empty() {
  [[ ! -s "$1" ]] || { printf 'expected empty file: %s\n' "$1" >&2; exit 1; }
}
run_wrapper() {
  : >"$CALL_LOG"
  STATUS=0
  bash "$SCRIPT" "$@" >"$TEMP_ROOT/stdout" 2>"$TEMP_ROOT/stderr" || STATUS=$?
}

case_collision() {
  ORES_CLI_REPORT_ROOT="$TEMP_ROOT/collision" MARKER=first run_wrapper --production-only --no-audit
  assert_eq "$STATUS" 0
  local first
  first="$(sed -n 's/^receipts: //p' "$TEMP_ROOT/stdout")"
  ORES_CLI_REPORT_ROOT="$TEMP_ROOT/collision" MARKER=second run_wrapper --production-only --no-audit
  assert_eq "$STATUS" 0
  local second
  second="$(sed -n 's/^receipts: //p' "$TEMP_ROOT/stdout")"
  [[ "$first" != "$second" ]] || { printf 'receipt directory was reused\n' >&2; exit 1; }
  assert_eq "$(cat "$first/production-ores-chat-missing.stdout")" first
  assert_eq "$(cat "$second/production-ores-chat-missing.stdout")" second
  [[ "$(LC_ALL=C ls -ld "$first")" == drwx------* ]]
  [[ "$(LC_ALL=C ls -l "$first/production-ores-chat-missing.stdout")" == -rw-------* ]]
}
case_bad_root() {
  printf 'not a directory\n' >"$TEMP_ROOT/not-a-directory"
  ORES_CLI_REPORT_ROOT="$TEMP_ROOT/not-a-directory" run_wrapper --apply --production-only --no-audit
  assert_eq "$STATUS" 70
  assert_empty "$CALL_LOG"
}
case_mktemp_failure() {
  FAKE_MKTEMP_FAIL=1 ORES_CLI_REPORT_ROOT="$TEMP_ROOT/mktemp-failure" run_wrapper --apply --no-audit
  assert_eq "$STATUS" 70
  assert_empty "$CALL_LOG"
}
case_date_failure() {
  FAKE_DATE_FAIL=1 ORES_CLI_REPORT_ROOT="$TEMP_ROOT/date-failure" run_wrapper --apply --no-audit
  assert_eq "$STATUS" 70
  assert_empty "$CALL_LOG"
}
case_invalid_date() {
  FAKE_DATE_VALUE='../outside-receipt' ORES_CLI_REPORT_ROOT="$TEMP_ROOT/invalid-date" run_wrapper --apply --production-only --no-audit
  assert_eq "$STATUS" 70
  assert_empty "$CALL_LOG"
  assert_has "$TEMP_ROOT/stderr" 'invalid receipt timestamp'
  if compgen -G "$TEMP_ROOT/outside-receipt.*" >/dev/null; then
    printf 'malformed timestamp escaped the receipt root\n' >&2
    exit 1
  fi
}
case_production_findings() {
  FAKE_LIST_EXIT=2 ORES_CLI_REPORT_ROOT="$TEMP_ROOT/production" run_wrapper --strict --production-only --no-audit
  assert_eq "$STATUS" 2
  assert_has "$TEMP_ROOT/stdout" 'commands with policy findings: 7'
  assert_empty "$TEMP_ROOT/stderr"
}
case_test_findings() {
  FAKE_LIST_EXIT=2 ORES_CLI_REPORT_ROOT="$TEMP_ROOT/test" run_wrapper --strict --tests-only --no-audit
  assert_eq "$STATUS" 2
  assert_has "$TEMP_ROOT/stdout" 'commands with policy findings: 7'
  assert_empty "$TEMP_ROOT/stderr"
}
case_unavailable() {
  FAKE_UNAVAILABLE=1 ORES_CLI_REPORT_ROOT="$TEMP_ROOT/unavailable" run_wrapper --strict --no-audit
  assert_eq "$STATUS" 2
  assert_empty "$CALL_LOG"
  assert_empty "$TEMP_ROOT/stderr"
  assert_has "$TEMP_ROOT/stdout" 'unavailable organizations: 14'
}
case_audit_findings() {
  FAKE_AUDIT_EXIT=2 ORES_CLI_REPORT_ROOT="$TEMP_ROOT/audit" run_wrapper --strict --production-only
  assert_eq "$STATUS" 2
  assert_empty "$TEMP_ROOT/stderr"
  assert_has "$TEMP_ROOT/stdout" 'commands with policy findings: 7'
}
case_create_findings() {
  FAKE_CREATE_EXIT=2 ORES_CLI_REPORT_ROOT="$TEMP_ROOT/create" run_wrapper --strict --apply --production-only --no-audit
  assert_eq "$STATUS" 2
  assert_empty "$TEMP_ROOT/stderr"
  assert_has "$TEMP_ROOT/stdout" 'commands with policy findings: 7'
}
case_runtime_failure() {
  FAKE_AUDIT_EXIT=70 ORES_CLI_REPORT_ROOT="$TEMP_ROOT/runtime" run_wrapper --strict --production-only
  assert_eq "$STATUS" 70
  assert_has "$TEMP_ROOT/stderr" 'fake runtime failure'
  assert_has "$TEMP_ROOT/stdout" 'operational failures: 7'
}
case_creation_guard() {
  FAKE_LOGIN=the1mills ORES_CLI_REPORT_ROOT="$TEMP_ROOT/guard" run_wrapper --apply --no-audit
  assert_eq "$STATUS" 70
  assert_empty "$CALL_LOG"
  assert_has "$TEMP_ROOT/stderr" '--apply requires active gh user ORESoftware'
}
case_empty_findings() {
  FAKE_EMPTY=1 FAKE_LIST_EXIT=2 ORES_CLI_REPORT_ROOT="$TEMP_ROOT/empty" run_wrapper --strict --production-only --no-audit
  assert_eq "$STATUS" 2
  if grep -F 'has no missing' "$TEMP_ROOT/stdout" >/dev/null; then
    printf 'empty finding output was misreported as no missing repositories\n' >&2
    exit 1
  fi
}

selected=0
for name in collision bad_root mktemp_failure date_failure invalid_date production_findings test_findings unavailable audit_findings create_findings runtime_failure creation_guard empty_findings; do
  if [[ "${1:-all}" == all || "${1:-all}" == "$name" ]]; then
    selected=$((selected + 1))
    "case_$name"
    printf 'PASS %s\n' "$name"
  fi
done

[[ "$selected" -gt 0 ]] || { printf 'unknown receipt test case\n' >&2; exit 64; }
