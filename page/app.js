// The page (spec 03): a simulated joint seen from above, its 50 builds, readouts, captions and
// clip sync. The logic is plain exported functions (tested in tests/page.test.mjs); the browser
// part at the bottom runs only when there is a document. Every number on screen is computed here
// from the model, read from oracle.json, or comes from a claims.md row via captions.json.
import { Rng } from "../rng.js";
import { DEG, blocked_torque, rest, solve } from "../statics.js";
import {
  PARAMS,
  build_stacks,
  draw_builds,
  draw_rebuilds,
  joint_params,
  quantile,
  run_case,
  seed_builds,
} from "../model.js";

export const PRESETS = Object.keys(PARAMS.presets);
const REL = 1e-9; // spec 01 parity tolerance
const N_RINGS_MAX = 4;

// ---------------------------------------------------------------- state and builds

// The confirmed default (spec 03): the oracle's page case, at rest, caption "stimulate".
export function default_state(oracle) {
  const pc = oracle.page_case;
  return {
    preset: pc.preset,
    load: pc.load,
    shield: pc.shield,
    n_rings: pc.n_rings,
    fixed: false, // F: every ring the median ring, as a fixed-force simulator assumes
    stim: null, // "A", "B" or null (rest)
    side: "A", // the side the next stimulation (and the readouts) refer to
    seed: oracle.headline_seed, // the page shows the first builds of the oracle's seed
    rebuilds: 0, // how often "your joint" (build 0) was rebuilt
    caption: "stimulate",
  };
}

// The page's builds (the first n_builds_page of the seed's stream, as in the oracle) and the
// rebuild draws for "your joint", which continue the same stream after those builds.
export function page_builds(state) {
  const rng = new Rng(state.seed);
  const builds = draw_builds(rng, PARAMS.n_builds_page);
  let rz = null;
  for (let k = 0; k < state.rebuilds; k++) rz = draw_rebuilds(rng, 1)[0];
  return { builds, rz };
}

// Stacks of build i. Fixed force: every ring is the median ring (a0, passive factor 1), eta 1.
export function stacks(state, bz, i, rz) {
  if (state.fixed) {
    const F = state.n_rings * PARAMS.a0;
    const P = state.n_rings * 1.0;
    return [
      [F, P],
      [F, P],
    ];
  }
  return build_stacks(bz, state.n_rings, state.preset, i === 0 ? rz : null);
}

// Everything the screen shows for one state: each build's rest angle, stimulated angle and
// swing toward the stimulated side (deg), the readouts, and "your joint" (build 0).
export function compute_view(state) {
  const { builds, rz } = page_builds(state);
  const p = joint_params(state.load, state.shield);
  const side = state.stim ?? state.side;
  const rows = builds.map((bz, i) => {
    const [A, B] = stacks(state, bz, i, rz);
    const [th_rest] = rest(A, B, p);
    const [th_stim] = solve(A, B, side, p, th_rest);
    const swing = (side === "A" ? th_stim - th_rest : th_rest - th_stim) * DEG;
    const balanced = Number.isFinite(th_stim);
    const shown = state.stim !== null && balanced ? th_stim : th_rest;
    return { A, B, rest: th_rest, stim: th_stim, swing, balanced, shown };
  });
  const swings = rows.filter((r) => r.balanced).map((r) => r.swing);
  const n = swings.length;
  const you = rows[0];
  const torque = side === "A" ? blocked_torque(you.A, you.B, p) : blocked_torque(you.B, you.A, p);
  return {
    side,
    rows,
    stats: {
      median: n > 0 ? quantile(swings, 0.5) : NaN,
      q10: n > 0 ? quantile(swings, 0.1) : NaN,
      p_target: n > 0 ? swings.filter((s) => s >= PARAMS.target_deg).length / n : NaN,
      n_no_balance: rows.length - n,
      median_rest_deg: quantile(
        rows.map((r) => r.rest * DEG),
        0.5,
      ),
    },
    // pull when held straight: blocked torque / r, a force in mN (r has no unit, the forces do)
    you: { rest_deg: you.rest * DEG, pull: torque / p.r, balanced: you.balanced },
  };
}

