"""
Fresh King-of-the-Hill solver, derived from the generator model (koth_gen.py).
Never inspects true_layout / the password.

Model facts exploited
---------------------
* range=[10^(L-1),10^L-1]; width w=10^(L-2)+1; range/w==90.
* <=9 Gaussians of identical width w, spaced ~3w apart (jitter +/-10%).
* Password hill is tallest (peak 10000), centre exactly at integer p.
  Side hill k steps away: peak 10000-k*2600 (jitter +/-5%) -> a crest's MEASURED
  height gives k=round((10000-H)/2600), cleanly separated by k.
* Known w => two probes on one dominant Gaussian invert to its centre:
      c=(x1+x2)/2 - w^2*ln(a1/a2)/(2*(x2-x1))
* Within +/-3% of p (near-zone) altitude is a PURE single Gaussian (height
  10000); it also dominates within ~1.55w of p -> inversion is exact there, so
  iterating the inversion converges to the exact integer p.

Phase 1: 7-point coarse scan (0..6/6) -> always a non-zero positive anchor.
Phase 2: inversion crest of the anchor hill -> hop count k; hop toward the taller
         neighbour (monotone in height => reaches the password hill); pinpoint the
         integer centre from the highest probe by iterated inversion.
Recovery (only if pinpoint from the best probe fails): a robust greedy gallop
         (large steps cross near-zone/superposition dips) then re-pinpoint; and a
         bounded cluster sweep as a final guarantee.
"""
import math
from koth_gen import (
    altitude, gaussian_width, numeric_range, hill_count,
    KOTH_PEAK_HEIGHT, KOTH_HILL_SPACING_WIDTHS, KOTH_HEIGHT_OFFSET_BASE,
)

H_PEAK = float(KOTH_PEAK_HEIGHT)                  # 10000
STEP_W = KOTH_HILL_SPACING_WIDTHS                # 3 widths between adjacent hills
MAIN_TH = H_PEAK - 0.5 * KOTH_HEIGHT_OFFSET_BASE  # 8700


def _iround(x):
    """Round half away from zero (matches Math.round / std::llround)."""
    if x >= 0:
        return int(math.floor(x + 0.5))
    return int(math.ceil(x - 0.5))


class Session:
    def __init__(self, password, difficulty, lo, hi, cap=400):
        self.p = int(password); self.pw = password
        self.diff = difficulty; self.lo = lo; self.hi = hi; self.cap = cap
        self.samples = {}; self.guesses = 0; self.solved = False
        self.best_x = lo; self.best_alt = -math.inf

    def probe(self, x):
        xi = _iround(x)
        if xi < self.lo or xi > self.hi:
            return None
        if xi in self.samples:
            return self.samples[xi]
        if self.guesses >= self.cap:
            return None
        self.guesses += 1
        if xi == self.p:
            self.solved = True; self.samples[xi] = math.inf
            self.best_x = xi; self.best_alt = math.inf
            return math.inf
        a = altitude(self.pw, self.diff, xi)
        self.samples[xi] = a
        if a > self.best_alt:
            self.best_alt = a; self.best_x = xi
        return a


def _clamp(x, lo, hi):
    return max(lo, min(hi, _iround(x)))


def _invert_center(x1, a1, x2, a2, w):
    return (x1 + x2) / 2.0 - (w * w) * math.log(a1 / a2) / (2.0 * (x2 - x1))


def _hopk(H):
    return max(1, _iround((H_PEAK - H) / KOTH_HEIGHT_OFFSET_BASE))


def _pick_best(*cands):
    """First candidate with maximum altitude (matches TS/C++ strict > tie-break)."""
    best = cands[0]
    for alt, x in cands[1:]:
        if alt > best[0]:
            best = (alt, x)
    return best


