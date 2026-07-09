"""Fully-convolutional policy+value ResNet for IPvGO.

The net is fully convolutional with global-average-pooled value/pass heads, so a
single model handles every board size (5/7/9/13). Action space is N*N board
points plus one pass action (index N*N).
"""

from __future__ import annotations

from typing import Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from config import NetConfig


class ResBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.c1 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.b1 = nn.BatchNorm2d(channels)
        self.c2 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.b2 = nn.BatchNorm2d(channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = F.relu(self.b1(self.c1(x)))
        h = self.b2(self.c2(h))
        return F.relu(h + x)


class GoNet(nn.Module):
    def __init__(self, cfg: NetConfig | None = None):
        super().__init__()
        self.cfg = cfg or NetConfig()
        c = self.cfg.channels

        self.stem = nn.Conv2d(self.cfg.in_planes, c, 3, padding=1, bias=False)
        self.stem_bn = nn.BatchNorm2d(c)
        self.blocks = nn.ModuleList([ResBlock(c) for _ in range(self.cfg.blocks)])

        # Policy head: per-point 1x1 logits + a pass logit from pooled features.
        self.pol_conv = nn.Conv2d(c, 32, 1, bias=False)
        self.pol_bn = nn.BatchNorm2d(32)
        self.pol_out = nn.Conv2d(32, 1, 1)
        self.pass_fc = nn.Linear(32, 1)

        # Value head: 1x1 conv -> global average pool -> MLP -> tanh.
        self.val_conv = nn.Conv2d(c, 32, 1, bias=False)
        self.val_bn = nn.BatchNorm2d(32)
        self.val_fc1 = nn.Linear(32, 64)
        self.val_fc2 = nn.Linear(64, 1)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """x: [B, C, N, N] -> (policy_logits [B, N*N+1], value [B, 1] in (-1,1))."""
        b = x.shape[0]
        n = x.shape[2]

        h = F.relu(self.stem_bn(self.stem(x)))
        for block in self.blocks:
            h = block(h)

        p = F.relu(self.pol_bn(self.pol_conv(h)))  # [B,32,N,N]
        board_logits = self.pol_out(p).reshape(b, n * n)  # [B, N*N]
        pooled = F.adaptive_avg_pool2d(p, 1).reshape(b, 32)
        pass_logit = self.pass_fc(pooled)  # [B,1]
        policy = torch.cat([board_logits, pass_logit], dim=1)  # [B, N*N+1]

        v = F.relu(self.val_bn(self.val_conv(h)))
        v = F.adaptive_avg_pool2d(v, 1).reshape(b, 32)
        v = F.relu(self.val_fc1(v))
        v = torch.tanh(self.val_fc2(v))  # [B,1]

        return policy, v