function rings_caption(state) {
  return state.load === "heavy" ? "rings_heavy" : "rings_light";
}

// One key or click -> the next state; the caption follows the last change (spec 03).
export function apply(state, action, oracle) {
  const s = { ...state };
  if (action === "stimulate") {
    if (s.stim === null) {
      s.stim = s.side;
    } else {
      s.stim = null;
      s.side = s.side === "A" ? "B" : "A"; // the next stimulation takes the other side, as in the clip
    }
    s.caption = "stimulate";
  } else if (action === "fixed") {
    s.fixed = !s.fixed;
    s.caption = s.fixed ? "fixed_force" : "stimulate";
  } else if (action.startsWith("rings:")) {
    s.n_rings = Number(action.slice(6));
    s.caption = rings_caption(s);
  } else if (action === "rings+" || action === "rings-") {
    s.n_rings = Math.min(N_RINGS_MAX, Math.max(1, s.n_rings + (action === "rings+" ? 1 : -1)));
    s.caption = rings_caption(s);
  } else if (action === "spread") {
    s.preset = PRESETS[(PRESETS.indexOf(s.preset) + 1) % PRESETS.length];
    s.fixed = false;
    s.caption = "spread";
  } else if (action === "rebuild") {
    s.rebuilds += 1;
    s.caption = `rebuild_${s.preset}`;
  } else if (action === "shield") {
    s.shield = s.shield === "shielded" ? "unshielded" : "shielded";
    s.caption = "shield";
  } else if (action === "load") {
    s.load = s.load === "heavy" ? "light" : "heavy";
    s.caption = rings_caption(s);
  } else if (action === "new") {
    s.seed += 1;
    s.rebuilds = 0;
    s.caption = "stimulate";
  } else if (action === "reset") {
    return default_state(oracle);
  }
  return s;
}

// Clip sync: the state of the last cue at or before time t (null before the first cue).
export function cue_state(cues, t) {
  let st = null;
  for (const c of cues) {
    if (c.t <= t) st = c.on ? c.side : null;
  }
  return st;
}

// Caption text: {{key:fmt}} from the oracle, [Cn] tags removed (spec 04).
export function render(text, oracle) {
  return text
    .replace(/\{\{(\w+)(?::([^}]*))?\}\}/g, (_, key, fmt) => fmt_value(oracle[key], fmt))
    .replace(/\s*\[[A-Z]\d+\]/g, "")
    .replace(/\s*\(check\)/g, "") // a note for a native speaker, not page text
    .trim();
}

function fmt_value(v, fmt) {
  const m = /^\.(\d+)f$/.exec(fmt || "");
  return m ? Number(v).toFixed(Number(m[1])) : String(v);
}

function close(a, b) {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= REL * Math.max(Math.abs(a), Math.abs(b));
}

export function deep_equal(a, b) {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deep_equal(x, b[i]));
  if (a && typeof a === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b || {}).sort();
    return deep_equal(ka, kb) && ka.every((k) => deep_equal(a[k], b[k]));
  }
  return a === b;
}

// The parity badge: the page's own model reproduces the inlined oracle (PARAMS, and the first
// raw swings of every table case of the headline seed) within the parity tolerance.
export function parity_check(oracle) {
  const fails = [];
  if (!deep_equal(PARAMS, oracle.params)) fails.push("PARAMS");
  const seed = oracle.headline_seed;
  const table = oracle.table[String(seed)];
  const first = table[Object.keys(table)[0]].first_swings_deg.length;
  const builds = seed_builds(seed, first);
  let checked = 0;
  for (const [key, c] of Object.entries(table)) {
    const [preset, load, n_rings, shield] = key.split("/");
    const got = run_case(builds, preset, load, shield, Number(n_rings)).first_swings_deg;
    got.forEach((g, i) => {
      checked += 1;
      if (!close(g, c.first_swings_deg[i])) fails.push(`${key}[${i}]`);
    });
  }
  return { ok: fails.length === 0, checked, fails };
}