def _crest(sess, x_seed, w, lo, hi):
    """Cheap inversion-based crest localisation (~3-5 probes). Returns (x, alt)."""
    x = _clamp(x_seed, lo, hi)
    a = sess.samples.get(x)
    if a is None:
        a = sess.probe(x)
        if sess.solved:
            return x, a
    off = max(1, _iround(0.5 * w))
    xb = x + off if (x + off) <= hi else x - off
    ab = sess.probe(xb)
    if sess.solved:
        return xb, ab
    if a is not None and ab is not None and a > 0 and ab > 0 and xb != x:
        try:
            c = _invert_center(x, a, xb, ab, w)
            cx = _clamp(c, lo, hi)
            ac = sess.samples.get(cx)
            if ac is None:
                ac = sess.probe(cx)
                if sess.solved:
                    return cx, ac
            best = _pick_best((a, x), (ab, xb), (ac if ac is not None else -1e18, cx))
            if best[1] != x and best[0] > a * 1.02:
                bx = best[1]
                xb2 = bx + max(1, off // 2)
                xb2 = xb2 if xb2 <= hi else bx - max(1, off // 2)
                ab2 = sess.probe(xb2)
                if sess.solved:
                    return xb2, ab2
                if ab2 is not None and ab2 > 0 and xb2 != bx and best[0] > 0:
                    try:
                        c2 = _invert_center(bx, best[0], xb2, ab2, w)
                        cx2 = _clamp(c2, lo, hi)
                        ac2 = sess.probe(cx2)
                        if sess.solved:
                            return cx2, ac2
                        cand = _pick_best(best, (ab2, xb2), (ac2 if ac2 is not None else -1e18, cx2))
                        return cand[1], cand[0]
                    except (ValueError, ZeroDivisionError):
                        pass
            return best[1], best[0]
        except (ValueError, ZeroDivisionError):
            pass
    xc = _clamp(x - off if (x - off) >= lo else x + 2 * off, lo, hi)
    ac = sess.probe(xc)
    if sess.solved:
        return xc, ac
    cand = [(a if a is not None else -1e18, x),
            (ab if ab is not None else -1e18, xb),
            (ac if ac is not None else -1e18, xc)]
    best = _pick_best(*cand)
    return best[1], best[0]


def _gallop(sess, x_seed, w, lo, hi):
    """Robust greedy climb; large steps cross near-zone/superposition dips."""
    x = _clamp(x_seed, lo, hi)
    a = sess.samples.get(x)
    if a is None:
        a = sess.probe(x)
        if sess.solved:
            return x, a
    if a is None:
        a = -1e18
    step = max(1, _iround(1.5 * w))
    stop = max(1, _iround(0.1 * w))
    while step >= stop:
        bd, ba, bx = 0, a, x
        for d in (1, -1):
            xn = _clamp(x + d * step, lo, hi)
            if xn == x:
                continue
            an = sess.probe(xn)
            if sess.solved:
                return xn, an
            if an is not None and an > ba:
                ba, bx, bd = an, xn, d
        if bd != 0:
            x, a = bx, ba
        else:
            step //= 2
    return x, a


# Early-stop once a probe's |altitude| exceeds this (near a hill core, not a
# faint tail).  0 would fire on ~1e-30 tails, so keep it meaningful.
SCAN_EARLY_THRESH = 400.0


def _spread_order(m):
    """Permutation of range(m): middle first, then both ends, then gap midpoints,
    so the range endpoints are probed early (edge clusters are found fast)."""
    if m <= 1:
        return list(range(m))
    order = []; seen = set()
    def add(i):
        if 0 <= i < m and i not in seen:
            seen.add(i); order.append(i)
    add(m // 2); add(0); add(m - 1)
    stack = [(0, m - 1)]
    while len(order) < m and stack:
        nxt = []
        for a, b in stack:
            mid = (a + b) // 2
            add(mid)
            if mid - a > 1: nxt.append((a, mid))
            if b - mid > 1: nxt.append((mid, b))
        stack = nxt
    for i in range(m):
        add(i)
    return order


def _scan_grid(lo, hi, w, hc):
    """Grid whose spacing guarantees a probe lands on the cluster, given the
    number of hills.  hc>1: spacing <= min cluster centre-span (hc-1)*3*0.9*w.
    hc==1 (single hill): spacing <= 3w so a probe lands within 1.5w of it."""
    span = hi - lo
    if span <= 0:
        return [lo]
    if hc > 1:
        spacing = max(1, int((hc - 1) * 3 * w * 0.9 * 0.98))
    else:
        spacing = max(1, int(3 * w))
    m = max(1, -(-span // spacing))          # ceil(span/spacing) intervals
    xs = sorted(set(lo + _iround(span * i / m) for i in range(m + 1)))
    return xs


def _backstop(sess, w, lo, hi):
    """Guaranteed finisher: scan the whole range finely enough that some probe
    lands within ~0.35w of p (password hill dominates there), then pinpoint."""
    step = max(1, int(0.7 * w))
    x = lo
    while x <= hi and not sess.solved:
        sess.probe(x); x += step
    if not sess.solved:
        _pinpoint(sess, sess.best_x, w, lo, hi, final_radius=30)


def _walk_and_pinpoint(sess, w, lo, hi):
    """Initial crest from the best probe, hop to the tallest hill, then pinpoint.
    Returns True if it reached the main hill (walk considered successful)."""
    step = STEP_W * w
    x, a = _crest(sess, sess.best_x, w, lo, hi)
    if sess.solved:
        return True
    last_dir = 1 if x <= lo else (-1 if x >= hi else None)
    for _ in range(10):
        if a >= MAIN_TH:
            break
        k = _hopk(a)
        if last_dir is None:
            xR = _clamp(x + k * step, lo, hi); xL = _clamp(x - k * step, lo, hi)
            aR = sess.probe(xR)
            if sess.solved:
                return True
            aL = sess.probe(xL)
            if sess.solved:
                return True
            order = [1, -1] if (aR if aR is not None else -1e18) >= (aL if aL is not None else -1e18) else [-1, 1]
        else:
            order = [last_dir, -last_dir]
        best = None
        for d in order:
            for kk in ((k,) if last_dir is None else (k, k - 1, k + 1, 1)):
                if kk < 1:
                    continue
                nx, na = _crest(sess, x + d * kk * step, w, lo, hi)
                if sess.solved:
                    return True
                if na is not None and na > a + 1.0:
                    best = (na, nx, d); break
            if best is not None:
                break
        if best is None:
            break
        a, x, last_dir = best
    reached_main = a >= MAIN_TH
    _pinpoint(sess, sess.best_x, w, lo, hi)
    return reached_main


def solve(assignment, cap=600):
    pw = assignment["password"]; diff = assignment["difficulty"]
    L = assignment["passwordLength"]
    lo, hi = numeric_range(L)
    if L == 1:
        lo = 0                      # a 1-digit password can be "0"
    w = gaussian_width(L); hc = hill_count(diff)
    sess = Session(pw, diff, lo, hi, cap=cap)
    if sess.p < lo or sess.p > hi:
        return {"solved": False, "guesses": 0, "reason": "pw-out-of-range"}

    # ---- PHASE 1: adaptive, ordered, early-stopping coarse scan ----
    xs = _scan_grid(lo, hi, w, hc)
    order = _spread_order(len(xs))
    for idx in order:
        a = sess.probe(xs[idx])
        if sess.solved:
            return _res(sess)
        if a is not None and abs(a) > SCAN_EARLY_THRESH:
            break

    # ---- PHASE 2 (fast attempt) ----
    _walk_and_pinpoint(sess, w, lo, hi)
    if sess.solved:
        return _res(sess)

    # ---- FALLBACK: complete the grid for the true global-best anchor ----
    for x in xs:
        sess.probe(x)
        if sess.solved:
            return _res(sess)
    _walk_and_pinpoint(sess, w, lo, hi)
    if sess.solved:
        return _res(sess)

    # ---- RECOVERY: gallop, bounded cluster sweep ----
    _gallop(sess, sess.best_x, w, lo, hi)
    if sess.solved:
        return _res(sess)
    _pinpoint(sess, sess.best_x, w, lo, hi)
    if sess.solved:
        return _res(sess)
    _cluster_sweep(sess, w, lo, hi)
    if sess.solved:
        return _res(sess)
    _pinpoint(sess, sess.best_x, w, lo, hi, final_radius=20)
    if sess.solved:
        return _res(sess)

    # ---- GUARANTEED BACKSTOP: fine full-range scan ----
    _backstop(sess, w, lo, hi)
    return _res(sess)


def _pinpoint(sess, seed_x, w, lo, hi, rounds=5, final_radius=8):
    """Iterated single-Gaussian inversion; exact once inside the near-zone."""
    pc = _clamp(seed_x, lo, hi)
    off = max(1, _iround(0.25 * w))
    for _ in range(rounds):
        a0 = sess.samples.get(pc)
        if a0 is None:
            a0 = sess.probe(pc)
            if sess.solved:
                return
        if a0 is None or a0 <= 0:
            break
        x1 = pc + off if (pc + off) <= hi else pc - off
        a1 = sess.probe(x1)
        if sess.solved:
            return
        if a1 is None or a1 <= 0 or x1 == pc:
            break
        try:
            c = _invert_center(pc, a0, x1, a1, w)
        except (ValueError, ZeroDivisionError):
            break
        nc = _clamp(c, lo, hi)
        if nc == pc:
            if off == 1:
                break
            off = max(1, off // 4)
            continue
        pc = nc
        off = max(1, min(off, _iround(0.25 * w)))
    sess.probe(pc)
    if sess.solved:
        return
    for d in range(1, final_radius + 1):
        for sgn in (-1, 1):
            sess.probe(pc + sgn * d)
            if sess.solved:
                return


def _cluster_sweep(sess, w, lo, hi):
    """Guaranteed: sample every hill around the best point (step < spacing)."""
    center = sess.best_x
    reach = _iround(28 * w)
    step = max(1, _iround(1.2 * w))
    x = max(lo, center - reach); b = min(hi, center + reach)
    while x <= b and not sess.solved:
        sess.probe(x); x += step


def _res(sess):
    return {"solved": sess.solved, "guesses": sess.guesses,
            "best_x": sess.best_x, "best_alt": sess.best_alt}
