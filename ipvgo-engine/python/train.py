"""Expert-iteration training loop.

Black = net + PUCT MCTS learns to beat the scripted White faction AIs. Each
iteration: (1) generate self-play games into a size-bucketed replay buffer,
(2) run SGD/Adam steps on sampled batches, (3) periodically checkpoint and
report per-faction win rates.
"""

from __future__ import annotations

import argparse
import os
import time
from typing import List

import numpy as np
import torch
import torch.nn.functional as F

import pyipvgo
from checkpoint import load_checkpoint, save_checkpoint
from config import TrainConfig
from evaluate import evaluate_faction
from evaluator import Evaluator
from network import GoNet
from replay import ReplayBuffer, Sample
from selfplay import play_self_play_game


def _make_batch(samples: List[Sample], device: torch.device):
    planes = torch.from_numpy(np.stack([s.planes for s in samples])).to(device)
    policy = torch.from_numpy(np.stack([s.policy for s in samples])).to(device)
    legal = torch.from_numpy(np.stack([s.legal for s in samples])).to(device).bool()
    value = torch.tensor([s.value for s in samples], dtype=torch.float32, device=device).unsqueeze(1)
    return planes, policy, legal, value


def train_step(net: GoNet, optimizer: torch.optim.Optimizer, batch, value_loss_weight: float):
    planes, target_policy, legal, target_value = batch
    net.train()
    optimizer.zero_grad(set_to_none=True)

    logits, value = net(planes)
    logits = logits.masked_fill(~legal, -1e9)
    log_probs = F.log_softmax(logits, dim=1)
    policy_loss = -(target_policy * log_probs).sum(dim=1).mean()
    value_loss = F.mse_loss(value, target_value)
    loss = policy_loss + value_loss_weight * value_loss

    loss.backward()
    optimizer.step()
    return float(loss.item()), float(policy_loss.item()), float(value_loss.item())


def run_selfplay(evaluator: Evaluator, cfg: TrainConfig, buffer: ReplayBuffer, rng: np.random.Generator):
    wins = 0
    total_moves = 0
    per_faction = {f: [0, 0] for f in cfg.selfplay.factions}  # faction -> [wins, games]
    for _ in range(cfg.games_per_iter):
        stats = play_self_play_game(evaluator, cfg.selfplay, cfg.mcts, buffer, rng)
        wins += int(stats.black_won)
        total_moves += stats.moves
        pf = per_faction.setdefault(stats.faction, [0, 0])
        pf[0] += int(stats.black_won)
        pf[1] += 1
    return wins, total_moves, per_faction


def main():
    parser = argparse.ArgumentParser(description="IPvGO expert-iteration trainer")
    parser.add_argument("--iterations", type=int)
    parser.add_argument("--games-per-iter", type=int)
    parser.add_argument("--train-steps-per-iter", type=int)
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--simulations", type=int, help="MCTS simulations for self-play")
    parser.add_argument("--channels", type=int)
    parser.add_argument("--blocks", type=int)
    parser.add_argument("--lr", type=float)
    parser.add_argument("--device", type=str)
    parser.add_argument("--checkpoint-dir", type=str)
    parser.add_argument("--resume", type=str, help="checkpoint path to resume from")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--min-buffer", type=int, help="min samples before training starts")
    parser.add_argument("--eval-every", type=int, help="run per-faction eval every N iters (0 disables)")
    args = parser.parse_args()

    cfg = TrainConfig()
    if args.iterations is not None: cfg.iterations = args.iterations
    if args.games_per_iter is not None: cfg.games_per_iter = args.games_per_iter
    if args.train_steps_per_iter is not None: cfg.train_steps_per_iter = args.train_steps_per_iter
    if args.batch_size is not None: cfg.batch_size = args.batch_size
    if args.simulations is not None: cfg.mcts.simulations = args.simulations
    if args.channels is not None: cfg.net.channels = args.channels
    if args.blocks is not None: cfg.net.blocks = args.blocks
    if args.lr is not None: cfg.lr = args.lr
    if args.device is not None: cfg.device = args.device
    if args.checkpoint_dir is not None: cfg.checkpoint_dir = args.checkpoint_dir
    if args.seed is not None: cfg.seed = args.seed
    if args.min_buffer is not None: cfg.min_buffer_to_train = args.min_buffer
    if args.eval_every is not None: cfg.eval_every = args.eval_every

    if cfg.net.in_planes != pyipvgo.NUM_PLANES:
        raise RuntimeError(f"NetConfig.in_planes ({cfg.net.in_planes}) != pyipvgo.NUM_PLANES ({pyipvgo.NUM_PLANES})")

    if cfg.device == "cuda" and not torch.cuda.is_available():
        print("[warn] CUDA not available; falling back to CPU")
        cfg.device = "cpu"
    device = torch.device(cfg.device)

    torch.manual_seed(cfg.seed)
    rng = np.random.default_rng(cfg.seed)

    if args.resume:
        net, _payload = load_checkpoint(args.resume, device)
        print(f"[resume] loaded {args.resume}")
    else:
        net = GoNet(cfg.net).to(device)

    optimizer = torch.optim.Adam(net.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    evaluator = Evaluator(net, device)
    buffer = ReplayBuffer(capacity_per_size=cfg.replay_capacity_per_size)

    os.makedirs(cfg.checkpoint_dir, exist_ok=True)
    print(f"[start] device={device} net(ch={cfg.net.channels},blocks={cfg.net.blocks}) "
          f"sims={cfg.mcts.simulations} games/iter={cfg.games_per_iter}")

    for it in range(1, cfg.iterations + 1):
        t0 = time.time()
        wins, total_moves, per_faction = run_selfplay(evaluator, cfg, buffer, rng)
        sp_time = time.time() - t0

        losses = []
        t1 = time.time()
        if len(buffer) >= cfg.min_buffer_to_train:
            for _ in range(cfg.train_steps_per_iter):
                samples = buffer.sample_batch(cfg.batch_size, rng)
                if samples is None:
                    break
                losses.append(train_step(net, optimizer, _make_batch(samples, device), cfg.value_loss_weight))
        train_time = time.time() - t1

        avg_loss = float(np.mean([l[0] for l in losses])) if losses else float("nan")
        avg_pl = float(np.mean([l[1] for l in losses])) if losses else float("nan")
        avg_vl = float(np.mean([l[2] for l in losses])) if losses else float("nan")
        print(f"[iter {it:04d}] sp_winrate={wins}/{cfg.games_per_iter} "
              f"buffer={len(buffer)} loss={avg_loss:.4f} (pol={avg_pl:.4f} val={avg_vl:.4f}) "
              f"sp={sp_time:.1f}s train={train_time:.1f}s")

        if it % cfg.checkpoint_every == 0:
            save_checkpoint(os.path.join(cfg.checkpoint_dir, "latest.pt"), net, extra={"iteration": it})
            save_checkpoint(os.path.join(cfg.checkpoint_dir, f"iter_{it:04d}.pt"), net, extra={"iteration": it})

        if cfg.eval_every > 0 and it % cfg.eval_every == 0:
            print(f"[eval iter {it:04d}]")
            for faction in cfg.selfplay.factions:
                for size in cfg.selfplay.sizes:
                    res = evaluate_faction(evaluator, faction, size, cfg.eval_games, cfg.eval_simulations,
                                           cfg.selfplay.apply_obstacles, rng)
                    print(f"    {faction:<16} n={size:<2} winrate={res.win_rate:.2%} ({res.black_wins}/{res.games})")

    print("[done]")


if __name__ == "__main__":
    main()
