// Command-line harness for the faithful IPvGO engine.
//
//   ipvgo_game selftest
//       Run built-in rule invariants; exits non-zero on failure.
//   ipvgo_game parity <cases.json>
//       Compare validMoves + score against captured game data.
//   ipvgo_game aimove <in.json> [out.json]
//       Emit the faithful faction AI move for the given position.
//   ipvgo_game gen <opponent> <size> <seedMs> <mathSeed>
//       Print a freshly generated board (obstacles + handicap).
//   ipvgo_game exploitplay <opponent> <size> <games> <depth> <seed> [fixed]
//       Black = policy-expectimax exploiter vs the scripted faction.
//   ipvgo_game exploitmove <in.json> [out.json]
//       Exploiter move for a game request (engine "exploit").
//   ipvgo_game policycheck <opponent> <size> [samples] [seed]
//       Compare the modeled reply distribution against sampled getMove().
//   ipvgo_game optbench [--seconds=S] [--positions=N] [--depth=D] [--reps=R]
//                       [--seed=S] [--only=cfg,...] [--factions=a,b] [--size=N]
//       A/B time each search optimisation against the baseline on one position
//       set, verifying every variant returns the same answer. Without
//       --positions the sweep is sized to run for about --seconds seconds.
//   ipvgo_game bench [budgetMs] [gamesPerFaction] [seed] [size]
//       Exploiter vs every faction with a live terminal view (board, win table).

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include <nlohmann/json.hpp>

#include "analysis.hpp"
#include "bench_tui.hpp"
#include "exploiter.hpp"
#include "features.hpp"
#include "game_engine.hpp"
#include "go_game.hpp"
#include "optbench.hpp"
#include "mcgs.hpp"
#include "obstacles.hpp"
#include "opponents.hpp"
#include "rng.hpp"
#include "setup.hpp"

using namespace ipvgo::game;
using ipvgo::nn::BenchOptions;
using ipvgo::nn::ExploitConfig;
using ipvgo::nn::ExploitResult;
using ipvgo::nn::McgsConfig;
using ipvgo::nn::McgsResult;
using ipvgo::nn::OptBenchOptions;
using ipvgo::nn::runExploitBench;
using ipvgo::nn::runExploitBenchJson;
using ipvgo::nn::runExploiter;
using ipvgo::nn::runMcgs;
using ipvgo::nn::runOptBench;
using json = nlohmann::json;

