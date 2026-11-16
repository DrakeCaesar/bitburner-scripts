import multiprocessing
import statistics
import time

from koth_gen import DEFAULT_SEED, generate_assignments
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
        avg = statistics.mean(guesses)
        median = guesses[n // 2]
        lo = guesses[0]
        hi = guesses[-1]
        p95 = guesses[int(0.95 * n)]
        p99 = guesses[int(0.99 * n)]
        return (
            f"{diff:>4}  {n:>6}  {unsolved_count:>8}  "
            f"{avg:>7.2f}  {median:>6}  {lo:>5}  {hi:>5}  {p95:>5}  {p99:>5}  {dt:>5.1f}s"
        )
    return (
        f"{diff:>4}  {0:>6}  {unsolved_count:>8}  "
        f"{'—':>7}  {'—':>6}  {'—':>5}  {'—':>5}  {'—':>5}  {'—':>5}  {dt:>5.1f}s"
    )


def print_progress(done, total):
    pct = done / total * 100
    bar = "#" * done + "." * (total - done)
    print(f"\r  [{bar}] {done}/{total}  ({pct:.0f}%)", end="", flush=True)


if __name__ == "__main__":
    multiprocessing.freeze_support()

    hdr = (
        f"{'diff':>4}  {'solved':>6}  {'unsolved':>8}  {'avg':>7}  "
        f"{'median':>6}  {'min':>5}  {'max':>5}  {'p95':>5}  {'p99':>5}  {'time':>6}"
    )
    sep = "-" * len(hdr)
    total = DIFF_MAX - DIFF_MIN + 1
    difficulties = list(range(DIFF_MIN, DIFF_MAX + 1))

    print(f"Benchmark  N={N} per difficulty  workers={multiprocessing.cpu_count()}")
    print(sep)
    print(hdr)
    print(sep)

    t_total = time.time()
    results = {}
    done = 0

    # Do not use apply_async callbacks to collect results: on Windows the callback
    # can still be pending when wait() returns, so rows go missing from output.
    with multiprocessing.Pool() as pool:
        for diff, guesses, unsolved_count, dt in pool.imap_unordered(bench_diff, difficulties):
            results[diff] = (guesses, unsolved_count, dt)
            done += 1
            print_progress(done, total)

    print()

    missing = [d for d in difficulties if d not in results]
    if missing:
        print(f"ERROR: missing results for difficulties: {missing}")
        raise SystemExit(1)

    failed = False
    for diff in difficulties:
        guesses, unsolved_count, dt = results[diff]
        if unsolved_count:
            failed = True
        print(format_row(diff, guesses, unsolved_count, dt))

    print(sep)
    print(f"Total wall time: {time.time() - t_total:.1f}s")
    if failed:
        raise SystemExit(1)
