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
    def evaluate_batch(self, env_states: List[EnvState]) -> Tuple[List[np.ndarray], List[float]]:
        if not env_states:
            return [], []
        # All states in a batch must share board size (the pass head reshapes on N).
        planes = np.stack([encode(s, self.settings) for s in env_states])
        x = torch.from_numpy(planes).to(self.device)
        self.net.eval()
        policy, value = self.net(x)
        policy = policy.detach().to("cpu").numpy()
        value = value.detach().to("cpu").numpy().reshape(-1)
        return [policy[i] for i in range(policy.shape[0])], [float(value[i]) for i in range(value.shape[0])]
