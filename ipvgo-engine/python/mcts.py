"""AlphaZero-style PUCT MCTS for Black against the scripted White environment.

White replies are folded into the transition (``pyipvgo.step_environment``),
which makes each edge a stochastic (chance) transition; we sample once per edge
expansion, matching the reference C++ design. The search guides Black only.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np

import pyipvgo
from config import MctsConfig
from evaluator import Evaluator


@dataclass
class _Node:
    state: "pyipvgo.GameState"
    terminal: bool = False
    terminal_value: float = 0.0
    expanded: bool = False
    actions: List[int] = field(default_factory=list)
    prior: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))
    visits: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.int64))
    total_value: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float64))
    children: List[Optional["_Node"]] = field(default_factory=list)


@dataclass
class MctsResult:
    visit_policy: np.ndarray  # size N*N+1, normalized visit counts
    best_action: int
    root_value: float


def _softmax_over_legal(logits: np.ndarray, actions: List[int]) -> np.ndarray:
    sub = logits[actions]
    sub = sub - np.max(sub)
    ex = np.exp(sub)
    total = ex.sum()
    if total > 0:
        ex /= total
    return ex.astype(np.float32)


def _expand(node: _Node, evaluator: Evaluator) -> float:
    mask = np.asarray(pyipvgo.legal_action_mask(node.state, pyipvgo.Color.Black))
    node.actions = [a for a in range(mask.shape[0]) if mask[a]]
    logits, value = evaluator.evaluate(node.state)
    node.prior = _softmax_over_legal(logits, node.actions)
    node.visits = np.zeros(len(node.actions), dtype=np.int64)
    node.total_value = np.zeros(len(node.actions), dtype=np.float64)
    node.children = [None] * len(node.actions)
    node.expanded = True
    return float(value)


def _add_dirichlet_noise(node: _Node, alpha: float, epsilon: float, rng: np.random.Generator) -> None:
    if node.prior.size == 0:
        return
    noise = rng.dirichlet([alpha] * node.prior.size).astype(np.float32)
    node.prior = (1.0 - epsilon) * node.prior + epsilon * noise


def _select_action(node: _Node, c_puct: float) -> int:
    total = int(node.visits.sum())
    sqrt_total = math.sqrt(max(1, total))
    q = np.where(node.visits > 0, node.total_value / np.maximum(node.visits, 1), 0.0)
    u = c_puct * node.prior * sqrt_total / (1.0 + node.visits)
    return int(np.argmax(q + u))


def run_mcts(root_state: "pyipvgo.GameState", evaluator: Evaluator, cfg: MctsConfig,
             rng: np.random.Generator) -> MctsResult:
    n = root_state.size
    action_count = pyipvgo.action_count(n)

    root = _Node(state=root_state)
    root_value = _expand(root, evaluator)
    if cfg.add_root_noise:
        _add_dirichlet_noise(root, cfg.dirichlet_alpha, cfg.dirichlet_epsilon, rng)

    for _ in range(cfg.simulations):
        node = root
        path = []  # list of (node, action_index)
        value = 0.0

        while True:
            if node.terminal:
                value = node.terminal_value
                break
            if not node.expanded:
                value = _expand(node, evaluator)
                break
            i = _select_action(node, cfg.c_puct)
            path.append((node, i))

            if node.children[i] is None:
                seed = int(rng.integers(0, 2**63 - 1))
                nxt, terminal, black_value = pyipvgo.step_environment(node.state, node.actions[i], seed)
                child = _Node(state=nxt, terminal=terminal, terminal_value=float(black_value))
                node.children[i] = child
            node = node.children[i]

        for parent, i in path:
            parent.visits[i] += 1
            parent.total_value[i] += value

    visit_policy = np.zeros(action_count, dtype=np.float32)
    total_visits = int(root.visits.sum())
    best_action = pyipvgo.pass_action(n)
    best_visits = -1
    for idx, a in enumerate(root.actions):
        if total_visits > 0:
            visit_policy[a] = root.visits[idx] / total_visits
        if root.visits[idx] > best_visits:
            best_visits = int(root.visits[idx])
            best_action = a

    return MctsResult(visit_policy=visit_policy, best_action=best_action, root_value=root_value)


def sample_action(visit_policy: np.ndarray, tau: float, rng: np.random.Generator) -> int:
    if tau <= 1e-3:
        return int(np.argmax(visit_policy))
    weights = np.power(visit_policy.astype(np.float64), 1.0 / tau)
    total = weights.sum()
    if total <= 0:
        return int(np.argmax(visit_policy))
    weights /= total
    return int(rng.choice(len(weights), p=weights))
