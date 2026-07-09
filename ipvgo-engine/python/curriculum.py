"""Automatic training curriculum: expand board sizes and factions when ready.

Starts on the easiest matchup (Netburners 5x5). After enough iterations, if eval
win rate on the gate matchup clears a threshold, unlock the next step (bigger
board and/or another faction). Cheats stay off until the final step.

No manual babysitting: run train.py with curriculum enabled (default).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

from config import CurriculumConfig, SelfPlayConfig

# Each step: (sizes, factions). Training randomly picks among these.
# Order: master Netburners on growing boards, then add factions one by one.
DEFAULT_STEPS: List[Tuple[List[int], List[str]]] = [
    ([5], ["Netburners"]),
    ([5, 7], ["Netburners"]),
    ([5, 7, 9], ["Netburners"]),
    ([5, 7, 9, 13], ["Netburners"]),
    ([5, 7, 9, 13], ["Netburners", "Slum Snakes"]),
    ([5, 7, 9, 13], ["Netburners", "Slum Snakes", "The Black Hand"]),
    ([5, 7, 9, 13], ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads"]),
    ([5, 7, 9, 13], ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus"]),
    (
        [5, 7, 9, 13],
        ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati"],
    ),
]


@dataclass
class CurriculumState:
    step: int = 0
    iters_at_step: int = 0

    def describe(self, steps: List[Tuple[List[int], List[str]]]) -> str:
        sizes, factions = steps[min(self.step, len(steps) - 1)]
        return f"step {self.step + 1}/{len(steps)} sizes={sizes} factions={factions}"


def active_selfplay_config(base: SelfPlayConfig, step: int,
                           steps: List[Tuple[List[int], List[str]]]) -> SelfPlayConfig:
    """Return a SelfPlayConfig copy restricted to the current curriculum step."""
    idx = min(step, len(steps) - 1)
    sizes, factions = steps[idx]
    return SelfPlayConfig(
        temperature_moves=base.temperature_moves,
        apply_obstacles=base.apply_obstacles,
        sizes=list(sizes),
        factions=list(factions),
    )


def cheats_enabled_for_step(cfg: CurriculumConfig, step: int, num_steps: int,
                            cheats_globally_enabled: bool) -> bool:
    if not cheats_globally_enabled:
        return False
    if not cfg.enabled:
        return cheats_globally_enabled
    if cfg.cheats_on_final_step_only:
        return step >= num_steps - 1
    return True


def should_advance(win_rate: float, cfg: CurriculumConfig, state: CurriculumState,
                   num_steps: int) -> bool:
    if state.step >= num_steps - 1:
        return False
    if state.iters_at_step < cfg.min_iters_per_step:
        return False
    return win_rate >= cfg.advance_win_rate


def unlocked_eval_matrix(step: int, steps: List[Tuple[List[int], List[str]]]
                         ) -> List[Tuple[str, int]]:
    """Faction/size pairs to report in periodic eval (current step only)."""
    sizes, factions = steps[min(step, len(steps) - 1)]
    return [(f, n) for f in factions for n in sizes]
