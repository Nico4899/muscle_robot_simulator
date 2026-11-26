# muscle-joint-demo

Biohybrid Systems Lab.

An offline simulator of an antagonistic joint driven by two stacks of lab-grown muscle rings, as
built by Morita, Nie and Takeuchi (Science Advances), and the checks behind it. The simulator is
simple on purpose; the checks are the point:

- a Python reference and its JavaScript port must agree exactly (parity);
- physics invariants, tested with Hypothesis, check the reference itself, and mutation testing
  measures which mistakes they would still miss (`reports/mutation.md`);
- an independent recheck recomputes the headline values with other code and another random
  generator;
- no number reaches the page or this README unless a script computed it (`oracle.json`) or a
  source backs it (`claims.md`, one row per claim, each read in full).

Everything shown is simulated and not fitted to lab data. The strain curves are the published
mean curves of single rings, used as they are.

## Run it

Needs Python, Node and make. Pinned Python packages are in `requirements.txt`.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt

make check            # every check in parallel, one line each
make oracle           # regenerate oracle.json (takes a couple of minutes)
make build            # dist/public/index.html; with private/ also dist/table/index.html (clip, lab logo)
./break_it.sh         # stage a bug in the port: parity goes red, then all is restored
./break_it.sh --both  # the same bug in reference and port: parity stays green, an invariant goes red
make mutate           # mutation testing of the reference, writes reports/mutation.md (slow)
```

Open `dist/public/index.html` in a browser; it needs no network. Keys: Space stimulate,
F fixed force, 1-4 rings per side, S spread, B rebuild your joint, H shielding, L load,
R new builds, Esc reset. Every key is also a button.

For development, serve the folder (`python3 -m http.server`) and open `page/index.src.html`.

## Credits and licence

The code is under the MIT licence (`LICENSE`). Movie S11 and the figures belong to Morita, Nie & Takeuchi, Science Advances 2025, under CC BY-NC 4.0; the clip is not in this repository, and the public page links to the paper instead. The published curves and angles come from the authors' Dryad dataset (CC0). Sources for every claim are in `claims.md`.
