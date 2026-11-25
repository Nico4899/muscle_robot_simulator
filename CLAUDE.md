# CLAUDE.md: muscle-joint-demo

Rules for Claude Code in this repo. Read this file and `specs/00_overview.md` before every task.

## What this repo is
An offline simulator of the Takeuchi lab's two-stack muscle joint and the checks behind it.
The simulator is simple on purpose; the checks are the point.

## Hard rules
1. **Scripts compute, you don't.** Never type a number into page text or the README. Numbers come
   from `oracle.json` via `{{key}}` placeholders, or from `claims.md` with a source.
2. **Nothing is fitted to lab data.** All PARAMS are fixed hand choices from `specs/01_model.md`.
   `kappa_heavy` was chosen once by hand so 4 unshielded rings land near the published 5-10 deg;
   say so wherever it appears. Never adjust any value toward published angles or the about 2x
   shielding gain.
3. **One reference, one port.** `statics.py`/`model.py` are the reference; the `.js` files port
   them line by line with the same names. Change one, change both, rerun `make oracle` and parity.
4. **Never edit a test to make it pass.** Report the failing case and stop. Ask before changing
   any tolerance.
5. **Stop after each step.** Show the diff and the output of `make check`.
6. **Never commit:** media (`*.mp4`, `*.mov`, images from the paper), `private/`, `reference/`,
   secrets, `.claude/`, lab members' names other than the paper's authors, the lab's experiment
   plan, ring or cell numbers requested from the lab, schedules.
7. **These specs are your only brief.** If something is missing, ask; don't fill it from elsewhere.

## Commands
- `make oracle`: regenerate `oracle.json` (includes the sensitivity table)
- `make test`: parity (Node) + physics and oracle tests (pytest)
- `make check`: test + numbers + recheck + scrub, under 15 s, one line per check
- `make mutate`: mutation testing of the reference, writes `reports/mutation.md`
- `make build`: `dist/table/index.html` (with clip) and `dist/public/index.html` (without)

## Style
Python 3.11+, NumPy, SciPy only in `recheck.py`. Plain ES modules, no npm packages: Node's built-in
test runner. Dev tools: pytest, hypothesis, mutmut. Short functions; comment where each value
comes from.
