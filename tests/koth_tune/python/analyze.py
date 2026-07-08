import math
from koth_gen import (
    generate_assignments, altitude, true_layout, gaussian_width, numeric_range,
    hill_count, DEFAULT_SEED, DEFAULT_DIFFICULTY, KOTH_HILL_SPACING_WIDTHS,
)

rows = generate_assignments(DEFAULT_SEED, 10000, DEFAULT_DIFFICULTY)

# 1) oracle sanity: altitude at the true password is exactly the peak (10000)
bad = 0
for r in rows[:200]:
    a = altitude(r["password"], r["difficulty"], int(r["password"]))
    if abs(a - 10000.0) > 1e-6:
        bad += 1
print("oracle peak==10000 check (first 200): failures =", bad)

# 2) length distribution
from collections import Counter
lens = Counter(r["passwordLength"] for r in rows)
print("password-length distribution:", dict(sorted(lens.items())))

# 3) Phase-1 coarse scan: 7 pointers at k/6 of [min,max]. Does at least one land
#    on non-zero altitude for EVERY problem? Record the best |alt| available.
FRACS = [i / 6 for i in range(7)]
fail_any_nonzero = 0
worst_best_abs = math.inf   # smallest "best |alt| over the 7 grid pts" across problems
worst_row = None
best_alt_is_negative = 0    # cases where the max *signed* alt over grid <= 0
for r in rows:
    L = r["passwordLength"]
    lo, hi = numeric_range(L)
    span = hi - lo
    alts = []
    for f in FRACS:
        x = round(lo + span * f)
        alts.append(altitude(r["password"], r["difficulty"], x))
    best_abs = max(abs(a) for a in alts)
    if best_abs == 0.0:
        fail_any_nonzero += 1
    if best_abs < worst_best_abs:
        worst_best_abs = best_abs
        worst_row = r
    if max(alts) <= 0:
        best_alt_is_negative += 1

print("problems where NO grid point had non-zero altitude:", fail_any_nonzero)
print("worst (smallest) best-|alt| over the 7 grid points:", worst_best_abs)
print("  -> at password", worst_row["password"])
print("problems where max signed grid alt <= 0 (only valleys hit):", best_alt_is_negative)

# 4) geometry check: cluster center-span vs grid spacing, in units of width
min_ratio = math.inf
for r in rows:
    L = r["passwordLength"]
    lo, hi = numeric_range(L)
    w = gaussian_width(L)
    lay = true_layout(r["password"], r["difficulty"])
    centers = [h["center"] for h in lay["hills"]]
    span_centers = max(centers) - min(centers)
    spacing = (hi - lo) / 6
    ratio = span_centers / spacing
    if ratio < min_ratio:
        min_ratio = ratio
print("min (cluster-center-span / grid-spacing) across 10k:", round(min_ratio, 4),
      "(must be > 1 to guarantee a grid hit)")

# 5) range/width ratio (should be ~90 for L>=2)
ratios = set()
for r in rows:
    L = r["passwordLength"]
    lo, hi = numeric_range(L)
    w = gaussian_width(L)
    ratios.add(round((hi - lo) / w))
print("distinct round(range/width) values:", sorted(ratios))
