"""
Exact Python port of the bitburner King-of-the-Hill problem generator and
altitude oracle, mirroring:
  tests/kingOfTheHillCore.ts          (bitburner-src game model)
  src/dnet/solvers/kingOfTheHill/     (in-game constants)

Only the *generator* + *oracle* are ported here. The solver lives in solver.py.
"""
import math

# ---- constants (verified against koth_common.hpp / solverCore.ts) ----
KOTH_PEAK_HEIGHT              = 10000
KOTH_NEAR_ZONE_FRACTION      = 0.03
KOTH_HILL_DIFFICULTY_DIVISOR = 8
KOTH_HILL_DIFFICULTY_CAP     = 4
KOTH_HILL_SPACING_WIDTHS     = 3
KOTH_LOCATION_JITTER_SCALE   = 0.2
KOTH_LOCATION_JITTER_BASE    = 0.9
KOTH_HEIGHT_OFFSET_BASE      = 2600
KOTH_HEIGHT_JITTER_SCALE     = 0.1
KOTH_HEIGHT_JITTER_BASE      = 0.95
KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2
KOTH_GAUSS_WIDTH_PLUS          = 1

ASSIGNMENT_PASSWORD_LENGTH_DIVISOR = 6
ASSIGNMENT_PASSWORD_LENGTH_CAP     = 10
ASSIGNMENT_SEED_STRIDE             = 9973
ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS = 15

DEFAULT_SEED       = 0x4b6f7468   # "Koth"
DEFAULT_DIFFICULTY = 60

MASK32 = 0xFFFFFFFF


# ---------------------------------------------------------------------------
# mulberry32  (assignment RNG -> password digits)  == C++ mulberry32
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# WHRNG  (altitude RNG -> hill index / jitter), seeded by the numeric password
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# assignment generation
# ---------------------------------------------------------------------------
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
    i = index - 1
    rng_seed = (seed + i * ASSIGNMENT_SEED_STRIDE) & MASK32
    return build_assignment(difficulty, mulberry32(rng_seed))


def generate_assignments(seed, count, difficulty):
    return [generate_assignment_at(seed, i + 1, difficulty) for i in range(count)]


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def hill_count(difficulty):
    return min(difficulty // KOTH_HILL_DIFFICULTY_DIVISOR, KOTH_HILL_DIFFICULTY_CAP) * 2 + 1


def gaussian_width(password_length):
    return 10 ** max(password_length - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS


def numeric_range(password_length):
    lo = 10 ** (password_length - 1)
    hi = 10 ** password_length - 1
    if password_length == 1:
        lo = 0
    return lo, hi


def _alt_given_specs(x, location, height, width):
    dx = x - location
    return height * math.exp((dx * dx / (width * width)) * -1.0)


def altitude(password_str, difficulty, x):
    """Oracle: altitude(x) for attempted integer x.  Mirrors getKingOfTheHillAltitude."""
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


# ---------------------------------------------------------------------------
# introspection: reconstruct the true hill layout (for analysis only; the
# solver is NOT allowed to call this).
# ---------------------------------------------------------------------------
def true_layout(password_str, difficulty):
    p = int(password_str)
    rng = WHRNG(p)
    hc = hill_count(difficulty)
    pw_hill_index = int(math.floor(rng.random() * (hc - 2))) + 1
    width = gaussian_width(len(password_str))
    hills = []
    for i in range(hc):
        loc_off = (i - pw_hill_index) * width * KOTH_HILL_SPACING_WIDTHS * (
            rng.random() * KOTH_LOCATION_JITTER_SCALE + KOTH_LOCATION_JITTER_BASE
        )
        ht_off = abs((i - pw_hill_index) * KOTH_HEIGHT_OFFSET_BASE) * (
            rng.random() * KOTH_HEIGHT_JITTER_SCALE + KOTH_HEIGHT_JITTER_BASE
        )
        hills.append({"i": i, "center": p + loc_off, "height": KOTH_PEAK_HEIGHT - ht_off})
    return {"p": p, "pw_hill_index": pw_hill_index, "width": width, "hills": hills}


if __name__ == "__main__":
    rows = generate_assignments(DEFAULT_SEED, 10, DEFAULT_DIFFICULTY)
    for r in rows:
        print(r)
