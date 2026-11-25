// Worker for tests/parity.test.mjs: computes one unit of oracle.json in JS and posts it back.
// Not a test file itself (no .test. in the name). The main thread does all comparisons.
import { parentPort, workerData } from "node:worker_threads";

import { PARAMS, rescue_rate, run_case, seed_builds, seed_builds_and_rebuilds } from "../model.js";

// "rings/heavy/4/unshielded" -> run_case on those builds
function case_from_key(builds, key) {
  const [preset, load, n_rings, shield] = key.split("/");
  return run_case(builds, preset, load, shield, Number(n_rings));
}

function compute({ kind, seed, keys, rescue_case }) {
  const out = {};
  if (kind === "table" || kind === "headline_cases") {
    const n = kind === "table" ? PARAMS.n_builds_oracle : PARAMS.n_builds_headline;
    const builds = seed_builds(seed, n);
    for (const key of keys) out[key] = case_from_key(builds, key);
  } else if (kind === "rescue") {
    const [builds, rebuilds] = seed_builds_and_rebuilds(seed);
    const rc = rescue_case;
    for (const preset of keys) {
      out[preset] = rescue_rate(builds, rebuilds, preset, rc.load, rc.shield, rc.n_rings);
    }
  } else {
    throw new Error(`unknown job kind ${kind}`);
  }
  return out;
}

parentPort.postMessage(compute(workerData));
