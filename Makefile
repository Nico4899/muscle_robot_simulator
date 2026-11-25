# the project venv when present (pytest, hypothesis live there), else the system python3
PY ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)

oracle:
	$(PY) make_oracle.py

test:
	node --test tests/*.test.mjs
	$(PY) -m pytest tests -q

numbers:
	$(PY) check_numbers.py

recheck:
	$(PY) recheck.py

scrub:
	bash scripts/scrub.sh

check: test numbers recheck scrub

mutate:
	mutmut run && $(PY) scripts/mutation_report.py > reports/mutation.md

build:
	$(PY) build.py

.PHONY: oracle test numbers recheck scrub check mutate build
