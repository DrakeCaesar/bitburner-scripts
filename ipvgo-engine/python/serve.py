"""HTTP inference service for the trained IPvGO agent.

server.js forwards POST /api/ipvgo/move requests here (see the "torch" engine
path). Answers the existing move contract:

  request : { board, history, komi, iterations, playAs, validMoves, opponent? }
  response: { move, iterations, elapsedMs, value, engine }

By default it evaluates the policy net greedily (masked argmax). If the request
includes `opponent` and playAs is Black ("X"), it runs PUCT MCTS (using the
faithful faction AI for White replies), capped at IPVGO_MAX_SIMS simulations.

Cheats are part of the trained policy, but executing them in-game requires
calling ns.go.cheat.* on the client. Since the move contract only carries a
board move / pass, this service masks cheat actions off by default so it always
returns a legal board move or pass. Set IPVGO_ALLOW_CHEATS=1 to additionally
surface a suggested cheat under response["cheat"] (the client may act on it).
"""

from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch

import pyipvgo
import env as envmod
from checkpoint import load_checkpoint
from config import MctsConfig
from env import CheatSettings, EnvState
from evaluator import Evaluator
from mcts import run_mcts

CHECKPOINT = os.environ.get("IPVGO_CHECKPOINT", os.path.join(os.path.dirname(__file__), "checkpoints", "latest.pt"))
PORT = int(os.environ.get("IPVGO_TORCH_PORT", "3011"))
MAX_SIMS = int(os.environ.get("IPVGO_MAX_SIMS", "200"))
DEVICE = os.environ.get("IPVGO_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
ALLOW_CHEATS = os.environ.get("IPVGO_ALLOW_CHEATS", "0") == "1"
CRIME_MULT = float(os.environ.get("IPVGO_CRIME_MULT", "1.0"))
SF_BONUS = float(os.environ.get("IPVGO_SF_BONUS", "0.0"))

_device = torch.device(DEVICE)
_net, _payload = load_checkpoint(CHECKPOINT, _device)
# Cheats disabled in the served evaluator so the policy is restricted to board
# moves + pass (the move contract cannot execute cheats). The net still consumes
# the cheat feature planes (env.encode); they are simply zeroed when disabled.
_settings = CheatSettings(enabled=False)
_evaluator = Evaluator(_net, _device, _settings)
_rng = np.random.default_rng()
print(f"[torch] loaded {CHECKPOINT} (iter={_payload.get('iteration')}) on {DEVICE}; "
      f"max_sims={MAX_SIMS} allow_cheats={ALLOW_CHEATS}", flush=True)


def _opposite(color: str) -> str:
    return "X" if color == "O" else "O"


def _move_from_action(action: int, n: int) -> dict:
    if action == envmod._bases(n)["PASS"]:
        return {"type": "pass"}
    x, y = envmod.action_point(action, n)
    return {"type": "move", "x": x, "y": y}


def _board_pass_mask(state, valid_moves, n: int) -> np.ndarray:
    """Legal mask over the *extended* space but restricted to board moves + pass,
    preferring the game's authoritative validMoves when provided."""
    mask = np.zeros(envmod.action_count(n), dtype=bool)
    base = np.asarray(pyipvgo.legal_action_mask(state, pyipvgo.Color.Black)).astype(bool)
    p = n * n
    if valid_moves:
        for x in range(min(n, len(valid_moves))):
            col = valid_moves[x]
            for y in range(min(n, len(col))):
                if col[y]:
                    mask[x * n + y] = True
    else:
        mask[0:p] = base[0:p]
    mask[envmod._bases(n)["PASS"]] = True  # pass always legal
    return mask


def compute_move(req: dict) -> dict:
    board = req["board"]
    n = len(board)
    history = req.get("history") or []
    komi = float(req.get("komi", 5.5))
    play_as = req.get("playAs", "X")
    valid_moves = req.get("validMoves")
    opponent_name = req.get("opponent")
    requested_iters = int(req.get("iterations", 0) or 0)

    resolved_ai = pyipvgo.parse_opponent(opponent_name) if opponent_name else None
    ai = resolved_ai if resolved_ai is not None else pyipvgo.Opponent.Netburners

    gs = pyipvgo.state_from_board(
        board, ai, _opposite(play_as), 0, [b if isinstance(b, str) else "".join(b) for b in history], komi
    )
    state = EnvState(gs)

    legal = _board_pass_mask(gs, valid_moves, n)

    use_mcts = resolved_ai is not None and play_as == "X" and requested_iters != 0
    sims_used = 0
    if use_mcts:
        sims = MAX_SIMS if requested_iters < 0 else min(requested_iters, MAX_SIMS)
        result = run_mcts(state, _evaluator, MctsConfig(simulations=sims, add_root_noise=False), _rng, _settings)
        sims_used = sims
        policy = result.visit_policy.copy()
        policy[~legal] = 0.0
        action = int(np.argmax(policy)) if policy.sum() > 0 else result.best_action
        value = result.root_value
    else:
        logits, value = _evaluator.evaluate(state)
        masked = np.where(legal, logits, -1e30)
        action = int(np.argmax(masked))

    out = {"move": _move_from_action(action, n), "iterations": sims_used, "value": float(value), "engine": "torch"}

    if ALLOW_CHEATS and play_as == "X":
        out["cheat"] = _suggest_cheat(state, n)
    return out


def _suggest_cheat(state: EnvState, n: int):
    """Best cheat action per the raw policy (cheats enabled), if any is legal.
    Returned for optional client-side execution via ns.go.cheat.*."""
    cheat_settings = CheatSettings(enabled=True, crime_success_mult=CRIME_MULT, source_file_bonus=SF_BONUS)
    logits, _ = Evaluator(_net, _device, cheat_settings).evaluate(state)
    mask = envmod.legal_mask(state, cheat_settings).astype(bool)
    p = n * n
    cheat_only = mask.copy()
    cheat_only[0:p + 1] = False  # exclude board moves + pass
    if not cheat_only.any():
        return None
    masked = np.where(cheat_only, logits, -1e30)
    action = int(np.argmax(masked))
    x, y = envmod.action_point(action, n)
    return {"kind": envmod.action_kind(action, n), "x": x, "y": y,
            "chance": envmod.cheat_chance(state.gs, cheat_settings)}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok", "engine": "torch", "device": DEVICE,
                             "iteration": _payload.get("iteration")})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/move":
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            req = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as exc:
            self._send(400, {"error": f"invalid JSON: {exc}"})
            return
        try:
            t0 = time.time()
            out = compute_move(req)
            out["elapsedMs"] = (time.time() - t0) * 1000.0
            self._send(200, out)
        except Exception as exc:  # noqa: BLE001 - report engine errors to caller
            self._send(500, {"error": str(exc)})

    def log_message(self, *_args):  # silence default stderr logging
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[torch] inference service on http://127.0.0.1:{PORT} (POST /move)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