// ---------------------------------------------------------------- browser

const SVGNS = "http://www.w3.org/2000/svg";
const HINGE = [300, 400]; // px in the joint drawing
const LINK = 360; // distal link length, px
const ANCHOR = [120, 70]; // anchor along the link and off its axis, px
const IDLE_MS = 30000; // spec 03: after 30 s idle ...
const IDLE_EVERY_MS = 4000; // ... re-stimulate every 4 s
const IDLE_HOLD_MS = 1000;
const EASE_S = 0.15;
const MODE_CLIP = "The joint follows the clip.";
const MODE_VISITOR = "You have the joint. The clip takes over again when you stop.";

function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// math coordinates (y up, origin at the hinge) -> drawing
function pt(x, y) {
  return [HINGE[0] + x, HINGE[1] - y];
}

function rot(x, y, th) {
  return [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];
}

async function load_json(id, url) {
  const inline = document.getElementById(id);
  if (inline && inline.textContent.trim()) return JSON.parse(inline.textContent);
  const res = await fetch(url);
  return res.json();
}

function sector(a1, a2, r) {
  const [lo, hi] = a1 < a2 ? [a1, a2] : [a2, a1];
  const p1 = pt(r * Math.cos(lo), r * Math.sin(lo));
  const p2 = pt(r * Math.cos(hi), r * Math.sin(hi));
  return `M ${HINGE[0]} ${HINGE[1]} L ${p1[0]} ${p1[1]} A ${r} ${r} 0 0 0 ${p2[0]} ${p2[1]} Z`;
}

function line_at(node, th, len) {
  const [x, y] = pt(len * Math.cos(th), len * Math.sin(th));
  node.setAttribute("x1", HINGE[0]);
  node.setAttribute("y1", HINGE[1]);
  node.setAttribute("x2", x);
  node.setAttribute("y2", y);
}

function build_drawing(svg, captions) {
  const g = {};
  g.band = el("path", { class: "band" }, svg);
  g.target = el("line", { class: "target" }, svg);
  g.anchors = [];
  for (let j = 0; j < 4; j++) g.anchors.push(el("line", { class: "anchor" }, svg));
  g.faint = [];
  for (let i = 0; i < PARAMS.n_builds_page; i++) g.faint.push(el("line", { class: "build" }, svg));
  g.median = el("line", { class: "median" }, svg);
  g.prox = el("line", { class: "you-link" }, svg);
  g.dist = el("line", { class: "you-link" }, svg);
  g.rings = { A: [], B: [] };
  for (const s of ["A", "B"]) {
    for (let j = 0; j < N_RINGS_MAX; j++) g.rings[s].push(el("line", { class: "ring" }, svg));
  }
  g.hinge = el("circle", { class: "hinge", cx: HINGE[0], cy: HINGE[1], r: 14 }, svg);
  const legend = [
    ["you-link", "your joint"],
    ["median", "typical (median) build"],
    ["build legend-build", "the other builds"],
    ["band-swatch", "band_label"],
    ["target", "target_label"],
  ];
  g.legend = {};
  legend.forEach(([cls, label], k) => {
    const y = 36 + k * 38;
    if (cls === "band-swatch") el("rect", { class: "band", x: 40, y: y - 12, width: 60, height: 24 }, svg);
    else el("line", { class: cls, x1: 40, y1: y, x2: 100, y2: y }, svg);
    g.legend[label] = el("text", { class: "svg-label", x: 115, y: y + 9 }, svg);
    g.legend[label].textContent = label;
  });
  return g;
}

