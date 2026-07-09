"""Size-bucketed replay buffer.

Samples are grouped by board size so a training batch always shares spatial
dims (the pass head reshapes on N). Each bucket is a bounded ring buffer.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional

import numpy as np


@dataclass
class Sample:
    n: int
    planes: np.ndarray   # [C, N, N] float32
    policy: np.ndarray   # [N*N+1] float32
    legal: np.ndarray    # [N*N+1] int8
    value: float


class ReplayBuffer:
    def __init__(self, capacity_per_size: int = 200_000):
        self.capacity_per_size = capacity_per_size
        self._by_size: Dict[int, Deque[Sample]] = {}

    def add(self, sample: Sample) -> None:
        dq = self._by_size.get(sample.n)
        if dq is None:
            dq = deque(maxlen=self.capacity_per_size)
            self._by_size[sample.n] = dq
        dq.append(sample)

    def __len__(self) -> int:
        return sum(len(dq) for dq in self._by_size.values())

    def sample_batch(self, batch_size: int, rng: np.random.Generator) -> Optional[List[Sample]]:
        eligible = [n for n, dq in self._by_size.items() if len(dq) >= batch_size]
        if not eligible:
            return None
        n = int(rng.choice(eligible))
        dq = self._by_size[n]
        idx = rng.integers(0, len(dq), size=batch_size)
        return [dq[i] for i in idx]
