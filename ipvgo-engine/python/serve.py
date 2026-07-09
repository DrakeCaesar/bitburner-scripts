"""HTTP inference service for the trained IPvGO agent.

server.js forwards POST /api/ipvgo/move requests here (see the "torch" engine
path). Answers the existing move contract:

  request : { board, history, komi, iterations, playAs, validMoves, opponent? }
  response: { move, iterations, elapsedMs, value, engine }

By default it evaluates the policy net greedily (masked argmax). If the request
includes `opponent` and playAs is Black ("X"), it runs PUCT MCTS (using the
faithful faction AI for White replies), capped at IPVGO_MAX_SIMS simulations.
"""

from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch

import pyipvgo
from checkpoint import load_checkpoint
from config import MctsConfig
from evaluator import Evaluator
from mcts import run_mcts

CHECKPOINT = os.environ.get("IPVGO_CHECKPOINT", os.path.join(os.path.dirname(__file__), "checkpoints", "latest.pt"))
PORT = int(os.environ.get("IPVGO_TORCH_PORT", "3011"))
MAX_SIMS = int(os.environ.get("IPVGO_MAX_SIMS", "200"))
DEVICE = os.environ.get("IPVGO_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")

_device = torch.device(DEVICE)
_net, _payload = load_checkpoint(CHECKPOINT, _device)
_evaluator = Evaluator(_net, _device)
_rng = np.random.default_rng()
print(f"[torch] loaded {CHECKPOINT} (iter={_payload.get('iteration')}) on {DEVICE}; max_sims={MAX_SIMS}")


def _opposite(color: str) -> str:
    return "X" if color == "O" else "O"


def _move_from_action(action: int, n: int) -> dict:
    if action == pyipvgo.pass_action(n):
        return {"type": "pass"}
    return {"type": "move", "x": action // n, "y": action % n}


def _legal_from_request(state, player, valid_moves, n: int) -> np.ndarray:
    """Legal-action mask; prefer the game's authoritative validMoves if given."""
    mask = np.asarray(pyipvgo.legal_action_mask(state, player)).astype(bool)
    if valid_moves:
        provided = np.zeros_like(mask)
        for x in range(min(n, len(valid_moves))):
            col = valid_moves[x]
            for y in range(min(n, len(col))):
                if col[y]:
                    provided[x * n + y] = True
        provided[pyipvgo.pass_action(n)] = True  # pass always legal
        mask = provided
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

    player = pyipvgo.parse_color(play_as)
    resolved_ai = pyipvgo.parse_opponent(opponent_name) if opponent_name else None
    ai = resolved_ai if resolved_ai is not None else pyipvgo.Opponent.Netburners

    state = pyipvgo.state_from_board(
        board, ai, _opposite(play_as), 0, [b if isinstance(b, str) else "".join(b) for b in history], komi
    )

    legal = _legal_from_request(state, player, valid_moves, n)

    use_mcts = resolved_ai is not None and play_as == "X" and requested_iters != 0
    sims_used = 0
    if use_mcts:
        sims = MAX_SIMS if requested_iters < 0 else min(requested_iters, MAX_SIMS)
        result = run_mcts(state, _evaluator, MctsConfig(simulations=sims, add_root_noise=False), _rng)
        sims_used = sims
        # Restrict MCTS visit policy to authoritative legal moves.
        policy = result.visit_policy.copy()
        policy[~legal] = 0.0
        action = int(np.argmax(policy)) if policy.sum() > 0 else result.best_action
        value = result.root_value
    else:
        logits, value = _evaluator.evaluate(state)
        masked = np.where(legal, logits, -1e30)
        action = int(np.argmax(masked))

    return {"move": _move_from_action(action, n), "iterations": sims_used, "value": float(value), "engine": "torch"}


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
