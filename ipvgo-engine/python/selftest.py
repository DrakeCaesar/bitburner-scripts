"""Smoke test for the pyipvgo bindings (no PyTorch required).

Verifies module import, board generation, feature/mask shapes, environment
stepping, faction moves, and scoring on a few random games.
"""

from __future__ import annotations

import sys

import numpy as np

import pyipvgo


def check(cond: bool, msg: str) -> None:
    if not cond:
        print(f"FAIL: {msg}")
        sys.exit(1)


def main() -> None:
    rng = np.random.default_rng(1234)

    print(f"NUM_PLANES = {pyipvgo.NUM_PLANES}")
    check(pyipvgo.NUM_PLANES == 12, "expected 12 feature planes")

    factions = [
        "Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati",
    ]
    for name in factions:
        ai = pyipvgo.parse_opponent(name)
        check(ai is not None, f"parse_opponent({name!r}) returned None")

    total_games = 0
    for size in (5, 7, 9, 13):
        for name in factions:
            ai = pyipvgo.parse_opponent(name)
            seed_ms = float(rng.integers(0, 30_000_000))
            state = pyipvgo.new_board_state(size, ai, True, seed_ms, int(rng.integers(0, 2**63 - 1)))
            check(state.size == size, f"state.size {state.size} != {size}")
            check(len(state.board) == size, "board column count mismatch")

            planes = np.asarray(pyipvgo.encode_state(state, pyipvgo.Color.Black))
            check(planes.shape == (12, size, size), f"planes shape {planes.shape}")

            mask = np.asarray(pyipvgo.legal_action_mask(state, pyipvgo.Color.Black))
            check(mask.shape == (size * size + 1,), f"mask shape {mask.shape}")
            check(mask[pyipvgo.pass_action(size)] == 1, "pass must be legal")

            # Play a short random game via the environment step.
            move_cap = size * size * 2 + 10
            steps = 0
            while not state.game_over and steps < move_cap:
                legal = np.asarray(pyipvgo.legal_action_mask(state, pyipvgo.Color.Black))
                actions = np.flatnonzero(legal)
                action = int(rng.choice(actions))
                seed = int(rng.integers(0, 2**63 - 1))
                state, terminal, black_value = pyipvgo.step_environment(state, action, seed)
                steps += 1
                if terminal:
                    check(abs(black_value) == 1.0, "terminal value must be +/-1")
                    break

            score = pyipvgo.get_score(state)
            check(score.black_sum >= 0 and score.white_sum >= 0, "scores must be non-negative")
            total_games += 1

    print(f"OK: {total_games} games across sizes x factions, shapes and rules consistent.")


if __name__ == "__main__":
    main()
