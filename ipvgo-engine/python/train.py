"""Expert-iteration training loop.

Black = net + PUCT MCTS learns to beat the scripted White faction AIs, and may
use the four cheats as extended actions (see env.py). Each iteration:
(1) generate self-play games into a size-bucketed replay buffer,
(2) run Adam steps on sampled batches,
(3) periodically checkpoint and report per-faction win rates.

Progress is printed live (flushed) during self-play and training so long
iterations show incremental output.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List

import numpy as np
import torch
import torch.nn.functional as F

import pyipvgo
import env as envmod
from checkpoint import load_checkpoint, save_checkpoint
from config import TrainConfig
from curriculum import (
    DEFAULT_STEPS,
    CurriculumState,
    active_selfplay_config,
    cheats_enabled_for_step,
    should_advance,
    unlocked_eval_matrix,
)
from env import CheatSettings
from evaluate import evaluate_faction
from evaluator import Evaluator
from network import GoNet
from replay import ReplayBuffer, Sample
from selfplay import GameStats, play_self_play_game


def log(msg: str) -> None:
    print(msg, flush=True)


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


def _resolve_workers(cfg: TrainConfig) -> int:
    if cfg.selfplay_workers > 0:
        return cfg.selfplay_workers
    return max(1, min(8, os.cpu_count() or 4))


def _play_one_game(seed: int, evaluator: Evaluator, sp_cfg, mcts_cfg, buffer: ReplayBuffer,
                   settings: CheatSettings) -> GameStats:
    rng = np.random.default_rng(seed)
    return play_self_play_game(evaluator, sp_cfg, mcts_cfg, buffer, rng, settings)


def run_selfplay(evaluator: Evaluator, cfg: TrainConfig, sp_cfg, buffer: ReplayBuffer,
                 rng: np.random.Generator, settings: CheatSettings, it: int):
    wins = 0
    total_moves = 0
    cheat_attempts = 0
    ejections = 0
    per_faction = {f: [0, 0] for f in sp_cfg.factions}

    games = cfg.games_per_iter
    workers = _resolve_workers(cfg)
    report_every = max(1, games // 8)
    game_seeds = rng.integers(0, 2**63 - 1, size=games)

    t0 = time.time()
    completed = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(_play_one_game, int(game_seeds[i]), evaluator, sp_cfg, cfg.mcts, buffer, settings)
            for i in range(games)
        ]
        for fut in as_completed(futures):
            stats = fut.result()
            completed += 1
            wins += int(stats.black_won)
            total_moves += stats.moves
            cheat_attempts += stats.cheat_attempts
            ejections += int(stats.ejected)
            pf = per_faction.setdefault(stats.faction, [0, 0])
            pf[0] += int(stats.black_won)
            pf[1] += 1

            if completed % report_every == 0 or completed == games:
                elapsed = time.time() - t0
                rate = completed / elapsed if elapsed > 0 else 0.0
                log(f"[iter {it:04d}] self-play {completed}/{games} "
                    f"win={wins}/{completed} cheats={cheat_attempts} eject={ejections} "
                    f"buffer={len(buffer)} ({rate:.2f} games/s, {workers} workers)")

    return wins, total_moves, per_faction, cheat_attempts, ejections


def run_training(net, optimizer, cfg: TrainConfig, buffer: ReplayBuffer, rng: np.random.Generator,
                 device: torch.device, it: int):
    losses = []
    if len(buffer) < cfg.min_buffer_to_train:
        log(f"[iter {it:04d}] training skipped (buffer {len(buffer)} < {cfg.min_buffer_to_train})")
        return losses

    steps = cfg.train_steps_per_iter
    report_every = max(1, steps // 4)
    for s in range(1, steps + 1):
        samples = buffer.sample_batch(cfg.batch_size, rng)
        if samples is None:
            break
        losses.append(train_step(net, optimizer, _make_batch(samples, device), cfg.value_loss_weight))
        if s % report_every == 0 or s == steps:
            recent = losses[-report_every:]
            log(f"[iter {it:04d}] train {s}/{steps} "
                f"loss={np.mean([l[0] for l in recent]):.4f} "
                f"(pol={np.mean([l[1] for l in recent]):.4f} val={np.mean([l[2] for l in recent]):.4f})")
    return losses


def main():
    parser = argparse.ArgumentParser(description="IPvGO expert-iteration trainer")
    parser.add_argument("--iterations", type=int)
    parser.add_argument("--games-per-iter", type=int)
    parser.add_argument("--train-steps-per-iter", type=int)
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--simulations", type=int, help="MCTS simulations for self-play")
    parser.add_argument("--leaf-batch-size", type=int, help="NN eval batch size inside C++ MCTS")
    parser.add_argument("--channels", type=int)
    parser.add_argument("--blocks", type=int)
    parser.add_argument("--lr", type=float)
    parser.add_argument("--device", type=str)
    parser.add_argument("--checkpoint-dir", type=str)
    parser.add_argument("--resume", type=str, help="checkpoint path to resume from")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--min-buffer", type=int, help="min samples before training starts")
    parser.add_argument("--eval-every", type=int, help="run per-faction eval every N iters (0 disables)")
    parser.add_argument("--no-cheats", action="store_true", help="disable cheat actions during training")
    parser.add_argument("--crime-mult", type=float, help="crime_success multiplier for cheat odds")
    parser.add_argument("--sf-bonus", type=float, help="Source-File 14.3 additive cheat bonus (0 or 0.25)")
    parser.add_argument("--cheat-warmup", type=int,
                        help="iterations trained with cheats OFF before auto-enabling them (0 disables warmup)")
    parser.add_argument("--workers", type=int, help="parallel self-play threads (0=auto, min(8, cpu_count))")
    parser.add_argument("--no-curriculum", action="store_true",
                        help="train on all factions/sizes from the start (no auto expansion)")
    parser.add_argument("--curriculum-advance", type=float,
                        help="gate eval win rate to unlock next step (default 0.12)")
    parser.add_argument("--curriculum-min-iters", type=int,
                        help="minimum iters per curriculum step before advancing")
    args = parser.parse_args()

    cfg = TrainConfig()
    if args.iterations is not None: cfg.iterations = args.iterations
    if args.games_per_iter is not None: cfg.games_per_iter = args.games_per_iter
    if args.train_steps_per_iter is not None: cfg.train_steps_per_iter = args.train_steps_per_iter
    if args.batch_size is not None: cfg.batch_size = args.batch_size
    if args.simulations is not None: cfg.mcts.simulations = args.simulations
    if args.leaf_batch_size is not None: cfg.mcts.leaf_batch_size = args.leaf_batch_size
    if args.channels is not None: cfg.net.channels = args.channels
    if args.blocks is not None: cfg.net.blocks = args.blocks
    if args.lr is not None: cfg.lr = args.lr
    if args.device is not None: cfg.device = args.device
    if args.checkpoint_dir is not None: cfg.checkpoint_dir = args.checkpoint_dir
    if args.seed is not None: cfg.seed = args.seed
    if args.min_buffer is not None: cfg.min_buffer_to_train = args.min_buffer
    if args.eval_every is not None: cfg.eval_every = args.eval_every
    if args.no_cheats: cfg.cheats.enabled = False
    if args.crime_mult is not None: cfg.cheats.crime_success_mult = args.crime_mult
    if args.sf_bonus is not None: cfg.cheats.source_file_bonus = args.sf_bonus
    if args.cheat_warmup is not None: cfg.cheats.warmup_iters = args.cheat_warmup
    if args.workers is not None: cfg.selfplay_workers = args.workers
    if args.no_curriculum: cfg.curriculum.enabled = False
    if args.curriculum_advance is not None: cfg.curriculum.advance_win_rate = args.curriculum_advance
    if args.curriculum_min_iters is not None: cfg.curriculum.min_iters_per_step = args.curriculum_min_iters

    steps = DEFAULT_STEPS
    num_steps = len(steps)

    if cfg.net.in_planes != envmod.NUM_INPUT_PLANES:
        raise RuntimeError(f"NetConfig.in_planes ({cfg.net.in_planes}) != env.NUM_INPUT_PLANES ({envmod.NUM_INPUT_PLANES})")

    if cfg.device == "cuda" and not torch.cuda.is_available():
        log("[warn] CUDA not available; falling back to CPU")
        cfg.device = "cpu"
    device = torch.device(cfg.device)

    torch.manual_seed(cfg.seed)
    rng = np.random.default_rng(cfg.seed)

    full_settings = CheatSettings(enabled=cfg.cheats.enabled, crime_success_mult=cfg.cheats.crime_success_mult,
                                  source_file_bonus=cfg.cheats.source_file_bonus)
    off_settings = CheatSettings(enabled=False)
    warmup = cfg.cheats.warmup_iters if cfg.cheats.enabled else 0

    curriculum = CurriculumState()
    resume_payload: dict = {}

    if args.resume:
        net, resume_payload = load_checkpoint(args.resume, device)
        curriculum.step = int(resume_payload.get("curriculum_step", 0))
        curriculum.iters_at_step = int(resume_payload.get("curriculum_iters_at_step", 0))
        log(f"[resume] loaded {args.resume} ({curriculum.describe(steps)})")
    else:
        net = GoNet(cfg.net).to(device)

    optimizer = torch.optim.Adam(net.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    evaluator = Evaluator(net, device, off_settings)
    buffer = ReplayBuffer(capacity_per_size=cfg.replay_capacity_per_size)

    os.makedirs(cfg.checkpoint_dir, exist_ok=True)
    opening_chance = 100 * pyipvgo.cheat_success_chance(0, full_settings.crime_success_mult,
                                                        full_settings.source_file_bonus)
    if not cfg.cheats.enabled:
        cheat_desc = "off"
    elif cfg.curriculum.enabled and cfg.curriculum.cheats_on_final_step_only:
        cheat_desc = f"final curriculum step only (chance@0={opening_chance:.0f}%)"
    elif warmup > 0:
        cheat_desc = (f"warmup {warmup} iters OFF, then on (crime x{full_settings.crime_success_mult:g}, "
                      f"sf +{full_settings.source_file_bonus:g}, chance@0={opening_chance:.0f}%)")
    else:
        cheat_desc = (f"on (crime x{full_settings.crime_success_mult:g}, "
                      f"sf +{full_settings.source_file_bonus:g}, chance@0={opening_chance:.0f}%)")

    if cfg.curriculum.enabled:
        log(f"[curriculum] auto expansion; gate={cfg.curriculum.gate_faction} "
            f"{cfg.curriculum.gate_size}x{cfg.curriculum.gate_size} "
            f"advance>={cfg.curriculum.advance_win_rate:.0%} "
            f"min_iters={cfg.curriculum.min_iters_per_step}; {curriculum.describe(steps)}")
    else:
        log("[curriculum] disabled (all factions/sizes from start)")

    log(f"[start] device={device} net(ch={cfg.net.channels},blocks={cfg.net.blocks},in={cfg.net.in_planes}) "
        f"sims={cfg.mcts.simulations} leaf_batch={cfg.mcts.leaf_batch_size} games/iter={cfg.games_per_iter} "
        f"workers={_resolve_workers(cfg)} cheats={cheat_desc}")

    def training_settings(iteration: int) -> CheatSettings:
        if cfg.curriculum.enabled:
            on = cheats_enabled_for_step(cfg.curriculum, curriculum.step, num_steps, cfg.cheats.enabled)
            return full_settings if on else off_settings
        return full_settings if (cfg.cheats.enabled and iteration > warmup) else off_settings

    for it in range(1, cfg.iterations + 1):
        sp_cfg = (active_selfplay_config(cfg.selfplay, curriculum.step, steps)
                  if cfg.curriculum.enabled else cfg.selfplay)
        settings = training_settings(it)
        evaluator.settings = settings

        t0 = time.time()
        wins, total_moves, per_faction, cheat_attempts, ejections = run_selfplay(
            evaluator, cfg, sp_cfg, buffer, rng, settings, it)
        sp_time = time.time() - t0

        t1 = time.time()
        losses = run_training(net, optimizer, cfg, buffer, rng, device, it)
        train_time = time.time() - t1

        curriculum.iters_at_step += 1

        avg_loss = float(np.mean([l[0] for l in losses])) if losses else float("nan")
        avg_pl = float(np.mean([l[1] for l in losses])) if losses else float("nan")
        avg_vl = float(np.mean([l[2] for l in losses])) if losses else float("nan")
        cur_tag = f" {curriculum.describe(steps)}" if cfg.curriculum.enabled else ""
        log(f"[iter {it:04d}] DONE winrate={wins}/{cfg.games_per_iter} "
            f"cheats={cheat_attempts} eject={ejections} buffer={len(buffer)} "
            f"loss={avg_loss:.4f} (pol={avg_pl:.4f} val={avg_vl:.4f}) "
            f"sp={sp_time:.1f}s train={train_time:.1f}s{cur_tag}")

        ckpt_extra = {
            "iteration": it,
            "curriculum_step": curriculum.step,
            "curriculum_iters_at_step": curriculum.iters_at_step,
        }
        if it % cfg.checkpoint_every == 0:
            save_checkpoint(os.path.join(cfg.checkpoint_dir, "latest.pt"), net, extra=ckpt_extra)
            save_checkpoint(os.path.join(cfg.checkpoint_dir, f"iter_{it:04d}.pt"), net, extra=ckpt_extra)
            log(f"[iter {it:04d}] checkpoint saved")

        if cfg.eval_every > 0 and it % cfg.eval_every == 0:
            log(f"[eval iter {it:04d}] (cheats OFF)")
            gate = evaluate_faction(
                evaluator, cfg.curriculum.gate_faction, cfg.curriculum.gate_size,
                cfg.curriculum.gate_eval_games, cfg.eval_simulations,
                cfg.selfplay.apply_obstacles, rng, off_settings)
            log(f"    GATE {cfg.curriculum.gate_faction} n={cfg.curriculum.gate_size} "
                f"winrate={gate.win_rate:.2%} ({gate.black_wins}/{gate.games})")

            if cfg.curriculum.enabled and should_advance(gate.win_rate, cfg.curriculum, curriculum, num_steps):
                curriculum.step += 1
                curriculum.iters_at_step = 0
                log(f"[curriculum] ADVANCED -> {curriculum.describe(steps)}")
                if curriculum.step >= num_steps - 1 and cfg.cheats.enabled:
                    log("[curriculum] cheats ENABLED (final step)")

            eval_pairs = (unlocked_eval_matrix(curriculum.step, steps)
                          if cfg.curriculum.enabled
                          else [(f, n) for f in cfg.selfplay.factions for n in cfg.selfplay.sizes])
            for faction, size in eval_pairs:
                if faction == cfg.curriculum.gate_faction and size == cfg.curriculum.gate_size:
                    res = gate
                else:
                    res = evaluate_faction(evaluator, faction, size, cfg.eval_games, cfg.eval_simulations,
                                           cfg.selfplay.apply_obstacles, rng, off_settings)
                log(f"    {faction:<16} n={size:<2} winrate={res.win_rate:.2%} "
                    f"({res.black_wins}/{res.games})")

    log("[done]")


if __name__ == "__main__":
    main()