namespace {

SimpleBoard parseBoard(const json& j) {
  SimpleBoard board(static_cast<int>(j.size()));
  int x = 0;
  for (const auto& col : j) {
    board[x] = col.get<std::string>();
    ++x;
  }
  return board;
}

GameState stateFromRequest(const json& req) {
  GameState state;
  state.board = parseBoard(req.at("board"));
  state.size = static_cast<int>(state.board.size());

  const std::string playAs = req.value("playAs", "X");
  const Color mover = parseColor(playAs);
  state.previousPlayer = oppositeColor(mover);  // it is `mover`'s turn
  state.gameOver = false;
  state.passCount = req.value("passCount", 0);

  if (req.contains("opponent")) {
    if (auto ai = parseOpponent(req.at("opponent").get<std::string>())) state.ai = *ai;
  }
  if (req.contains("komi") && !req.at("komi").is_null()) {
    state.komiOverride = req.at("komi").get<double>();
    state.hasKomiOverride = true;
  }
  if (req.contains("history")) {
    for (const auto& snap : req.at("history")) {
      state.previousBoards.append(parseBoard(snap));
    }
  }
  if (req.contains("opponent")) {
    if (auto ai = parseOpponent(req.at("opponent").get<std::string>())) state.ai = *ai;
  }
  return state;
}

void printBoard(const SimpleBoard& b) {
  const int n = b.size();
  for (int x = 0; x < n; ++x) std::cout << std::string(b[x].data(), static_cast<size_t>(n)) << "\n";
}

// ---- selftest --------------------------------------------------------------

int g_failures = 0;
void check(bool cond, const std::string& label) {
  if (!cond) {
    ++g_failures;
    std::cerr << "FAIL: " << label << "\n";
  } else {
    std::cout << "ok: " << label << "\n";
  }
}

GameState stateFromSimple(const SimpleBoard& board, Color previousPlayer) {
  GameState s;
  s.board = board;
  s.size = static_cast<int>(board.size());
  s.previousPlayer = previousPlayer;
  return s;
}

int runSelftest() {
  // Capture: black plays the last liberty of a surrounded white stone at (2,2).
  {
    SimpleBoard b(5, std::string(5, '.'));
    b[2][2] = 'O';  // white stone
    b[2][1] = 'X';  // south
    b[2][3] = 'X';  // north
    b[1][2] = 'X';  // west
    // east neighbor (3,2) is the last liberty; black plays there.
    GameState s = stateFromSimple(b, Color::White);  // black to move
    const bool ok = makeMove(s, 3, 2, Color::Black);
    check(ok, "capture: move accepted");
    check(s.board[2][2] == '.', "capture: white stone removed");
  }

  // Suicide: filling the last liberty of your own stone with no capture is illegal.
  {
    SimpleBoard b(5, std::string(5, '.'));
    b[2][1] = 'O';
    b[2][3] = 'O';
    b[1][2] = 'O';
    b[3][2] = 'O';  // empty point (2,2) fully surrounded by white
    GameState s = stateFromSimple(b, Color::White);  // black to move
    const Validity v = evaluateIfMoveIsValid(s, 2, 2, Color::Black);
    check(v == Validity::NoSuicide, "suicide: rejected as NoSuicide");
  }

  // Offline node cannot be played.
  {
    SimpleBoard b(5, std::string(5, '.'));
    b[0][0] = '#';
    GameState s = stateFromSimple(b, Color::White);
    check(evaluateIfMoveIsValid(s, 0, 0, Color::Black) == Validity::PointBroken, "offline: PointBroken");
  }

  // Superko: a move recreating any prior board position is illegal.
  {
    SimpleBoard empty(5, std::string(5, '.'));
    GameState s = stateFromSimple(empty, Color::White);  // black to move
    const SimpleBoard afterCorner = evaluateMoveResult(empty, 0, 0, Color::Black);
    s.previousBoards.append(afterCorner);
    check(evaluateIfMoveIsValid(s, 0, 0, Color::Black) == Validity::BoardRepeated,
          "superko: repeated board rejected");
    // A different, non-repeating move is still valid.
    check(evaluateIfMoveIsValid(s, 2, 2, Color::Black) == Validity::Valid, "superko: novel move allowed");
  }

  // Scoring: stones + enclosed empty territory + komi to white.
  {
    SimpleBoard b = {"XXXXX", "X...X", "X.X.X", "X...X", "XXXXX"};
    // Black wall enclosing empties; but center has a black stone. All empties are
    // black territory (single-color enclosure), plus all black stones.
    GameState s = stateFromSimple(b, Color::White);
    s.hasKomiOverride = true;
    s.komiOverride = 5.5;
    const Score sc = getScore(s);
    int blackStones = 0;
    for (int x = 0; x < b.size(); ++x)
      for (int y = 0; y < b.size(); ++y)
        if (b[x][y] == 'X') blackStones++;
    check(sc.blackPieces == blackStones, "scoring: black piece count");
    check(sc.blackTerritory == 8, "scoring: black territory = 8 empties");
    check(sc.komi == 5.5 && sc.whiteSum == 5.5, "scoring: komi applied to white only");
    check(blackWins(sc), "scoring: black wins");
  }

  // Obstacle generation is deterministic for a fixed seed and leaves no offline board.
  {
    MathRandom mr(1);
    GameState a = newBoardState(9, Opponent::Netburners, true, 123456.0, mr);
    MathRandom mr2(1);
    GameState b = newBoardState(9, Opponent::Netburners, true, 123456.0, mr2);
    check(a.board == b.board, "obstacles: deterministic for fixed seed");
    int live = 0;
    for (int x = 0; x < a.board.size(); ++x)
      for (int y = 0; y < a.board.size(); ++y)
        if (a.board[x][y] != '#') live++;
    check(live > 0, "obstacles: some live nodes remain");
    // removeIslands guarantees no empty region of size <= 2 exists in isolation.
    check(a.board.size() == 9 && a.board[0].size() == 9, "obstacles: size preserved");
  }

  // Handicap: Illuminati gets white starting stones; Netburners gets none.
  {
    MathRandom mr(7);
    GameState ill = newBoardState(9, Opponent::Illuminati, false, 0.0, mr);
    int white = 0;
    for (int x = 0; x < ill.board.size(); ++x)
      for (int y = 0; y < ill.board.size(); ++y)
        if (ill.board[x][y] == 'O') white++;
    check(white >= 1, "handicap: Illuminati has white stones");

    MathRandom mr2(7);
    GameState net = newBoardState(9, Opponent::Netburners, false, 0.0, mr2);
    int white2 = 0;
    for (int x = 0; x < net.board.size(); ++x)
      for (int y = 0; y < net.board.size(); ++y)
        if (net.board[x][y] == 'O') white2++;
    check(white2 == 0, "handicap: Netburners has none");
  }

  // World Daemon uses the fixed 19x19 bitverse board with handicap.
  {
    MathRandom mr(3);
    GameState wd = newBoardState(19, Opponent::WorldDaemon, true, 999.0, mr);
    check(wd.size == 19, "wd: board is 19x19");
    int offline = 0;
    for (int x = 0; x < wd.board.size(); ++x)
      for (int y = 0; y < wd.board.size(); ++y)
        if (wd.board[x][y] == '#') offline++;
    check(offline > 0, "wd: has fixed offline nodes");
  }

  // Every faction returns a legal move (or pass) from a mid-game position.
  {
    SimpleBoard b = {".....", ".XO..", ".XO..", ".XO..", "....."};
    GameState s = stateFromSimple(b, Color::Black);  // white (AI) to move
    for (Opponent ai : {Opponent::Netburners, Opponent::SlumSnakes, Opponent::TheBlackHand, Opponent::Tetrads,
                        Opponent::Daedalus, Opponent::Illuminati}) {
      s.ai = ai;
      MathRandom mr(42);
      const Play p = getMove(s, Color::White, ai, 55555.0, mr);
      bool legal = p.type == PlayType::Pass ||
                   (p.type == PlayType::Move && evaluateIfMoveIsValid(s, p.x, p.y, Color::White) == Validity::Valid);
      check(legal, "ai move legal for " + opponentName(ai));
    }
  }

  std::cout << (g_failures ? "\nSELFTEST FAILED\n" : "\nSELFTEST PASSED\n");
  return g_failures ? 1 : 0;
}

// ---- parity ----------------------------------------------------------------

int runParity(const std::string& path) {
  std::ifstream in(path);
  if (!in) {
    std::cerr << "cannot open " << path << "\n";
    return 1;
  }
  json cases;
  in >> cases;

  int mismatches = 0;
  int total = 0;
  for (const auto& tc : cases) {
    ++total;
    GameState state = stateFromRequest(tc);
    const Color mover = oppositeColor(state.previousPlayer);

    if (tc.contains("validMoves")) {
      const json& vm = tc.at("validMoves");
      const int N = state.size;
      bool ok = true;
      for (int x = 0; x < N && ok; ++x) {
        for (int y = 0; y < N && ok; ++y) {
          const bool expected = vm[x][y].get<bool>();
          const bool actual = evaluateIfMoveIsValid(state, x, y, mover) == Validity::Valid;
          if (expected != actual) {
            ok = false;
            std::cerr << "case " << (total - 1) << " validMove mismatch at " << x << "," << y << " expected "
                      << expected << " got " << actual << "\n";
          }
        }
      }
      if (!ok) ++mismatches;
    }

    if (tc.contains("score")) {
      const Score sc = getScore(state);
      const double eb = tc.at("score").at("black").get<double>();
      const double ew = tc.at("score").at("white").get<double>();
      if (eb != sc.blackSum || ew != sc.whiteSum) {
        ++mismatches;
        std::cerr << "case " << (total - 1) << " score mismatch: expected B=" << eb << " W=" << ew
                  << " got B=" << sc.blackSum << " W=" << sc.whiteSum << "\n";
      }
    }
  }

  std::cout << "parity: " << (total - mismatches) << "/" << total << " cases matched\n";
  return mismatches ? 1 : 0;
}

// ---- aimove ----------------------------------------------------------------

int runAiMove(const std::string& inPath, const std::string& outPath) {
  std::ifstream in(inPath);
  if (!in) {
    std::cerr << "cannot open " << inPath << "\n";
    return 1;
  }
  json req;
  in >> req;

  GameState state = stateFromRequest(req);
  const Color mover = oppositeColor(state.previousPlayer);
  const double seedMs = req.value("seedMs", 0.0);
  const uint64_t mathSeed = req.value("mathSeed", static_cast<uint64_t>(0));
  MathRandom mr(mathSeed);

  const Play play = getMove(state, mover, state.ai, seedMs, mr);
  json out;
  if (play.type == PlayType::Move) out["move"] = {{"type", "move"}, {"x", play.x}, {"y", play.y}};
  else out["move"] = {{"type", "pass"}};

  const std::string text = out.dump();
  if (!outPath.empty()) {
    std::ofstream(outPath) << text;
  } else {
    std::cout << text << "\n";
  }
  return 0;
}

// ---- mcgsmove (faithful rules + graph search, Black only) ------------------

bool actionAllowed(const json& req, int N, int action) {
  if (!req.contains("validMoves") || req.at("validMoves").is_null()) return true;
  const json& vm = req.at("validMoves");
  if (action == ipvgo::nn::passAction(N)) return true;
  const int x = action / N;
  const int y = action % N;
  if (x < 0 || y < 0 || x >= N || y >= N) return false;
  return vm[x][y].get<bool>();
}

json actionToMoveJson(int N, int action) {
  if (action == ipvgo::nn::passAction(N)) return json{{"type", "pass"}};
  return json{{"type", "move"}, {"x", action / N}, {"y", action % N}};
}

int pickMcgsAction(const McgsResult& result, int N, const json& req) {
  if (actionAllowed(req, N, result.bestAction)) return result.bestAction;

  std::vector<std::pair<float, int>> ranked;
  ranked.reserve(result.visitPolicy.size());
  for (size_t i = 0; i < result.visitPolicy.size(); ++i) {
  const int action = static_cast<int>(i);
    if (!actionAllowed(req, N, action)) continue;
    ranked.emplace_back(result.visitPolicy[i], action);
  }
  if (ranked.empty()) return ipvgo::nn::passAction(N);
  std::sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) { return a.first > b.first; });
  return ranked[0].second;
}

