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

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "analysis.hpp"
#include "features.hpp"
#include "game_engine.hpp"
#include "go_game.hpp"
#include "mcgs.hpp"
#include "obstacles.hpp"
#include "opponents.hpp"
#include "rng.hpp"
#include "setup.hpp"

using namespace ipvgo::game;
using ipvgo::nn::McgsConfig;
using ipvgo::nn::McgsResult;
using ipvgo::nn::runMcgs;
using json = nlohmann::json;

namespace {

SimpleBoard parseBoard(const json& j) {
  SimpleBoard board;
  for (const auto& col : j) board.push_back(col.get<std::string>());
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
      state.previousBoards.push_back(boardString(parseBoard(snap)));
    }
  }
  if (req.contains("opponent")) {
    if (auto ai = parseOpponent(req.at("opponent").get<std::string>())) state.ai = *ai;
  }
  return state;
}

void printBoard(const SimpleBoard& b) {
  for (const auto& col : b) std::cout << col << "\n";
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
    s.previousBoards.push_back(boardString(afterCorner));
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
    for (const auto& col : b)
      for (char c : col)
        if (c == 'X') blackStones++;
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
    for (const auto& col : a.board)
      for (char c : col)
        if (c != '#') live++;
    check(live > 0, "obstacles: some live nodes remain");
    // removeIslands guarantees no empty region of size <= 2 exists in isolation.
    check(a.board.size() == 9 && a.board[0].size() == 9, "obstacles: size preserved");
  }

  // Handicap: Illuminati gets white starting stones; Netburners gets none.
  {
    MathRandom mr(7);
    GameState ill = newBoardState(9, Opponent::Illuminati, false, 0.0, mr);
    int white = 0;
    for (const auto& col : ill.board)
      for (char c : col)
        if (c == 'O') white++;
    check(white >= 1, "handicap: Illuminati has white stones");

    MathRandom mr2(7);
    GameState net = newBoardState(9, Opponent::Netburners, false, 0.0, mr2);
    int white2 = 0;
    for (const auto& col : net.board)
      for (char c : col)
        if (c == 'O') white2++;
    check(white2 == 0, "handicap: Netburners has none");
  }

  // World Daemon uses the fixed 19x19 bitverse board with handicap.
  {
    MathRandom mr(3);
    GameState wd = newBoardState(19, Opponent::WorldDaemon, true, 999.0, mr);
    check(wd.size == 19, "wd: board is 19x19");
    int offline = 0;
    for (const auto& col : wd.board)
      for (char c : col)
        if (c == '#') offline++;
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
      const std::string cur = boardString(state.board);
      for (size_t i = 0; i < state.previousBoards.size(); ++i) {
        if (state.previousBoards[i] == cur) {
          ++anomalies;
          std::cerr << "fuzz: superko violated (current board seen in history)\n";
          break;
        }
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
    std::cerr << "usage: ipvgo_game <selftest|fuzz|parity|aimove|mcgsmove|mcgsplay|gen> ...\n";
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
