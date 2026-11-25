#!/usr/bin/env bash
# Stage a bug and watch the right check catch it (spec 02).
#   ./break_it.sh          flip the crosstalk sign in statics.js only: parity goes red
#   ./break_it.sh --both   flip it in statics.py and statics.js, regenerate the oracle:
#                          parity stays green (a shared mistake), invariant I4 goes red
# Every change is reverted on exit, also on failure or Ctrl-C, and the working tree must end
# exactly as it started (empty `git status --porcelain` when it started clean).
set -euo pipefail
cd "$(dirname "$0")"

PY=${PY:-$([ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)}
MODE=${1:-js}
case "$MODE" in
  js) PATCH=break_js.patch ;;
  --both) PATCH=break_both.patch ;;
  *) echo "usage: $0 [--both]" >&2; exit 2 ;;
esac

BEFORE=$(git status --porcelain)
ORACLE_BACKUP=$(mktemp)
cp oracle.json "$ORACLE_BACKUP"
APPLIED=0

restore() {
  if [ "$APPLIED" = 1 ]; then git apply -R "$PATCH"; APPLIED=0; fi
  cp "$ORACLE_BACKUP" oracle.json
}
cleanup() { restore; rm -f "$ORACLE_BACKUP"; }
trap cleanup EXIT

step() { printf '%-62s' "$1"; }
ok() { echo "ok"; }
fail() { echo "FAIL: $1"; exit 1; }

parity() { node --test tests/parity.test.mjs >/dev/null 2>&1; }
invariant_I4() { "$PY" -m pytest tests/test_physics.py -q -k test_I4_ >/dev/null 2>&1; }

step "apply $PATCH"
git apply "$PATCH" && APPLIED=1 && ok

if [ "$MODE" = js ]; then
  step "parity (port broken, reference not): expect red"
  if parity; then fail "parity stayed green"; else ok; fi
else
  step "regenerate oracle.json from the broken reference"
  "$PY" make_oracle.py >/dev/null 2>&1 || true  # its seed checks are not the point here
  if cmp -s oracle.json "$ORACLE_BACKUP"; then fail "oracle.json did not change"; else ok; fi
  step "parity (same mistake in both): expect green"
  if parity; then ok; else fail "parity went red"; fi
  step "invariant I4 (crosstalk never helps): expect red"
  if invariant_I4; then fail "I4 stayed green"; else ok; fi
fi

step "revert"
restore && ok

step "parity after revert: expect green"
if parity; then ok; else fail "parity red after revert"; fi
if [ "$MODE" = --both ]; then
  step "invariant I4 after revert: expect green"
  if invariant_I4; then ok; else fail "I4 red after revert"; fi
fi

step "working tree as it started"
if [ "$(git status --porcelain)" = "$BEFORE" ]; then ok; else
  echo "FAIL: tree differs"; diff <(echo "$BEFORE") <(git status --porcelain) || true; exit 1
fi
if [ -z "$BEFORE" ]; then echo "git status --porcelain is empty"; fi