function draw(g, view, anim, state, oracle, captions) {
  const sign = view.side === "A" ? 1 : -1;
  const base = view.stats.median_rest_deg / DEG;
  const band = captions.band;
  g.band.setAttribute("d", sector(base + (sign * band.lo_deg) / DEG, base + (sign * band.hi_deg) / DEG, LINK + 30));
  line_at(g.target, base + (sign * oracle.target_deg) / DEG, LINK + 40);
  view.rows.forEach((r, i) => line_at(g.faint[i], anim[i], LINK));
  const sorted = [...anim].sort((a, b) => a - b);
  line_at(g.median, sorted[Math.floor(sorted.length / 2)], LINK);
  const th = anim[0];
  const [px, py] = pt(-LINK, 0);
  g.prox.setAttribute("x1", px);
  g.prox.setAttribute("y1", py);
  g.prox.setAttribute("x2", HINGE[0]);
  g.prox.setAttribute("y2", HINGE[1]);
  line_at(g.dist, th, LINK);
  [
    [-ANCHOR[0], ANCHOR[1], 0],
    [-ANCHOR[0], -ANCHOR[1], 0],
    [ANCHOR[0], ANCHOR[1], th],
    [ANCHOR[0], -ANCHOR[1], th],
  ].forEach(([x, y, a], j) => {
    const base = pt(...rot(x, 0, a));
    const tip = pt(...rot(x, y * 1.25, a));
    const node = g.anchors[j];
    node.setAttribute("x1", base[0]);
    node.setAttribute("y1", base[1]);
    node.setAttribute("x2", tip[0]);
    node.setAttribute("y2", tip[1]);
  });
  for (const s of ["A", "B"]) {
    const off = s === "A" ? ANCHOR[1] : -ANCHOR[1];
    const p0 = [-ANCHOR[0], off];
    const p1 = rot(ANCHOR[0], off, th);
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;
    g.rings[s].forEach((node, j) => {
      const used = j < state.n_rings;
      node.style.display = used ? "" : "none";
      if (!used) return;
      const o = (j - (state.n_rings - 1) / 2) * 13;
      const a = pt(p0[0] + o * nx, p0[1] + o * ny);
      const b = pt(p1[0] + o * nx, p1[1] + o * ny);
      node.setAttribute("x1", a[0]);
      node.setAttribute("y1", a[1]);
      node.setAttribute("x2", b[0]);
      node.setAttribute("y2", b[1]);
      node.classList.toggle("active", state.stim === s);
    });
  }
}

function fmt_deg(v) {
  return Number.isFinite(v) ? `${v.toFixed(1)}°` : "–";
}

function show_text(state, view, oracle, captions) {
  const t = (s) => render(s, oracle);
  document.getElementById("caption").textContent = t(captions.steps[state.caption]);
  document.getElementById("r-typical").textContent = fmt_deg(view.stats.median);
  document.getElementById("r-worst").textContent = fmt_deg(view.stats.q10);
  document.getElementById("r-chance").textContent = Number.isFinite(view.stats.p_target)
    ? `${Math.round(100 * view.stats.p_target)} %`
    : "–";
  document.getElementById("r-rest").textContent = fmt_deg(view.you.rest_deg);
  document.getElementById("r-blocked").textContent = `${view.you.pull.toFixed(1)} mN`;
  const flag = document.getElementById("r-no-balance");
  flag.hidden = view.stats.n_no_balance === 0;
  flag.textContent = `${view.stats.n_no_balance} ${captions.readouts.no_balance}`;
  document.getElementById("v-rings").textContent = String(state.n_rings);
  document.getElementById("v-preset").textContent = state.fixed ? "none (fixed force)" : state.preset;
  document.getElementById("v-shield").textContent = state.shield === "shielded" ? "on" : "off";
  document.getElementById("v-load").textContent = state.load;
  document.getElementById("v-fixed").textContent = state.fixed ? "on" : "off";
  document.getElementById("v-side").textContent = view.side;
}