int runMcgsMove(const std::string& inPath, const std::string& outPath) {
  std::ifstream in(inPath);
  if (!in) {
    std::cerr << "cannot open " << inPath << "\n";
    return 1;
  }
  json req;
  in >> req;

  GameState state = stateFromRequest(req);
  const Color mover = whoseTurn(state);
  if (mover != Color::Black) {
    std::cerr << "mcgsmove: playAs must be Black (X); it is not Black's turn\n";
    return 1;
  }

  McgsConfig cfg;
  cfg.playouts = req.value("iterations", 10000);
  cfg.threads = req.value("threads", 0);
  cfg.exploration = req.value("exploration", 0.3);
  cfg.useAiTweaks = req.value("useAiTweaks", true);
  cfg.suppressTransposition = req.value("suppressTransposition", true);
  const uint64_t seed = req.value("seed", static_cast<uint64_t>(0));
  const uint64_t mathSeed = req.value("mathSeed", static_cast<uint64_t>(0));

  const auto t0 = std::chrono::steady_clock::now();
  const McgsResult result = runMcgs(state, cfg, seed, mathSeed);
  const auto ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();

  const int action = pickMcgsAction(result, state.size, req);
  json out;
  out["move"] = actionToMoveJson(state.size, action);
  out["iterations"] = cfg.playouts;
  out["elapsedMs"] = ms;
  out["rootValue"] = result.rootValue;
  out["engine"] = "mcgs";

  const std::string text = out.dump();
  if (!outPath.empty()) {
    std::ofstream fout(outPath);
    fout << text;
  } else {
    std::cout << text << "\n";
  }
  return 0;
}

