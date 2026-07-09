"""Thin inference wrapper around GoNet, operating on pyipvgo.GameState."""

from __future__ import annotations

from typing import List, Tuple

import numpy as np
import torch

import pyipvgo
from network import GoNet


class Evaluator:
    def __init__(self, net: GoNet, device: torch.device):
        self.net = net
        self.device = device

    @torch.no_grad()
    def evaluate(self, state: "pyipvgo.GameState") -> Tuple[np.ndarray, float]:
        logits, values = self.evaluate_batch([state])
        return logits[0], values[0]

    @torch.no_grad()
    def evaluate_batch(self, states: List["pyipvgo.GameState"]) -> Tuple[List[np.ndarray], List[float]]:
        if not states:
            return [], []
        # All states in a batch must share board size (fully-conv, but the pass
        # head reshapes on N). Callers batch by size; assert to catch misuse.
        n = states[0].size
        planes = np.stack(
            [np.asarray(pyipvgo.encode_state(s, pyipvgo.Color.Black), dtype=np.float32) for s in states]
        )
        x = torch.from_numpy(planes).to(self.device)
        self.net.eval()
        policy, value = self.net(x)
        policy = policy.detach().to("cpu").numpy()
        value = value.detach().to("cpu").numpy().reshape(-1)
        return [policy[i] for i in range(policy.shape[0])], [float(value[i]) for i in range(value.shape[0])]
