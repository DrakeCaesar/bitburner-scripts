"""Self-play game generation: Black = net+MCTS, White = scripted faction AI.

Uses the extended environment (``env``) so the agent may also choose cheat
actions; cheat outcomes (success / skipped turn / ejection) are sampled by the
environment, and ejection counts as a loss.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

import numpy as np

import pyipvgo
import env as envmod
from config import MctsConfig, SelfPlayConfig
from env import CheatSettings, EnvState
from evaluator import Evaluator
from mcts import run_mcts, sample_action
from replay import ReplayBuffer, Sample


@dataclass
class GameStats:
    black_won: bool
    moves: int
    faction: str
    size: int
    cheat_attempts: int = 0
    ejected: bool = False


def play_self_play_game(evaluator: Evaluator, sp_cfg: SelfPlayConfig, mcts_cfg: MctsConfig,
                        buffer: ReplayBuffer, rng: np.random.Generator,
                        settings: CheatSettings) -> GameStats:
    size = int(rng.choice(sp_cfg.sizes))
    faction = str(rng.choice(sp_cfg.factions))
    state, _ai = envmod.new_game(size, faction, sp_cfg.apply_obstacles, rng)

    move_cap = size * size * 3 + 20

    trajectory: List[Sample] = []
    move_no = 0
    cheat_attempts = 0
    ejected = False
    final_value = None

    while not state.game_over and move_no < move_cap:
        result = run_mcts(state, evaluator, mcts_cfg, rng, settings)

        planes = envmod.encode(state, settings)
        legal = envmod.legal_mask(state, settings)
        trajectory.append(Sample(n=size, planes=planes, policy=result.visit_policy.copy(),
                                  legal=legal, value=0.0))

        tau = 1.0 if move_no < sp_cfg.temperature_moves else 0.0
        action = sample_action(result.visit_policy, tau, rng)
        is_cheat = envmod.action_kind(action, size) not in ("move", "pass")
        if is_cheat:
            cheat_attempts += 1

        state, terminal, black_value = envmod.step(state, action, rng, settings)
        move_no += 1
        if terminal:
            final_value = black_value
            # A cheat that ends the game is an ejection (a loss).
            if is_cheat and black_value < 0:
                ejected = True
            break

    if final_value is None:
        final_value = float(pyipvgo.black_terminal_value(state.gs))

    for sample in trajectory:
        sample.value = float(final_value)
        buffer.add(sample)

    return GameStats(black_won=final_value > 0.0, moves=move_no, faction=faction, size=size,
                     cheat_attempts=cheat_attempts, ejected=ejected)
