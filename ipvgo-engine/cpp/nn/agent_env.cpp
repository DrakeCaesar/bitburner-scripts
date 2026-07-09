#include "agent_env.hpp"

#include <algorithm>
#include <cmath>

#include "environment.hpp"
#include "features.hpp"
#include "opponents.hpp"

namespace ipvgo::nn {

using namespace ipvgo::game;

namespace {

int factionPlaneIndex(Opponent ai) {
  switch (ai) {
    case Opponent::Netburners: return 0;
    case Opponent::SlumSnakes: return 1;
    case Opponent::TheBlackHand: return 2;
    case Opponent::Tetrads: return 3;
    case Opponent::Daedalus: return 4;
    case Opponent::Illuminati: return 5;
    case Opponent::WorldDaemon: return 6;
    default: return -1;
  }
}

StepOutcome whiteReply(const GameState& state, std::mt19937_64& rng) {
  StepOutcome out;
  out.next = state;
  if (out.next.gameOver) {
    out.terminal = true;
    out.blackValue = blackTerminalValue(out.next);
    return out;
  }
  const double whiteSeed = static_cast<double>(rng() % 30000000u);
  MathRandom mr(rng());
  const Play wp = getMove(out.next, Color::White, out.next.ai, whiteSeed, mr);
  if (wp.type == PlayType::Move) {
    if (!makeMove(out.next, wp.x, wp.y, Color::White)) passTurn(out.next, Color::White);
  } else {
    passTurn(out.next, Color::White);
  }
  out.terminal = out.next.gameOver;
  if (out.terminal) out.blackValue = blackTerminalValue(out.next);
  return out;
}

StepResult afterCheat(GameState next, CheatResult result, bool gameOver, std::mt19937_64& rng) {
  StepResult out;
  if (result == CheatResult::Ejected) {
    out.next.gs = std::move(next);
    out.terminal = true;
    out.blackValue = -1.0f;
    return out;
  }
  if (gameOver) {
    out.next.gs = std::move(next);
    out.terminal = true;
    out.blackValue = blackTerminalValue(out.next.gs);
    return out;
  }
  const StepOutcome wr = whiteReply(next, rng);
  out.next.gs = std::move(wr.next);
  out.terminal = wr.terminal;
  out.blackValue = wr.terminal ? wr.blackValue : 0.0f;
  return out;
}

CheatParams toCheatParams(const CheatSettings& s) {
  CheatParams p;
  p.crimeSuccessMult = s.crimeSuccessMult;
  p.sourceFileBonus = s.sourceFileBonus;
  return p;
}

}  // namespace

ActionBases actionBases(int n) {
  const int p = n * n;
  return {p, p, p + 1, 2 * p + 1, 3 * p + 1, 4 * p + 1};
}

int extendedActionCount(int n) { return kPointActionTypes * n * n + 1; }

double cheatChance(const GameState& gs, const CheatSettings& settings) {
  if (!settings.enabled) return 0.0;
  return cheatSuccessChance(gs.cheatCount, toCheatParams(settings));
}

std::vector<float> extendedEncode(const EnvState& env, const CheatSettings& settings) {
  const int n = env.gs.size;
  std::vector<float> out(static_cast<size_t>(kInputPlanes) * n * n, 0.0f);
  const std::vector<float> base = encodeState(env.gs, Color::Black);
  std::copy(base.begin(), base.end(), out.begin());

  const size_t planeStride = static_cast<size_t>(n) * n;
  const size_t cheatBase = static_cast<size_t>(kNumPlanes) * planeStride;
  out[cheatBase + 0] = static_cast<float>(cheatChance(env.gs, settings));
  out[cheatBase + planeStride] = static_cast<float>(std::min(env.gs.cheatCount / 10.0, 1.0));
  if (settings.enabled) {
    for (size_t i = 0; i < planeStride; ++i) out[cheatBase + 2 * planeStride + i] = 1.0f;
  }
  if (env.extraMove) {
    for (size_t i = 0; i < planeStride; ++i) out[cheatBase + 3 * planeStride + i] = 1.0f;
  }

  const int fidx = factionPlaneIndex(env.gs.ai);
  if (fidx >= 0) {
    const size_t factionBase = cheatBase + 4 * planeStride;
    for (size_t i = 0; i < planeStride; ++i) out[factionBase + static_cast<size_t>(fidx) * planeStride + i] = 1.0f;
  }
  return out;
}

std::vector<char> extendedLegalMask(const EnvState& env, const CheatSettings& settings) {
  const int n = env.gs.size;
  const ActionBases b = actionBases(n);
  std::vector<char> mask(extendedActionCount(n), 0);

  const std::vector<char> board = legalActionMask(env.gs, Color::Black);
  for (int i = 0; i < b.P; ++i) mask[i] = board[static_cast<size_t>(i)];

  if (env.extraMove) {
    int legalBoard = 0;
    for (int i = 0; i < b.P; ++i) legalBoard += mask[i];
    if (legalBoard == 0) mask[b.pass] = 1;
    return mask;
  }

  mask[b.pass] = board[static_cast<size_t>(b.P)];

  if (!settings.enabled) return mask;

  int legalBoard = 0;
  for (int x = 0; x < n; ++x) {
    for (int y = 0; y < n; ++y) {
      const char c = env.gs.board[x][y];
      const int idx = x * n + y;
      if (c == 'O') mask[b.remove + idx] = 1;
      if (c == '#') mask[b.repair + idx] = 1;
      if (c != '#') mask[b.destroy + idx] = 1;
      if (mask[idx]) ++legalBoard;
    }
  }
  if (legalBoard >= 2) {
    for (int i = 0; i < b.P; ++i) mask[b.p2m + i] = board[static_cast<size_t>(i)];
  }
  return mask;
}

StepResult extendedStep(const EnvState& env, int action, std::mt19937_64& rng, const CheatSettings& settings) {
  const int n = env.gs.size;
  const ActionBases b = actionBases(n);

  if (env.extraMove) {
    const int move = action < b.P ? action : passAction(n);
    const StepOutcome so = stepEnvironment(env.gs, move, rng);
    StepResult out;
    out.next.gs = std::move(so.next);
    out.terminal = so.terminal;
    out.blackValue = so.terminal ? so.blackValue : 0.0f;
    return out;
  }

  if (action < b.P) {
    const StepOutcome so = stepEnvironment(env.gs, action, rng);
    StepResult out;
    out.next.gs = std::move(so.next);
    out.terminal = so.terminal;
    out.blackValue = so.terminal ? so.blackValue : 0.0f;
    return out;
  }
  if (action == b.pass) {
    const StepOutcome so = stepEnvironment(env.gs, passAction(n), rng);
    StepResult out;
    out.next.gs = std::move(so.next);
    out.terminal = so.terminal;
    out.blackValue = so.terminal ? so.blackValue : 0.0f;
    return out;
  }

  const CheatParams cp = toCheatParams(settings);
  const double successRng = std::uniform_real_distribution<double>(0.0, 1.0)(rng);
  const double ejectRng = std::uniform_real_distribution<double>(0.0, 1.0)(rng);

  if (action >= b.remove && action < b.repair) {
    const int idx = action - b.remove;
    const int x = idx / n;
    const int y = idx % n;
    GameState next = env.gs;
    const CheatResult res =
        applyCheat(next, Color::Black, CheatType::RemoveRouter, {{x, y}}, successRng, ejectRng, cp);
    return afterCheat(std::move(next), res, next.gameOver, rng);
  }
  if (action >= b.repair && action < b.destroy) {
    const int idx = action - b.repair;
    const int x = idx / n;
    const int y = idx % n;
    GameState next = env.gs;
    const CheatResult res =
        applyCheat(next, Color::Black, CheatType::RepairOfflineNode, {{x, y}}, successRng, ejectRng, cp);
    return afterCheat(std::move(next), res, next.gameOver, rng);
  }
  if (action >= b.destroy && action < b.p2m) {
    const int idx = action - b.destroy;
    const int x = idx / n;
    const int y = idx % n;
    GameState next = env.gs;
    const CheatResult res =
        applyCheat(next, Color::Black, CheatType::DestroyNode, {{x, y}}, successRng, ejectRng, cp);
    return afterCheat(std::move(next), res, next.gameOver, rng);
  }
  if (action >= b.p2m && action < b.p2m + b.P) {
    const int idx = action - b.p2m;
    const int x = idx / n;
    const int y = idx % n;
    GameState next = env.gs;
    const CheatResult res = beginPlayTwoMoves(next, Color::Black, x, y, successRng, ejectRng, cp);
    if (res == CheatResult::Success && !next.gameOver) {
      StepResult out;
      out.next.gs = std::move(next);
      out.next.extraMove = true;
      return out;
    }
    return afterCheat(std::move(next), res, next.gameOver, rng);
  }

  const StepOutcome so = stepEnvironment(env.gs, passAction(n), rng);
  StepResult out;
  out.next.gs = std::move(so.next);
  out.terminal = so.terminal;
  out.blackValue = so.terminal ? so.blackValue : 0.0f;
  return out;
}

}  // namespace ipvgo::nn
