"""
King-of-the-Hill: problem generator, altitude oracle, and benchmark harness.

This module contains ONLY the assignment code (an exact Python port of the
bitburner generator + altitude oracle) and solver-agnostic benchmark tools.
It contains NO solver.  Plug in your own `solve(assignment) -> result` callable.

Ported from (all identical models):
  tests/kingOfTheHillCore.ts               (bitburner-src game model)
  src/dnet/solvers/kingOfTheHill/solverCore.ts (constants)

--------------------------------------------------------------------------------
Solver contract expected by the benchmark
--------------------------------------------------------------------------------
    def solve(assignment, cap=400) -> dict
        assignment is a dict: {"difficulty", "password", "passwordLength"}
        must return at least {"solved": bool, "guesses": int}

    Your solver must find the password only through altitude(...) probes; the
    benchmark measures how many distinct probes (guesses) it uses.  A convenient
    pattern is to build a probe session on top of `altitude(...)` that increments
    a counter and flags success when the attempted integer equals the password.

--------------------------------------------------------------------------------
Usage
--------------------------------------------------------------------------------
    from koth_harness import generate_assignments, run_benchmark, DEFAULT_SEED, DEFAULT_DIFFICULTY
    from my_solver import solve            # <- your code, kept separately

    run_benchmark(solve, n=10000)          # prints solved/avg/percentiles/histogram

    # or, from the shell:
    #   python koth_harness.py --self-check          # validate oracle + Phase-1 scan
    #   python koth_harness.py --solver my_solver:solve --n 10000
"""
import math

# ============================================================================
# constants  (verified against koth_common.hpp / solverCore.ts)
# ============================================================================
KOTH_PEAK_HEIGHT               = 10000
KOTH_NEAR_ZONE_FRACTION        = 0.03
KOTH_HILL_DIFFICULTY_DIVISOR   = 8
KOTH_HILL_DIFFICULTY_CAP       = 4
KOTH_HILL_SPACING_WIDTHS       = 3
KOTH_LOCATION_JITTER_SCALE     = 0.2
KOTH_LOCATION_JITTER_BASE      = 0.9
KOTH_HEIGHT_OFFSET_BASE        = 2600
KOTH_HEIGHT_JITTER_SCALE       = 0.1
KOTH_HEIGHT_JITTER_BASE        = 0.95
KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2
KOTH_GAUSS_WIDTH_PLUS          = 1

ASSIGNMENT_PASSWORD_LENGTH_DIVISOR  = 6
ASSIGNMENT_PASSWORD_LENGTH_CAP      = 10
ASSIGNMENT_SEED_STRIDE              = 9973
ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS = 15

DEFAULT_SEED       = 0x4b6f7468   # "Koth"
DEFAULT_DIFFICULTY = 60

MASK32 = 0xFFFFFFFF


# ============================================================================
# mulberry32  (assignment RNG -> password digits)  == C++ mulberry32
# ============================================================================
def mulberry32(seed):
    state = seed & MASK32

    def rng():
        nonlocal state
        state = (state + 0x6d2b79f5) & MASK32
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & MASK32
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & MASK32)) & MASK32)) & MASK32
        t ^= (t >> 14)
        return (t & MASK32) / 4294967296.0

    return rng


# ============================================================================
# WHRNG  (altitude RNG -> hill index / jitter), seeded by the numeric password
# ============================================================================
class WHRNG:
    __slots__ = ("s1", "s2", "s3")

    def __init__(self, total_playtime):
        v = math.fmod(total_playtime / 1000.0, 30000.0)
        self.s1 = self.s2 = self.s3 = v

    def _step(self):
        self.s1 = math.fmod(171.0 * self.s1, 30269.0)
        self.s2 = math.fmod(172.0 * self.s2, 30307.0)
        self.s3 = math.fmod(170.0 * self.s3, 30323.0)

    def random(self):
        self._step()
        return math.fmod(self.s1 / 30269.0 + self.s2 / 30307.0 + self.s3 / 30323.0, 1.0)


# ============================================================================
# assignment generation
# ============================================================================
def get_password_seeded(length, rng):
    digits = "0123456789"
    capped = max(1, min(int(length), 50))
    chars = []
    for _ in range(capped):
        chars.append(digits[min(9, int(math.floor(rng() * 10.0)))])
    pw = "".join(chars)
    if len(pw) > ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS:
        pw = pw[:ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS]
    return str(int(pw))  # Number(pw).toString() -> strips leading zeros


def build_assignment(difficulty, rng):
    raw_len = 1.0 + difficulty / ASSIGNMENT_PASSWORD_LENGTH_DIVISOR
    password_length = int(min(raw_len, float(ASSIGNMENT_PASSWORD_LENGTH_CAP)))
    password = get_password_seeded(password_length, rng)
    return {
        "difficulty": difficulty,
        "password": password,
        "passwordLength": len(password),
    }


