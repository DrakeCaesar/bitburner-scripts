"""Monte Carlo Graph Search (MCGS) for IPvGO — no neural net required.

Graph-based MCTS with transpositions and a hand-tuned model of the scripted
White faction AI. Suitable as a strong teacher for early curriculum steps.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import pyipvgo
from env import EnvState


@dataclass
class McgsConfig:
    playouts: int = 10000
    exploration: float = 0.3
    use_ai_tweaks: bool = True
    suppress_transposition: bool = True


@dataclass
class McgsResult:
    visit_policy: np.ndarray
    best_action: int
    root_value: float


def run_mcgs(state: EnvState, cfg: McgsConfig, rng: np.random.Generator) -> McgsResult:
    seed = int(rng.integers(0, 2**63 - 1))
    visit_policy, best_action, root_value = pyipvgo.run_mcgs(
        state.gs,
        cfg.playouts,
        cfg.exploration,
        cfg.use_ai_tweaks,
        cfg.suppress_transposition,
        seed,
    )
    return McgsResult(
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
