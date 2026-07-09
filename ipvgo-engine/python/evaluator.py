"""Thin inference wrapper around GoNet, operating on env.EnvState."""

from __future__ import annotations

from typing import List, Tuple

import numpy as np
import torch

from env import CheatSettings, EnvState, encode
from network import GoNet


class Evaluator:
    def __init__(self, net: GoNet, device: torch.device, settings: CheatSettings | None = None):
        self.net = net
        self.device = device
        self.settings = settings or CheatSettings()

    @torch.no_grad()
    def evaluate(self, env_state: EnvState) -> Tuple[np.ndarray, float]:
        logits, values = self.evaluate_batch([env_state])
        return logits[0], values[0]

    @torch.no_grad()
    def evaluate_planes_batch(self, planes: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Batched inference on pre-encoded planes [B, C, N, N] (used by C++ MCTS)."""
        x = torch.from_numpy(planes).to(self.device)
        self.net.eval()
        policy, value = self.net(x)
        return policy.detach().cpu().numpy(), value.detach().cpu().numpy().reshape(-1)

    @torch.no_grad()
    def evaluate_batch(self, env_states: List[EnvState]) -> Tuple[List[np.ndarray], List[float]]:
        if not env_states:
            return [], []
        planes = np.stack([encode(s, self.settings) for s in env_states])
        policy, value = self.evaluate_planes_batch(planes)
        return [policy[i] for i in range(policy.shape[0])], [float(value[i]) for i in range(value.shape[0])]
