"""Optional extended action space: the four IPvGO cheats.

The base agent (nn-mcts / train) does not use cheats. This module provides a
faithful, self-contained way to fold cheats into an environment step so the
agent can *optionally* be fine-tuned to exploit them (Source-File 14.2).

Cheat success/eject probabilities are player-dependent in game:
    crime_success_mult = Player.mults.crime_success
    source_file_bonus  = 0.25 if SF14 level 3 else 0.0
Pass these through so training reflects a specific power level.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

import numpy as np

import pyipvgo


@dataclass
class CheatAction:
    type: "pyipvgo.CheatType"
    points: List[Tuple[int, int]]


def cheat_step(state: "pyipvgo.GameState", cheat: CheatAction, rng: np.random.Generator,
               crime_success_mult: float = 1.0, source_file_bonus: float = 0.0
               ) -> Tuple["pyipvgo.GameState", bool, float, "pyipvgo.CheatResult"]:
    """Apply a Black cheat, then White's reply if the game continues.

    Returns (next_state, terminal, black_value, cheat_result). On ejection the
    game ends immediately (a loss for Black); on a skipped turn White still
    replies. Mirrors the game's determineCheatSuccess + handleNextTurn flow.
    """
    success_rng = float(rng.random())
    eject_rng = float(rng.random())
    next_state, result, game_over = pyipvgo.apply_cheat(
        state, pyipvgo.Color.Black, cheat.type, cheat.points, success_rng, eject_rng,
        crime_success_mult, source_file_bonus,
    )

    if game_over:  # ejected
        return next_state, True, pyipvgo.black_terminal_value(next_state), result

    seed = int(rng.integers(0, 2**63 - 1))
    next_state, terminal, black_value = pyipvgo.white_reply(next_state, seed)
    if not terminal:
        black_value = 0.0
    return next_state, terminal, float(black_value), result