// ---- mcgsplay (MCGS Black vs scripted faction White) -----------------------

int runMcgsPlay(const std::string& opponentName, int size, int games, int playouts, uint64_t seed) {
  const Opponent ai = parseOpponent(opponentName).value_or(Opponent::Netburners);
  std::mt19937_64 rng(seed ? seed : 1);

  McgsConfig cfg;
  cfg.playouts = playouts;
  cfg.useAiTweaks = false;

  int wins = 0;
  double totalBlackMs = 0.0;
  long totalMoves = 0;

  for (int g = 0; g < games; ++g) {
    const double clockMs = static_cast<double>(rng() % 30000000u);
    const uint64_t mathSeed = rng();
    MathRandom mathRng(mathSeed);
    GameState state = newBoardState(size, ai, true, clockMs, mathRng);
    int whiteMoves = 0;
    const int moveCap = size * size * 4;

    for (int m = 0; m < moveCap && !state.gameOver; ++m) {
      if (whoseTurn(state) != Color::Black) {
        std::cerr << "mcgsplay: expected Black to move\n";
        return 1;
      }

      const auto t0 = std::chrono::steady_clock::now();
      const McgsResult search = runMcgs(state, cfg, static_cast<uint64_t>(rng()), mathSeed, whiteMoves);
      totalBlackMs += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();

      const int action = search.bestAction;
      if (action == ipvgo::nn::passAction(size)) {
        passTurn(state, Color::Black);
      } else {
        const int x = action / size;
        const int y = action % size;
        if (!makeMove(state, x, y, Color::Black)) passTurn(state, Color::Black);
      }
      ++totalMoves;
      if (state.gameOver) break;

      const Play wp = getMove(state, Color::White, ai, 0.0, mathRng);
      ++whiteMoves;
      if (wp.type == PlayType::Pass) {
        passTurn(state, Color::White);
      } else if (!makeMove(state, wp.x, wp.y, Color::White)) {
        passTurn(state, Color::White);
      }
      if (state.gameOver) break;
    }

    const Score sc = getScore(state);
    if (blackWins(sc)) ++wins;
  }

  const double avgMs = totalMoves > 0 ? totalBlackMs / static_cast<double>(totalMoves) : 0.0;
  const double winPct = 100.0 * wins / std::max(games, 1);
  std::cout << "mcgsplay: " << opponentName << " " << size << "x" << size << " "
            << "wins=" << wins << "/" << games << " (" << winPct << "%) "
            << "playouts=" << playouts << " avgBlackThinkMs=" << avgMs << "\n";
  return wins == games ? 0 : 1;
}

// ---- exploitmove (policy-expectimax search, Black only) --------------------

int pickExploitAction(const ExploitResult& result, int N, const json& req) {
  for (const auto& [action, value] : result.rootScores) {
    (void)value;
    if (actionAllowed(req, N, action)) return action;
  }
  return ipvgo::nn::passAction(N);
}

