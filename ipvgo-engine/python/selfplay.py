"""Self-play game generation: Black = net+MCTS, White = scripted faction AI."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

import numpy as np

import pyipvgo
from config import MctsConfig, SelfPlayConfig
from evaluator import Evaluator
from mcts import run_mcts, sample_action
from replay import ReplayBuffer, Sample


@dataclass
class GameStats:
    black_won: bool
    moves: int
    faction: str
    size: int


def _resolve_faction(name: str) -> "pyipvgo.Opponent":
    ai = pyipvgo.parse_opponent(name)
    if ai is None:
        raise ValueError(f"Unknown faction: {name!r}")
    return ai


def play_self_play_game(evaluator: Evaluator, sp_cfg: SelfPlayConfig, mcts_cfg: MctsConfig,
                        buffer: ReplayBuffer, rng: np.random.Generator) -> GameStats:
    size = int(rng.choice(sp_cfg.sizes))
    faction = str(rng.choice(sp_cfg.factions))
    ai = _resolve_faction(faction)

    seed_ms = float(rng.integers(0, 30_000_000))
    math_seed = int(rng.integers(0, 2**63 - 1))
    state = pyipvgo.new_board_state(size, ai, sp_cfg.apply_obstacles, seed_ms, math_seed)

    move_cap = size * size * 3 + 20

    trajectory: List[Sample] = []
    move_no = 0
    while not state.game_over and move_no < move_cap:
        result = run_mcts(state, evaluator, mcts_cfg, rng)

        planes = np.asarray(pyipvgo.encode_state(state, pyipvgo.Color.Black), dtype=np.float32)
        legal = np.asarray(pyipvgo.legal_action_mask(state, pyipvgo.Color.Black), dtype=np.int8)
        trajectory.append(Sample(n=size, planes=planes, policy=result.visit_policy.copy(),
                                 legal=legal, value=0.0))

        tau = 1.0 if move_no < sp_cfg.temperature_moves else 0.0
        action = sample_action(result.visit_policy, tau, rng)

        seed = int(rng.integers(0, 2**63 - 1))
        state, _terminal, _black_value = pyipvgo.step_environment(state, action, seed)
        move_no += 1

    black_value = pyipvgo.black_terminal_value(state)
    for sample in trajectory:
        sample.value = float(black_value)
        buffer.add(sample)

    return GameStats(black_won=black_value > 0.0, moves=move_no, faction=faction, size=size)
