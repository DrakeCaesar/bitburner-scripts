#include "bench_tui.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

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
  virtual void onGameStart(size_t index, const std::string& faction, int game, int games) = 0;
  virtual void onThinking(size_t index, const GameState& state, int game, int move) = 0;
  virtual void onBlackMove(size_t index, const GameState& state, int game, int move,
                           const ExploitResult& search, double elapsedMs, bool passed) = 0;
  virtual void onWhiteReply(size_t index, const GameState& state, int game, int move, const Play& play) = 0;
  virtual void onGameEnd(size_t index, const FactionBenchRow& row, bool win, double margin) = 0;
  virtual void onRows(const std::vector<FactionBenchRow>& rows) = 0;
  virtual void onFinish(const std::vector<FactionBenchRow>& rows, int failures) = 0;
};

int runBenchGames(const BenchOptions& options, BenchObserver& observer) {
  const std::vector<std::string> factions =
      options.factions.empty() ? defaultFactions(options.size) : options.factions;
  if (factions.empty()) return 0;

  std::vector<FactionBenchRow> rows(factions.size());
  for (size_t i = 0; i < factions.size(); ++i) rows[i].faction = factions[i];
  observer.onRows(rows);

  ExploitConfig cfg;
  cfg.budgetMs = options.budgetMs;
  cfg.nodeLimit = options.iterations;
  cfg.depth = options.depth;
  cfg.maxDepth = options.maxDepth;
  cfg.beam = options.beam;
  cfg.whiteChildren = options.whiteChildren;
  cfg.whiteMass = options.whiteMass;
  cfg.endgameEmpties = options.endgameEmpties;
  cfg.nodeBudget = options.nodeBudget;
  cfg.threads = options.threads;
  cfg.deterministic = true;  // a benchmark has to be repeatable
  // IPVGO_DYNAMIC=1 measures the scheduler play actually uses, at the cost of
  // repeatability.
  if (std::getenv("IPVGO_DYNAMIC") != nullptr) cfg.deterministic = false;
  cfg.carry = options.carry;

  std::mt19937_64 rng(options.seed ? options.seed : 1);

  for (size_t f = 0; f < factions.size(); ++f) {
    const Opponent ai = parseOpponent(factions[f]).value_or(Opponent::Netburners);

    for (int g = 0; g < options.gamesPerFaction; ++g) {
      if (!options.only.empty()) {
        const std::string tag = factions[f] + ":" + std::to_string(g + 1);
        if (std::find(options.only.begin(), options.only.end(), tag) == options.only.end()) continue;
        rng.seed((options.seed ? options.seed : 1) * 1000003ull + f * 1009ull + static_cast<uint64_t>(g));
      }
      const double clockMs = static_cast<double>(rng() % 30000000u);
      const uint64_t mathSeed = rng();
      MathRandom mathRng(mathSeed);
      GameState state = newBoardState(options.size, ai, true, clockMs, mathRng);
      observer.onGameStart(f, factions[f], g + 1, options.gamesPerFaction);

      SearchSession session;
      const int moveCap = options.size * options.size * 4;
      for (int m = 0; m < moveCap && !state.gameOver; ++m) {
        if (whoseTurn(state) != Color::Black) break;

        observer.onThinking(f, state, g + 1, m + 1);
        const auto t0 = std::chrono::steady_clock::now();
        const ExploitResult search = runExploiter(state, cfg, nullptr, options.carry ? &session : nullptr);
        const double elapsedMs =
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();

        const int action = search.bestAction;
        const bool passed = action == passAction(options.size);
        if (passed) {
          passTurn(state, Color::Black);
        } else if (!makeMove(state, action / options.size, action % options.size, Color::Black)) {
          passTurn(state, Color::Black);
        }

        rows[f].moves += 1;
        rows[f].msSum += elapsedMs;
        observer.onBlackMove(f, state, g + 1, m + 1, search, elapsedMs, passed);

        if (state.gameOver) break;

        const Play whitePlay =
            getMove(state, Color::White, ai, static_cast<double>(rng() % 30000000u), mathRng);
        if (whitePlay.type == PlayType::Pass) {
          passTurn(state, Color::White);
        } else if (!makeMove(state, whitePlay.x, whitePlay.y, Color::White)) {
          passTurn(state, Color::White);
        }
        observer.onWhiteReply(f, state, g + 1, m + 1, whitePlay);
      }

      const Score score = getScore(state);
      const double margin = score.blackSum - score.whiteSum;
      const bool win = blackWins(score);
      rows[f].games += 1;
      if (win) rows[f].wins += 1;
      else rows[f].losses += 1;
      rows[f].marginSum += margin;

      observer.onGameEnd(f, rows[f], win, margin);
      observer.onRows(rows);
    }
  }

  int failures = 0;
  for (const FactionBenchRow& row : rows) {
    if (row.games == 0 || row.wins != row.games) ++failures;
  }
  observer.onFinish(rows, failures);
  return failures;
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

  void onGameStart(size_t index, const std::string& faction, int game, int games) override {
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
  explicit JsonObserver(size_t factionCount) : factionCount_(factionCount) {}

  void onGameStart(size_t index, const std::string& faction, int game, int games) override {
    faction_ = faction;
    game_ = game;
    games_ = games;
    emit({{"type", "gameStart"},
          {"faction", faction},
          {"factionIndex", index},
          {"factionCount", factionCount_},
          {"game", game},
          {"games", games}});
  }

  void onThinking(size_t, const GameState& state, int game, int move) override {
    const Score score = getScore(state);
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
    emit({{"type", "move"},
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
          {"whiteScore", score.whiteSum}});
  }

  void onWhiteReply(size_t, const GameState& state, int game, int move, const Play& play) override {
    const Score score = getScore(state);
    emit({{"type", "reply"},
          {"faction", faction_},
          {"game", game},
          {"move", move},
          {"white", play.type == PlayType::Pass ? json(nullptr) : json{{"x", play.x}, {"y", play.y}}},
          {"pass", play.type == PlayType::Pass},
          {"board", boardJson(state.board)},
          {"blackScore", score.blackSum},
          {"whiteScore", score.whiteSum}});
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
    const std::string line = event.dump();
    std::fwrite(line.data(), 1, line.size(), stdout);
    std::fputc('\n', stdout);
    std::fflush(stdout);
  }

  size_t factionCount_ = 0;
  std::string faction_;
  int game_ = 0;
  int games_ = 0;
};

}  // namespace

int runExploitBench(const BenchOptions& options) {
  const std::vector<std::string> factions =
      options.factions.empty() ? defaultFactions(options.size) : options.factions;
  if (factions.empty()) return 0;

  LiveObserver observer(options, factions.size());
  return runBenchGames(options, observer);
}

int runExploitBenchJson(const BenchOptions& options) {
  const std::vector<std::string> factions =
      options.factions.empty() ? defaultFactions(options.size) : options.factions;
  if (factions.empty()) return 0;

  JsonObserver observer(factions.size());
  return runBenchGames(options, observer);
}

}  // namespace ipvgo::nn