int runExploitMove(const std::string& inPath, const std::string& outPath) {
  std::ifstream in(inPath);
  if (!in) {
    std::cerr << "cannot open " << inPath << "\n";
    return 1;
  }
  json req;
  in >> req;

  GameState state = stateFromRequest(req);
  if (whoseTurn(state) != Color::Black) {
    std::cerr << "exploitmove: playAs must be Black (X); it is not Black's turn\n";
    return 1;
  }

  ExploitConfig cfg;
  cfg.depth = req.value("depth", 4);
  cfg.maxDepth = req.value("maxDepth", 10);
  cfg.beam = req.value("beam", 12);
  cfg.whiteChildren = req.value("whiteChildren", 6);
  cfg.whiteMass = req.value("whiteMass", 0.9);
  cfg.endgameEmpties = req.value("endgameEmpties", 8);
  cfg.nodeBudget = req.value("nodeBudget", 200000);
  cfg.threads = req.value("threads", 0);
  cfg.budgetMs = req.value("budgetMs", 0);
  // `iterations` is what the in-game client sends; treat it as a node budget.
  cfg.nodeLimit = req.value("nodeLimit", 0L);
  if (cfg.nodeLimit <= 0) cfg.nodeLimit = req.value("iterations", 0L);
  if (cfg.nodeLimit > 0) cfg.budgetMs = 0;

  const auto t0 = std::chrono::steady_clock::now();
  const ExploitResult result = runExploiter(state, cfg);
  const auto ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();

  const int action = pickExploitAction(result, state.size, req);
  json out;
  out["move"] = actionToMoveJson(state.size, action);
  out["depth"] = result.depth;
  out["value"] = result.value;
  out["nodes"] = result.nodes;
  out["elapsedMs"] = ms;
  out["engine"] = "exploit";

  const std::string text = out.dump();
  if (!outPath.empty()) {
    std::ofstream fout(outPath);
    fout << text;
  } else {
    std::cout << text << "\n";
  }
  return 0;
}

// ---- exploitplay (exploiter Black vs scripted faction White) ---------------

int runExploitPlay(const std::string& opponentName, int size, int games, int depth, uint64_t seed,
                   bool fixedWhiteSeed, int beam = 0, int whiteChildren = 0) {
  const Opponent ai = parseOpponent(opponentName).value_or(Opponent::Netburners);
  std::mt19937_64 rng(seed ? seed : 1);

  ExploitConfig cfg;
  cfg.depth = depth;
  if (beam > 0) cfg.beam = beam;
  if (whiteChildren > 0) cfg.whiteChildren = whiteChildren;

  int wins = 0;
  double totalBlackMs = 0.0;
  double totalMargin = 0.0;
  long totalMoves = 0;

  for (int g = 0; g < games; ++g) {
    const double clockMs = static_cast<double>(rng() % 30000000u);
    const uint64_t mathSeed = rng();
    MathRandom mathRng(mathSeed);
    GameState state = newBoardState(size, ai, true, clockMs, mathRng);
    const int moveCap = size * size * 4;
    int gameMoves = 0;

    for (int m = 0; m < moveCap && !state.gameOver; ++m) {
      if (whoseTurn(state) != Color::Black) {
        std::cerr << "exploitplay: expected Black to move\n";
        return 1;
      }

      const auto t0 = std::chrono::steady_clock::now();
      const ExploitResult search = runExploiter(state, cfg);
      totalBlackMs +=
          std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();

      const int action = search.bestAction;
      if (std::getenv("IPVGO_TRACE")) {
        const Score probe = getScore(state);
        std::cout << "  g" << g << " m" << m << " B ";
        if (action == ipvgo::nn::passAction(size)) std::cout << "pass";
        else std::cout << (action / size) << "," << (action % size);
        std::cout << " v=" << search.value << " nodes=" << search.nodes << " score=" << probe.blackSum << ":"
                  << probe.whiteSum << "\n";
      }
      if (action == ipvgo::nn::passAction(size)) {
        passTurn(state, Color::Black);
      } else if (!makeMove(state, action / size, action % size, Color::Black)) {
        passTurn(state, Color::Black);
      }
      ++totalMoves;
      ++gameMoves;
      if (state.gameOver) break;

      // A real game reseeds the faction AI from Player.totalPlaytime every move.
      const double whiteSeed = fixedWhiteSeed ? 0.0 : static_cast<double>(rng() % 30000000u);
      const Play wp = getMove(state, Color::White, ai, whiteSeed, mathRng);
      if (std::getenv("IPVGO_TRACE")) {
        std::cout << "      W ";
        if (wp.type == PlayType::Pass) std::cout << "pass";
        else std::cout << wp.x << "," << wp.y;
        std::cout << "\n";
      }
      if (wp.type == PlayType::Pass) {
        passTurn(state, Color::White);
      } else if (!makeMove(state, wp.x, wp.y, Color::White)) {
        passTurn(state, Color::White);
      }
      if (state.gameOver) break;
    }

    const Score sc = getScore(state);
    if (blackWins(sc)) ++wins;
    totalMargin += sc.blackSum - sc.whiteSum;
    if (std::getenv("IPVGO_TRACE")) {
      std::cout << "  game " << g << " black=" << sc.blackSum << " white=" << sc.whiteSum
                << " margin=" << (sc.blackSum - sc.whiteSum) << " blackMoves=" << gameMoves << "\n";
      if (!blackWins(sc)) printBoard(state.board);
    }
  }

  const double avgMs = totalMoves > 0 ? totalBlackMs / static_cast<double>(totalMoves) : 0.0;
  const double winPct = 100.0 * wins / std::max(games, 1);
  const double avgMargin = games > 0 ? totalMargin / static_cast<double>(games) : 0.0;
  std::cout << "exploitplay: " << opponentName << " " << size << "x" << size << " "
            << "wins=" << wins << "/" << games << " (" << winPct << "%) "
            << "depth=" << depth << " beam=" << cfg.beam << " whiteChildren=" << cfg.whiteChildren
            << " avgBlackThinkMs=" << avgMs << " avgMargin=" << avgMargin << "\n";
  return wins == games ? 0 : 1;
}

