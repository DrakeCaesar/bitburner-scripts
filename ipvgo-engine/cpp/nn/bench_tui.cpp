#include "bench_tui.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <ostream>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "cheats.hpp"
#include "exploiter.hpp"
#include "features.hpp"
#include "game_engine.hpp"
#include "go_game.hpp"
#include "opponents.hpp"
#include "rng.hpp"
#include "setup.hpp"

#ifdef _WIN32
#define NOMINMAX
#include <io.h>
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace ipvgo::nn {

using namespace ipvgo::game;
using json = nlohmann::json;

namespace {

constexpr const char* kReset = "\x1b[0m";
constexpr const char* kBold = "\x1b[1m";
constexpr const char* kRed = "\x1b[31m";
constexpr const char* kGreen = "\x1b[32m";
constexpr const char* kYellow = "\x1b[33m";
constexpr const char* kCyan = "\x1b[96m";
constexpr const char* kGrey = "\x1b[90m";
constexpr const char* kBlackStone = "\x1b[94m";
constexpr const char* kWhiteStone = "\x1b[97m";

const char* kSpinner[] = {"|", "/", "-", "\\"};

bool stdoutIsTty() {
#ifdef _WIN32
  return _isatty(_fileno(stdout)) != 0;
#else
  return isatty(STDOUT_FILENO) != 0;
#endif
}

void enableAnsi() {
#ifdef _WIN32
  HANDLE handle = GetStdHandle(STD_OUTPUT_HANDLE);
  DWORD mode = 0;
  if (GetConsoleMode(handle, &mode)) {
    SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
  }
#endif
}

bool traceEnabled() {
  const char* value = std::getenv("IPVGO_TRACE");
  return value != nullptr && std::string(value) != "0";
}

struct LiveView {
  std::mutex mutex;
  std::string faction;
  size_t factionIndex = 0;
  size_t factionCount = 1;
  int gameIndex = 0;
  int gameCount = 1;
  int moveIndex = 0;
  bool thinking = false;
  std::chrono::steady_clock::time_point thinkStart = std::chrono::steady_clock::now();
  int budgetMs = 0;
  long iterations = 0;
  int lastDepth = 0;
  long lastNodes = 0;
  double lastMs = 0.0;
  SimpleBoard board;
  double blackScore = 0.0;
  double whiteScore = 0.0;
  std::string lastBlack = "-";
  std::string lastWhite = "-";
  std::vector<FactionBenchRow> rows;
  bool finished = false;
};

std::string coord(int x, int y) {
  if (x < 0 || y < 0) return "-";
  std::string out;
  out += static_cast<char>('a' + x);
  out += std::to_string(y + 1);
  return out;
}

std::string pad(const std::string& text, size_t width, bool leftAlign = true) {
  if (text.size() >= width) return text;
  const std::string fill(width - text.size(), ' ');
  return leftAlign ? text + fill : fill + text;
}

std::string bar(double fraction, int width) {
  const double clamped = std::min(1.0, std::max(0.0, fraction));
  const int filled = static_cast<int>(std::lround(clamped * width));
  std::string out = "[";
  out += std::string(static_cast<size_t>(filled), '#');
  out += std::string(static_cast<size_t>(width - filled), '-');
  out += "]";
  return out;
}

const char* rateColor(double pct, int games) {
  if (games == 0) return kGrey;
  if (pct >= 99.999) return kGreen;
  if (pct >= 50.0) return kYellow;
  return kRed;
}

std::string formatNumber(double value, int decimals = 1) {
  std::ostringstream out;
  out << std::fixed << std::setprecision(decimals) << value;
  return out.str();
}

std::vector<std::string> renderBoardLines(const SimpleBoard& board) {
  std::vector<std::string> lines;
  const int n = static_cast<int>(board.size());
  if (n == 0) return lines;

  std::string header = "      ";
  for (int x = 0; x < n; ++x) {
    header += ' ';
    header += static_cast<char>('a' + x);
    header += ' ';
  }
  lines.push_back(std::string(kGrey) + header + kReset);
  for (int y = n - 1; y >= 0; --y) {
    std::ostringstream row;
    row << kGrey << "  " << std::setw(2) << (y + 1) << kReset << "  ";
    for (int x = 0; x < n; ++x) {
      const char c = board[x][y];
      const char* color = c == 'X' ? kBlackStone : c == 'O' ? kWhiteStone : c == '#' ? kRed : kGrey;
      row << color << ' ' << c << ' ' << kReset;
    }
    lines.push_back(row.str());
  }
  return lines;
}

std::vector<std::string> renderFrame(const LiveView& view, double elapsedMs, size_t frame) {
  std::vector<std::string> lines;
  lines.push_back(std::string(kBold) + "IPvGO exploiter bench" + kReset + kGrey +
                  "   Black = policy expectimax, White = scripted faction" + kReset);
  lines.push_back(std::string(kGrey) + std::string(74, '-') + kReset);

  std::ostringstream current;
  current << "  " << kCyan << pad(view.faction, 14) << kReset << kGrey << " ("
          << (view.factionIndex + 1) << "/" << view.factionCount << ")" << kReset << "   game "
          << view.gameIndex << "/" << view.gameCount << "   move " << view.moveIndex;

  if (view.finished) {
    current << "   " << kGreen << "finished" << kReset;
  } else if (view.thinking) {
    current << "   " << kYellow << kSpinner[frame % 4] << " thinking " << std::setw(4)
            << static_cast<int>(elapsedMs) << " ms" << kReset << kGrey << " / budget ";
    if (view.iterations > 0) {
      current << view.iterations << " nodes";
    } else {
      current << view.budgetMs << " ms";
    }
    current << kReset;
  } else {
    current << "   " << kGrey << "applying white reply" << kReset;
  }
  lines.push_back(current.str());

  std::ostringstream search;
  search << "  " << kGrey << "depth " << kReset << view.lastDepth << kGrey << "   nodes " << kReset
         << view.lastNodes << kGrey << "   last think " << kReset << static_cast<int>(view.lastMs) << " ms"
         << kGrey << "   score " << kReset << "B " << formatNumber(view.blackScore) << kGrey << " / "
         << kReset << "W " << formatNumber(view.whiteScore) << kGrey << "   last B " << kReset
         << view.lastBlack << kGrey << "   last W " << kReset << view.lastWhite;
  lines.push_back(search.str());
  lines.push_back(std::string(kGrey) + std::string(74, '-') + kReset);

  const std::vector<std::string> boardLines = renderBoardLines(view.board);
  lines.insert(lines.end(), boardLines.begin(), boardLines.end());

  lines.push_back(std::string(kGrey) + std::string(74, '-') + kReset);
  std::ostringstream header;
  header << "  " << kGrey << pad("faction", 16) << pad("games", 7, false) << pad("W", 5, false)
         << pad("L", 5, false) << pad("win %", 8, false) << pad("margin", 9, false)
         << pad("ms/move", 10, false) << "  progress" << kReset;
  lines.push_back(header.str());

  for (const FactionBenchRow& row : view.rows) {
    std::ostringstream line;
    line << "  " << pad(row.faction, 16) << kGrey << pad(std::to_string(row.games), 7, false)
         << pad(std::to_string(row.wins), 5, false) << kReset
         << (row.losses > 0 ? kRed : kGrey) << pad(std::to_string(row.losses), 5, false) << kReset
         << rateColor(row.winRate(), row.games) << pad(formatNumber(row.winRate()), 8, false) << kReset
         << kGrey << pad(formatNumber(row.avgMargin(), 1), 9, false)
         << pad(static_cast<int>(row.avgMs()) == 0 ? "-" : std::to_string(static_cast<int>(row.avgMs())), 10,
                false)
         << kReset << "  ";
    const double progress = view.gameCount > 0 ? static_cast<double>(row.games) / view.gameCount : 0.0;
    line << bar(progress, 16) << " " << rateColor(row.winRate(), row.games)
         << pad(formatNumber(row.winRate()) + "%", 7, false) << kReset;
    lines.push_back(line.str());
  }

  if (view.finished) {
    lines.push_back(std::string(kGrey) + std::string(74, '-') + kReset);
    int below = 0;
    for (const FactionBenchRow& row : view.rows) {
      if (row.games == 0 || row.wins != row.games) ++below;
    }
    lines.push_back(below == 0 ? std::string(kGreen) + "  PASS: 100% against every faction" + kReset
                               : std::string(kRed) + "  FAIL: " + std::to_string(below) +
                                     " faction(s) below 100%" + kReset);
  }
  return lines;
}

class BenchView {
 public:
  explicit BenchView(LiveView& view) : view_(view) {}

  void start() {
    const auto proc = [this] {
      size_t frame = 0;
      std::string last;
      while (!stop_.load()) {
        std::string frameText;
        {
          std::lock_guard<std::mutex> lock(view_.mutex);
          const double elapsedMs =
              view_.thinking ? std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() -
                                                                        view_.thinkStart)
                                   .count()
                             : 0.0;
          const std::vector<std::string> lines = renderFrame(view_, elapsedMs, frame);
          frameText = std::string("\x1b[H");
          for (const std::string& line : lines) frameText += line + "\x1b[K\n";
          frameText += "\x1b[J";
        }
        if (frameText != last) {
          std::fwrite(frameText.data(), 1, frameText.size(), stdout);
          std::fflush(stdout);
          last = frameText;
        }
        ++frame;
        std::this_thread::sleep_for(std::chrono::milliseconds(80));
      }
    };
    thread_ = std::thread(proc);
  }

  void stop() {
    stop_.store(true);
    if (thread_.joinable()) thread_.join();
  }

 private:
  LiveView& view_;
  std::atomic<bool> stop_{false};
  std::thread thread_;
};

std::vector<std::string> defaultFactions(int size) {
  if (size <= 13) {
    return {"Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati"};
  }
  return {"WorldDaemon"};
}

// One game loop shared by the terminal view and the web (NDJSON) view.
class BenchObserver {
 public:
  virtual ~BenchObserver() = default;
  // `seed` is the seed this game's inputs are derived from: (options.seed, faction,
  // game number) make a game reproducible on its own.
  virtual void onGameStart(size_t index, const std::string& faction, int game, int games, uint64_t seed) = 0;
  virtual void onThinking(size_t index, const GameState& state, int game, int move) = 0;
  virtual void onBlackMove(size_t index, const GameState& state, int game, int move,
                           const ExploitResult& search, double elapsedMs, bool passed) = 0;
  virtual void onWhiteReply(size_t index, const GameState& state, int game, int move, const Play& play) = 0;
  virtual void onGameEnd(size_t index, const FactionBenchRow& row, bool win, double margin) = 0;
  virtual void onRows(const std::vector<FactionBenchRow>& rows) = 0;
  virtual void onFinish(const std::vector<FactionBenchRow>& rows, int failures) = 0;
};

// The seed of one game, derived from (options.seed, faction, game number) instead of from
// a stream shared by the whole batch. The old stream drew per move, so game N's opening
// depended on how long games 1..N-1 ran - which also meant two engine builds were never
// compared on the same openings. With a per-game seed a game can be replayed on its own,
// played out of order, and played alongside other games.
uint64_t benchGameSeed(const BenchOptions& options, size_t factionIndex, int gameNumber) {
  return (options.seed ? options.seed : 1) * 1000003ull + static_cast<uint64_t>(factionIndex) * 1009ull +
         static_cast<uint64_t>(gameNumber);
}

struct BenchGameResult {
  int moves = 0;
  double msSum = 0.0;
  bool win = false;
  double margin = 0.0;
  // Cheats this game attempted, and whether one got us ejected (which is a loss whatever
  // the board says, as it is in the game).
  int cheats = 0;
  bool ejected = false;
};

// The engine's cheat kinds and the game's CheatType are declared in different orders, so
// map them explicitly rather than casting.
ipvgo::game::CheatType cheatTypeFor(int kind) {
  switch (static_cast<ipvgo::nn::CheatKind>(kind)) {
    case ipvgo::nn::CheatKind::PlayTwoMoves: return ipvgo::game::CheatType::PlayTwoMoves;
    case ipvgo::nn::CheatKind::DestroyNode: return ipvgo::game::CheatType::DestroyNode;
    case ipvgo::nn::CheatKind::RepairOfflineNode: return ipvgo::game::CheatType::RepairOfflineNode;
    case ipvgo::nn::CheatKind::RemoveRouter:
    case ipvgo::nn::CheatKind::None: break;
  }
  return ipvgo::game::CheatType::RemoveRouter;
}

// Plays whatever the search preferred, and reports the roll. Returns 0 when no cheat was
// attempted, otherwise 1 = succeeded, 2 = turn skipped, 3 = ejected.
int playPreferredCheat(GameState& state, const ExploitResult& search, std::mt19937_64& rng,
                       const BenchOptions& options, BenchGameResult& result) {
  if (!options.cheats || !search.cheatPreferred || search.cheat.kind == 0) return 0;
  const ipvgo::game::CheatType type = cheatTypeFor(search.cheat.kind);
  std::vector<std::pair<int, int>> points{{search.cheat.x1, search.cheat.y1}};
  if (type == ipvgo::game::CheatType::PlayTwoMoves) points.emplace_back(search.cheat.x2, search.cheat.y2);
  ipvgo::game::CheatParams params;
  params.crimeSuccessMult = options.crimeSuccessMult;
  params.sourceFileBonus = options.sourceFile14Level >= 3 ? 0.25 : 0.0;
  std::uniform_real_distribution<double> unit(0.0, 1.0);
  const double successRng = unit(rng);
  const double ejectRng = unit(rng);
  const ipvgo::game::CheatResult outcome =
      ipvgo::game::applyCheat(state, Color::Black, type, points, successRng, ejectRng, params);
  if (outcome == ipvgo::game::CheatResult::InvalidTarget) return 0;
  result.cheats += 1;
  switch (outcome) {
    case ipvgo::game::CheatResult::Success: return 1;
    case ipvgo::game::CheatResult::TurnSkipped: return 2;
    case ipvgo::game::CheatResult::Ejected:
      // Ejection ends the game as a loss, whatever the score says.
      state.gameOver = true;
      result.ejected = true;
      return 3;
    case ipvgo::game::CheatResult::InvalidTarget: break;
  }
  return 0;
}

// One game, start to finish. `gameNumber` is the 1-based number shown in the GUI (and the
// one a replay refers to); `gamesInFaction` only drives the progress display.
BenchGameResult playBenchGame(const BenchOptions& options, const ExploitConfig& cfg, size_t factionIndex,
                              const std::string& faction, int gameNumber, int gamesInFaction, uint64_t seed,
                              BenchObserver& observer) {
  const Opponent ai = parseOpponent(faction).value_or(Opponent::Netburners);
  std::mt19937_64 rng(seed);
  const double clockMs = static_cast<double>(rng() % 30000000u);
  MathRandom mathRng(rng());
  GameState state = newBoardState(options.size, ai, true, clockMs, mathRng);
  observer.onGameStart(factionIndex, faction, gameNumber, gamesInFaction, seed);

  BenchGameResult result;
  SearchSession session;
  // IPVGO_MOVECAP overrides the built-in size*size*4 cap; a game that reaches it is
  // scored as if it had ended there.
  const char* capEnv = std::getenv("IPVGO_MOVECAP");
  const int moveCap = capEnv != nullptr ? std::max(1, std::atoi(capEnv)) : options.size * options.size * 4;
  for (int m = 0; m < moveCap && !state.gameOver; ++m) {
    if (whoseTurn(state) != Color::Black) break;

    observer.onThinking(factionIndex, state, gameNumber, m + 1);
    const auto t0 = std::chrono::steady_clock::now();
    const ExploitResult search = runExploiter(state, cfg, nullptr, options.carry ? &session : nullptr);
    const double elapsedMs =
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();

    // A cheat, when the search preferred one, replaces the normal move for this turn.
    const int cheatOutcome = playPreferredCheat(state, search, rng, options, result);
    const bool cheated = cheatOutcome != 0;
    const int action = search.bestAction;
    const bool passed = !cheated && action == passAction(options.size);
    if (cheated) {
      // `state` already holds the outcome (effect applied, turn skipped, or game over).
    } else if (passed) {
      passTurn(state, Color::Black);
    } else if (!makeMove(state, action / options.size, action % options.size, Color::Black)) {
      passTurn(state, Color::Black);
    }

    result.moves += 1;
    result.msSum += elapsedMs;
    // Report the cheat's own target so the move list matches the board; the search result
    // also carries the cheat fields, which the JSON observer includes.
    if (cheated) {
      ExploitResult shown = search;
      shown.bestAction = flatIndex(options.size, search.cheat.x1, search.cheat.y1);
      shown.cheat.outcome = cheatOutcome;
      observer.onBlackMove(factionIndex, state, gameNumber, m + 1, shown, elapsedMs, false);
    } else {
      observer.onBlackMove(factionIndex, state, gameNumber, m + 1, search, elapsedMs, passed);
    }

    if (state.gameOver) break;

    const Play whitePlay = getMove(state, Color::White, ai, static_cast<double>(rng() % 30000000u), mathRng);
    if (whitePlay.type == PlayType::Pass) {
      passTurn(state, Color::White);
    } else if (!makeMove(state, whitePlay.x, whitePlay.y, Color::White)) {
      passTurn(state, Color::White);
    }
    observer.onWhiteReply(factionIndex, state, gameNumber, m + 1, whitePlay);
  }

  const Score score = getScore(state);
  result.margin = score.blackSum - score.whiteSum;
  result.win = result.ejected ? false : blackWins(score);
  return result;
}

struct BenchJob {
  size_t faction = 0;
  int game = 0;
  int gamesInFaction = 0;
};

// Everything a batch needs before the first game: the faction list, one search config per
// faction, and the games to play in the order a sequential run plays them.
struct BenchRun {
  std::vector<std::string> factions;
  std::vector<FactionBenchRow> rows;
  std::vector<ExploitConfig> configs;
  std::vector<BenchJob> jobs;
};

BenchRun prepareBenchRun(const BenchOptions& options, bool singleThreadedGames) {
  BenchRun run;
  run.factions = options.factions.empty() ? defaultFactions(options.size) : options.factions;
  if (!options.replay.empty()) {
    // A replay names its own games, so the faction list is whatever they mention.
    run.factions.clear();
    for (const BenchOptions::ReplayGame& game : options.replay) {
      if (std::find(run.factions.begin(), run.factions.end(), game.faction) == run.factions.end()) {
        run.factions.push_back(game.faction);
      }
    }
  }
  if (run.factions.empty()) return run;

  run.rows.resize(run.factions.size());
  for (size_t i = 0; i < run.factions.size(); ++i) run.rows[i].faction = run.factions[i];

  ExploitConfig cfg;
  cfg.budgetMs = options.budgetMs;
  cfg.nodeLimit = options.iterations;
  cfg.depth = options.depth;
  cfg.maxDepth = options.maxDepth;
  cfg.autoDepth = options.autoDepth;
  cfg.perMoveBudget = options.perMoveBudget;
  cfg.widen = options.widen;
  cfg.beam = options.beam;
  cfg.whiteChildren = options.whiteChildren;
  cfg.whiteMass = options.whiteMass;
  cfg.endgameEmpties = options.endgameEmpties;
  cfg.nodeBudget = options.nodeBudget;
  cfg.threads = options.threads;
  // Games running side by side get their parallelism from the game count, so each one
  // searches on a single thread - that is the whole point of the switch.
  if (singleThreadedGames) cfg.threads = 1;
  // A benchmark defaults to the repeatable round-robin split; the GUI's scheduler
  // toggle asks for the dynamic one instead.
  cfg.deterministic = !options.dynamicRoot;
  // IPVGO_DYNAMIC=1 measures the scheduler play actually uses, at the cost of
  // repeatability.
  if (std::getenv("IPVGO_DYNAMIC") != nullptr) cfg.deterministic = false;
  cfg.carry = options.carry;
  // Verify the move this game plays against every reply in the model (the first White
  // ply only); deeper plies keep the normal width.
  cfg.verifyRootReplies = options.verifyRootReplies;
  // Cheats: the one global switch. The search values them; playBenchGame rolls the
  // outcome and applies it, so a cheat costs the game what it costs in the real one.
  cfg.cheatsEnabled = options.cheats;
  cfg.cheatMargin = options.cheatMargin;
  cfg.cheatMaxAttempts = options.cheatMaxAttempts;
  cfg.cheatOnlyWhenLosing = options.cheatLosingGate;
  cfg.crimeSuccessMult = options.crimeSuccessMult;
  cfg.sourceFile14Level = options.sourceFile14Level;

  // A tuned setting applies to its own faction only; everything else keeps the
  // globals, so leaving one faction tuned cannot change how the others play.
  run.configs.assign(run.factions.size(), cfg);
  for (size_t i = 0; i < run.factions.size(); ++i) {
    for (const auto& [name, tuning] : options.tuningByFaction) {
      if (name != run.factions[i]) continue;
      if (tuning.beam > 0) run.configs[i].beam = tuning.beam;
      if (tuning.whiteChildren > 0) run.configs[i].whiteChildren = tuning.whiteChildren;
      if (tuning.whiteMass > 0.0) run.configs[i].whiteMass = tuning.whiteMass;
    }
  }

  const auto wants = [&](size_t f, int gameNumber) {
    if (options.only.empty()) return true;
    const std::string tag = run.factions[f] + ":" + std::to_string(gameNumber);
    return std::find(options.only.begin(), options.only.end(), tag) != options.only.end();
  };
  if (!options.replay.empty()) {
    for (const BenchOptions::ReplayGame& game : options.replay) {
      const auto where = std::find(run.factions.begin(), run.factions.end(), game.faction);
      if (where == run.factions.end()) continue;
      const size_t f = static_cast<size_t>(where - run.factions.begin());
      int gamesInFaction = 0;
      for (const BenchOptions::ReplayGame& other : options.replay) {
        if (other.faction == game.faction) ++gamesInFaction;
      }
      run.jobs.push_back({f, game.game, gamesInFaction});
    }
  } else {
    for (size_t f = 0; f < run.factions.size(); ++f) {
      for (int g = 1; g <= options.gamesPerFaction; ++g) {
        if (wants(f, g)) run.jobs.push_back({f, g, options.gamesPerFaction});
      }
    }
  }
  return run;
}

// Folds one finished game into its faction's row.
void foldBenchResult(FactionBenchRow& row, const BenchGameResult& result) {
  row.moves += result.moves;
  row.msSum += result.msSum;
  row.games += 1;
  if (result.win) row.wins += 1;
  else row.losses += 1;
  row.marginSum += result.margin;
}

// Plays one job and folds its outcome into the faction's row.
void playBenchJob(const BenchOptions& options, BenchRun& run, const BenchJob& job, BenchObserver& observer) {
  const BenchGameResult result =
      playBenchGame(options, run.configs[job.faction], job.faction, run.factions[job.faction], job.game,
                    job.gamesInFaction, benchGameSeed(options, job.faction, job.game), observer);
  foldBenchResult(run.rows[job.faction], result);
  observer.onGameEnd(job.faction, run.rows[job.faction], result.win, result.margin);
  observer.onRows(run.rows);
}

int finishBenchRun(const std::vector<FactionBenchRow>& rows, BenchObserver& observer) {
  int failures = 0;
  for (const FactionBenchRow& row : rows) {
    if (row.games == 0 || row.wins != row.games) ++failures;
  }
  observer.onFinish(rows, failures);
  return failures;
}

int runBenchGames(const BenchOptions& options, BenchObserver& observer) {
  BenchRun run = prepareBenchRun(options, false);
  if (run.factions.empty()) return 0;
  observer.onRows(run.rows);
  for (const BenchJob& job : run.jobs) playBenchJob(options, run, job, observer);
  return finishBenchRun(run.rows, observer);
}

class LiveObserver : public BenchObserver {
 public:
  LiveObserver(const BenchOptions& options, size_t factionCount) : live_(resolveLive()) {
    view_.budgetMs = options.budgetMs;
    view_.iterations = options.iterations;
    view_.gameCount = options.gamesPerFaction;
    view_.factionCount = factionCount;
    if (live_) {
      enableAnsi();
      ui_.start();
    }
  }

  ~LiveObserver() override {
    {
      std::lock_guard<std::mutex> lock(view_.mutex);
      view_.finished = true;
      view_.thinking = false;
    }
    ui_.stop();
  }

  void onGameStart(size_t index, const std::string& faction, int game, int games, uint64_t seed) override {
    (void)seed;
    std::lock_guard<std::mutex> lock(view_.mutex);
    view_.faction = faction;
    view_.factionIndex = index;
    view_.gameIndex = game;
    view_.gameCount = games;
    view_.moveIndex = 0;
    view_.lastBlack = "-";
    view_.lastWhite = "-";
    view_.board.clear();
    view_.blackScore = 0.0;
    view_.whiteScore = 0.0;
  }

  void onThinking(size_t, const GameState& state, int game, int move) override {
    std::lock_guard<std::mutex> lock(view_.mutex);
    view_.thinking = true;
    view_.gameIndex = game;
    view_.moveIndex = move;
    view_.board = state.board;
    view_.thinkStart = std::chrono::steady_clock::now();
    updateScore(state);
  }

  void onBlackMove(size_t, const GameState& state, int game, int move, const ExploitResult& search,
                   double elapsedMs, bool passed) override {
    std::lock_guard<std::mutex> lock(view_.mutex);
    view_.thinking = false;
    view_.gameIndex = game;
    view_.moveIndex = move;
    view_.lastDepth = search.depth;
    view_.lastNodes = search.nodes;
    view_.lastMs = elapsedMs;
    view_.lastBlack =
        passed ? "pass" : coord(search.bestAction / state.size, search.bestAction % state.size);
    view_.board = state.board;
    updateScore(state);
    if (traceEnabled()) {
      std::printf("  g%d m%d B %s v=%.3f d=%d nodes=%ld score=%.1f:%.1f\n", game, move,
                  view_.lastBlack.c_str(), search.value, search.depth, search.nodes, view_.blackScore,
                  view_.whiteScore);
      std::fflush(stdout);
    }
  }

  void onWhiteReply(size_t, const GameState& state, int game, int move, const Play& play) override {
    (void)game;
    (void)move;
    std::lock_guard<std::mutex> lock(view_.mutex);
    view_.lastWhite = play.type == PlayType::Pass ? "pass" : coord(play.x, play.y);
    view_.board = state.board;
    updateScore(state);
    if (traceEnabled()) {
      std::printf("      W %s\n", view_.lastWhite.c_str());
      std::fflush(stdout);
    }
  }

  void onGameEnd(size_t, const FactionBenchRow&, bool win, double margin) override {
    if (live_) return;
    std::lock_guard<std::mutex> lock(view_.mutex);
    std::printf("%-16s game %2d/%d  %s  margin %+5.1f\n", view_.faction.c_str(), view_.gameIndex,
                view_.gameCount, win ? "WIN " : "LOSS", margin);
    std::fflush(stdout);
  }

  void onRows(const std::vector<FactionBenchRow>& rows) override {
    std::lock_guard<std::mutex> lock(view_.mutex);
    view_.rows = rows;
  }

  void onFinish(const std::vector<FactionBenchRow>& rows, int failures) override {
    {
      std::lock_guard<std::mutex> lock(view_.mutex);
      view_.rows = rows;
      view_.finished = true;
      view_.thinking = false;
    }
    ui_.stop();
    std::printf("%s\n", kReset);
    for (const FactionBenchRow& row : rows) {
      std::printf("%-16s %3d/%3d (%5.1f%%)  avg margin %+6.1f  %4d ms/move\n", row.faction.c_str(), row.wins,
                  row.games, row.winRate(), row.avgMargin(), static_cast<int>(row.avgMs()));
    }
    if (failures == 0) {
      std::printf("bench: PASS (100%% against every faction)\n");
    } else {
      std::printf("bench: FAIL (%d faction(s) below 100%%)\n", failures);
    }
    std::fflush(stdout);
  }

 private:
  static bool resolveLive() {
    const char* env = std::getenv("IPVGO_TUI");
    if (env != nullptr) return std::string(env) != "0";
    return stdoutIsTty();
  }

  void updateScore(const GameState& state) {
    const Score score = getScore(state);
    view_.blackScore = score.blackSum;
    view_.whiteScore = score.whiteSum;
  }

  LiveView view_;
  bool live_;
  BenchView ui_{view_};
};

class JsonObserver : public BenchObserver {
 public:
  // `out` is where the NDJSON goes. Games played side by side are given one observer each
  // writing to its own buffer, because this class keeps the state of the game it is
  // describing; the buffers are flushed whole so a game's events stay contiguous.
  JsonObserver(size_t factionCount, bool audit, std::ostream& out)
      : factionCount_(factionCount), audit_(audit), out_(out) {}

  void onGameStart(size_t index, const std::string& faction, int game, int games, uint64_t seed) override {
    faction_ = faction;
    game_ = game;
    games_ = games;
    rootReport_ = EvalReport{};
    rootRulesLead_ = 0.0;
    replies_.replies.clear();
    emit({{"type", "gameStart"},
          {"faction", faction},
          {"factionIndex", index},
          {"factionCount", factionCount_},
          {"game", game},
          {"games", games},
          // The seed this game's inputs come from: enough to replay exactly this game.
          {"seed", seed}});
  }

  void onThinking(size_t, const GameState& state, int game, int move) override {
    const Score score = getScore(state);
    // Before the search runs, so the audit costs nothing out of the think budget.
    if (audit_) {
      rootReport_ = explainEval(state);
      rootRulesLead_ = score.blackSum - score.whiteSum;
      flatValue_ = flatValue(state);
    }
    emit({{"type", "thinking"},
          {"faction", faction_},
          {"game", game},
          {"move", move},
          {"board", boardJson(state.board)},
          {"blackScore", score.blackSum},
          {"whiteScore", score.whiteSum}});
  }

  void onBlackMove(size_t, const GameState& state, int game, int move, const ExploitResult& search,
                   double elapsedMs, bool passed) override {
    const Score score = getScore(state);
    const int n = state.size;
    json event = {{"type", "move"},
                  {"faction", faction_},
                  {"game", game},
                  {"move", move},
                  {"black", passed ? json(nullptr)
                                   : json{{"x", search.bestAction / n}, {"y", search.bestAction % n}}},
                  {"pass", passed},
                  {"value", search.value},
                  {"depth", search.depth},
                  {"nodes", search.nodes},
                  {"ms", elapsedMs},
                  {"board", boardJson(state.board)},
                  {"blackScore", score.blackSum},
                  {"whiteScore", score.whiteSum}};
    if (audit_) event["audit"] = moveAudit(state, score, search);
    // When the search preferred a cheat, the move above is the cheat's own target and
    // these fields say what was attempted and what it was worth.
    if (search.cheatPreferred) {
      event["cheat"] = {{"kind", search.cheat.kind},
                        {"x1", search.cheat.x1},
                        {"y1", search.cheat.y1},
                        {"x2", search.cheat.x2},
                        {"y2", search.cheat.y2},
                        {"value", search.cheat.value},
                        {"successChance", search.cheat.successChance},
                        {"bestMoveValue", search.cheat.bestMoveValue},
                        {"currentValue", search.cheat.currentValue},
                        {"reason", search.cheat.reason},
                        {"outcome", search.cheat.outcome}};
    }
    emit(event);
  }

  void onWhiteReply(size_t, const GameState& state, int game, int move, const Play& play) override {
    const Score score = getScore(state);
    json event = {{"type", "reply"},
                  {"faction", faction_},
                  {"game", game},
                  {"move", move},
                  {"white", play.type == PlayType::Pass ? json(nullptr) : json{{"x", play.x}, {"y", play.y}}},
                  {"pass", play.type == PlayType::Pass},
                  {"board", boardJson(state.board)},
                  {"blackScore", score.blackSum},
                  {"whiteScore", score.whiteSum}};
    if (audit_) event["audit"] = replyAudit(state, score, play);
    replies_.replies.clear();
    emit(event);
  }

  void onGameEnd(size_t, const FactionBenchRow& row, bool win, double margin) override {
    emit({{"type", "gameEnd"},
          {"faction", faction_},
          {"game", game_},
          {"games", games_},
          {"win", win},
          {"margin", margin},
          {"moves", row.moves}});
  }

  void onRows(const std::vector<FactionBenchRow>& rows) override { emitRows(rows); }

  void onFinish(const std::vector<FactionBenchRow>& rows, int failures) override {
    emitRows(rows);
    emit({{"type", "done"}, {"failures", failures}});
  }

 private:
  // One position as the leaf evaluator and the rules score see it. `lead` is the
  // eval's own lead (stones plus territory it credits, minus komi, plus the atari
  // terms); `rulesLead` is what getScore says, which is the game's win condition.
  // The two disagreeing is the thing the loss analysis looks for.
  static json evalJson(const EvalReport& report, double rulesLead) {
    return {{"lead", report.lead},
            {"win", report.winProbability},
            {"empties", report.empties},
            {"rulesLead", rulesLead}};
  }

  static json actionJson(int action, int size) {
    if (action == passAction(size)) return {{"x", nullptr}, {"y", nullptr}, {"pass", true}};
    return {{"x", action / size}, {"y", action % size}, {"pass", false}};
  }

  // Per Black move: what the eval said at the root (before the search, so it is on
  // the same position `value` describes), what it says after the move, the top
  // alternatives the search ranked, and White's modelled replies with their
  // probabilities. The reply set is kept so onWhiteReply can price the real one.
  json moveAudit(const GameState& state, const Score& score, const ExploitResult& search) {
    json top = json::array();
    const size_t n = std::min<size_t>(3, search.rootScores.size());
    for (size_t i = 0; i < n; ++i) {
      json entry = actionJson(search.rootScores[i].first, state.size);
      entry["value"] = search.rootScores[i].second;
      top.push_back(entry);
    }

    replies_.replies.clear();
    if (!state.gameOver) replies_ = opponentReplyDistribution(state, Color::White, state.ai);
    json replies = json::array();
    for (size_t i = 0; i < replies_.replies.size() && i < 3; ++i) {
      const WeightedReply& reply = replies_.replies[i];
      replies.push_back({{"x", reply.passMove ? json(nullptr) : json(reply.x)},
                         {"y", reply.passMove ? json(nullptr) : json(reply.y)},
                         {"pass", reply.passMove},
                         {"prob", reply.prob}});
    }

    const EvalReport after = explainEval(state);
    return {{"root", evalJson(rootReport_, rootRulesLead_)},
            {"after", evalJson(after, score.blackSum - score.whiteSum)},
            {"flat", flatValue_},
            {"top", top},
            {"replies", replies}};
  }

  // The depth-independent reference value: one Black ply, then the modelled White
  // replies, then the leaf. The search value depends on how deep the budget got,
  // so two consecutive moves are not comparable; this one is the same search on
  // every move, which is what a blunder has to be measured against. The endgame
  // solve is disabled on purpose: it is a third estimator, it would make the value
  // jump when the empty-point threshold is crossed, and one exact solve per root
  // move is not a "one-ply" cost.
  static double flatValue(const GameState& state) {
    ExploitConfig cfg;
    cfg.depth = 1;
    cfg.maxDepth = 1;
    cfg.endgameEmpties = 0;
    cfg.threads = 1;
    cfg.deterministic = true;
    return runExploiter(state, cfg).value;
  }

  // Per White reply: the eval after it, and how likely the model thought that exact
  // move was. A blunder whose reply had a high model probability was in the tree,
  // so it is the leaf eval's fault; one that was not is the reply model's.
  json replyAudit(const GameState& state, const Score& score, const Play& play) {
    double prob = 0.0;
    bool found = false;
    for (const WeightedReply& reply : replies_.replies) {
      const bool same = play.type == PlayType::Pass ? reply.passMove
                                                   : (!reply.passMove && reply.x == play.x && reply.y == play.y);
      if (!same) continue;
      prob = reply.prob;
      found = true;
      break;
    }
    const EvalReport after = explainEval(state);
    return {{"after", evalJson(after, score.blackSum - score.whiteSum)},
            {"model", {{"prob", found ? prob : 0.0},
                       {"points", replies_.replies.size()},
                       {"found", found}}}};
  }

  void emitRows(const std::vector<FactionBenchRow>& rows) {
    json list = json::array();
    for (const FactionBenchRow& row : rows) {
      list.push_back({{"faction", row.faction},
                      {"games", row.games},
                      {"wins", row.wins},
                      {"losses", row.losses},
                      {"winRate", row.winRate()},
                      {"avgMargin", row.avgMargin()},
                      {"avgMs", row.avgMs()}});
    }
    emit({{"type", "rows"}, {"rows", list}});
  }

  static json boardJson(const SimpleBoard& board) {
    json list = json::array();
    const int n = board.size();
    for (int x = 0; x < n; ++x) list.push_back(std::string(board[x].data(), static_cast<size_t>(n)));
    return list;
  }

  void emit(const json& event) {
    out_ << event.dump() << '\n';
    out_.flush();
  }

  size_t factionCount_ = 0;
  bool audit_ = true;
  std::ostream& out_;
  std::string faction_;
  int game_ = 0;
  int games_ = 0;
  // Root eval of the position the pending move was chosen in, and White's reply
  // distribution after that move (cleared on every reply).
  EvalReport rootReport_;
  double rootRulesLead_ = 0.0;
  double flatValue_ = 0.0;
  ReplyDist replies_;
};

}  // namespace

