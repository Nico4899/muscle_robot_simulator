"""Build the page (spec 04) into single HTML files that work from file:// with no network.

  dist/table/index.html   everything inlined, including the clip from private/ (git-ignored;
                          for the table at the event, never published)
  dist/public/index.html  the same without the clip and the lab's logo: a link to the paper
                          instead, and the SIMULATED badge (GitHub Pages)

Inlined: style.css, the JS modules (bundled: each module in its own scope, imports resolved
from the others' exports), oracle.json, captions.json (with [Cn] tags stripped, spec 04) and
cues.json. Without private/ only the public page is built.
"""
import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGE = ROOT / "page"
CLIP = ROOT / "private" / "s11small.mp4"
LOGO = ROOT / "private" / "lab_logo.png"  # the lab's logo: table build only, never published
MODULES = [ROOT / "rng.js", ROOT / "statics.js", ROOT / "model.js", PAGE / "app.js"]  # deps first

IMPORT = re.compile(r'import\s*\{([^}]*)\}\s*from\s*"([^"]+)";', re.S)
EXPORT = re.compile(r"^export\s+(?:async\s+)?(const|let|function|class)\s+([A-Za-z_$][\w$]*)", re.M)
TAG = re.compile(r"\s*\[[A-Z]\d+\]")


def bundle():
    """One script: each module wrapped in a function scope that returns its exports."""
    parts = ["const __modules = {};"]
    for path in MODULES:
        src = path.read_text(encoding="utf-8")
        names = [m.group(2) for m in EXPORT.finditer(src)]

        def resolve(m, here=path):
            target = (here.parent / m.group(2)).resolve()
            return f"const {{{m.group(1)}}} = __modules[{json.dumps(target.name)}];"

        body = EXPORT.sub(lambda m: m.group(0).replace("export ", "", 1), IMPORT.sub(resolve, src))
        body = re.sub(r"^import \* as (\w+) from \"([^\"]+)\";", lambda m:
                      f"const {m.group(1)} = __modules[{json.dumps(Path(m.group(2)).name)}];",
                      body, flags=re.M)
        if "import " in "".join(ln for ln in body.splitlines() if ln.startswith("import")):
            sys.exit(f"build: unhandled import in {path.name}")
        parts.append(f"__modules[{json.dumps(path.name)}] = (() => {{\n{body}\n"
                     f"return {{ {', '.join(names)} }};\n}})();")
    js = "\n".join(parts)
    if "</script" in js.lower():
        sys.exit("build: '</script' inside the scripts would end the inline block")
    return js


def strip_tags(node):
    """captions.json without [Cn] tags (spec 04) and without "_" notes."""
    if isinstance(node, str):
        return TAG.sub("", node)
    if isinstance(node, dict):
        return {k: strip_tags(v) for k, v in node.items() if not k.startswith("_")}
    return node


def inline_json(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def page(clip_src, logo_src):
    html = (PAGE / "index.src.html").read_text(encoding="utf-8")
    css = (PAGE / "style.css").read_text(encoding="utf-8")
    data = {
        "data-oracle": json.loads((ROOT / "oracle.json").read_text(encoding="utf-8")),
        "data-captions": strip_tags(json.loads((ROOT / "captions.json").read_text(encoding="utf-8"))),
        "data-cues": json.loads((PAGE / "cues.json").read_text(encoding="utf-8")),
    }
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}</style>")
    for key, obj in data.items():
        empty = f'<script type="application/json" id="{key}"></script>'
        assert html.count(empty) == 1, key
        html = html.replace(empty, f'<script type="application/json" id="{key}">{inline_json(obj)}</script>')
    module = '<script type="module" src="app.js"></script>'
    assert html.count(module) == 1
    html = html.replace(module, f'<script type="module">\n{bundle()}\n</script>')
    video = '<video id="clip"'
    assert html.count(video) == 1
    html = html.replace(video, f'<video id="clip" data-src="{clip_src}"')
    logo = '<img id="logo"'
    assert html.count(logo) == 1
    html = html.replace(logo, f'<img id="logo" data-src="{logo_src}"')
    html = html.replace("<!-- build.py fills these three; in development app.js fetches the files instead -->\n", "")
    return html


def write(target, html):
    out = ROOT / "dist" / target / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"build: {out.relative_to(ROOT)} ({len(html.encode()) // 1024} KB)")


def main():
    write("public", page("none", "none"))
    if CLIP.exists():
        b64 = base64.b64encode(CLIP.read_bytes()).decode("ascii")
        logo = "none"
        if LOGO.exists():
            logo = "data:image/png;base64," + base64.b64encode(LOGO.read_bytes()).decode("ascii")
        write("table", page(f"data:video/mp4;base64,{b64}", logo))
    else:
        print(f"build: no {CLIP.relative_to(ROOT)}, so no table page (public only)")


if __name__ == "__main__":
    main()