// ---- policycheck (reply distribution vs sampled getMove) -------------------

int runPolicyCheck(const std::string& opponentName, int size, int samples, uint64_t seed) {
  const Opponent ai = parseOpponent(opponentName).value_or(Opponent::Netburners);
  std::mt19937_64 rng(seed ? seed : 1);

  double maxTv = 0.0;
  double sumTv = 0.0;
  int positions = 0;

  for (int p = 0; p < 4; ++p) {
    MathRandom mathRng(rng());
    GameState state = newBoardState(size, ai, true, static_cast<double>(rng() % 30000000u), mathRng);
    for (int m = 0; m < 8 && !state.gameOver; ++m) {
      if (whoseTurn(state) != Color::Black) break;
      const auto blackMoves = getAllValidMoves(state, Color::Black);
      if (blackMoves.empty()) break;
      const auto [bx, by] = blackMoves[rng() % blackMoves.size()];
      makeMove(state, bx, by, Color::Black);
      if (state.gameOver) break;
      // Stop on White to move so the sampled policy is the one being modeled.
      if (m == 7) break;

      const Play wp = getMove(state, Color::White, ai, static_cast<double>(rng() % 30000000u), mathRng);
      if (wp.type == PlayType::Pass) {
        passTurn(state, Color::White);
      } else if (!makeMove(state, wp.x, wp.y, Color::White)) {
        passTurn(state, Color::White);
      }
    }
    if (state.gameOver || whoseTurn(state) != Color::White) continue;

    const ReplyDist dist = opponentReplyDistribution(state, Color::White, ai);
    std::unordered_map<int, double> modeled;
    for (const auto& reply : dist.replies) {
      const int action = reply.passMove ? -1 : reply.x * size + reply.y;
      modeled[action] += reply.prob;
    }

    std::unordered_map<int, double> empirical;
    for (int s = 0; s < samples; ++s) {
      const Play wp = getMove(state, Color::White, ai, static_cast<double>(rng() % 30000000u), mathRng);
      const int action = wp.type == PlayType::Pass ? -1 : wp.x * size + wp.y;
      empirical[action] += 1.0;
    }

    double tv = 0.0;
    for (const auto& [action, count] : empirical) {
      const double p = count / static_cast<double>(samples);
      const auto it = modeled.find(action);
      tv += std::fabs(p - (it == modeled.end() ? 0.0 : it->second));
    }
    for (const auto& [action, prob] : modeled) {
      if (!empirical.count(action)) tv += prob;
    }
    tv /= 2.0;

    maxTv = std::max(maxTv, tv);
    sumTv += tv;
    ++positions;
  }

  if (positions == 0) {
    std::cerr << "policycheck: no positions sampled\n";
    return 1;
  }
  std::cout << "policycheck: " << opponentName << " size=" << size << " positions=" << positions
            << " samples=" << samples << " maxTV=" << maxTv << " avgTV=" << (sumTv / positions) << "\n";
  return maxTv < 0.1 ? 0 : 1;
}

// Shared by `bench` (--key=value) and `benchjson` (JSON keys) so both entry
// points accept the same search knobs.
bool applyTuningOption(BenchOptions& options, const std::string& key, const std::string& value) {
  if (key == "beam") options.beam = std::stoi(value);
  else if (key == "white-children" || key == "whiteChildren") options.whiteChildren = std::stoi(value);
  else if (key == "white-mass" || key == "whiteMass") options.whiteMass = std::stod(value);
  else if (key == "endgame-empties" || key == "endgameEmpties") options.endgameEmpties = std::stoi(value);
  else if (key == "node-budget" || key == "nodeBudget") options.nodeBudget = std::stol(value);
  else if (key == "max-depth" || key == "maxDepth") options.maxDepth = std::stoi(value);
  else if (key == "depth") options.depth = std::stoi(value);
  else if (key == "threads") options.threads = std::stoi(value);
  else return false;
  return true;
}

// "20000i" is a node budget; a plain number is milliseconds.
void applyBudget(BenchOptions& options, const std::string& budget) {
  if (!budget.empty() && (budget.back() == 'i' || budget.back() == 'n')) {
    options.iterations = std::stol(budget.substr(0, budget.size() - 1));
    options.budgetMs = 0;
  } else {
    options.budgetMs = std::stoi(budget);
  }
}

}  // namespace

// ---- fuzz: self-consistency over full games -------------------------------

