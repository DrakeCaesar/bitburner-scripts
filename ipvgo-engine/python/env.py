"""Extended IPvGO environment for the Black agent, including cheats.

This wraps the faithful C++ engine (``pyipvgo``) and defines the RL action space,
feature encoding, legality mask, and stochastic transition used by MCTS,
self-play, evaluation and serving.

Action layout (P = N*N):
    [0,       P)     place a stone (board move); action a -> (x=a//N, y=a%N)
    P                pass
    [P+1,   2P+1)    cheat: removeRouter(x,y)        (clear an opponent 'O' stone)
    [2P+1,  3P+1)    cheat: repairOfflineNode(x,y)   ('#' -> '.')
    [3P+1,  4P+1)    cheat: destroyNode(x,y)         (any non-'#' -> '#')
    [4P+1,  5P+1)    cheat: playTwoMoves first point (then a normal 2nd move)
Total actions = 5*P + 1. This ordering must match GoNet's policy head.

playTwoMoves is modeled as an extended (chance) action: on success it places the
first stone and the agent keeps the turn (``EnvState.extra_move``); the next
board move places the second stone and White then replies. This is behaviorally
equivalent to the game's simultaneous two-stone play for the common case of two
empty target points, while keeping the action space linear.

Cheat success is stochastic and its probability changes with the number of prior
cheats this game; the changing chance and cheat count are exposed as feature
planes so the policy/value net can condition on the risk.

Feature planes (NUM_INPUT_PLANES = 23):
    0..11  base C++ planes (own/opp/empty/offline, legal, bias, komi, turn, 4x history)
    12     current cheat success chance   13  normalized prior cheat count
    14     cheats-available flag           15  free-second-move-pending flag
    16..22 one-hot faction identity (Netburners, Slum Snakes, The Black Hand,
           Tetrads, Daedalus, Illuminati, WorldDaemon)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Tuple

import numpy as np

import pyipvgo

# Number of extra feature planes appended to the C++ base planes.
CHEAT_PLANES = 4

# Faction identity is one-hot encoded as constant planes so the net can special-
# ize its policy/value per opponent (each of the six plays a different strategy,
# and Illuminati/WorldDaemon start with handicap stones). Unknown/None -> zeros.
FACTION_ORDER = [
    pyipvgo.Opponent.Netburners,
    pyipvgo.Opponent.SlumSnakes,
    pyipvgo.Opponent.TheBlackHand,
    pyipvgo.Opponent.Tetrads,
    pyipvgo.Opponent.Daedalus,
    pyipvgo.Opponent.Illuminati,
    pyipvgo.Opponent.WorldDaemon,
]
FACTION_PLANES = len(FACTION_ORDER)
_FACTION_INDEX = {op: i for i, op in enumerate(FACTION_ORDER)}

NUM_INPUT_PLANES = pyipvgo.NUM_PLANES + CHEAT_PLANES + FACTION_PLANES  # 12 + 4 + 7 = 23

# Number of per-point action "types" the policy head emits (board move + 4 cheats).
POINT_ACTION_TYPES = 5


@dataclass
class CheatSettings:
    """Player-power inputs to the cheat success formula.

    enabled            : whether cheats are part of the action space at all.
    crime_success_mult : Player.mults.crime_success (>=1 makes cheats easier).
    source_file_bonus  : additive success bonus (0.25 for SF14.3, else 0.0).
    """

    enabled: bool = True
    crime_success_mult: float = 1.0
    source_file_bonus: float = 0.0


@dataclass
class EnvState:
    gs: "pyipvgo.GameState"
    extra_move: bool = False  # playTwoMoves second placement pending (Black to move again)

    @property
    def size(self) -> int:
        return self.gs.size

    @property
    def game_over(self) -> bool:
        return self.gs.game_over

    @property
    def cheat_count(self) -> int:
        return self.gs.cheat_count


def action_count(n: int) -> int:
    return POINT_ACTION_TYPES * n * n + 1


def _bases(n: int):
    p = n * n
    return {
        "P": p,
        "PASS": p,
        "REMOVE": p + 1,
        "REPAIR": 2 * p + 1,
        "DESTROY": 3 * p + 1,
        "P2M": 4 * p + 1,
    }


def cheat_chance(gs: "pyipvgo.GameState", settings: CheatSettings) -> float:
    if not settings.enabled:
        return 0.0
    return float(
        pyipvgo.cheat_success_chance(gs.cheat_count, settings.crime_success_mult, settings.source_file_bonus)
    )


def encode(env: EnvState, settings: CheatSettings) -> np.ndarray:
    """Return [NUM_INPUT_PLANES, N, N] float32 planes: base C++ planes (12) +
    cheat planes (4) + one-hot faction planes (7)."""
    n = env.size
    base = np.asarray(pyipvgo.encode_state(env.gs, pyipvgo.Color.Black), dtype=np.float32)  # [12, N, N]
    extra = np.zeros((CHEAT_PLANES, n, n), dtype=np.float32)
    extra[0] = cheat_chance(env.gs, settings)                 # current success chance
    extra[1] = min(env.gs.cheat_count / 10.0, 1.0)            # normalized prior cheat count
    extra[2] = 1.0 if settings.enabled else 0.0              # cheats available
    extra[3] = 1.0 if env.extra_move else 0.0               # free second-move pending
    faction = np.zeros((FACTION_PLANES, n, n), dtype=np.float32)
    fidx = _FACTION_INDEX.get(env.gs.ai)
    if fidx is not None:
        faction[fidx] = 1.0
    return np.concatenate([base, extra, faction], axis=0)


def legal_mask(env: EnvState, settings: CheatSettings) -> np.ndarray:
    """Return an int8 mask of size action_count(N)."""
    n = env.size
    b = _bases(n)
    p = b["P"]
    mask = np.zeros(action_count(n), dtype=np.int8)

    board = np.asarray(pyipvgo.legal_action_mask(env.gs, pyipvgo.Color.Black))  # size P+1 (board + pass)
    mask[0:p] = board[0:p]

    if env.extra_move:
        # Must place the second stone; allow pass only if no legal placement exists.
        if int(mask[0:p].sum()) == 0:
            mask[b["PASS"]] = 1
        return mask

    mask[b["PASS"]] = board[p]  # pass always legal on a normal turn

    if not settings.enabled:
        return mask

    board2d = env.gs.board
    for x in range(n):
        col = board2d[x]
        for y in range(n):
            c = col[y]
            idx = x * n + y
            if c == "O":
                mask[b["REMOVE"] + idx] = 1        # remove an opponent router
            if c == "#":
                mask[b["REPAIR"] + idx] = 1        # repair an offline node
            if c != "#":
                mask[b["DESTROY"] + idx] = 1       # destroy any online point

    # playTwoMoves needs at least two legal placements; first point is any legal move.
    if int(mask[0:p].sum()) >= 2:
        mask[b["P2M"]:b["P2M"] + p] = board[0:p]

    return mask


def _after_cheat(next_gs, result, game_over, rng: np.random.Generator) -> Tuple[EnvState, bool, float]:
    """Resolve a single-point cheat outcome: eject=loss, else White replies."""
    if result == pyipvgo.CheatResult.Ejected:
        return EnvState(next_gs), True, -1.0  # ejection is a loss regardless of board score
    if game_over:
        return EnvState(next_gs), True, float(pyipvgo.black_terminal_value(next_gs))
    seed = int(rng.integers(0, 2**63 - 1))
    nxt, terminal, black_value = pyipvgo.white_reply(next_gs, seed)
    return EnvState(nxt), bool(terminal), float(black_value) if terminal else 0.0


def step(env: EnvState, action: int, rng: np.random.Generator, settings: CheatSettings
         ) -> Tuple[EnvState, bool, float]:
    """Apply `action`; return (next_env, terminal, black_value).

    black_value is only meaningful when terminal (+1 win/tie, -1 loss/eject).
    """
    n = env.size
    b = _bases(n)
    p = b["P"]

    # --- Free second move of a successful playTwoMoves ---
    if env.extra_move:
        seed = int(rng.integers(0, 2**63 - 1))
        move = action if (action < p) else pyipvgo.pass_action(n)
        nxt, terminal, black_value = pyipvgo.step_environment(env.gs, move, seed)
        return EnvState(nxt), bool(terminal), float(black_value) if terminal else 0.0

    # --- Normal board move / pass ---
    if action < p:
        seed = int(rng.integers(0, 2**63 - 1))
        nxt, terminal, black_value = pyipvgo.step_environment(env.gs, action, seed)
        return EnvState(nxt), bool(terminal), float(black_value) if terminal else 0.0
    if action == b["PASS"]:
        seed = int(rng.integers(0, 2**63 - 1))
        nxt, terminal, black_value = pyipvgo.step_environment(env.gs, pyipvgo.pass_action(n), seed)
        return EnvState(nxt), bool(terminal), float(black_value) if terminal else 0.0

    # --- Cheat actions ---
    success_rng = float(rng.random())
    eject_rng = float(rng.random())
    mult = settings.crime_success_mult
    bonus = settings.source_file_bonus

    if b["REMOVE"] <= action < b["REMOVE"] + p:
        idx = action - b["REMOVE"]
        pt = (idx // n, idx % n)
        nxt, res, over = pyipvgo.apply_cheat(env.gs, pyipvgo.Color.Black, pyipvgo.CheatType.RemoveRouter,
                                             [pt], success_rng, eject_rng, mult, bonus)
        return _after_cheat(nxt, res, over, rng)

    if b["REPAIR"] <= action < b["REPAIR"] + p:
        idx = action - b["REPAIR"]
        pt = (idx // n, idx % n)
        nxt, res, over = pyipvgo.apply_cheat(env.gs, pyipvgo.Color.Black, pyipvgo.CheatType.RepairOfflineNode,
                                             [pt], success_rng, eject_rng, mult, bonus)
        return _after_cheat(nxt, res, over, rng)

    if b["DESTROY"] <= action < b["DESTROY"] + p:
        idx = action - b["DESTROY"]
        pt = (idx // n, idx % n)
        nxt, res, over = pyipvgo.apply_cheat(env.gs, pyipvgo.Color.Black, pyipvgo.CheatType.DestroyNode,
                                             [pt], success_rng, eject_rng, mult, bonus)
        return _after_cheat(nxt, res, over, rng)

    if b["P2M"] <= action < b["P2M"] + p:
        idx = action - b["P2M"]
        x, y = idx // n, idx % n
        nxt, res, over = pyipvgo.begin_play_two_moves(env.gs, pyipvgo.Color.Black, x, y,
                                                      success_rng, eject_rng, mult, bonus)
        if res == pyipvgo.CheatResult.Success and not over:
            return EnvState(nxt, extra_move=True), False, 0.0  # keep the turn for the second stone
        return _after_cheat(nxt, res, over, rng)

    # Should not happen with proper masking; treat as pass.
    seed = int(rng.integers(0, 2**63 - 1))
    nxt, terminal, black_value = pyipvgo.step_environment(env.gs, pyipvgo.pass_action(n), seed)
    return EnvState(nxt), bool(terminal), float(black_value) if terminal else 0.0


def new_game(size: int, faction: str, apply_obstacles: bool, rng: np.random.Generator) -> Tuple[EnvState, "pyipvgo.Opponent"]:
    ai = pyipvgo.parse_opponent(faction)
    if ai is None:
        raise ValueError(f"Unknown faction: {faction!r}")
    seed_ms = float(rng.integers(0, 30_000_000))
    math_seed = int(rng.integers(0, 2**63 - 1))
    gs = pyipvgo.new_board_state(size, ai, apply_obstacles, seed_ms, math_seed)
    return EnvState(gs), ai


def action_kind(action: int, n: int) -> str:
    """Human-readable action category, for logging/serving."""
    b = _bases(n)
    p = b["P"]
    if action < p:
        return "move"
    if action == b["PASS"]:
        return "pass"
    if action < b["REPAIR"]:
        return "removeRouter"
    if action < b["DESTROY"]:
        return "repairOfflineNode"
    if action < b["P2M"]:
        return "destroyNode"
    return "playTwoMoves"


def action_point(action: int, n: int) -> Tuple[int, int]:
    """(x, y) target for a point action (board move or any cheat)."""
    b = _bases(n)
    p = b["P"]
    if action < p:
        idx = action
    elif action < b["REPAIR"]:
        idx = action - b["REMOVE"]
    elif action < b["DESTROY"]:
        idx = action - b["REPAIR"]
    elif action < b["P2M"]:
        idx = action - b["DESTROY"]
    else:
        idx = action - b["P2M"]
    return idx // n, idx % n
