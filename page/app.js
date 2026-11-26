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

// "What drives the spread" (spec 03): the precomputed indices for the current case, or null
// with a fixed force (no spread to divide). total: share of the variance the group drives,
// alone or with others; first: the share it drives alone.
export function spread_bars(oracle, state) {
  const sens = oracle.sensitivity;
  if (state.fixed || !sens) return null;
  const c = sens.cases[`${state.preset}/${state.load}/${state.n_rings}/${state.shield}`];
  if (c.n_no_balance > 0) return null; // indices undefined for this case
  return sens.groups.map((g) => ({ group: g, total: c.total[g], first: c.first[g] }));
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
// the joint drawing, px in the SVG (viewBox 860 x 400); math coordinates have y up, origin at the hinge
const HINGE = [300, 210];
const LINK = 300; // moving link, hinge to tip
const POST = 110; // posts along the links, either side of the hinge
const STACK_OFF = 75; // stack centre line, off the link axis
const RING_GAP = 19; // between neighbouring rings of a stack
const RING_H = 11; // ring loop thickness
const FRAME = [290, 24, 40]; // fixed frame: length, gap to the hinge, width
const R_SCALE = 345; // angle scale radius
const R_BAND = 328; // published band radius
const R_SWING = 190; // your swing arc radius
const SCALE_DEG = 35; // scale from -35 to +35 deg, a tick every 5, a label every 10
const IDLE_MS = 30000; // spec 03: after 30 s idle ...
const IDLE_EVERY_MS = 4000; // ... re-stimulate every 4 s
const IDLE_HOLD_MS = 1000;
const EASE_S = 0.15;
const STAGE = [1920, 1080];
const TIP_GAP = 12; // tooltip distance from its element, stage px

function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function set(node, attrs) {
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
}

// math coordinates (y up, origin at the hinge) -> drawing
function pt(x, y) {
  return [HINGE[0] + x, HINGE[1] - y];
}

function rot(x, y, th) {
  return [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];
}

function polar(r, th) {
  return pt(r * Math.cos(th), r * Math.sin(th));
}

function arc(r, a1, a2) {
  const [lo, hi] = a1 < a2 ? [a1, a2] : [a2, a1];
  const p1 = polar(r, lo);
  const p2 = polar(r, hi);
  return `M ${p1[0]} ${p1[1]} A ${r} ${r} 0 0 0 ${p2[0]} ${p2[1]}`;
}

function radial(node, th, r1, r2) {
  const [x1, y1] = polar(r1, th);
  const [x2, y2] = polar(r2, th);
  set(node, { x1, y1, x2, y2 });
}

function lookup(captions, path) {
  return path.split(".").reduce((o, k) => (o ? o[k] : undefined), captions);
}

async function load_json(id, url) {
  const inline = document.getElementById(id);
  if (inline && inline.textContent.trim()) return JSON.parse(inline.textContent);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// The static parts of the drawing, and handles to the parts that move.
function build_drawing(svg, text) {
  const g = {};
  // angle scale: absolute angle of the moving link, 0 = straight
  const scale = el("g", { "aria-hidden": "true" }, svg);
  el("path", { class: "scale", d: arc(R_SCALE, -SCALE_DEG / DEG, SCALE_DEG / DEG) }, scale);
  for (let d = -SCALE_DEG; d <= SCALE_DEG; d += 5) {
    const major = d % 10 === 0;
    radial(el("line", { class: "scale-tick" }, scale), d / DEG, R_SCALE, R_SCALE + (major ? 16 : 8));
    if (major) {
      const [x, y] = polar(R_SCALE + 26, d / DEG);
      const label = el("text", { class: "scale-label", x, y: y + 8 }, scale);
      label.textContent = `${Math.abs(d)}°`;
    }
  }
  g.band = el("path", { class: "band", "data-tip": "band" }, svg);
  g.target = el("line", { class: "target", "data-tip": "target" }, svg);
  // the other builds: a faint line and a tip dot each
  const builds = el("g", { "data-tip": "builds" }, svg);
  g.faint = [];
  g.dots = [];
  for (let i = 0; i < PARAMS.n_builds_page; i++) g.faint.push(el("line", { class: "build" }, builds));
  for (let i = 0; i < PARAMS.n_builds_page; i++) g.dots.push(el("circle", { class: "build-tip", r: 5 }, builds));
  const median = el("g", { "data-tip": "median" }, svg);
  g.median = el("line", { class: "median" }, median);
  g.median_tip = el("circle", { class: "median-tip", r: 8 }, median);
  // fixed frame with its two posts
  const frame = el("g", { "data-tip": "base" }, svg);
  const [fx, fy] = pt(-FRAME[0], FRAME[2] / 2);
  el("rect", { class: "frame", x: fx, y: fy, width: FRAME[0] - FRAME[1], height: FRAME[2], rx: 6 }, frame);
  const fl = el("text", { class: "frame-label", x: fx + 16, y: fy + FRAME[2] / 2 + 8 }, frame);
  fl.textContent = text("drawing.base");
  // the stacks: glow when stimulated, ring loops, a letter badge and a state tag
  g.stacks = {};
  for (const s of ["A", "B"]) {
    const sign = s === "A" ? 1 : -1;
    const grp = el("g", {}, svg);
    const glow = el("rect", { class: "stack-glow" }, grp);
    const rings = [];
    for (let j = 0; j < N_RINGS_MAX; j++) rings.push(el("rect", { class: "ring", rx: RING_H / 2 }, grp));
    // fixed post: from the frame out past the stack
    const top = pt(-POST - 6, sign * (STACK_OFF + 45));
    const bot = pt(-POST - 6, sign * (FRAME[2] / 2));
    el("rect", { class: "post", x: top[0], y: Math.min(top[1], bot[1]), width: 12, height: Math.abs(top[1] - bot[1]), rx: 4 }, grp);
    const moving = el("rect", { class: "post moving", width: 12, rx: 4 }, grp);
    const [bx, by] = pt(-POST - 50, sign * STACK_OFF);
    el("circle", { class: "stack-badge", cx: bx, cy: by, r: 20 }, grp);
    const letter = el("text", { class: "stack-letter", x: bx, y: by + 8, "text-anchor": "middle" }, grp);
    letter.textContent = s;
    const tag = el("text", { class: "stack-tag", x: bx - 30, y: by + 8, "text-anchor": "end" }, grp);
    g.stacks[s] = { grp, glow, rings, moving, tag, sign };
  }
  // your joint: the moving link, its tip and the swing arc
  const you = el("g", { "data-tip": "you" }, svg);
  g.link = el("line", { class: "you-link" }, you);
  g.you_tip = el("circle", { class: "you-tip", r: 10 }, you);
  g.swing = el("path", { class: "swing-arc" }, svg);
  g.swing_label = el("text", { class: "swing-label" }, svg);
  el("circle", { class: "hinge", cx: HINGE[0], cy: HINGE[1], r: 14 }, svg);
  return g;
}

// a ring loop from p0 to p1 (math coordinates), hooked over both posts; also the stack's glow
function loop(node, p0, p1, h = RING_H, wrap = 2 * RING_H) {
  const [a, b] = [pt(...p0), pt(...p1)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) + wrap;
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  set(node, { x: cx - len / 2, y: cy - h / 2, width: len, height: h, transform: `rotate(${ang} ${cx} ${cy})` });
}

function draw(g, view, anim, state, oracle, captions, text) {
  const sign = view.side === "A" ? 1 : -1;
  const base = view.stats.median_rest_deg / DEG;
  const band = captions.band;
  g.band.setAttribute("d", arc(R_BAND, base + (sign * band.lo_deg) / DEG, base + (sign * band.hi_deg) / DEG));
  radial(g.target, base + (sign * oracle.target_deg) / DEG, LINK - 40, R_SCALE + 18);
  view.rows.forEach((r, i) => {
    radial(g.faint[i], anim[i], 0, LINK);
    const [x, y] = polar(LINK, anim[i]);
    set(g.dots[i], { cx: x, cy: y });
  });
  const sorted = [...anim].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  radial(g.median, med, 0, LINK);
  const [mx, my] = polar(LINK, med);
  set(g.median_tip, { cx: mx, cy: my });
  const th = anim[0];
  radial(g.link, th, 0, LINK);
  const [tx, ty] = polar(LINK, th);
  set(g.you_tip, { cx: tx, cy: ty });
  for (const s of ["A", "B"]) {
    const st = g.stacks[s];
    const on = state.stim === s;
    const n = state.n_rings;
    st.rings.forEach((node, j) => {
      const used = j < n;
      node.style.display = used ? "" : "none";
      if (!used) return;
      const off = st.sign * (STACK_OFF + (j - (n - 1) / 2) * RING_GAP);
      const p0 = [-POST, off];
      const p1 = rot(POST, off, th);
      loop(node, p0, p1);
      node.classList.toggle("on", on);
    });
    // glow: a band around the whole stack
    const p0 = [-POST, st.sign * STACK_OFF];
    const p1 = rot(POST, st.sign * STACK_OFF, th);
    loop(st.glow, p0, p1, (n - 1) * RING_GAP + RING_H + 16, 2 * RING_H + 16);
    st.glow.style.display = on ? "" : "none";
    // moving post: rides on the link, rotated with it
    const [px, py] = pt(...rot(POST, st.sign * ((STACK_OFF + 45 + 7) / 2), th));
    const ph = STACK_OFF + 45 - 7;
    set(st.moving, {
      x: px - 6,
      y: py - ph / 2,
      height: ph,
      transform: `rotate(${(-th * 180) / Math.PI} ${px} ${py})`,
    });
    st.tag.textContent = text(on ? "drawing.stimulated" : "drawing.relaxed");
    st.tag.classList.toggle("on", on);
    st.grp.dataset.tip = on ? "ring_on" : "ring_off";
  }
  // your swing: from your rest angle to where your joint is now
  const rest_th = view.rows[0].rest;
  const d = (th - rest_th) * DEG;
  const show = Math.abs(d) >= 0.5;
  g.swing.style.display = show ? "" : "none";
  g.swing_label.style.display = show ? "" : "none";
  if (show) {
    g.swing.setAttribute("d", arc(R_SWING, rest_th, th));
    // label under the arc's lower end, clear of the links
    const [lx, ly] = polar(R_SWING, Math.min(rest_th, th));
    set(g.swing_label, { x: lx + 12, y: ly + 36 });
    g.swing_label.textContent = `${text("drawing.swing")} ${Math.abs(d).toFixed(1)}°`;
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
  document.getElementById("v-preset").textContent = state.fixed ? "none" : t(captions.groups[state.preset]);
  document.getElementById("v-shield").textContent = state.shield === "shielded" ? "on" : "off";
  document.getElementById("b-shield").setAttribute("aria-pressed", String(state.shield === "shielded"));
  document.getElementById("v-load").textContent = state.load;
  document.getElementById("v-fixed").textContent = state.fixed ? "on" : "off";
  document.getElementById("b-fixed").setAttribute("aria-pressed", String(state.fixed));
  document.getElementById("v-side").textContent = view.side;
  const bars = spread_bars(oracle, state);
  document.getElementById("bars").hidden = bars === null;
  const none = document.getElementById("sobol-none");
  none.hidden = bars !== null;
  none.textContent = t(state.fixed ? captions.no_spread.fixed : captions.no_spread.undefined);
  for (const b of bars || []) {
    const row = document.querySelector(`#bars [data-group="${b.group}"]`);
    const pct = (v) => `${Math.max(0, Math.min(100, 100 * v))}%`;
    row.querySelector(".fill").style.width = pct(b.total);
    row.querySelector(".tick").style.left = pct(b.first);
    row.querySelector(".val").textContent = `${Math.round(100 * Math.max(0, b.total))} %`;
  }
  // the drawing, for screen readers
  const you = view.rows[0];
  const now = (you.shown * DEG).toFixed(1);
  document.getElementById("joint-label").textContent =
    `${t(captions.headings.sim)}. ${t(captions.legend.you)}: ${now}°, ` +
    `${t(captions.readouts.typical)} ${fmt_deg(view.stats.median)}; ` +
    `${t(captions.readouts.rest)} ${fmt_deg(view.you.rest_deg)}.`;
}

// Tooltips: one box in the stage, shown on hover and on keyboard focus; each tip's text is also
// linked to its element with aria-describedby for screen readers.
function setup_tips(captions, oracle) {
  const stage = document.getElementById("stage");
  const tip = document.getElementById("tip");
  const texts = document.getElementById("tip-texts");
  const text = (key) => (captions.tips[key] ? render(captions.tips[key], oracle) : "");
  for (const key of Object.keys(captions.tips)) {
    const span = document.createElement("span");
    span.id = `tip-${key}`;
    span.textContent = text(key);
    texts.appendChild(span);
  }
  for (const node of document.querySelectorAll("[data-tip]")) {
    if (node.closest("svg")) continue; // the drawing is one image for screen readers
    const prev = node.getAttribute("aria-describedby");
    node.setAttribute("aria-describedby", [prev, `tip-${node.dataset.tip}`].filter(Boolean).join(" "));
  }
  let current = null;
  const hide = () => {
    tip.hidden = true;
    current = null;
  };
  const show = (node) => {
    const body = text(node.dataset.tip);
    if (!body) return hide();
    current = node;
    tip.textContent = body;
    tip.hidden = false;
    const sr = stage.getBoundingClientRect();
    const s = sr.width / STAGE[0];
    const r = node.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = (r.left - sr.left) / s;
    let y = (r.bottom - sr.top) / s + TIP_GAP;
    x = Math.max(16, Math.min(STAGE[0] - w - 16, x));
    if (y + h > STAGE[1] - 8) y = (r.top - sr.top) / s - h - TIP_GAP;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  stage.addEventListener("pointerover", (e) => {
    const node = e.target.closest("[data-tip]");
    if (node !== current) (node ? show(node) : hide());
  });
  stage.addEventListener("pointerleave", hide);
  stage.addEventListener("focusin", (e) => {
    const node = e.target.closest("[data-tip]");
    if (node) show(node);
    else hide();
  });
  stage.addEventListener("focusout", hide);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  return { refresh: () => current && show(current) };
}

function legend(captions, oracle) {
  const t = (s) => render(s, oracle);
  const sw = {
    you: '<line x1="4" y1="12" x2="40" y2="12" stroke="var(--you)" stroke-width="10" stroke-linecap="round"/>',
    median: '<line x1="2" y1="12" x2="34" y2="12" stroke="var(--ink)" stroke-width="4"/><circle cx="36" cy="12" r="6" fill="var(--ink)"/>',
    builds: '<circle cx="8" cy="12" r="5" fill="var(--build)"/><circle cx="22" cy="8" r="5" fill="var(--build)"/><circle cx="36" cy="14" r="5" fill="var(--build)"/>',
    ring: '<rect class="sw-ring" x="3" y="6" width="38" height="12" rx="6"/>',
    band: '<line class="sw-band" x1="4" y1="12" x2="40" y2="12"/>',
    target: '<line x1="2" y1="12" x2="42" y2="12" stroke="var(--ink)" stroke-width="3" stroke-dasharray="10 6"/>',
  };
  const label = {
    you: captions.legend.you,
    median: captions.legend.median,
    builds: captions.legend.builds,
    ring: captions.legend.ring,
    band: captions.band_label,
    target: captions.target_label,
  };
  const ul = document.getElementById("legend");
  for (const key of Object.keys(sw)) {
    const li = document.createElement("li");
    li.tabIndex = 0;
    li.dataset.tip = key;
    li.innerHTML = `<svg viewBox="0 0 44 24" aria-hidden="true">${sw[key]}</svg><span></span>`;
    li.querySelector("span").textContent = t(label[key]);
    ul.appendChild(li);
  }
}

async function main() {
  let oracle, captions, cues;
  try {
    [oracle, captions, cues] = await Promise.all([
      load_json("data-oracle", "../oracle.json"),
      load_json("data-captions", "../captions.json"),
      load_json("data-cues", "cues.json"),
    ]);
  } catch (err) {
    document.getElementById("load-error").hidden = false; // e.g. the source page opened from disk
    throw err;
  }
  window.page_ready = true;
  const t = (s) => render(s, oracle);
  const text = (path) => t(lookup(captions, path) ?? "");
  document.getElementById("title-en").textContent = t(captions.title.en);
  document.getElementById("title-ja").textContent = t(captions.title.ja);
  document.getElementById("badge").textContent = `${t(captions.badge.en)} · ${t(captions.badge.ja)}`;
  document.getElementById("affiliation-name").textContent = t(captions.affiliation.en);
  // the lab's logo: table build only (build.py sets data-src), like the clip. With the logo the
  // presenter says "simulated" aloud; without it (public build) the SIMULATED badge stays on screen.
  const logo = document.getElementById("logo");
  const logo_src = logo.dataset.src || "../private/lab_logo.png";
  const badge_only = () => {
    logo.hidden = true;
    document.getElementById("badge").hidden = false;
  };
  logo.alt = t(captions.affiliation.logo_alt);
  logo.addEventListener("load", () => (logo.hidden = false));
  logo.addEventListener("error", badge_only);
  if (logo_src === "none") badge_only();
  else logo.src = logo_src;
  document.getElementById("clip-credit").textContent = t(captions.clip_credit);
  document.getElementById("sobol-title").textContent = t(captions.sobol_title);
  document.getElementById("sobol-caption").textContent = t(captions.sobol_caption);
  for (const node of document.querySelectorAll("[data-text]")) node.textContent = text(node.dataset.text);
  const bars_box = document.getElementById("bars");
  for (const g of oracle.sensitivity ? oracle.sensitivity.groups : []) {
    const row = document.createElement("div");
    row.className = "bar";
    row.dataset.group = g;
    row.dataset.tip = `g_${g}`;
    row.tabIndex = 0;
    row.innerHTML = '<span class="name"></span><span class="track"><span class="fill"></span><span class="tick"></span></span><span class="val"></span>';
    row.querySelector(".name").textContent = t(captions.groups[g] ?? g);
    bars_box.appendChild(row);
  }
  for (const dt of document.querySelectorAll("#readouts dt")) {
    dt.textContent = t(captions.readouts[dt.dataset.label]);
  }
  legend(captions, oracle);

  const parity = parity_check(oracle);
  const badge = document.getElementById("parity");
  badge.classList.add(parity.ok ? "ok" : "fail");
  badge.textContent = parity.ok ? "parity ✓" : "parity ✗";
  if (!parity.ok) badge.title = parity.fails.join(", ");

  const svg = document.getElementById("joint");
  const g = build_drawing(svg, text);
  const tips = setup_tips(captions, oracle);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    tips.refresh();
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
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (keys[k] || keys[e.key]) {
      e.preventDefault(); // also keeps Space on a focused button from clicking it a second time
      act(keys[k] || keys[e.key]);
    } else if (/^[1-4]$/.test(e.key)) {
      act(`rings:${e.key}`);
    }
  });
  for (const btn of document.querySelectorAll("[data-action]")) {
    btn.addEventListener("click", () => act(btn.dataset.action));
  }

  // clip: build.py inlines it (data-src); in development the file next to this page
  const clip = document.getElementById("clip");
  const play = document.getElementById("clip-play");
  const built = Boolean(clip.dataset.src);
  const src = clip.dataset.src || "s11small.mp4";
  let clip_ok = false;
  const hide_clip = () => {
    clip.closest(".clip-box").hidden = true;
    document.getElementById("clip-credit").hidden = true;
    document.getElementById("clip-mode").hidden = true;
  };
  // no clip (public build, or the private copy missing in development): the paper link instead
  const no_clip = () => {
    hide_clip();
    document.getElementById("clip-missing").hidden = false;
  };
  // a clip this browser cannot decode (e.g. an embedded preview without H.264)
  const cannot = () => {
    hide_clip();
    document.getElementById("clip-cannot").hidden = false;
    document.getElementById("clip-missing").hidden = false;
    document.getElementById("clip-missing-text").hidden = true;
  };
  const start = () =>
    clip.play().then(
      () => (play.hidden = true),
      () => (play.hidden = false), // autoplay refused: one click starts it
    );
  clip.addEventListener("loadeddata", () => {
    clip_ok = true;
  });
  clip.addEventListener("error", () => (built ? cannot() : no_clip()));
  play.addEventListener("click", start);
  if (src === "none") {
    no_clip(); // the public build: no media
  } else if (!clip.canPlayType("video/mp4")) {
    cannot();
  } else {
    clip.loop = true;
    clip.src = src;
    if (reduce) play.hidden = false; // reduced motion: the visitor starts the clip
    else start();
  }
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
      if (clip_ok) mode.textContent = t(clip_leads ? captions.clip.mode_clip : captions.clip.mode_visitor);
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
    const k = reduce ? 1 : 1 - Math.exp(-dt / EASE_S);
    anim = anim.map((a, i) => a + (view.rows[i].shown - a) * k);
    draw(g, view, anim, state, oracle, captions, text);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const stage = document.getElementById("stage");
  const fit = () => {
    const s = Math.min(window.innerWidth / STAGE[0], window.innerHeight / STAGE[1]);
    stage.style.transform = `scale(${s})`;
  };
  window.addEventListener("resize", fit);
  fit();
}

if (typeof document !== "undefined") main();