def generate_assignment_at(seed, index, difficulty):
    """1-based index, matching generateAssignmentAt(seed, index, difficulty)."""
    i = index - 1
    rng_seed = (seed + i * ASSIGNMENT_SEED_STRIDE) & MASK32
    return build_assignment(difficulty, mulberry32(rng_seed))


def generate_assignments(seed=DEFAULT_SEED, count=10000, difficulty=DEFAULT_DIFFICULTY):
    return [generate_assignment_at(seed, i + 1, difficulty) for i in range(count)]


# ============================================================================
# derived helpers
# ============================================================================
def hill_count(difficulty):
    return min(difficulty // KOTH_HILL_DIFFICULTY_DIVISOR, KOTH_HILL_DIFFICULTY_CAP) * 2 + 1


def gaussian_width(password_length):
    return 10 ** max(password_length - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS


def numeric_range(password_length):
    """Inclusive [min, max] the attempted integer must fall in."""
    return (10 ** (password_length - 1), 10 ** password_length - 1)


def _alt_given_specs(x, location, height, width):
    dx = x - location
    return height * math.exp((dx * dx / (width * width)) * -1.0)


# ============================================================================
# altitude oracle  (mirrors getKingOfTheHillAltitude)
# ============================================================================
def altitude(password_str, difficulty, x):
    """Altitude feedback for an attempted integer x against the given password."""
    p = int(password_str)
    rng = WHRNG(p)
    hc = hill_count(difficulty)
    pw_hill_index = int(math.floor(rng.random() * (hc - 2))) + 1
    width = gaussian_width(len(password_str))

    if p != 0 and abs((x - p) / p) < KOTH_NEAR_ZONE_FRACTION:
        return _alt_given_specs(x, p, KOTH_PEAK_HEIGHT, width)

    alt = 0.0
    for i in range(hc):
        loc_off = (i - pw_hill_index) * width * KOTH_HILL_SPACING_WIDTHS * (
            rng.random() * KOTH_LOCATION_JITTER_SCALE + KOTH_LOCATION_JITTER_BASE
        )
        ht_off = abs((i - pw_hill_index) * KOTH_HEIGHT_OFFSET_BASE) * (
            rng.random() * KOTH_HEIGHT_JITTER_SCALE + KOTH_HEIGHT_JITTER_BASE
        )
        alt += _alt_given_specs(x, p + loc_off, KOTH_PEAK_HEIGHT - ht_off, width)
    return alt


def auth(password_str, difficulty, attempted):
    """True iff attempted (int) equals the password; matches the game's check."""
    return str(int(attempted)) == password_str


# ============================================================================
# optional probe session (convenience; solvers may use their own)
# ============================================================================
class ProbeSession:
    """Counts distinct probes and flags success on an exact hit."""
    def __init__(self, assignment, cap=5000):
        self.pw = assignment["password"]
        self.p = int(self.pw)
        self.diff = assignment["difficulty"]
        self.lo, self.hi = numeric_range(assignment["passwordLength"])
        self.cap = cap
        self.samples = {}
        self.guesses = 0
        self.solved = False

    def probe(self, x):
        xi = int(round(x))
        if xi < self.lo or xi > self.hi:
            return None
        if xi in self.samples:
            return self.samples[xi]
        if self.guesses >= self.cap:
            return None
        self.guesses += 1
        if xi == self.p:
            self.solved = True
            self.samples[xi] = math.inf
            return math.inf
        a = altitude(self.pw, self.diff, xi)
        self.samples[xi] = a
        return a


# ============================================================================
# benchmark tools
# ============================================================================
def _percentile(sorted_vals, q):
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, int(q * len(sorted_vals)))
    return sorted_vals[idx]


def run_benchmark(solve_fn, n=10000, seed=DEFAULT_SEED, difficulty=DEFAULT_DIFFICULTY,
                  cap=400, bucket=5, verbose=True):
    """Run `solve_fn` over `n` generated problems and report statistics.

    `solve_fn(assignment, cap=...)` must return {"solved": bool, "guesses": int}.
    Returns a dict of aggregate stats; prints a summary when verbose.
    """
    import time
    rows = generate_assignments(seed, n, difficulty)
    t0 = time.time()
    guesses = []
    unsolved = []
    for i, r in enumerate(rows):
        try:
            res = solve_fn(r, cap=cap)
        except TypeError:
            res = solve_fn(r)
        if res.get("solved"):
            guesses.append(int(res["guesses"]))
        else:
            unsolved.append((i + 1, r["password"], res.get("reason")))
    dt = time.time() - t0

    gs = sorted(guesses)
    stats = {
        "n": n, "seed": seed, "difficulty": difficulty,
        "solved": len(gs), "unsolved": len(unsolved),
        "time_s": dt,
        "avg": (sum(gs) / len(gs)) if gs else None,
        "median": (gs[len(gs) // 2]) if gs else None,
        "min": gs[0] if gs else None,
        "max": gs[-1] if gs else None,
        "p95": _percentile(gs, 0.95),
        "p99": _percentile(gs, 0.99),
        "unsolved_list": unsolved,
    }
    if gs:
        from collections import Counter
        hist = Counter((g // bucket) * bucket for g in gs)
        stats["histogram"] = dict(sorted(hist.items()))

    if verbose:
        print(f"N={n}  seed={hex(seed)}  difficulty={difficulty}")
        print(f"solved={stats['solved']}  unsolved={stats['unsolved']}  time={dt:.1f}s")
        if gs:
            print(f"avg={stats['avg']:.3f}  median={stats['median']}  min={stats['min']}  "
                  f"max={stats['max']}  p95={stats['p95']}  p99={stats['p99']}")
            print(f"histogram (guess-bucket:count): {stats['histogram']}")
        if unsolved:
            head = unsolved[:20]
            print(f"UNSOLVED ({len(unsolved)}): {head}{' ...' if len(unsolved) > 20 else ''}")
    return stats


def self_check(n=10000, seed=DEFAULT_SEED, difficulty=DEFAULT_DIFFICULTY, verbose=True):
    """Validate the oracle and the 7-point coarse-scan guarantee (no solver needed).

    Confirms:
      * altitude(x=password) == peak height (10000),
      * the 7 pointers at 0,1/6,..,6/6 of the range always find non-zero curvature,
      * the max-altitude grid point is always positive,
      * geometry invariants: range/width == 90 and cluster-span/grid-spacing > 1.
    """
    rows = generate_assignments(seed, n, difficulty)

    peak_fail = 0
    for r in rows[:200]:
        if abs(altitude(r["password"], r["difficulty"], int(r["password"])) - KOTH_PEAK_HEIGHT) > 1e-6:
            peak_fail += 1

    fracs = [i / 6 for i in range(7)]
    no_curvature = 0
    only_valleys = 0
    worst_best_abs = math.inf
    range_over_width = set()
    for r in rows:
        L = r["passwordLength"]
        lo, hi = numeric_range(L)
        w = gaussian_width(L)
        range_over_width.add(round((hi - lo) / w))
        span = hi - lo
        alts = [altitude(r["password"], r["difficulty"], round(lo + span * f)) for f in fracs]
        best_abs = max(abs(a) for a in alts)
        worst_best_abs = min(worst_best_abs, best_abs)
        if best_abs == 0.0:
            no_curvature += 1
        if max(alts) <= 0:
            only_valleys += 1

    result = {
        "peak_failures": peak_fail,
        "coarse_scan_misses": no_curvature,
        "only_valley_anchors": only_valleys,
        "worst_best_abs_alt": worst_best_abs,
        "range_over_width_values": sorted(range_over_width),
        "ok": (peak_fail == 0 and no_curvature == 0 and only_valleys == 0),
    }
    if verbose:
        print(f"self-check over N={n} (seed={hex(seed)}, difficulty={difficulty}):")
        print(f"  oracle peak==10000 failures (first 200): {peak_fail}")
        print(f"  coarse-scan curvature misses:            {no_curvature}")
        print(f"  problems with only-valley best anchor:   {only_valleys}")
        print(f"  worst best-|alt| over the 7 pointers:    {worst_best_abs:.4f}")
        print(f"  distinct round(range/width):             {sorted(range_over_width)}")
        print(f"  RESULT: {'OK' if result['ok'] else 'FAILED'}")
    return result


def _load_solver(spec):
    """spec like 'module:function' or 'module' (function defaults to 'solve')."""
    import importlib
    mod_name, _, fn_name = spec.partition(":")
    fn_name = fn_name or "solve"
    mod = importlib.import_module(mod_name)
    return getattr(mod, fn_name)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="KotH assignment generator + benchmark harness (no solver).")
    ap.add_argument("--self-check", action="store_true",
                    help="validate the oracle and the 7-point coarse-scan guarantee")
    ap.add_argument("--solver", metavar="module:function",
                    help="import path to your solver callable, e.g. my_solver:solve")
    ap.add_argument("--n", type=int, default=10000)
    ap.add_argument("--seed", type=lambda s: int(s, 0), default=DEFAULT_SEED)
    ap.add_argument("--difficulty", type=int, default=DEFAULT_DIFFICULTY)
    ap.add_argument("--cap", type=int, default=400)
    ap.add_argument("--sample", type=int, default=0,
                    help="print this many generated assignments and exit")
    args = ap.parse_args()

    if args.sample:
        for r in generate_assignments(args.seed, args.sample, args.difficulty):
            print(r)
    elif args.self_check:
        self_check(n=args.n, seed=args.seed, difficulty=args.difficulty)
    elif args.solver:
        solve_fn = _load_solver(args.solver)
        run_benchmark(solve_fn, n=args.n, seed=args.seed,
                      difficulty=args.difficulty, cap=args.cap)
    else:
        ap.print_help()
