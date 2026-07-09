"""Checkpoint save/load that also records the network shape."""

from __future__ import annotations

import os
from dataclasses import asdict
from typing import Tuple

import torch

from config import NetConfig
from network import GoNet


def save_checkpoint(path: str, net: GoNet, extra: dict | None = None) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    payload = {"net_cfg": asdict(net.cfg), "model_state": net.state_dict()}
    if extra:
        payload.update(extra)
    torch.save(payload, path)


def load_checkpoint(path: str, device: torch.device) -> Tuple[GoNet, dict]:
    payload = torch.load(path, map_location=device)
    cfg = NetConfig(**payload["net_cfg"])
    net = GoNet(cfg).to(device)
    net.load_state_dict(payload["model_state"])
    return net, payload
