PY ?= python3

oracle:
	$(PY) make_oracle.py

test:
	node --test tests/
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
