import time, statistics, multiprocessing
from koth_gen import generate_assignments, DEFAULT_SEED
from solver import solve

N = int(__import__("os").environ.get("N", "10000"))
DIFF_MIN = 1
DIFF_MAX = 60

def bench_diff(diff):
    rows = generate_assignments(DEFAULT_SEED, N, diff)
    t0 = time.time()
    guesses = []; unsolved_count = 0
    for r in rows:
        res = solve(r)
        if res["solved"]: guesses.append(res["guesses"])
        else: unsolved_count += 1
    dt = time.time() - t0
    return diff, sorted(guesses), unsolved_count, dt

def format_row(diff, guesses, unsolved_count, dt):
    if guesses:
        n = len(guesses)
        avg = statistics.mean(guesses); median = guesses[n//2]
        lo = guesses[0]; hi = guesses[-1]
        p95 = guesses[int(0.95*n)]; p99 = guesses[int(0.99*n)]
        return (f"{diff:>4}  {n:>6}  {unsolved_count:>8}  {avg:>7.2f}  {median:>6}  "
                f"{lo:>5}  {hi:>5}  {p95:>5}  {p99:>5}  {dt:>5.1f}s")
    return (f"{diff:>4}  {0:>6}  {unsolved_count:>8}  {'—':>7}  {'—':>6}  {'—':>5}  {'—':>5}  {'—':>5}  {'—':>5}  {dt:>5.1f}s")

if __name__ == "__main__":
    HDR = (f"{'diff':>4}  {'solved':>6}  {'unsolved':>8}  {'avg':>7}  {'median':>6}  "
           f"{'min':>5}  {'max':>5}  {'p95':>5}  {'p99':>5}  {'time':>6}")
    print(f"Benchmark  N={N} per difficulty")
    print("-"*len(HDR)); print(HDR); print("-"*len(HDR))
    results = {}
    with multiprocessing.Pool() as pool:
        for diff, g, u, dt in pool.map(bench_diff, range(DIFF_MIN, DIFF_MAX+1)):
            results[diff] = (g, u, dt)
    for diff in range(DIFF_MIN, DIFF_MAX+1):
        g,u,dt = results[diff]; print(format_row(diff,g,u,dt))
