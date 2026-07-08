import time, statistics, multiprocessing
from koth_gen import generate_assignments, DEFAULT_SEED
from solver import solve

N = 100000
DIFF_MIN = 1
DIFF_MAX = 60


def bench_diff(diff):
    rows = generate_assignments(DEFAULT_SEED, N, diff)
    t0 = time.time()
    guesses = []
    unsolved_count = 0
    for r in rows:
        res = solve(r)
        if res["solved"]:
            guesses.append(res["guesses"])
        else:
            unsolved_count += 1
    dt = time.time() - t0
    return diff, sorted(guesses), unsolved_count, dt


def format_row(diff, guesses, unsolved_count, dt):
    if guesses:
        n = len(guesses)
        avg    = statistics.mean(guesses)
        median = guesses[n // 2]
        lo     = guesses[0]
        hi     = guesses[-1]
        p95    = guesses[int(0.95 * n)]
        p99    = guesses[int(0.99 * n)]
        return (f"{diff:>4}  {n:>6}  {unsolved_count:>8}  "
                f"{avg:>7.2f}  {median:>6}  {lo:>5}  {hi:>5}  {p95:>5}  {p99:>5}  {dt:>5.1f}s")
    else:
        return (f"{diff:>4}  {0:>6}  {unsolved_count:>8}  "
                f"{'—':>7}  {'—':>6}  {'—':>5}  {'—':>5}  {'—':>5}  {'—':>5}  {dt:>5.1f}s")


if __name__ == "__main__":
    HDR = (f"{'diff':>4}  {'solved':>6}  {'unsolved':>8}  {'avg':>7}  "
           f"{'median':>6}  {'min':>5}  {'max':>5}  {'p95':>5}  {'p99':>5}  {'time':>6}")
    SEP = "-" * len(HDR)

    print(f"Benchmark  N={N} per difficulty  workers={multiprocessing.cpu_count()}")
    print(SEP)
    print(HDR)
    print(SEP)

    total = DIFF_MAX - DIFF_MIN + 1
    done = [0]
    results = {}

    def _progress(result):
        diff, guesses, unsolved_count, dt = result
        results[diff] = (guesses, unsolved_count, dt)
        done[0] += 1
        pct = done[0] / total * 100
        bar = "#" * done[0] + "." * (total - done[0])
        print(f"\r  [{bar}] {done[0]}/{total}  ({pct:.0f}%)", end="", flush=True)

    t_total = time.time()
    with multiprocessing.Pool() as pool:
        handles = [
            pool.apply_async(bench_diff, (diff,), callback=_progress)
            for diff in range(DIFF_MIN, DIFF_MAX + 1)
        ]
        for h in handles:
            h.wait()

    print()  # newline after progress bar

    for diff in range(DIFF_MIN, DIFF_MAX + 1):
        guesses, unsolved_count, dt = results[diff]
        print(format_row(diff, guesses, unsolved_count, dt))

    print(SEP)
    print(f"Total wall time: {time.time() - t_total:.1f}s")
