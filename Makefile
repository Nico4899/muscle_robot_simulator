SHELL := /bin/bash
# the project venv when present (pytest, hypothesis live there), else the system python3
PY ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)
# what make check runs, all in parallel; pytest is split so its three slow invariants
# (I10, I11, I12 at about 5-10 s each) run side by side instead of one after another
CHECKS := test-js py-fast py-I10 py-I11 py-I12 numbers recheck scrub

oracle:
	$(PY) make_oracle.py

test: test-js test-py

test-js:
	node --test tests/*.test.mjs

test-py:
	$(PY) -m pytest tests -q

py-fast:
	$(PY) -m pytest tests -q -k "not test_I10_ and not test_I11_ and not test_I12_rings_preset"

py-I10:
	$(PY) -m pytest tests -q -k test_I10_

py-I11:
	$(PY) -m pytest tests -q -k test_I11_

py-I12:
	$(PY) -m pytest tests -q -k test_I12_rings_preset

numbers:
	$(PY) check_numbers.py

recheck:
	$(PY) recheck.py

scrub:
	bash scripts/scrub.sh

# every check in parallel, one line each; the full output of each goes to .check/<name>.log
check:
	@mkdir -p .check && rm -f .check/*.failed
	@$(MAKE) --no-print-directory -j $(words $(CHECKS)) $(addprefix check-,$(CHECKS)); \
	  n=$$(ls .check/*.failed 2>/dev/null | wc -l | tr -d ' '); \
	  if [ $$n = 0 ]; then echo "make check: all green in $$SECONDS s"; \
	  else echo "make check: $$n of $(words $(CHECKS)) FAILED in $$SECONDS s"; exit 1; fi

# one check, quietly: a line on stdout, the output in its log, a .failed marker if it fails
check-%:
	@SECONDS=0; if $(MAKE) --no-print-directory $* > .check/$*.log 2>&1; \
	  then printf 'ok    %-8s %3d s\n' $* $$SECONDS; \
	  else printf 'FAIL  %-8s %3d s   see .check/%s.log\n' $* $$SECONDS $*; touch .check/$*.failed; fi

mutate:
	mutmut run && $(PY) scripts/mutation_report.py > reports/mutation.md

build:
	$(PY) build.py

.PHONY: oracle test test-js test-py py-fast py-I10 py-I11 py-I12 numbers recheck scrub check mutate build
