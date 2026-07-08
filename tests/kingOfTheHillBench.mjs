/* Auto-generated — edit tests/kingOfTheHillBench.ts; run pnpm run test:koth:bench */
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// tests/kingOfTheHillBench.ts
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

// src/dnet/solvers/kingOfTheHill/solverCore.ts
var KOTH_PEAK_HEIGHT = 1e4;
var KOTH_HILL_SPACING_WIDTHS = 3;
var KOTH_HILL_DIFFICULTY_DIVISOR = 8;
var KOTH_HILL_DIFFICULTY_CAP = 4;
var KOTH_HEIGHT_OFFSET_BASE = 2600;
var KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2;
var KOTH_GAUSS_WIDTH_PLUS = 1;
var SOLVER_MAX_PROBES = 600;
var H_PEAK = KOTH_PEAK_HEIGHT;
var STEP_W = KOTH_HILL_SPACING_WIDTHS;
var MAIN_TH = H_PEAK - 0.5 * KOTH_HEIGHT_OFFSET_BASE;
function parseKingOfTheHillAltitude(feedback, message) {
  if (typeof feedback === "number" && Number.isFinite(feedback)) return feedback;
  if (typeof feedback === "string") {
    const trimmed = feedback.trim();
    if (trimmed.length > 0) {
      const direct = Number(trimmed);
      if (Number.isFinite(direct)) return direct;
    }
  }
  if (typeof message === "string") {
    const fromMessage = message.match(/current altitude:\s*([-\d.]+)/i);
    if (fromMessage) {
      const alt = Number(fromMessage[1]);
      if (Number.isFinite(alt)) return alt;
    }
  }
  return null;
}
function kingOfTheHillHillCount(difficulty) {
  return Math.min(Math.floor(difficulty / KOTH_HILL_DIFFICULTY_DIVISOR), KOTH_HILL_DIFFICULTY_CAP) * 2 + 1;
}
function kingOfTheHillGaussianWidth(passwordLength) {
  return 10 ** Math.max(passwordLength - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS;
}
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}
function invertCenter(x1, a1, x2, a2, w) {
  return (x1 + x2) / 2 - w * w * Math.log(a1 / a2) / (2 * (x2 - x1));
}
function hopK(H) {
  return Math.max(1, Math.round((H_PEAK - H) / KOTH_HEIGHT_OFFSET_BASE));
}
function spreadOrder(m) {
  if (m <= 1) return [0];
  const order = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (i) => {
    if (i >= 0 && i < m && !seen.has(i)) {
      seen.add(i);
      order.push(i);
    }
  };
  add(Math.floor(m / 2));
  add(0);
  add(m - 1);
  let stack = [[0, m - 1]];
  while (order.length < m && stack.length > 0) {
    const nxt = [];
    for (const [a, b] of stack) {
      const mid = Math.floor((a + b) / 2);
      add(mid);
      if (mid - a > 1) nxt.push([a, mid]);
      if (b - mid > 1) nxt.push([mid, b]);
    }
    stack = nxt;
  }
  for (let i = 0; i < m; i++) add(i);
  return order;
}
function scanGrid(lo, hi, w, hc) {
  const span = hi - lo;
  if (span <= 0) return [lo];
  const spacing = hc > 1 ? Math.max(1, Math.floor((hc - 1) * 3 * w * 0.9 * 0.98)) : Math.max(1, Math.floor(3 * w));
  const m = Math.max(1, Math.ceil(span / spacing));
  const xs = /* @__PURE__ */ new Set();
  for (let i = 0; i <= m; i++) {
    xs.add(lo + Math.round(span * i / m));
  }
  return [...xs].sort((a, b) => a - b);
}
function crest(sess, xSeed, w, lo, hi) {
  let x = clamp(xSeed, lo, hi);
  let a = sess.samples.get(x) ?? null;
  if (a === null) {
    a = sess.probe(x);
    if (sess.solved) return [x, a ?? Infinity];
  }
  const off = Math.max(1, Math.round(0.5 * w));
  let xb = x + off <= hi ? x + off : x - off;
  let ab = sess.probe(xb);
  if (sess.solved) return [xb, ab ?? Infinity];
  if (a !== null && ab !== null && a > 0 && ab > 0 && xb !== x) {
    try {
      const c = invertCenter(x, a, xb, ab, w);
      const cx = clamp(c, lo, hi);
      let ac2 = sess.samples.get(cx) ?? null;
      if (ac2 === null) {
        ac2 = sess.probe(cx);
        if (sess.solved) return [cx, ac2 ?? Infinity];
      }
      const cand2 = [
        [a, x],
        [ab, xb],
        [ac2 ?? -1e18, cx]
      ];
      let best2 = cand2[0];
      for (const pair of cand2.slice(1)) {
        if (pair[0] > best2[0]) best2 = pair;
      }
      if (best2[1] !== x && best2[0] > a * 1.02) {
        const bx = best2[1];
        let xb2 = bx + Math.max(1, Math.floor(off / 2));
        if (xb2 > hi) xb2 = bx - Math.max(1, Math.floor(off / 2));
        const ab2 = sess.probe(xb2);
        if (sess.solved) return [xb2, ab2 ?? Infinity];
        if (ab2 !== null && ab2 > 0 && xb2 !== bx && best2[0] > 0) {
          try {
            const c2 = invertCenter(bx, best2[0], xb2, ab2, w);
            const cx2 = clamp(c2, lo, hi);
            let ac22 = sess.samples.get(cx2) ?? null;
            if (ac22 === null) {
              ac22 = sess.probe(cx2);
              if (sess.solved) return [cx2, ac22 ?? Infinity];
            }
            const cand22 = [best2, [ab2, xb2], [ac22 ?? -1e18, cx2]];
            let best22 = cand22[0];
            for (const pair of cand22.slice(1)) {
              if (pair[0] > best22[0]) best22 = pair;
            }
            return [best22[1], best22[0]];
          } catch {
          }
        }
      }
      return [best2[1], best2[0]];
    } catch {
    }
  }
  const xc = clamp(x - off >= lo ? x - off : x + 2 * off, lo, hi);
  const ac = sess.probe(xc);
  if (sess.solved) return [xc, ac ?? Infinity];
  const cand = [
    [a ?? -1e18, x],
    [ab ?? -1e18, xb],
    [ac ?? -1e18, xc]
  ];
  let best = cand[0];
  for (const pair of cand.slice(1)) {
    if (pair[0] > best[0]) best = pair;
  }
  return [best[1], best[0]];
}
function gallop(sess, xSeed, w, lo, hi) {
  let x = clamp(xSeed, lo, hi);
  let a = sess.samples.get(x) ?? -1e18;
  if (!sess.samples.has(x)) {
    const probed = sess.probe(x);
    if (sess.solved) return [x, probed ?? Infinity];
    if (probed !== null) a = probed;
  }
  let step = Math.max(1, Math.round(1.5 * w));
  const stop = Math.max(1, Math.round(0.1 * w));
  while (step >= stop) {
    let bd = 0;
    let ba = a;
    let bx = x;
    for (const d of [1, -1]) {
      const xn = clamp(x + d * step, lo, hi);
      if (xn === x) continue;
      const an = sess.probe(xn);
      if (sess.solved) return [xn, an ?? Infinity];
      if (an !== null && an > ba) {
        ba = an;
        bx = xn;
        bd = d;
      }
    }
    if (bd !== 0) {
      x = bx;
      a = ba;
    } else {
      step = Math.floor(step / 2);
    }
  }
  return [x, a];
}
function pinpoint(sess, seedX, w, lo, hi, rounds = 5, finalRadius = 8) {
  let pc = clamp(seedX, lo, hi);
  let off = Math.max(1, Math.round(0.25 * w));
  for (let r = 0; r < rounds; r++) {
    let a0 = sess.samples.get(pc) ?? null;
    if (a0 === null) {
      a0 = sess.probe(pc);
      if (sess.solved) return;
    }
    if (a0 === null || a0 <= 0) break;
    const x1 = pc + off <= hi ? pc + off : pc - off;
    const a1 = sess.probe(x1);
    if (sess.solved) return;
    if (a1 === null || a1 <= 0 || x1 === pc) break;
    try {
      const c = invertCenter(pc, a0, x1, a1, w);
      const nc = clamp(c, lo, hi);
      if (nc === pc) {
        if (off === 1) break;
        off = Math.max(1, Math.floor(off / 4));
        continue;
      }
      pc = nc;
      off = Math.max(1, Math.min(off, Math.round(0.25 * w)));
    } catch {
      break;
    }
  }
  sess.probe(pc);
  if (sess.solved) return;
  for (let d = 1; d <= finalRadius; d++) {
    for (const sgn of [-1, 1]) {
      sess.probe(pc + sgn * d);
      if (sess.solved) return;
    }
  }
}
function clusterSweep(sess, w, lo, hi) {
  const center = sess.bestVal;
  const reach = Math.round(28 * w);
  const step = Math.max(1, Math.round(1.2 * w));
  let x = Math.max(lo, center - reach);
  const b = Math.min(hi, center + reach);
  while (x <= b && !sess.solved) {
    sess.probe(x);
    x += step;
  }
}
function backstop(sess, w, lo, hi) {
  const step = Math.max(1, Math.round(0.7 * w));
  let x = lo;
  while (x <= hi && !sess.solved) {
    sess.probe(x);
    x += step;
  }
  if (!sess.solved) pinpoint(sess, sess.bestVal, w, lo, hi, 5, 30);
}
function walkAndPinpoint(sess, w, lo, hi) {
  const step = STEP_W * w;
  let [x, a] = crest(sess, sess.bestVal, w, lo, hi);
  if (sess.solved) return true;
  let lastDir = x <= lo ? 1 : x >= hi ? -1 : null;
  for (let hop = 0; hop < 10; hop++) {
    if (a >= MAIN_TH) break;
    const k = hopK(a);
    let order;
    if (lastDir === null) {
      const xR = clamp(x + k * step, lo, hi);
      const xL = clamp(x - k * step, lo, hi);
      const aR = sess.probe(xR);
      if (sess.solved) return true;
      const aL = sess.probe(xL);
      if (sess.solved) return true;
      order = (aR ?? -1e18) >= (aL ?? -1e18) ? [1, -1] : [-1, 1];
    } else {
      order = [lastDir, -lastDir];
    }
    let best = null;
    for (const d of order) {
      const ks = lastDir === null ? [k] : [k, k - 1, k + 1, 1];
      for (const kk of ks) {
        if (kk < 1) continue;
        const [nx, na] = crest(sess, x + d * kk * step, w, lo, hi);
        if (sess.solved) return true;
        if (na !== null && na > a + 1) {
          best = [na, nx, d];
          break;
        }
      }
      if (best !== null) break;
    }
    if (best === null) break;
    a = best[0];
    x = best[1];
    lastDir = best[2];
  }
  const reachedMain = a >= MAIN_TH;
  pinpoint(sess, sess.bestVal, w, lo, hi);
  return reachedMain;
}
function runSolverCore(sess, lo, hi, w, hc) {
  const xs = scanGrid(lo, hi, w, hc);
  const order = spreadOrder(xs.length);
  for (const idx of order) {
    const a = sess.probe(xs[idx]);
    if (sess.solved) return;
    if (a !== null && a > 0) break;
  }
  walkAndPinpoint(sess, w, lo, hi);
  if (sess.solved) return;
  for (const x of xs) {
    sess.probe(x);
    if (sess.solved) return;
  }
  walkAndPinpoint(sess, w, lo, hi);
  if (sess.solved) return;
  gallop(sess, sess.bestVal, w, lo, hi);
  if (sess.solved) return;
  pinpoint(sess, sess.bestVal, w, lo, hi);
  if (sess.solved) return;
  clusterSweep(sess, w, lo, hi);
  if (sess.solved) return;
  pinpoint(sess, sess.bestVal, w, lo, hi, 5, 20);
  if (sess.solved) return;
  backstop(sess, w, lo, hi);
}
function numericRange(passwordLength) {
  let min = 10 ** (passwordLength - 1);
  const max = 10 ** passwordLength - 1;
  if (passwordLength === 1) min = 0;
  return { min, max };
}
function createAuthProbeSession(min, max, auth) {
  const samples = /* @__PURE__ */ new Map();
  const session = {
    min,
    max,
    guesses: 0,
    solved: false,
    exhausted: false,
    bestVal: min,
    bestAlt: -Infinity,
    samples,
    probe(x) {
      if (session.exhausted || session.solved) return null;
      const xi = Math.round(x);
      if (xi < min || xi > max) return null;
      if (samples.has(xi)) return samples.get(xi);
      if (session.guesses >= SOLVER_MAX_PROBES) {
        session.exhausted = true;
        return null;
      }
      session.guesses++;
      const result = auth(String(xi));
      if (result.success) {
        session.solved = true;
        samples.set(xi, Infinity);
        session.bestVal = xi;
        session.bestAlt = Infinity;
        return Infinity;
      }
      const alt = parseKingOfTheHillAltitude(result.feedback, result.message);
      if (alt === null) return null;
      samples.set(xi, alt);
      if (alt > session.bestAlt) {
        session.bestAlt = alt;
        session.bestVal = xi;
      }
      return alt;
    }
  };
  return session;
}
function runSolverImproved(assignment, options) {
  const { min, max } = numericRange(assignment.passwordLength);
  const ctx = {
    min,
    max,
    hillCount: kingOfTheHillHillCount(assignment.difficulty),
    passwordLength: assignment.passwordLength,
    gaussWidth: kingOfTheHillGaussianWidth(assignment.passwordLength)
  };
  const session = createAuthProbeSession(min, max, options.auth);
  runSolverCore(session, min, max, ctx.gaussWidth, ctx.hillCount);
  const result = {
    guesses: session.guesses,
    solved: session.solved,
    bestVal: session.bestVal,
    bestAlt: session.bestAlt
  };
  if (options.returnSamples === true) result.samples = session.samples;
  return result;
}

