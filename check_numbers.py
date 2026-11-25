"""Number checks (spec 04): no number reaches the captions, README or page text unless it comes
from oracle.json through a {{key}} placeholder, or from a claims.md row that is cited on the
same line and read in full.

- Every {{key}} / {{key:fmt}} must exist in oracle.json and render with its format.
- Every bare number must appear in the value column of a row cited on that line ([C1], [L1]),
  or be whitelisted: key labels such as "1-4" anywhere; years and licence versions in credits.
- Every cited row must exist and have "read in full?" = yes.
- Numbers written as words ("fifty", "twice") are printed as warnings for a human, not failures.
Exit 1 on any failure. A source file that does not exist yet is reported and skipped.
"""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

SOURCES = ("captions.json", "README.md", "page/index.src.html")
PLACEHOLDER = re.compile(r"\{\{(\w+)(?::([^}]*))?\}\}")
CITATION = re.compile(r"\[([A-Z]\d+)\]")
# a bare number: digits not glued to letters, digits or a decimal point (so not "S11", "C4")
NUMBER = re.compile(r"(?<![A-Za-z0-9_.])\d+(?:\.\d+)?(?![A-Za-z0-9_])")
VALUE_NUMBER = re.compile(r"\d+(?:\.\d+)?")  # inside a claims.md value: "2x", "5-10 deg"
KEY_LABELS = ("1-4", "1 in 10")  # labels, not claims: the rings keys; the 10 % quantile readout
CREDIT_ONLY = re.compile(r"\b(?:19|20)\d\d\b|\bCC[ -]BY(?:-[A-Z]+)*\s+\d+\.\d+")  # years, licences
NUMBER_WORDS = re.compile(
    r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|"
    r"fifty|sixty|seventy|eighty|ninety|hundred|thousand|twice|thrice|half|double|triple|dozen)\b",
    re.IGNORECASE)


def load_claims(path="claims.md"):
    """{row id: {"value": ..., "read": ...}} from the claims.md table."""
    rows = {}
    header = None
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if header is None:
            header = [c.lower() for c in cells]
            continue
        if set(cells[0]) <= set("-: "):
            continue  # the |---| separator row
        row = dict(zip(header, cells))
        rows[row["id"]] = {"value": row["value"], "read": row["read in full?"]}
    return rows


def caption_items(path):
    """(where, text, is_credit) for every caption string, skipping "_"-prefixed notes."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))

    def walk(node, where):
        if isinstance(node, str):
            yield where, node, "credit" in where
        elif isinstance(node, dict):
            for k, v in node.items():
                if not k.startswith("_"):
                    yield from walk(v, f"{where}.{k}" if where else k)

    for where, text, credit in walk(data, ""):
        yield f"{path}:{where}", text, credit


def markdown_items(path):
    for i, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        credit = bool(re.search(r"CC[ -]BY|CC0|licen[cs]e", line, re.IGNORECASE))
        yield f"{path}:{i}", line, credit


class PageText(HTMLParser):
    """Visible text and text attributes of the page, per source line; script and style skipped;
    text inside an element whose class mentions "credit" counts as a credit."""

    ATTRS = ("alt", "title", "aria-label", "placeholder")
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source",
            "track", "wbr"}

    def __init__(self):
        super().__init__()
        self.items = []
        self.stack = []  # (tag, skip, credit)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        parent_skip = self.stack[-1][1] if self.stack else False
        parent_credit = self.stack[-1][2] if self.stack else False
        credit = parent_credit or "credit" in (a.get("class") or "")
        for name in self.ATTRS:
            if a.get(name):
                self.items.append((self.getpos()[0], a[name], credit))
        if tag not in self.VOID:
            self.stack.append((tag, parent_skip or tag in ("script", "style"), credit))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.stack and self.stack[-1][1]:
            return
        line = self.getpos()[0]
        for k, text in enumerate(data.split("\n")):
            if text.strip():
                self.items.append((line + k, text, self.stack[-1][2] if self.stack else False))


def html_items(path):
    parser = PageText()
    parser.feed(Path(path).read_text(encoding="utf-8"))
    for line, text, credit in parser.items:
        yield f"{path}:{line}", text, credit


def check_item(where, text, credit, oracle, claims, errors, warnings, cited_ids):
    for m in PLACEHOLDER.finditer(text):
        key, fmt = m.group(1), m.group(2) or ""
        if key not in oracle:
            errors.append(f"{where}: {{{{{key}}}}} is not in oracle.json")
            continue
        try:
            format(oracle[key], fmt)
        except (TypeError, ValueError) as e:
            errors.append(f"{where}: {{{{{key}:{fmt}}}}} does not render: {e}")
    ids = CITATION.findall(text)
    cited_ids.update((i, where) for i in ids)
    bare = CITATION.sub(" ", PLACEHOLDER.sub(" ", text))
    for label in KEY_LABELS:
        bare = bare.replace(label, " ")
    if credit:
        bare = CREDIT_ONLY.sub(" ", bare)
    allowed = set()
    for i in ids:
        if i in claims:
            allowed.update(float(x) for x in VALUE_NUMBER.findall(claims[i]["value"]))
    for num in NUMBER.findall(bare):
        if float(num) not in allowed:
            how = f"not in the value of {', '.join(ids)}" if ids else "no claims.md row cited"
            errors.append(f"{where}: bare number {num} ({how}): {text.strip()}")
    for word in NUMBER_WORDS.findall(bare):
        warnings.append(f"{where}: number word '{word}': {text.strip()}")


def main():
    oracle = json.loads(Path("oracle.json").read_text(encoding="utf-8"))
    claims = load_claims()
    errors, warnings, skipped = [], [], []
    cited_ids = set()
    n_items = 0
    readers = {".json": caption_items, ".md": markdown_items, ".html": html_items}
    for src in SOURCES:
        if not Path(src).exists():
            skipped.append(src)
            continue
        for where, text, credit in readers[Path(src).suffix](src):
            n_items += 1
            check_item(where, text, credit, oracle, claims, errors, warnings, cited_ids)
    for row_id, where in sorted(cited_ids):
        if row_id not in claims:
            errors.append(f"{where}: [{row_id}] is not a row of claims.md")
        elif claims[row_id]["read"].lower() != "yes":
            errors.append(f"{where}: [{row_id}] is cited but its \"read in full?\" is "
                          f"\"{claims[row_id]['read']}\", not yes")

    for w in warnings:
        print(f"warn  {w}")
    for e in errors:
        print(f"FAIL  {e}")
    note = f"; not yet written: {', '.join(skipped)}" if skipped else ""
    status = "ok" if not errors else f"{len(errors)} failures"
    print(f"numbers: {status}, {n_items} text items, {len(warnings)} number-word warnings{note}")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