int runFuzz(int games, uint64_t seed) {
  std::mt19937_64 rng(seed);
  const std::vector<int> sizes = {5, 7, 9, 13};
  const std::vector<Opponent> factions = {Opponent::Netburners, Opponent::SlumSnakes, Opponent::TheBlackHand,
                                          Opponent::Tetrads,    Opponent::Daedalus,   Opponent::Illuminati};
  long anomalies = 0;
  long totalMoves = 0;

  for (int g = 0; g < games; ++g) {
    const int size = sizes[rng() % sizes.size()];
    const Opponent ai = factions[rng() % factions.size()];
    const double seedMs = static_cast<double>(rng() % 30000000);
    MathRandom mr(rng());
    GameState state = newBoardState(size, ai, true, seedMs, mr);

    const int moveCap = size * size * 4;
    for (int m = 0; m < moveCap && !state.gameOver; ++m) {
      // Black (player) plays a random legal move, else passes.
      const std::vector<std::pair<int, int>> blackMoves = getAllValidMoves(state, Color::Black);
      if (blackMoves.empty()) {
        passTurn(state, Color::Black);
      } else {
        const auto [bx, by] = blackMoves[rng() % blackMoves.size()];
        if (!makeMove(state, bx, by, Color::Black)) {
          ++anomalies;
          std::cerr << "fuzz: getAllValidMoves returned an unplayable Black move\n";
        }
        ++totalMoves;
      }
      if (state.gameOver) break;

      // White (faction AI) responds; its move must be legal.
      const double whiteSeed = static_cast<double>(rng() % 30000000);
      MathRandom wmr(rng());
      const Play wp = getMove(state, Color::White, ai, whiteSeed, wmr);
      if (wp.type == PlayType::Pass) {
        passTurn(state, Color::White);
      } else {
        if (evaluateIfMoveIsValid(state, wp.x, wp.y, Color::White) != Validity::Valid) {
          ++anomalies;
          std::cerr << "fuzz: faction " << opponentName(ai) << " produced an illegal move at " << wp.x << ","
                    << wp.y << "\n";
        } else if (!makeMove(state, wp.x, wp.y, Color::White)) {
          ++anomalies;
          std::cerr << "fuzz: makeMove rejected a supposedly valid White move\n";
        }
        ++totalMoves;
      }

      // Superko invariant: current board must not appear in prior history.
      if (state.previousBoards.contains(state.board)) {
        ++anomalies;
        std::cerr << "fuzz: superko violated (current board seen in history)\n";
        break;
      }
    }

    const Score sc = getScore(state);
    if (sc.blackSum < 0 || sc.whiteSum < 0) {
      ++anomalies;
      std::cerr << "fuzz: negative score\n";
    }
  }

  std::cout << "fuzz: " << games << " games, " << totalMoves << " moves, " << anomalies << " anomalies\n";
  return anomalies ? 1 : 0;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "usage: ipvgo_game "
                 "<selftest|fuzz|parity|aimove|mcgsmove|mcgsplay|exploitmove|exploitplay|policycheck|optbench|gen> ...\n";
    return 2;
  }
  const std::string cmd = argv[1];

  if (cmd == "selftest") return runSelftest();
  if (cmd == "fuzz") return runFuzz(argc >= 3 ? std::stoi(argv[2]) : 200, argc >= 4 ? std::stoull(argv[3]) : 1u);
  if (cmd == "parity" && argc >= 3) return runParity(argv[2]);
  if (cmd == "aimove" && argc >= 3) return runAiMove(argv[2], argc >= 4 ? argv[3] : "");
  if (cmd == "mcgsmove" && argc >= 3) return runMcgsMove(argv[2], argc >= 4 ? argv[3] : "");
  if (cmd == "mcgsplay" && argc >= 6) {
    const int size = std::stoi(argv[3]);
    const int games = std::stoi(argv[4]);
    const int playouts = std::stoi(argv[5]);
    const uint64_t seed = argc >= 7 ? std::stoull(argv[6]) : 0u;
    return runMcgsPlay(argv[2], size, games, playouts, seed);
  }
  if (cmd == "exploitmove" && argc >= 3) return runExploitMove(argv[2], argc >= 4 ? argv[3] : "");
  if (cmd == "exploitplay" && argc >= 6) {
    const int size = std::stoi(argv[3]);
    const int games = std::stoi(argv[4]);
    const int depth = std::stoi(argv[5]);
    const uint64_t seed = argc >= 7 ? std::stoull(argv[6]) : 0u;
    const bool fixedWhite = argc >= 8 && std::string(argv[7]) == "fixed";
    const int beam = argc >= 9 ? std::stoi(argv[8]) : 0;
    const int whiteChildren = argc >= 10 ? std::stoi(argv[9]) : 0;
    return runExploitPlay(argv[2], size, games, depth, seed, fixedWhite, beam, whiteChildren);
  }
  if (cmd == "bench") {
    BenchOptions options;
    std::vector<std::string> pos;
    for (int i = 2; i < argc; ++i) {
      const std::string arg = argv[i];
      if (arg.rfind("--", 0) != 0) {
        pos.push_back(arg);
        continue;
      }
      const size_t eq = arg.find('=');
      const std::string key = arg.substr(2, eq == std::string::npos ? std::string::npos : eq - 2);
      const std::string value = eq == std::string::npos ? "" : arg.substr(eq + 1);
      try {
        if (!applyTuningOption(options, key, value)) {
          std::cerr << "bench: unknown option --" << key << "\n";
          return 2;
        }
      } catch (const std::exception&) {
        std::cerr << "bench: bad value for --" << key << "\n";
        return 2;
      }
    }
    if (pos.size() >= 1) applyBudget(options, pos[0]);
    if (pos.size() >= 2) options.gamesPerFaction = std::stoi(pos[1]);
    if (pos.size() >= 3) options.seed = std::stoull(pos[2]);
    if (pos.size() >= 4) options.size = std::stoi(pos[3]);
    for (size_t i = 4; i < pos.size(); ++i) options.factions.push_back(pos[i]);
    return runExploitBench(options) == 0 ? 0 : 1;
  }
  if (cmd == "benchjson" && argc >= 3) {
    BenchOptions options;
    try {
      const std::string arg = argv[2];
      std::string text = arg;
      if (!arg.empty() && arg.front() != '{') {
        std::ifstream in(arg);
        if (!in) {
          std::cerr << "benchjson: cannot open " << arg << "\n";
          return 2;
        }
        text.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
      }
      const json config = json::parse(text);
      options.size = config.value("size", 5);
      options.budgetMs = config.value("budgetMs", 200);
      options.iterations = config.value("iterations", 0L);
      if (options.iterations > 0) options.budgetMs = 0;
      options.gamesPerFaction = config.value("games", 10);
      options.seed = config.value("seed", static_cast<uint64_t>(1));
      options.depth = config.value("depth", 2);
      options.maxDepth = config.value("maxDepth", 10);
      for (const char* key : {"beam", "whiteChildren", "endgameEmpties", "nodeBudget", "threads"}) {
        if (config.contains(key) && !config.at(key).is_null()) {
          applyTuningOption(options, key, config.at(key).dump());
        }
      }
      if (config.contains("whiteMass") && !config.at("whiteMass").is_null()) {
        applyTuningOption(options, "whiteMass", config.at("whiteMass").dump());
      }
      if (config.contains("factions")) {
        for (const auto& name : config.at("factions")) options.factions.push_back(name.get<std::string>());
      }
    } catch (const std::exception& err) {
      std::cerr << "benchjson: bad config: " << err.what() << "\n";
      return 2;
    }
    return runExploitBenchJson(options) == 0 ? 0 : 1;
  }
  if (cmd == "optbench") {
    OptBenchOptions options;
    for (int i = 2; i < argc; ++i) {
      const std::string arg = argv[i];
      if (arg.rfind("--", 0) != 0) {
        std::cerr << "optbench: unexpected argument " << arg << "\n";
        return 2;
      }
      const size_t eq = arg.find('=');
      const std::string key = arg.substr(2, eq == std::string::npos ? std::string::npos : eq - 2);
      const std::string value = eq == std::string::npos ? "" : arg.substr(eq + 1);
      try {
        if (key == "positions") options.positions = std::stoi(value);
        else if (key == "seconds") options.seconds = std::stod(value);
        else if (key == "depth") options.depth = std::stoi(value);
        else if (key == "reps") options.reps = std::stoi(value);
        else if (key == "seed") options.seed = std::stoull(value);
        else if (key == "size") options.size = std::stoi(value);
        else if (key == "beam") options.beam = std::stoi(value);
        else if (key == "white-children" || key == "whiteChildren") options.whiteChildren = std::stoi(value);
        else if (key == "threads") options.threads = std::stoi(value);
        else if (key == "only") {
          std::stringstream ss(value);
          std::string item;
          while (std::getline(ss, item, ',')) {
            if (!item.empty()) options.only.push_back(item);
          }
        } else if (key == "factions") {
          std::stringstream ss(value);
          std::string item;
          while (std::getline(ss, item, ',')) {
            if (!item.empty()) options.factions.push_back(item);
          }
        } else {
          std::cerr << "optbench: unknown option --" << key << "\n";
          return 2;
        }
      } catch (const std::exception&) {
        std::cerr << "optbench: bad value for --" << key << "\n";
        return 2;
      }
    }
    return runOptBench(options);
  }
  if (cmd == "policycheck" && argc >= 4) {
    const int size = std::stoi(argv[3]);
    const int samples = argc >= 5 ? std::stoi(argv[4]) : 2000;
    const uint64_t seed = argc >= 6 ? std::stoull(argv[5]) : 1u;
    return runPolicyCheck(argv[2], size, samples, seed);
  }
  if (cmd == "gen" && argc >= 6) {
    const auto ai = parseOpponent(argv[2]).value_or(Opponent::Netburners);
    const int size = std::stoi(argv[3]);
    const double seedMs = std::stod(argv[4]);
    const uint64_t mathSeed = static_cast<uint64_t>(std::stoll(argv[5]));
    MathRandom mr(mathSeed);
    GameState s = newBoardState(size, ai, true, seedMs, mr);
    printBoard(s.board);
    return 0;
  }

  std::cerr << "unknown command\n";
  return 2;
}
