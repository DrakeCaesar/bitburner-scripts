"""Deterministic per-faction win-rate evaluation (argmax, no root noise)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import pyipvgo
import env as envmod
from config import MctsConfig
from env import CheatSettings
from evaluator import Evaluator
from mcts import run_mcts


@dataclass
class EvalResult:
    faction: str
    size: int
    games: int
    black_wins: int
    cheat_attempts: int = 0

    @property
    def win_rate(self) -> float:
        return self.black_wins / self.games if self.games else 0.0


def evaluate_faction(evaluator: Evaluator, faction: str, size: int, games: int, simulations: int,
                     apply_obstacles: bool, rng: np.random.Generator,
                     settings: CheatSettings | None = None) -> EvalResult:
    settings = settings or evaluator.settings
    mcts_cfg = MctsConfig(simulations=simulations, add_root_noise=False)
    move_cap = size * size * 3 + 20
    wins = 0
    cheat_attempts = 0

    for _ in range(games):
        state, _ai = envmod.new_game(size, faction, apply_obstacles, rng)

        move_no = 0
        final_value = None
        while not state.game_over and move_no < move_cap:
            result = run_mcts(state, evaluator, mcts_cfg, rng, settings)
            if envmod.action_kind(result.best_action, size) not in ("move", "pass"):
                cheat_attempts += 1
            state, terminal, black_value = envmod.step(state, result.best_action, rng, settings)
            move_no += 1
            if terminal:
                final_value = black_value
                break

        if final_value is None:
            final_value = float(pyipvgo.black_terminal_value(state.gs))
        if final_value > 0.0:
            wins += 1

    return EvalResult(faction=faction, size=size, games=games, black_wins=wins, cheat_attempts=cheat_attempts)
