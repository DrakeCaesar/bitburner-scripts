"""Configuration dataclasses for the IPvGO training pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List


# Faction names as accepted by pyipvgo.parse_opponent / used for reporting.
DEFAULT_FACTIONS: List[str] = [
    "Netburners",
    "Slum Snakes",
    "The Black Hand",
    "Tetrads",
    "Daedalus",
    "Illuminati",
]

DEFAULT_SIZES: List[int] = [5, 7, 9, 13]


@dataclass
class NetConfig:
    channels: int = 64
    blocks: int = 8
    in_planes: int = 23  # env.NUM_INPUT_PLANES (12 base + 4 cheat + 7 faction planes)
    point_action_types: int = 5  # env.POINT_ACTION_TYPES (board move + 4 cheats)


@dataclass
class MctsConfig:
    simulations: int = 128
    c_puct: float = 1.5
    dirichlet_alpha: float = 0.3
    dirichlet_epsilon: float = 0.25
    add_root_noise: bool = True
    leaf_batch_size: int = 32  # batched NN evals inside C++ MCTS


@dataclass
class CheatConfig:
    """Cheat availability during training/eval (see env.CheatSettings).

    warmup_iters: number of initial iterations trained with cheats DISABLED so
    the net first learns real board play and a value head with actual variance;
    cheats are auto-enabled once ``iteration > warmup_iters``. Without a warmup
    the untrained policy spams cheats (they are ~80% of the action space) and
    almost every game ends in ejection, giving an all-loss value signal.
    """

    enabled: bool = True
    crime_success_mult: float = 1.0
    source_file_bonus: float = 0.0
    warmup_iters: int = 10


@dataclass
class SelfPlayConfig:
    temperature_moves: int = 8  # sample proportionally for the first N Black moves
    apply_obstacles: bool = True
    sizes: List[int] = field(default_factory=lambda: list(DEFAULT_SIZES))
    factions: List[str] = field(default_factory=lambda: list(DEFAULT_FACTIONS))


@dataclass
class TrainConfig:
    iterations: int = 200
    games_per_iter: int = 64
    train_steps_per_iter: int = 256
    batch_size: int = 256
    lr: float = 1e-3
    weight_decay: float = 1e-4
    value_loss_weight: float = 1.0
    replay_capacity_per_size: int = 200_000
    min_buffer_to_train: int = 2_000
    checkpoint_dir: str = "python/checkpoints"
    checkpoint_every: int = 1
    eval_every: int = 5
    eval_games: int = 16
    eval_simulations: int = 96
    device: str = "cuda"
    seed: int = 0

    net: NetConfig = field(default_factory=NetConfig)
    mcts: MctsConfig = field(default_factory=MctsConfig)
    selfplay: SelfPlayConfig = field(default_factory=SelfPlayConfig)
    cheats: CheatConfig = field(default_factory=CheatConfig)