// tests/kingOfTheHillCore.ts
var NUMBERS = "0123456789";
var MAX_PASSWORD_LENGTH = 50;
var DEFAULT_SEED = 1265595496;
var KOTH_NEAR_ZONE_FRACTION = 0.03;
var KOTH_LOCATION_JITTER_SCALE = 0.2;
var KOTH_LOCATION_JITTER_BASE = 0.9;
var KOTH_HEIGHT_OFFSET_BASE2 = 2600;
var KOTH_HEIGHT_JITTER_SCALE = 0.1;
var KOTH_HEIGHT_JITTER_BASE = 0.95;
var ASSIGNMENT_PASSWORD_LENGTH_DIVISOR = 6;
var ASSIGNMENT_PASSWORD_LENGTH_CAP = 10;
var ASSIGNMENT_SEED_STRIDE = 9973;
var ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS = 15;
var WHRNG = class {
  constructor(totalPlaytime) {
    __publicField(this, "s1");
    __publicField(this, "s2");
    __publicField(this, "s3");
    const v = totalPlaytime / 1e3 % 3e4;
    this.s1 = v;
    this.s2 = v;
    this.s3 = v;
  }
  step() {
    this.s1 = 171 * this.s1 % 30269;
    this.s2 = 172 * this.s2 % 30307;
    this.s3 = 170 * this.s3 % 30323;
  }
  random() {
    this.step();
    return (this.s1 / 30269 + this.s2 / 30307 + this.s3 / 30323) % 1;
  }
};
function getAltitudeGivenHillSpecs(x, location, height, width) {
  return height * Math.exp((x - location) ** 2 / width ** 2 * -1);
}
function getKingOfTheHillAltitude(server, attemptedPassword) {
  const password = Number(server.password);
  const x = Number(attemptedPassword);
  const rng = new WHRNG(password);
  const hillCount = Math.min(Math.floor(server.difficulty / KOTH_HILL_DIFFICULTY_DIVISOR), KOTH_HILL_DIFFICULTY_CAP) * 2 + 1;
  const passwordHillIndex = Math.floor(rng.random() * (hillCount - 2)) + 1;
  const width = 10 ** Math.max(server.password.length - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS;
  if (password !== 0 && Math.abs((x - password) / password) < KOTH_NEAR_ZONE_FRACTION) {
    return getAltitudeGivenHillSpecs(x, password, KOTH_PEAK_HEIGHT, width);
  }
  let altitude = 0;
  for (let i = 0; i < hillCount; i++) {
    const locationOffset = (i - passwordHillIndex) * width * KOTH_HILL_SPACING_WIDTHS * (rng.random() * KOTH_LOCATION_JITTER_SCALE + KOTH_LOCATION_JITTER_BASE);
    const heightOffset = Math.abs((i - passwordHillIndex) * KOTH_HEIGHT_OFFSET_BASE2) * (rng.random() * KOTH_HEIGHT_JITTER_SCALE + KOTH_HEIGHT_JITTER_BASE);
    altitude += getAltitudeGivenHillSpecs(x, password + locationOffset, KOTH_PEAK_HEIGHT - heightOffset, width);
  }
  return altitude;
}
function authKingOfTheHill(server, attemptedPassword) {
  if (server.password === attemptedPassword) {
    return { success: true };
  }
  const altitude = getKingOfTheHillAltitude(server, attemptedPassword);
  const message = `current altitude: ${altitude.toFixed(5)} m; highest peak: ${KOTH_PEAK_HEIGHT.toLocaleString()} m`;
  return { success: false, feedback: `${altitude}`, message };
}
function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function getPasswordSeeded(length, rng, allowLetters = false) {
  const characters = NUMBERS + (allowLetters ? "" : "");
  let password = "";
  const cappedLength = clampNumber(length, 1, MAX_PASSWORD_LENGTH);
  for (let i = 0; i < cappedLength; i++) {
    password += characters[Math.floor(rng() * characters.length)];
  }
  if (!allowLetters && Number(password) > Number.MAX_SAFE_INTEGER) {
    password = password.slice(0, ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS);
  }
  if (!allowLetters) {
    return Number(password).toString();
  }
  return password;
}
function buildAssignment(difficulty, rng) {
  const passwordLength = Math.min(
    Math.floor(1 + difficulty / ASSIGNMENT_PASSWORD_LENGTH_DIVISOR),
    ASSIGNMENT_PASSWORD_LENGTH_CAP
  );
  const password = getPasswordSeeded(passwordLength, rng, false);
  return {
    difficulty,
    password,
    passwordLength: password.length,
    modelId: "globalMaxima",
    staticPasswordHint: "Ascend the highest mountain!"
  };
}
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function toServer(assignment) {
  return { password: assignment.password, difficulty: assignment.difficulty };
}
function generateAssignmentAt(seed, index, difficulty) {
  const i = index - 1;
  const rng = mulberry32(seed + i * ASSIGNMENT_SEED_STRIDE >>> 0);
  return { index, assignment: buildAssignment(difficulty, rng) };
}
function generateAssignments(seed, count, difficulty) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(generateAssignmentAt(seed, i + 1, difficulty));
  }
  return rows;
}
function runSolver(assignment, options = {}) {
  const server = toServer(assignment);
  const raw = runSolverImproved(assignment, {
    auth: (guess) => authKingOfTheHill(server, guess),
    returnSamples: options.returnSamples === true
  });
  const result = {
    guesses: raw.guesses,
    solved: raw.solved,
    bestVal: raw.bestVal,
    bestAlt: Number.isFinite(raw.bestAlt) ? raw.bestAlt : null
  };
  if (options.returnSamples && raw.samples) {
    result.probes = [...raw.samples.entries()].map(([x, alt]) => ({ x, alt }));
  }
  return result;
}

