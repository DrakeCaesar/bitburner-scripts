"""Deterministic per-faction win-rate evaluation (argmax, no root noise)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import pyipvgo
from config import MctsConfig
from evaluator import Evaluator
from mcts import run_mcts


@dataclass
class EvalResult:
    faction: str
    size: int
    games: int
    black_wins: int

    @property
    def win_rate(self) -> float:
        return self.black_wins / self.games if self.games else 0.0


def evaluate_faction(evaluator: Evaluator, faction: str, size: int, games: int, simulations: int,
                     apply_obstacles: bool, rng: np.random.Generator) -> EvalResult:
    ai = pyipvgo.parse_opponent(faction)
    if ai is None:
        raise ValueError(f"Unknown faction: {faction!r}")

    mcts_cfg = MctsConfig(simulations=simulations, add_root_noise=False)
    move_cap = size * size * 3 + 20
    wins = 0

    for _ in range(games):
        seed_ms = float(rng.integers(0, 30_000_000))
        math_seed = int(rng.integers(0, 2**63 - 1))
        state = pyipvgo.new_board_state(size, ai, apply_obstacles, seed_ms, math_seed)

        move_no = 0
        while not state.game_over and move_no < move_cap:
            result = run_mcts(state, evaluator, mcts_cfg, rng)
            seed = int(rng.integers(0, 2**63 - 1))
            state, _terminal, _bv = pyipvgo.step_environment(state, result.best_action, seed)
            move_no += 1

        if pyipvgo.black_terminal_value(state) > 0.0:
            wins += 1

    return EvalResult(faction=faction, size=size, games=games, black_wins=wins)