async function main() {
  const [oracle, captions, cues] = await Promise.all([
    load_json("data-oracle", "../oracle.json"),
    load_json("data-captions", "../captions.json"),
    load_json("data-cues", "cues.json"),
  ]);
  const t = (s) => render(s, oracle);
  document.getElementById("title-en").textContent = t(captions.title.en);
  document.getElementById("title-ja").textContent = t(captions.title.ja);
  document.getElementById("subtitle-en").textContent = t(captions.subtitle.en);
  document.getElementById("badge").textContent = `${t(captions.badge.en)} · ${t(captions.badge.ja)}`;
  document.getElementById("clip-credit").textContent = t(captions.clip_credit);
  for (const dt of document.querySelectorAll("#readouts dt")) {
    dt.textContent = t(captions.readouts[dt.dataset.label]);
  }

  const parity = parity_check(oracle);
  const badge = document.getElementById("parity");
  badge.classList.add(parity.ok ? "ok" : "fail");
  badge.textContent = parity.ok ? "parity ✓" : "parity ✗";
  badge.title = parity.ok ? `${parity.checked} values match oracle.json` : parity.fails.join(", ");

  const svg = document.getElementById("joint");
  const g = build_drawing(svg, captions);
  g.legend.band_label.textContent = t(captions.band_label);
  g.legend.target_label.textContent = t(captions.target_label);

  let state = default_state(oracle);
  let view = compute_view(state);
  let anim = view.rows.map((r) => r.shown);
  show_text(state, view, oracle, captions);
  let last_input = performance.now();
  let touched = false; // the clip leads until the visitor first takes over

  function update(next) {
    state = next;
    view = compute_view(state);
    show_text(state, view, oracle, captions);
  }
  function act(action) {
    // taking over from the clip starts from rest, so a first Space always stimulates
    const from = leading ? { ...state, stim: null } : state;
    last_input = performance.now();
    touched = true;
    update(apply(from, action, oracle));
  }

  const keys = { " ": "stimulate", f: "fixed", s: "spread", b: "rebuild", h: "shield", l: "load", r: "new", Escape: "reset" };
  window.addEventListener("keydown", (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (keys[k] || keys[e.key]) {
      e.preventDefault();
      act(keys[k] || keys[e.key]);
    } else if (/^[1-4]$/.test(e.key)) {
      act(`rings:${e.key}`);
    }
  });
  for (const btn of document.querySelectorAll("[data-action]")) {
    btn.addEventListener("click", () => act(btn.dataset.action));
  }

  // clip: table build only (build.py sets data-src); in development the private copy if present
  const clip = document.getElementById("clip");
  const src = clip.dataset.src || "../private/s11small.mp4";
  let clip_ok = false;
  clip.addEventListener("loadeddata", () => {
    clip_ok = true;
  });
  clip.addEventListener("error", () => {
    clip.hidden = true;
    document.getElementById("clip-missing").hidden = false;
  });
  clip.src = src;
  let cue_now;
  let leading = null;
  const mode = document.getElementById("clip-mode");

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const idle = now - last_input > IDLE_MS;
    const clip_leads = clip_ok && !clip.paused && (!touched || idle);
    if (clip_leads !== leading) {
      leading = clip_leads;
      cue_now = undefined; // re-apply the current cue when the clip takes the lead again
      if (clip_ok) mode.textContent = clip_leads ? MODE_CLIP : MODE_VISITOR;
    }
    if (clip_leads) {
      const st = cue_state(cues, clip.currentTime);
      if (st !== cue_now) {
        cue_now = st;
        update({ ...state, stim: st, side: st ?? state.side });
      }
    } else if (!clip_ok && idle) {
      const phase = (now - last_input - IDLE_MS) % IDLE_EVERY_MS;
      const round = Math.floor((now - last_input - IDLE_MS) / IDLE_EVERY_MS);
      const want = phase < IDLE_HOLD_MS ? (round % 2 === 0 ? "A" : "B") : null;
      if (want !== state.stim) update({ ...state, stim: want, side: want ?? state.side });
    }
    const k = 1 - Math.exp(-dt / EASE_S);
    anim = anim.map((a, i) => a + (view.rows[i].shown - a) * k);
    draw(g, view, anim, state, oracle, captions);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const stage = document.getElementById("stage");
  const fit = () => {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `scale(${s})`;
  };
  window.addEventListener("resize", fit);
  fit();
}

if (typeof document !== "undefined") main();
