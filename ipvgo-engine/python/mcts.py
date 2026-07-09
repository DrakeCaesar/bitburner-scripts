"""PUCT MCTS for Black — search runs in C++, NN eval batched via PyTorch callback.

Python keeps: MctsResult / sample_action API used by selfplay, evaluate, serve.
The hot path (tree walk, env.step, leaf batching) is native C++ in pyipvgo.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import pyipvgo
from config import MctsConfig
from env import CheatSettings, EnvState
from evaluator import Evaluator


@dataclass
class MctsResult:
    visit_policy: np.ndarray
    best_action: int
    root_value: float


def run_mcts(root_state: EnvState, evaluator: Evaluator, cfg: MctsConfig, rng: np.random.Generator,
             settings: CheatSettings | None = None) -> MctsResult:
    settings = settings or evaluator.settings
    seed = int(rng.integers(0, 2**63 - 1))

    def eval_fn(planes_batch: np.ndarray):
        policy, value = evaluator.evaluate_planes_batch(planes_batch)
        return policy, value

    visit_policy, best_action, root_value = pyipvgo.run_puct_mcts(
        root_state.gs,
        root_state.extra_move,
        settings.enabled,
        settings.crime_success_mult,
        settings.source_file_bonus,
        cfg.simulations,
        cfg.c_puct,
        cfg.dirichlet_alpha,
        cfg.dirichlet_epsilon,
        cfg.add_root_noise,
        cfg.leaf_batch_size,
        seed,
        eval_fn,
    )
    return MctsResult(
        visit_policy=np.asarray(visit_policy, dtype=np.float32),
        best_action=int(best_action),
        root_value=float(root_value),
    )


def sample_action(visit_policy: np.ndarray, tau: float, rng: np.random.Generator) -> int:
    if tau <= 1e-3:
        return int(np.argmax(visit_policy))
    weights = np.power(visit_policy.astype(np.float64), 1.0 / tau)
    total = weights.sum()
    if total <= 0:
        return int(np.argmax(visit_policy))
    weights /= total
    return int(rng.choice(len(weights), p=weights))