int runExploitBench(const BenchOptions& options) {
  const std::vector<std::string> factions =
      options.factions.empty() ? defaultFactions(options.size) : options.factions;
  if (factions.empty()) return 0;

  LiveObserver observer(options, factions.size());
  if (options.gamesInParallel > 1) {
    // The live view shows one board and this path writes one game at a time; the JSON
    // path (benchjson) is the one that runs games side by side. The answers are identical
    // either way, only the wall clock differs.
    std::fprintf(stderr, "bench: parallel games are a benchjson option; playing one game at a time\n");
  }
  return runBenchGames(options, observer);
}

int runExploitBenchJson(const BenchOptions& options) {
  const bool parallel = options.gamesInParallel > 1;
  BenchRun run = prepareBenchRun(options, parallel);
  if (run.factions.empty()) return 0;
  const size_t factionCount = run.factions.size();

  const unsigned workers =
      parallel ? std::max(1u, std::min<unsigned>(static_cast<unsigned>(options.gamesInParallel),
                                                 static_cast<unsigned>(run.jobs.size())))
               : 1u;
  if (workers <= 1) {
    JsonObserver observer(factionCount, options.audit, std::cout);
    observer.onRows(run.rows);
    for (const BenchJob& job : run.jobs) playBenchJob(options, run, job, observer);
    return finishBenchRun(run.rows, observer);
  }

  {
    JsonObserver observer(factionCount, options.audit, std::cout);
    observer.onRows(run.rows);
  }
  // Games run side by side, each on one search thread. The rows they feed are shared, and
  // each game's events are buffered and written in one piece, so what the stream shows is
  // still one whole game at a time.
  std::mutex rowsMutex;
  std::mutex outMutex;
  std::atomic<size_t> next{0};
  std::vector<std::thread> pool;
  pool.reserve(workers);
  for (unsigned t = 0; t < workers; ++t) {
    pool.emplace_back([&]() {
      for (;;) {
        const size_t index = next.fetch_add(1, std::memory_order_relaxed);
        if (index >= run.jobs.size()) break;
        const BenchJob& job = run.jobs[index];
        std::ostringstream buffer;
        JsonObserver observer(factionCount, options.audit, buffer);
        // The game itself runs outside the lock: only the row it feeds is shared.
        const BenchGameResult result =
            playBenchGame(options, run.configs[job.faction], job.faction, run.factions[job.faction], job.game,
                          job.gamesInFaction, benchGameSeed(options, job.faction, job.game), observer);
        {
          std::lock_guard<std::mutex> lock(rowsMutex);
          foldBenchResult(run.rows[job.faction], result);
          observer.onGameEnd(job.faction, run.rows[job.faction], result.win, result.margin);
          observer.onRows(run.rows);
        }
        std::lock_guard<std::mutex> lock(outMutex);
        std::cout << buffer.str();
        std::cout.flush();
      }
    });
  }
  for (std::thread& thread : pool) thread.join();
  JsonObserver observer(factionCount, options.audit, std::cout);
  return finishBenchRun(run.rows, observer);
}

}  // namespace ipvgo::nn