// tests/kingOfTheHillBench.ts
var __dirname = dirname(fileURLToPath(import.meta.url));
var WORKER_PATH = join(__dirname, "kingOfTheHillBenchWorker.mjs");
var DEFAULT_BENCH_COUNT = 1e5;
var DEFAULT_DIFF_MIN = 1;
var DEFAULT_DIFF_MAX = 60;
function summarizeGuesses(guesses) {
  const gs = [...guesses].sort((a, b) => a - b);
  const n = gs.length;
  if (n === 0) {
    return { solved: 0, unsolved: 0, avg: null, median: null, min: null, max: null, p95: null, p99: null };
  }
  const sum = gs.reduce((a, b) => a + b, 0);
  return {
    solved: n,
    unsolved: 0,
    avg: sum / n,
    median: gs[Math.floor(n / 2)] ?? null,
    min: gs[0] ?? null,
    max: gs[n - 1] ?? null,
    p95: gs[Math.floor(0.95 * n)] ?? null,
    p99: gs[Math.floor(0.99 * n)] ?? null
  };
}
function benchDifficulty(seed, count, difficulty) {
  const rows = generateAssignments(seed, count, difficulty);
  const t0 = performance.now();
  const guesses = [];
  let unsolved = 0;
  for (const { assignment } of rows) {
    const res = runSolver(assignment);
    if (res.solved) guesses.push(res.guesses);
    else unsolved++;
  }
  guesses.sort((a, b) => a - b);
  return {
    difficulty,
    guesses,
    unsolved,
    seconds: (performance.now() - t0) / 1e3
  };
}
function formatBenchRow(difficulty, guesses, unsolved, seconds) {
  const stats = summarizeGuesses(guesses);
  const dash = "\u2014";
  if (stats.solved > 0) {
    return `${String(difficulty).padStart(4)}  ${String(stats.solved).padStart(6)}  ${String(unsolved).padStart(8)}  ${stats.avg.toFixed(2).padStart(7)}  ${String(stats.median).padStart(6)}  ${String(stats.min).padStart(5)}  ${String(stats.max).padStart(5)}  ${String(stats.p95).padStart(5)}  ${String(stats.p99).padStart(5)}  ${seconds.toFixed(1).padStart(5)}s`;
  }
  return `${String(difficulty).padStart(4)}  ${String(0).padStart(6)}  ${String(unsolved).padStart(8)}  ${dash.padStart(7)}  ${dash.padStart(6)}  ${dash.padStart(5)}  ${dash.padStart(5)}  ${dash.padStart(5)}  ${dash.padStart(5)}  ${seconds.toFixed(1).padStart(5)}s`;
}
var BENCH_HEADER = `${"diff".padStart(4)}  ${"solved".padStart(6)}  ${"unsolved".padStart(8)}  ${"avg".padStart(7)}  ${"median".padStart(6)}  ${"min".padStart(5)}  ${"max".padStart(5)}  ${"p95".padStart(5)}  ${"p99".padStart(5)}  ${"time".padStart(6)}`;
function runDifficultyInWorker(seed, count, difficulty) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: { seed, count, difficulty } });
    worker.on("message", (msg) => resolve(msg));
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`bench worker for difficulty ${difficulty} exited with code ${code}`));
    });
  });
}
async function runBenchmark(options = {}) {
  const seed = options.seed ?? DEFAULT_SEED;
  const count = options.count ?? DEFAULT_BENCH_COUNT;
  const diffMin = options.diffMin ?? DEFAULT_DIFF_MIN;
  const diffMax = options.diffMax ?? DEFAULT_DIFF_MAX;
  const workers = Math.max(1, options.workers ?? cpus().length);
  const difficulties = Array.from({ length: diffMax - diffMin + 1 }, (_, i) => diffMin + i);
  const tTotal = performance.now();
  const results = [];
  let done = 0;
  const total = difficulties.length;
  const report = () => options.onProgress?.(done, total);
  if (workers <= 1) {
    for (const difficulty of difficulties) {
      results.push(benchDifficulty(seed, count, difficulty));
      done++;
      report();
    }
  } else {
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(workers, total) }, async () => {
        for (; ; ) {
          const i = next++;
          if (i >= total) break;
          const difficulty = difficulties[i];
          const row = await runDifficultyInWorker(seed, count, difficulty);
          results.push(row);
          done++;
          report();
        }
      })
    );
  }
  results.sort((a, b) => a.difficulty - b.difficulty);
  return { results, totalSeconds: (performance.now() - tTotal) / 1e3 };
}
function parseArgs(argv) {
  let seed = DEFAULT_SEED;
  let count = DEFAULT_BENCH_COUNT;
  let diffMin = DEFAULT_DIFF_MIN;
  let diffMax = DEFAULT_DIFF_MAX;
  let workers = cpus().length;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--seed" || arg === "-s") && argv[i + 1]) seed = Number(argv[++i]);
    else if ((arg === "--count" || arg === "-n") && argv[i + 1]) count = Number(argv[++i]);
    else if (arg === "--diff-min" && argv[i + 1]) diffMin = Number(argv[++i]);
    else if (arg === "--diff-max" && argv[i + 1]) diffMax = Number(argv[++i]);
    else if ((arg === "--workers" || arg === "-w") && argv[i + 1]) workers = Number(argv[++i]);
    else if (arg === "--sequential") workers = 1;
  }
  return { seed, count, diffMin, diffMax, workers };
}
function printProgress(done, total) {
  const pct = done / total * 100;
  const bar = "#".repeat(done) + ".".repeat(total - done);
  process.stdout.write(`\r  [${bar}] ${done}/${total}  (${pct.toFixed(0)}%)`);
}
async function main() {
  const { seed, count, diffMin, diffMax, workers } = parseArgs(process.argv);
  const sep = "-".repeat(BENCH_HEADER.length);
  console.log(`Benchmark  N=${count} per difficulty  workers=${workers}`);
  console.log(sep);
  console.log(BENCH_HEADER);
  console.log(sep);
  const { results, totalSeconds } = await runBenchmark({
    seed,
    count,
    diffMin,
    diffMax,
    workers,
    onProgress: printProgress
  });
  process.stdout.write("\n");
  let failed = false;
  for (const row of results) {
    if (row.unsolved > 0) failed = true;
    console.log(formatBenchRow(row.difficulty, row.guesses, row.unsolved, row.seconds));
  }
  console.log(sep);
  console.log(`Total wall time: ${totalSeconds.toFixed(1)}s`);
  if (failed) process.exit(1);
}
var isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
export {
  BENCH_HEADER,
  DEFAULT_BENCH_COUNT,
  DEFAULT_DIFF_MAX,
  DEFAULT_DIFF_MIN,
  benchDifficulty,
  formatBenchRow,
  runBenchmark,
  summarizeGuesses
};
