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
//   ipvgo_game profileworkload [games] [seed]
//   ipvgo_game prof [faction] [boardSize] [games] [nodeLimit]   (x64-Profile build only)
//       Repeatable, approximately one-minute Release workload for CPU profiling.
//   ipvgo_game exploitmove <in.json> [out.json]
//       Exploiter move for a game request (engine "exploit").
//   ipvgo_game serve
//       Long-lived engine: one JSON request per stdin line, one JSON response per
//       stdout line, with the search session kept alive across requests.
//   ipvgo_game policycheck <opponent> <size> [samples] [seed]
//       Compare the modeled reply distribution against sampled getMove().
//   ipvgo_game optbench [--seconds=S] [--positions=N] [--depth=D] [--reps=R]
//                       [--seed=S] [--factions=a,b] [--size=N]
//       Time fixed-depth searches on one reproducible position set (the node
//       count and value are printed so runs can be compared across builds).
//       Without --positions the sweep is sized to run for about --seconds seconds.
//   ipvgo_game bench [budgetMs] [gamesPerFaction] [seed] [size]
//       Exploiter vs every faction with a live terminal view (board, win table).

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include <nlohmann/json.hpp>

#include "analysis.hpp"
#include "bench_tui.hpp"
#include "exploiter.hpp"
#include "features.hpp"
#include "game_engine.hpp"
#include "go_game.hpp"
#include "safety.hpp"
#include "patterns.hpp"
#include "influence.hpp"
#include "optbench.hpp"
#include "profiler.hpp"
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

  // The bitwise capture sweep must agree with the reference flood fill on
  // arbitrary positions, including dead chains that predate the move (obstacle
  // and handicap generation can leave those).
  {
    std::mt19937_64 rng(20260101);
    const char alphabet[] = {'.', '.', '.', '.', 'X', 'X', 'O', 'O', '#'};
    long mismatches = 0;
    long checked = 0;
    for (int trial = 0; trial < 200; ++trial) {
      const int n = 5 + 2 * static_cast<int>(rng() % 3);  // 5, 7, 9
      SimpleBoard board(n);
      for (int x = 0; x < n; ++x)
        for (int y = 0; y < n; ++y) board[x][y] = alphabet[rng() % sizeof(alphabet)];
      for (int x = 0; x < n; ++x) {
        for (int y = 0; y < n; ++y) {
          if (board[x][y] != '.') continue;
          for (Color player : {Color::Black, Color::White}) {
            SimpleBoard reference = board;
            reference[x][y] = colorChar(player);
            updateCapturesFloodFill(reference, player);
            ++checked;
            if (reference != evaluateMoveResult(board, x, y, player)) ++mismatches;
          }
        }
      }
    }
    check(mismatches == 0, "capture: bitwise sweep matches the flood fill (" + std::to_string(checked) + " cases)");
  }

  // Make/unmake must restore a GameState exactly, or the search that mutates one
  // state in place would silently drift.
  {
    std::mt19937_64 rng(424242);
    const char alphabet[] = {'.', '.', '.', '.', 'X', 'X', 'O', 'O', '#'};
    long mismatches = 0;
    long checked = 0;
    for (int trial = 0; trial < 120; ++trial) {
      const int n = 5 + 2 * static_cast<int>(rng() % 3);
      SimpleBoard board(n);
      for (int x = 0; x < n; ++x)
        for (int y = 0; y < n; ++y) board[x][y] = alphabet[rng() % sizeof(alphabet)];
      GameState state = stateFromSimple(board, Color::White);
      const GameState before = state;
      for (int x = 0; x < n; ++x) {
        for (int y = 0; y < n; ++y) {
          MoveUndo undo;
          if (!applyMove(state, x, y, Color::Black, undo)) continue;
          ++checked;
          undoMove(state, undo);
          if (state.board != before.board || state.previousPlayer != before.previousPlayer ||
              state.passCount != before.passCount || state.gameOver != before.gameOver ||
              state.previousBoards.size() != before.previousBoards.size()) {
            ++mismatches;
          }
        }
      }
      MoveUndo undo;
      applyPass(state, Color::Black, undo);
      undoMove(state, undo);
      ++checked;
      if (state.previousPlayer != before.previousPlayer || state.passCount != before.passCount) ++mismatches;
    }
    check(mismatches == 0, "make/unmake restores the state (" + std::to_string(checked) + " cases)");
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

  // ---- Static safety analysis (Benson / vital) ---------------------------
  {
    auto countSafe = [&](const SimpleBoard& b, Color c, bool vital) {
      const ChainSet cs = computeChains(b);
      const SafetyResult r = analyzeSafety(b, cs, c, vital);
      int chains = 0;
      for (int i = 0; i < cs.count; ++i) {
        if (cs.chainColor[i] == colorChar(c) && r.safe(i)) ++chains;
      }
      return chains;
    };

    // Two separate one-point eyes: pass-alive. Columns are columns, so the
    // board below is a 5x3 wall with holes at (1,1) and (3,1).
    const SimpleBoard twoEyes = {
        "XXX.....", "X.X.....", "XXX.....", "X.X.....", "XXX.....",
        "........", "........", "........",
    };
    check(countSafe(twoEyes, Color::Black, false) == 1, "benson: a group with two real eyes is pass-alive");

    // The same wall with one hole: White can throw in at the second point, so it
    // is not pass-alive. This is the case the evaluator used to over-credit.
    const SimpleBoard oneEye = {
        "XXX.....", "X.X.....", "XXX.....", "........", "........",
        "........", "........", "........",
    };
    check(countSafe(oneEye, Color::Black, false) == 0, "benson: one eye is not pass-alive");

    // A 2x2 eye space is a single region, not two eyes - the opponent can play
    // inside and make a dead shape, so it must not count as alive.
    const SimpleBoard falseEye = {
        ".XX.....", "X..X....", "X..X....", ".XX.....",
        "........", "........", "........", "........",
    };
    check(countSafe(falseEye, Color::Black, false) == 0, "benson: a 2x2 eye space is not two eyes");

    // A scattered group with no eyes at all must not be pass-alive - this is the
    // exact situation that made the 7x7 Netburners loss look like a win.
    const SimpleBoard scattered = {
        "X.X.X...", ".O.O....", "X.X.X...", "........",
        "........", "........", "........", "........",
    };
    check(countSafe(scattered, Color::Black, false) == 0, "benson: scattered stones are not pass-alive");
    check(countSafe(scattered, Color::White, false) == 0, "benson: the opponent's scattered stones are not either");

    // Benson must never claim life for a dead-looking group even with the vital
    // extension: the extension only ever adds chains, never removes them.
    check(countSafe(twoEyes, Color::Black, true) >= countSafe(twoEyes, Color::Black, false),
          "vital: never weaker than benson");
  }

  // ---- Influence operator (Bouzy dilation) -------------------------------
  {
    // What this operator gives is reach: how far a colour's influence extends. It
    // does NOT measure strength - a scattered group and a connected one of the
    // same size reach about as far - which is why using it to price connection did
    // not work. The tests below pin down what it does promise.
    const SimpleBoard none = {
        "........", "........", "........", "........",
        "........", "........", "........", "........",
    };
    check(ipvgo::game::computeInfluence(none, 5).diff() == 0, "influence: an empty board is neutral");

    const SimpleBoard lone = {
        "........", "........", "........", "........",
        "....X...", "........", "........", "........",
    };
    const ipvgo::game::Influence li = ipvgo::game::computeInfluence(lone, 5);
    const int stone = flatIndex(8, 4, 4);
    const int adjacent = flatIndex(8, 4, 5);
    const int far = flatIndex(8, 0, 0);
    check(li.value[static_cast<size_t>(stone)] > 0, "influence: a stone seeds its own point");
    check(li.value[static_cast<size_t>(adjacent)] > li.value[static_cast<size_t>(far)],
          "influence: influence is stronger next to a stone than far from it");
    check(li.diff() > 0, "influence: a lone black stone is positive");

    // The opponent's field must have the opposite sign.
    const SimpleBoard both = {
        "........", "........", "........", "........",
        "....X...", "........", "........", "........",
    };
    SimpleBoard mixed = both;
    mixed[1][1] = 'O';
    const ipvgo::game::Influence mi = ipvgo::game::computeInfluence(mixed, 5);
    check(mi.value[static_cast<size_t>(flatIndex(8, 1, 1))] < 0, "influence: a white stone is negative");
  }

  // ---- Pattern matcher: the bitset version must equal the slow oracle --------
  {
    std::mt19937_64 rng(20260101ULL);
    long checkedCells = 0;
    long mismatches = 0;
    long matched = 0;
    for (int board = 0; board < 240; ++board) {
      const int n = 5 + static_cast<int>(rng() % 5) * 2;  // 5,7,9,11,13
      SimpleBoard b(n);
      for (int x = 0; x < n; ++x) {
        for (int y = 0; y < n; ++y) {
          const uint64_t r = rng() % 100;
          // Skew towards stones so patterns actually fire; keep some obstacles.
          b[x][y] = r < 38 ? 'X' : r < 72 ? 'O' : r < 76 ? '#' : '.';
        }
      }
      for (int x = 0; x < n; ++x) {
        for (int y = 0; y < n; ++y) {
          for (Color c : {Color::Black, Color::White}) {
            const bool fast = matchesAnyPattern(b, x, y, c);
            const bool slow = matchesAnyPatternSlow(b, x, y, c);
            if (fast != slow) ++mismatches;
            if (fast) ++matched;
            ++checkedCells;
          }
        }
      }
    }
    check(mismatches == 0, "pattern matching: bitset agrees with the oracle (" + std::to_string(checkedCells) +
                               " cells, " + std::to_string(matched) + " matches)");

    // A pattern that must fire: a hane shape in the corner.
    const SimpleBoard hane = {
        "OX......", "........", "........", "........", "........",
        "........", "........", "........",
    };
    check(matchesAnyPattern(hane, 1, 0, Color::White) == matchesAnyPatternSlow(hane, 1, 0, Color::White),
          "pattern matching: corner hane agrees");
  }

  // ---- Liberty queries: the bit-plane answers must equal the chain reference ---
  {
    std::mt19937_64 rng(20260202ULL);
    long checkedPoints = 0;
    long mismatches = 0;
    long foundWeakest = 0;
    for (int board = 0; board < 160; ++board) {
      const int n = 5 + static_cast<int>(rng() % 8) * 2;  // 5,7,9,11,13,17,19
      SimpleBoard b(n);
      for (int x = 0; x < n; ++x) {
        for (int y = 0; y < n; ++y) {
          const uint64_t r = rng() % 100;
          b[x][y] = r < 40 ? 'X' : r < 74 ? 'O' : r < 78 ? '#' : '.';
        }
      }
      const ChainSet cs = computeChains(b);
      const BoardBits bits(b);
      for (int x = 0; x < n; ++x) {
        for (int y = 0; y < n; ++y) {
          if (b[x][y] != '.') continue;
          for (const Color side : {Color::Black, Color::White}) {
            // effectiveLibertyCount against the chain implementation that builds
            // the whole merged chain.
            const int fast = bits.effectiveLibertyCount(x, y, side);
            const int reference = static_cast<int>(findEffectiveLibertiesOfNewMove(b, x, y, side).size());
            if (fast != reference) {
              ++mismatches;
              if (mismatches <= 5) {
                std::cerr << "selftest: effectiveLibertyCount mismatch at " << n << "x" << n << " (" << x << ","
                          << y << ") " << (side == Color::Black ? "black" : "white") << ": fast " << fast
                          << ", reference " << reference << "\n"
                          << boardString(b) << "\n";
              }
            }
            const int minFast = bits.minAdjacentLibertyCount(x, y, side);
            const int minReference = findMinLibertyCountOfAdjacentChains(b, x, y, side);
            if (minFast != minReference) {
              ++mismatches;
              if (mismatches <= 5) {
                std::cerr << "selftest: minAdjacentLibertyCount mismatch at " << n << "x" << n << " (" << x
                          << "," << y << ") " << (side == Color::Black ? "black" : "white") << ": fast "
                          << minFast << ", reference " << minReference << "\n"
                          << boardString(b) << "\n";
              }
            }
            // The chain queries the move generators use now: same answers, read
            // out of the chain set instead of a word flood.
            const int chainFast = chainEffectiveLiberties(cs, x, y, side);
            if (chainFast != reference) {
              ++mismatches;
              if (mismatches <= 5) {
                std::cerr << "selftest: chainEffectiveLiberties mismatch at " << n << "x" << n << " (" << x
                          << "," << y << ") " << (side == Color::Black ? "black" : "white") << ": chain "
                          << chainFast << ", reference " << reference << "\n"
                          << boardString(b) << "\n";
              }
            }
            const int chainMin = chainMinAdjacentLiberties(cs, x, y, side);
            if (chainMin != minReference) {
              ++mismatches;
              if (mismatches <= 5) {
                std::cerr << "selftest: chainMinAdjacentLiberties mismatch at " << n << "x" << n << " (" << x
                          << "," << y << ") " << (side == Color::Black ? "black" : "white") << ": chain "
                          << chainMin << ", reference " << minReference << "\n"
                          << boardString(b) << "\n";
              }
            }
            const BoardBits::Weakest weakest = bits.weakestAdjacent(cs, x, y, side);
            const WeakestChain referenceWeakest = findEnemyNeighborChainWithFewestLiberties(b, x, y, side);
            const int referenceLength = referenceWeakest.found ? referenceWeakest.length : 0;
            const int referenceLiberties =
                referenceWeakest.found ? static_cast<int>(referenceWeakest.liberties.size()) : 0;
            if (weakest.found != referenceWeakest.found || weakest.stones != referenceLength ||
                weakest.liberties != referenceLiberties) {
              ++mismatches;
              if (mismatches <= 5) {
                std::cerr << "selftest: weakestAdjacent mismatch at " << n << "x" << n << " (" << x << ","
                          << y << "): fast " << weakest.found << "/" << weakest.stones << "/"
                          << weakest.liberties << ", reference " << referenceWeakest.found << "/"
                          << referenceLength << "/" << referenceLiberties << "\n"
                          << boardString(b) << "\n";
              }
            }
            const WeakestAdjacent chainWeakest = chainWeakestAdjacent(cs, x, y, side);
            if (chainWeakest.found != weakest.found || chainWeakest.stones != weakest.stones ||
                chainWeakest.liberties != weakest.liberties ||
                chainWeakest.libertyGroups != weakest.libertyGroups) {
              ++mismatches;
              if (mismatches <= 5) {
                std::cerr << "selftest: chainWeakestAdjacent mismatch at " << n << "x" << n << " (" << x << ","
                          << y << "): chain " << chainWeakest.found << "/" << chainWeakest.stones << "/"
                          << chainWeakest.liberties << "/" << chainWeakest.libertyGroups << ", bit planes "
                          << weakest.found << "/" << weakest.stones << "/" << weakest.liberties << "/"
                          << weakest.libertyGroups << "\n"
                          << boardString(b) << "\n";
              }
            }
            if (weakest.found) ++foundWeakest;
            ++checkedPoints;
          }
        }
      }
    }
    check(mismatches == 0, "liberty queries: chain and bit-plane answers agree with the reference (" +
                               std::to_string(checkedPoints) + " queries, " +
                               std::to_string(foundWeakest) + " with an adjacent chain)");
  }

  // ---- Region border flags: the chain pass records what the leaf eval reads ----
  {
    std::mt19937_64 rng(20260404ULL);
    long regions = 0;
    long mismatches = 0;
    for (int board = 0; board < 120; ++board) {
      const int n = 5 + static_cast<int>(rng() % 8) * 2;  // 5,7,9,11,13,17,19
      SimpleBoard b(n);
      for (int x = 0; x < n; ++x) {
        for (int y = 0; y < n; ++y) {
          const uint64_t r = rng() % 100;
          b[x][y] = r < 40 ? 'X' : r < 74 ? 'O' : r < 78 ? '#' : '.';
        }
      }
      const ChainSet cs = computeChains(b);
      for (int c = 0; c < cs.count; ++c) {
        if (cs.chainColor[c] != '.') continue;
        ++regions;
        uint8_t expected = 0;
        for (const int idx : cs.members(c)) {
          for (const int nIdx : onBoardNeighbors(n, idx / n, idx % n)) {
            const char nc = b[nIdx / n][nIdx % n];
            if (nc == 'X') expected |= 1;
            else if (nc == 'O') expected |= 2;
          }
        }
        if (cs.border[static_cast<size_t>(c)] != expected) {
          ++mismatches;
          if (mismatches <= 5) {
            std::cerr << "selftest: region border mismatch at " << n << "x" << n << " chain " << c << ": recorded "
                      << static_cast<int>(cs.border[static_cast<size_t>(c)]) << ", expected "
                      << static_cast<int>(expected) << "\n"
                      << boardString(b) << "\n";
          }
        }
      }
    }
    check(mismatches == 0, "region border flags agree with a member scan (" + std::to_string(regions) + " regions)");
  }

  // ---- Chain arrays: the worst case must fit their capacity ---------------------
  {
    // A checkerboard is the worst case for the liberty arrays: every stone is its own
    // chain, so each empty point contributes four (chain, liberty) pairs. At 19x19
    // that is 368 pairs - the arrays were sized kMaxPoints (361) and this overflowed.
    constexpr int kSize = 19;
    SimpleBoard b(kSize);
    for (int x = 0; x < kSize; ++x)
      for (int y = 0; y < kSize; ++y) b[x][y] = ((x + y) % 2 == 0) ? 'X' : '.';
    const ChainSet cs = computeChains(b);
    long pairs = 0;
    bool consistent = true;
    for (int c = 0; c < cs.count; ++c) {
      const int liberties = cs.libertyCount(c);
      if (liberties < 0) consistent = false;
      pairs += liberties;
      for (const int lib : cs.liberties(c))
        if (lib < 0 || lib >= kSize * kSize || b[lib / kSize][lib % kSize] != '.') consistent = false;
    }
    check(consistent && pairs > ChainSet::kMaxPoints && pairs <= ChainSet::kMaxLiberties,
          "chain arrays: worst case 19x19 fits (" + std::to_string(pairs) + " liberty pairs, capacity " +
              std::to_string(ChainSet::kMaxLiberties) + ")");
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

// Computes one Black move from a game request. Shared by `exploitmove` (one
// process per move) and `serve` (one process for a whole game or session, which
// is what lets the search reuse positions from earlier moves).
json computeExploitMoveJson(const json& req, ipvgo::nn::SearchSession* session,
                            const std::atomic<bool>* cancel = nullptr) {
  // A new game restarts the move history, so a history that shrank since the last
  // request means the cached positions belong to a game that is over. Speculative
  // (cancellable) searches must not move that marker.
  if (session != nullptr && cancel == nullptr && req.contains("history") && req.at("history").is_array()) {
    session->noteRequest(req.at("history").size());
  }
  GameState state = stateFromRequest(req);
  if (whoseTurn(state) != Color::Black) {
    return json{{"error", "playAs must be Black (X); it is not Black's turn"}};
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
  cfg.whiteWorstCase = req.value("whiteWorstCase", false);
  cfg.adaptiveWidth = req.value("adaptiveWidth", true);
  cfg.nodeLimit = req.value("nodeLimit", 0L);
  if (cfg.nodeLimit <= 0) cfg.nodeLimit = req.value("iterations", 0L);
  if (cfg.nodeLimit > 0) cfg.budgetMs = 0;
  cfg.cancel = cancel;
  cfg.carry = req.value("carry", false);
  // Play uses the faster dynamic root scheduler; IPVGO_DETERMINISTIC=1 pins the
  // round-robin split for a repeatable session.
  cfg.deterministic = std::getenv("IPVGO_DETERMINISTIC") != nullptr;

  const auto t0 = std::chrono::steady_clock::now();
  const ExploitResult result = runExploiter(state, cfg, nullptr, session);
  if (result.cancelled) return json{{"cancelled", true}};
  const auto ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();

  const int action = pickExploitAction(result, state.size, req);
  json out;
  out["move"] = actionToMoveJson(state.size, action);
  out["depth"] = result.depth;
  out["value"] = result.value;
  out["nodes"] = result.nodes;
  out["elapsedMs"] = ms;
  out["memoHits"] = result.memoHits;
  out["reusedHits"] = result.memoReusedHits;
  out["cachedEntries"] = result.cachedEntries;
  out["sessionResets"] = result.sessionResets;
  out["engine"] = "exploit";
  return out;
}

int runExploitMove(const std::string& inPath, const std::string& outPath) {
  std::ifstream in(inPath);
  if (!in) {
    std::cerr << "cannot open " << inPath << "\n";
    return 1;
  }
  json req;
  in >> req;

  const json out = computeExploitMoveJson(req, nullptr);
  if (out.contains("error")) {
    std::cerr << "exploitmove: " << out["error"].get<std::string>() << "\n";
    return 1;
  }

  const std::string text = out.dump();
  if (!outPath.empty()) {
    std::ofstream fout(outPath);
    fout << text;
  } else {
    std::cout << text << "\n";
  }
  return 0;
}

// ---- pondering ---------------------------------------------------------------
//
// The game pads White's reply with a delay, and the opponent policy itself is
// instant, so the engine is idle for most of that wait. A "ponder" request tells
// it which move Black just played; it then searches the position after each of
// White's likeliest replies and keeps the answers. When the real request for the
// position that actually arose comes in, an identical search is already finished.
//
// The speculative request is built the way the game would report the position
// (newest history entry first, no passCount), so its position key matches the
// key of the real request exactly.

json boardToJson(const SimpleBoard& board) {
  json out = json::array();
  const int n = static_cast<int>(board.size());
  for (int x = 0; x < n; ++x) out.push_back(std::string(board.column(x), static_cast<size_t>(n)));
  return out;
}

// Everything in a request, other than the position, that changes what the search returns.
std::string searchConfigKey(const json& req) {
  static const char* const fields[] = {"depth",          "maxDepth",       "beam",         "whiteChildren",
                                       "whiteMass",      "endgameEmpties", "nodeBudget",   "threads",
                                       "budgetMs",       "whiteWorstCase", "adaptiveWidth", "nodeLimit",
                                       "iterations",     "opponent",       "komi",         "playAs",
                                       "carry"};
  json key = json::object();
  for (const char* field : fields) {
    if (req.contains(field)) key[field] = req.at(field);
  }
  return key.dump();
}

uint64_t ponderKey(const json& req) {
  const GameState state = stateFromRequest(req);
  return ipvgo::nn::fnv1a64(ipvgo::nn::positionKey(state),
                            static_cast<uint64_t>(std::hash<std::string>{}(searchConfigKey(req))));
}

bool servedMoveAllowed(const json& req, const json& served) {
  const json& move = served.at("move");
  if (move.value("type", "") != "move") return true;
  const int N = static_cast<int>(req.at("board").size());
  return actionAllowed(req, N, move.at("x").get<int>() * N + move.at("y").get<int>());
}

class Ponderer {
 public:
  explicit Ponderer(ipvgo::nn::SearchSession* session) : session_(session) {}
  ~Ponderer() { stop(); }

  // Results are only touched by the worker while it runs, so they are read after stop().
  std::unordered_map<uint64_t, json> results;

  void start(const json& req) {
    stop();
    results.clear();
    worker_ = std::thread([this, req] {
      try {
        run(req);
      } catch (const std::exception&) {
        // Speculation is best effort; the real request recomputes anything missing.
      }
    });
  }

  void stop() {
    if (worker_.joinable()) {
      cancel_.store(true);
      worker_.join();
    }
    cancel_.store(false);
  }

 private:
  void run(const json& req) {
    const GameState state = stateFromRequest(req);
    if (whoseTurn(state) != Color::Black) return;

    const json& ourMove = req.at("ourMove");
    const bool blackMoved = ourMove.value("type", "") == "move";
    GameState afterBlack = state;
    if (blackMoved) {
      if (!makeMove(afterBlack, ourMove.at("x").get<int>(), ourMove.at("y").get<int>(), Color::Black)) return;
    } else {
      passTurn(afterBlack, Color::Black);
    }
    if (afterBlack.gameOver || whoseTurn(afterBlack) != Color::White) return;

    const ipvgo::game::ReplyDist dist = opponentReplyDistribution(afterBlack, Color::White, afterBlack.ai);
    const int maxReplies = req.value("ponderReplies", 4);
    const double massGoal = req.value("ponderMass", 0.95);
    double mass = 0.0;
    int considered = 0;
    for (const auto& reply : dist.replies) {
      if (cancel_.load() || considered >= maxReplies || mass >= massGoal) return;
      mass += reply.prob;
      ++considered;
      if (reply.passMove) continue;
      GameState afterWhite = afterBlack;
      if (!makeMove(afterWhite, reply.x, reply.y, Color::White)) continue;

      // The game stores the board from before each move, newest first.
      json history = json::array();
      history.push_back(boardToJson(afterBlack.board));
      if (blackMoved) history.push_back(boardToJson(state.board));
      if (req.contains("history")) {
        for (const auto& entry : req.at("history")) history.push_back(entry);
      }

      json next = req;
      for (const char* field : {"ponder", "ourMove", "validMoves", "passCount", "requestId"}) next.erase(field);
      next["board"] = boardToJson(afterWhite.board);
      next["history"] = std::move(history);

      json out = computeExploitMoveJson(next, session_, &cancel_);
      if (out.contains("cancelled")) return;
      if (out.contains("error")) continue;
      out["ponder"] = true;
      out["replyProb"] = reply.prob;
      results[ponderKey(next)] = std::move(out);
    }
  }

  ipvgo::nn::SearchSession* session_;
  std::atomic<bool> cancel_{false};
  std::thread worker_;
};

// One long-lived engine: reads one JSON request per line and answers on one line,
// keeping the search session alive so positions solved for an earlier move are
// not solved again. Requests may carry an "id" that is echoed back. A request
// with "ponder": true is acknowledged at once and searched in the background
// until the next request arrives.
int runEngineServer() {
  ipvgo::nn::SearchSession session;
  Ponderer ponderer(&session);
  std::ios::sync_with_stdio(false);
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    json req;
    try {
      req = json::parse(line);
    } catch (const std::exception& err) {
      std::cout << json{{"error", std::string("bad request: ") + err.what()}}.dump() << "\n";
      std::cout.flush();
      continue;
    }
    json out;
    if (req.value("ponder", false)) {
      ponderer.start(req);
      out = json{{"ponder", "started"}};
    } else {
      ponderer.stop();
      try {
        const auto hit = ponderer.results.find(ponderKey(req));
        if (hit != ponderer.results.end() && servedMoveAllowed(req, hit->second)) {
          out = hit->second;
          out["ponderHit"] = true;
          if (req.contains("history") && req.at("history").is_array()) {
            session.noteRequest(req.at("history").size());
          }
        }
      } catch (const std::exception&) {
        out = json();
      }
      ponderer.results.clear();
      if (out.is_null()) {
        try {
          out = computeExploitMoveJson(req, &session);
        } catch (const std::exception& err) {
          out = json{{"error", std::string("search failed: ") + err.what()}};
        }
      }
    }
    if (req.contains("id")) out["id"] = req["id"];
    std::cout << out.dump() << "\n";
    std::cout.flush();
  }
  return 0;
}

// ---- safety (static life analysis on one position) -------------------------

int runSafety(const std::string& inPath) {
  std::ifstream in(inPath);
  if (!in) {
    std::cerr << "cannot open " << inPath << "\n";
    return 1;
  }
  json req;
  in >> req;
  const GameState state = stateFromRequest(req);
  const ChainSet cs = computeChains(state.board);
  const ipvgo::game::SafetyResult black = ipvgo::game::analyzeSafety(state.board, cs, Color::Black, true);
  const ipvgo::game::SafetyResult white = ipvgo::game::analyzeSafety(state.board, cs, Color::White, true);
  const ipvgo::nn::EvalReport report = ipvgo::nn::explainEval(state);

  auto label = [](ipvgo::game::SafetyLevel l) {
    switch (l) {
      case ipvgo::game::SafetyLevel::Benson: return "benson";
      case ipvgo::game::SafetyLevel::Vital: return "vital";
      default: return "-";
    }
  };

  std::cout << "chains:\n";
  for (int c = 0; c < cs.count; ++c) {
    const char colour = cs.chainColor[c];
    if (colour != 'X' && colour != 'O') continue;
    const auto& s = colour == 'X' ? black : white;
    std::cout << "  " << colour << " size=" << cs.members(c).size() << " libs=" << cs.libertyCount(c)
              << " safety=" << label(s.level(c)) << "\n";
  }
  std::cout << "benson chains: black=" << black.bensonChains << " white=" << white.bensonChains
            << "  (vital adds: black=" << black.vitalChains << " white=" << white.vitalChains << ")\n";
  std::cout << "rules lead (game-over score) = " << report.rulesLead << "\n";
  std::cout << "eval lead  (safety-discounted) = " << report.lead << "\n";
  std::cout << "win probability = " << report.winProbability << "  empties=" << report.empties << "\n";

  const ipvgo::game::Influence inf = ipvgo::game::computeInfluence(state.board, 5);
  std::cout << "influence: black=" << inf.black << " white=" << inf.white << " diff=" << inf.diff()
            << "  per-point-mean=" << (static_cast<double>(inf.diff()) / (state.size * state.size)) << "\n";
  if (std::getenv("IPVGO_INFLUENCE_MAP")) {
    for (int y = state.size - 1; y >= 0; --y) {
      std::cout << "  ";
      for (int x = 0; x < state.size; ++x) {
        const char stone = state.board[x][y];
        if (stone == '#' || stone == 'X' || stone == 'O') {
          std::cout << stone;
          continue;
        }
        const int v = inf.value[flatIndex(state.size, x, y)];
        std::cout << (v > 30 ? 'B' : v > 8 ? 'b' : v < -30 ? 'W' : v < -8 ? 'w' : '.');
      }
      std::cout << "\n";
    }
  }

  const bool ok = std::getenv("IPVGO_SAFETY_EXPECT_LEAD") == nullptr ||
                  std::abs(report.lead - std::atof(std::getenv("IPVGO_SAFETY_EXPECT_LEAD"))) < 0.51;
  return ok ? 0 : 2;
}

// ---- replies (print the modelled opponent distribution) --------------------

int runReplies(const std::string& inPath) {
  std::ifstream in(inPath);
  if (!in) {
    std::cerr << "cannot open " << inPath << "\n";
    return 1;
  }
  json req;
  in >> req;
  const GameState state = stateFromRequest(req);
  const Color mover = oppositeColor(state.previousPlayer);
  const ipvgo::game::ReplyDist dist = ipvgo::game::opponentReplyDistribution(state, mover, state.ai);
  const int N = state.size;
  std::printf("mover=%c faction=%s replies=%zu\n", colorChar(mover), opponentName(state.ai).c_str(),
              dist.replies.size());
  for (const auto& r : dist.replies) {
    if (r.passMove) std::printf("  pass                p=%.6f\n", r.prob);
    else std::printf("  %d,%d               p=%.6f\n", r.x, r.y, r.prob);
  }
  (void)N;
  return 0;
}

// ---- exploitplay (exploiter Black vs scripted faction White) ---------------

// Stands in for the game's delay before White replies: while it runs, searches the
// positions White is likeliest to reach, as the server's Ponderer does, but in
// process so exploitplay can measure what pondering is worth.
class SimPonder {
 public:
  ~SimPonder() { stop(); }
  std::unordered_map<uint64_t, ExploitResult> answers;

  void start(const GameState& afterBlack, ExploitConfig cfg, ipvgo::nn::SearchSession* session, int maxReplies,
             bool deep) {
    stop();
    answers.clear();
    cfg.cancel = &cancel_;
    worker_ = std::thread([this, afterBlack, cfg, session, maxReplies, deep] {
      const ipvgo::game::ReplyDist dist = opponentReplyDistribution(afterBlack, Color::White, afterBlack.ai);
      std::vector<GameState> predicted;
      double mass = 0.0;
      for (const auto& reply : dist.replies) {
        if (static_cast<int>(predicted.size()) >= maxReplies || mass >= 0.95) break;
        mass += reply.prob;
        if (reply.passMove) continue;
        GameState next = afterBlack;
        if (!makeMove(next, reply.x, reply.y, Color::White)) continue;
        const ExploitResult result = runExploiter(next, cfg, nullptr, session);
        if (result.cancelled) return;
        answers[ipvgo::nn::positionKey(next)] = result;
        predicted.push_back(next);
      }
      if (!deep) return;
      for (int round = 1; round <= 6; ++round) {
        ExploitConfig bigger = cfg;
        const long scale = 1L << (2 * round);
        if (cfg.nodeLimit > 0) bigger.nodeLimit = cfg.nodeLimit * scale;
        else if (cfg.budgetMs > 0) bigger.budgetMs = cfg.budgetMs * static_cast<int>(scale);
        else return;
        for (const GameState& next : predicted) {
          const ExploitResult result = runExploiter(next, bigger, nullptr, session);
          if (result.cancelled) return;
          answers[ipvgo::nn::positionKey(next)] = result;
        }
      }
    });
  }

  void stop() {
    if (worker_.joinable()) {
      cancel_.store(true);
      worker_.join();
    }
    cancel_.store(false);
  }

 private:
  std::atomic<bool> cancel_{false};
  std::thread worker_;
};

int runExploitPlay(const std::string& opponentName, int size, int games, int depth, uint64_t seed,
                   bool fixedWhiteSeed, int beam = 0, int whiteChildren = 0, long nodeLimitOverride = 0,
                   bool progressOverride = false) {
  const Opponent ai = parseOpponent(opponentName).value_or(Opponent::Netburners);
  std::mt19937_64 rng(seed ? seed : 1);

  ExploitConfig cfg;
  cfg.depth = depth;
  if (beam > 0) cfg.beam = beam;
  if (whiteChildren > 0) cfg.whiteChildren = whiteChildren;
  // Benchmark the configuration the game actually runs: the client sends
  // `iterations`, which becomes a node budget, and a node budget switches the
  // search to iterative deepening and makes the depth argument irrelevant.
  if (std::getenv("IPVGO_WHITE_WORST")) cfg.whiteWorstCase = true;
  if (std::getenv("IPVGO_FIXED_WIDTH")) cfg.adaptiveWidth = false;
  if (const char* limit = std::getenv("IPVGO_NODE_LIMIT")) {
    const long parsed = std::atol(limit);
    if (parsed > 0) cfg.nodeLimit = parsed;
  }
  if (nodeLimitOverride > 0) cfg.nodeLimit = nodeLimitOverride;
  if (const char* threads = std::getenv("IPVGO_THREADS")) cfg.threads = std::atoi(threads);
  // Play uses the faster dynamic root scheduler. Set IPVGO_DETERMINISTIC=1 to pin the
  // round-robin split instead, which makes a run repeatable for an A/B or a trace.
  cfg.deterministic = std::getenv("IPVGO_DETERMINISTIC") != nullptr;
  cfg.carry = std::getenv("IPVGO_CARRY") != nullptr;
  // Simulated White delay, and whether the idle time also keeps deepening.
  const int ponderMs = std::getenv("IPVGO_PONDER_MS") ? std::atoi(std::getenv("IPVGO_PONDER_MS")) : 0;
  const int ponderReplies = std::getenv("IPVGO_PONDER_REPLIES") ? std::atoi(std::getenv("IPVGO_PONDER_REPLIES")) : 4;
  SimPonder ponder;
  long ponderHits = 0;
  long totalDepth = 0;

  int wins = 0;
  double totalBlackMs = 0.0;
  double totalMargin = 0.0;
  long totalMoves = 0;
  long totalNodes = 0;
  long totalMemoHits = 0;
  long totalMemoReused = 0;
  long totalReplyHits = 0;
  long totalCuts = 0;
  long lastCached = 0;
  long lastResets = 0;

  // One session for the whole run: a position solved for one move is not solved
  // again, and a new game drops it the same way the server does.
  ipvgo::nn::SearchSession session;
  const bool useSession = std::getenv("IPVGO_NO_SESSION") == nullptr;
  // A long game set is otherwise a silent black box: report each game as it ends,
  // with a running total and an ETA, so a slow configuration is obvious while it
  // is running rather than an hour later.
  const bool progress = progressOverride || std::getenv("IPVGO_PROGRESS") != nullptr;
  const auto runStart = std::chrono::steady_clock::now();

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

      if (useSession) session.noteRequest(static_cast<size_t>(state.previousBoards.size()));

      const auto t0 = std::chrono::steady_clock::now();
      ExploitResult search;
      const auto hit = ponder.answers.find(ipvgo::nn::positionKey(state));
      if (ponderMs > 0 && hit != ponder.answers.end()) {
        search = hit->second;
        search.nodes = 0;
        search.memoHits = search.memoReusedHits = 0;
        ++ponderHits;
      } else {
        search = runExploiter(state, cfg, nullptr, useSession ? &session : nullptr);
      }
      totalDepth += search.depth;
      totalBlackMs +=
          std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
      totalNodes += search.nodes;
      totalMemoHits += search.memoHits;
      totalMemoReused += search.memoReusedHits;
      totalReplyHits += search.replyHits;
      totalCuts += search.budgetCuts;
      lastCached = search.cachedEntries;
      lastResets = search.sessionResets;

      const int action = search.bestAction;
      const bool explain = std::getenv("IPVGO_EXPLAIN") != nullptr;
      // Reply distribution White faces after Black's chosen move, kept for the
      // "what did the opponent do" line below.
      ipvgo::game::ReplyDist afterBlack;
      if (explain) {
        std::cout << "  g" << g << " m" << m << " BLACK played ";
        if (action == ipvgo::nn::passAction(size)) std::cout << "pass";
        else std::cout << (action / size) << "," << (action % size);
        const Score probe = getScore(state);
        std::cout << "  p(win)=" << search.value << "  lead=" << (probe.blackSum - probe.whiteSum)
                  << "  depth=" << search.depth << " nodes=" << search.nodes << "\n";

        int shown = 0;
        for (const auto& [alt, value] : search.rootScores) {
          if (shown++ >= 4) break;
          std::cout << "      considered ";
          if (alt == ipvgo::nn::passAction(size)) std::cout << "  pass";
          else std::cout << (alt / size) << "," << (alt % size);
          std::cout << "  p(win)=" << value << "\n";
        }

        GameState after = state;
        if (action == ipvgo::nn::passAction(size)) passTurn(after, Color::Black);
        else if (!makeMove(after, action / size, action % size, Color::Black)) passTurn(after, Color::Black);
        if (!after.gameOver) afterBlack = ipvgo::game::opponentReplyDistribution(after, Color::White, ai);
        shown = 0;
        for (const auto& r : afterBlack.replies) {
          if (shown++ >= 4) break;
          std::cout << "      White likely  ";
          if (r.passMove) std::cout << "pass";
          else std::cout << r.x << "," << r.y;
          std::cout << "  p=" << r.prob << "\n";
        }
      }
      if (std::getenv("IPVGO_TRACE")) {
        const Score probe = getScore(state);
        int empties = 0;
        for (int x = 0; x < state.size; ++x) {
          for (int y = 0; y < state.size; ++y) empties += state.board[x][y] == '.' ? 1 : 0;
        }
        std::cout << "  g" << g << " m" << m << " B ";
        if (action == ipvgo::nn::passAction(size)) std::cout << "pass";
        else std::cout << (action / size) << "," << (action % size);
        std::cout << " v=" << search.value << " nodes=" << search.nodes << " score=" << probe.blackSum << ":"
                  << probe.whiteSum << " e=" << empties << "\n";
        if (std::getenv("IPVGO_TRACE_BOARD")) {
          std::cout << "  pos g" << g << " m" << m << " [";
          for (int x = 0; x < size; ++x) {
            std::cout << (x ? "," : "") << "\"" << std::string(state.board[x].data(), static_cast<size_t>(size)) << "\"";
          }
          std::cout << "]\n";
        }
      }
      if (action == ipvgo::nn::passAction(size)) {
        passTurn(state, Color::Black);
      } else if (!makeMove(state, action / size, action % size, Color::Black)) {
        passTurn(state, Color::Black);
      }
      ++totalMoves;
      ++gameMoves;
      if (state.gameOver) break;

      if (ponderMs > 0) {
        ponder.start(state, cfg, useSession ? &session : nullptr, ponderReplies, cfg.carry);
        std::this_thread::sleep_for(std::chrono::milliseconds(ponderMs));
        ponder.stop();
      }
      // A real game reseeds the faction AI from Player.totalPlaytime every move.
      const double whiteSeed = fixedWhiteSeed ? 0.0 : static_cast<double>(rng() % 30000000u);
      const Play wp = getMove(state, Color::White, ai, whiteSeed, mathRng);
      if (explain) {
        double actual = 0.0;
        for (const auto& r : afterBlack.replies) {
          const bool same = wp.type == PlayType::Pass ? r.passMove
                                                     : (!r.passMove && r.x == wp.x && r.y == wp.y);
          if (same) { actual = r.prob; break; }
        }
        std::cout << "      WHITE played  ";
        if (wp.type == PlayType::Pass) std::cout << "pass";
        else std::cout << wp.x << "," << wp.y;
        std::cout << "  p=" << actual << "  (model covers " << afterBlack.replies.size() << " points)\n";
      }
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
    if (progress) {
      const double elapsed =
          std::chrono::duration<double>(std::chrono::steady_clock::now() - runStart).count();
      const double perGame = elapsed / static_cast<double>(g + 1);
      const double eta = perGame * static_cast<double>(games - g - 1);
      std::fprintf(stderr, "  game %d/%d  %s %+6.1f  wins=%d  moves=%d  %.0fs elapsed, ~%.0fs left\n", g + 1, games,
                   blackWins(sc) ? "WIN " : "LOSS", sc.blackSum - sc.whiteSum, wins, gameMoves, elapsed, eta);
      std::fflush(stderr);
    }
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
            << " avgBlackThinkMs=" << avgMs << " avgMargin=" << avgMargin
            << " avgDepth=" << (totalMoves > 0 ? static_cast<double>(totalDepth) / static_cast<double>(totalMoves) : 0.0)
            << " ponderHits=" << ponderHits << "/" << totalMoves << "\n";
  if (std::getenv("IPVGO_CACHE_STATS")) {
    const double hitPct = totalNodes > 0 ? 100.0 * static_cast<double>(totalMemoHits) / static_cast<double>(totalNodes) : 0.0;
    const double reusePct =
        totalMemoHits > 0 ? 100.0 * static_cast<double>(totalMemoReused) / static_cast<double>(totalMemoHits) : 0.0;
    std::cout << "exploitplay: cache nodes=" << totalNodes << " memoHits=" << totalMemoHits << " (" << hitPct
              << "%) of which crossMove=" << totalMemoReused << " (" << reusePct << "%)"
              << " replyHits=" << totalReplyHits << " budgetCuts=" << totalCuts
              << " think_ms=" << static_cast<long>(totalBlackMs) << " moves=" << totalMoves
              << " cached=" << lastCached << " resets=" << lastResets << "\n";
  }
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

// ---- eyetest: the incremental eye totals against the board-wide analysis -----
//
// getEyeCreationMoves() derives the eye totals after a candidate move from the
// summary of the position before it. That is only sound if it agrees with the
// board-wide analysis on every point of every position, so this walks seeded
// games and compares the two for both colours at every empty point.
int runEyeTest(int games, uint64_t seed) {
  std::mt19937_64 rng(seed);
  const std::vector<int> sizes = {5, 7, 9, 13};
  const std::vector<Opponent> factions = {Opponent::Netburners, Opponent::SlumSnakes, Opponent::TheBlackHand,
                                          Opponent::Tetrads,    Opponent::Daedalus,   Opponent::Illuminati};
  long checked = 0;
  long fastPath = 0;
  long mismatches = 0;
  long bailInput = 0;
  long bailCapture = 0;
  long bailEncircledBase = 0;
  long bailEncircledNew = 0;

  for (int g = 0; g < games; ++g) {
    const int size = sizes[rng() % sizes.size()];
    const Opponent ai = factions[rng() % factions.size()];
    const double seedMs = static_cast<double>(rng() % 30000000);
    MathRandom mr(rng());
    GameState state = newBoardState(size, ai, true, seedMs, mr);

    const int moveCap = size * size * 4;
    for (int m = 0; m < moveCap && !state.gameOver; ++m) {
      // Both colours at every empty point: the incremental path is used for
      // White (the faction's own eyes) and for Black (eye blocking), so neither
      // side may be taken on trust.
      for (const Color side : {Color::White, Color::Black}) {
        const ChainSet cs = computeChains(state.board);
        const EyeBoardSummary before = summarizeEyes(state.board, cs, side);
        const double maxSize = eyeCandidateMaxSize(state.board);
        // The container-free summary against the eye map it replaced.
        int refLiving = 0;
        int refEyes = 0;
        {
          const EyeMap em = getAllEyesByChainId(state.board, side);
          for (const auto& [chainIdx, emptyChains] : em.eyes) {
            (void)chainIdx;
            if (!emptyChains.empty()) ++refEyes;
            if (emptyChains.size() >= 2) ++refLiving;
          }
        }
        if (refLiving != before.totals.livingGroups || refEyes != before.totals.eyeCount) {
          ++mismatches;
          if (mismatches <= 3) {
            std::cerr << "eyetest: summarizeEyes disagrees at game " << g << " move " << m << " "
                      << opponentName(ai) << " size " << size << " "
                      << (side == Color::Black ? "black" : "white") << ": summary "
                      << before.totals.eyeCount << "/" << before.totals.livingGroups << ", eye map " << refEyes
                      << "/" << refLiving << "\n"
                      << boardString(state.board) << "\n";
          }
        }
        for (int x = 0; x < size; ++x) {
          for (int y = 0; y < size; ++y) {
            if (state.board[x][y] != '.') continue;
            if (evaluateIfMoveIsValid(state, x, y, side) != Validity::Valid) continue;
            ++checked;
            EyeTotals incremental;
            EyeBail bail = EyeBail::None;
            if (!eyeTotalsAfterMove(state.board, cs, before, side, x, y, maxSize, incremental, &bail)) {
              switch (bail) {
                case EyeBail::Capture: ++bailCapture; break;
                case EyeBail::EncircledBase: ++bailEncircledBase; break;
                case EyeBail::EncircledNew: ++bailEncircledNew; break;
                default: ++bailInput; break;
              }
              continue;
            }
            ++fastPath;
            const SimpleBoard eval = evaluateMoveResult(state.board, x, y, side);
            const EyeTotals full = summarizeEyes(eval, computeChains(eval), side).totals;
            if (incremental.eyeCount != full.eyeCount || incremental.livingGroups != full.livingGroups) {
              ++mismatches;
              if (mismatches <= 3) {
                std::cerr << "eyetest: mismatch at game " << g << " move " << m << " " << opponentName(ai)
                          << " size " << size << " (" << x << "," << y << ") "
                          << (side == Color::Black ? "black" : "white") << ": incremental eyes "
                          << incremental.eyeCount << "/" << incremental.livingGroups << ", full "
                          << full.eyeCount << "/" << full.livingGroups << "\n";
                std::cerr << boardString(state.board) << "\n";
                const ChainSet evalChains = computeChains(eval);
                const EyeBoardSummary after = summarizeEyes(eval, evalChains, side);
                std::cerr << "  before:";
                for (int c = 0; c < cs.count; ++c) {
                  if (cs.chainColor[c] == '.') continue;
                  std::cerr << " [" << c << " " << cs.chainColor[c] << " n" << cs.members(c).size() << " e"
                            << static_cast<int>(before.perChain[static_cast<size_t>(c)]) << "]";
                }
                std::cerr << "\n  after:";
                for (int c = 0; c < evalChains.count; ++c) {
                  if (evalChains.chainColor[c] == '.') continue;
                  std::cerr << " [" << c << " " << evalChains.chainColor[c] << " n"
                            << evalChains.members(c).size() << " e"
                            << static_cast<int>(after.perChain[static_cast<size_t>(c)]) << "]";
                }
                std::cerr << "\n";
              }
            }
          }
        }
      }

      const Color mover = whoseTurn(state);
      if (mover == Color::Black) {
        const std::vector<std::pair<int, int>> blackMoves = getAllValidMoves(state, Color::Black);
        if (blackMoves.empty()) {
          passTurn(state, Color::Black);
        } else {
          const auto [bx, by] = blackMoves[rng() % blackMoves.size()];
          if (!makeMove(state, bx, by, Color::Black)) passTurn(state, Color::Black);
        }
      } else {
        const double whiteSeed = static_cast<double>(rng() % 30000000);
        MathRandom wmr(rng());
        const Play wp = getMove(state, Color::White, ai, whiteSeed, wmr);
        if (wp.type == PlayType::Pass || !makeMove(state, wp.x, wp.y, Color::White)) {
          passTurn(state, Color::White);
        }
      }
    }
  }

  std::cout << "eyetest: " << checked << " candidate points, " << fastPath << " on the incremental path ("
            << (checked > 0 ? 100.0 * static_cast<double>(fastPath) / static_cast<double>(checked) : 0.0)
            << "%), " << mismatches << " mismatches\n";
  std::cout << "         declined: capture " << bailCapture << ", encirclement (existing) " << bailEncircledBase
            << ", encirclement (new) " << bailEncircledNew << ", input " << bailInput << "\n";
  return mismatches ? 1 : 0;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "usage: ipvgo_game "
                 "<selftest|fuzz|parity|aimove|mcgsmove|mcgsplay|exploitmove|exploitplay|"
                 "profileworkload|prof|serve|policycheck|optbench|gen> ...\n";
    return 2;
  }
  const std::string cmd = argv[1];

  if (cmd == "selftest") return runSelftest();
  if (cmd == "safety" && argc >= 3) return runSafety(argv[2]);
  if (cmd == "replies" && argc >= 3) return runReplies(argv[2]);
  if (cmd == "fuzz") return runFuzz(argc >= 3 ? std::stoi(argv[2]) : 200, argc >= 4 ? std::stoull(argv[3]) : 1u);
  if (cmd == "eyetest") return runEyeTest(argc >= 3 ? std::stoi(argv[2]) : 8, argc >= 4 ? std::stoull(argv[3]) : 1u);
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
  if (cmd == "prof") return runProfiler(argc - 1, argv + 1);
  if (cmd == "serve") return runEngineServer();
  if (cmd == "profileworkload") {
    const int games = argc >= 3 ? std::stoi(argv[2]) : 25;
    const uint64_t seed = argc >= 4 ? std::stoull(argv[3]) : 1u;
    if (games < 1) {
      std::cerr << "profileworkload: games must be positive\n";
      return 2;
    }
    return runExploitPlay("Illuminati", 9, games, 2, seed, false, 0, 0, 5000, true);
  }
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
      options.carry = config.value("carry", false);
      options.audit = config.value("audit", true);
      if (config.contains("replay")) {
        for (const auto& entry : config.at("replay")) {
          BenchOptions::ReplayGame game;
          game.faction = entry.value("faction", std::string());
          game.game = entry.value("game", 0);
          game.drawsBefore = entry.value("draws", 0L);
          if (!game.faction.empty() && game.game > 0) options.replay.push_back(game);
        }
      }
      if (config.contains("only")) {
        for (const auto& tag : config.at("only")) options.only.push_back(tag.get<std::string>());
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
        else if (key == "factions") {
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
