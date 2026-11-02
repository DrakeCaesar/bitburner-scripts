#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace ipvgo::game {

// Board characters match the game's SimpleBoard serialization exactly:
//   'X' black, 'O' white, '.' empty, '#' offline/blocked.
enum class Color : char { Empty = '.', Black = 'X', White = 'O', Offline = '#' };

enum class Opponent {
  None,
  Netburners,
  SlumSnakes,
  TheBlackHand,
  Tetrads,
  Daedalus,
  Illuminati,
  WorldDaemon,
};

enum class Validity {
  PointBroken,
  PointNotEmpty,
  BoardRepeated,
  NoSuicide,
  NotYourTurn,
  GameOver,
  Invalid,
  Valid,
};

enum class PlayType { Move, Pass, GameOver };

struct Play {
  PlayType type = PlayType::Pass;
  int x = -1;
  int y = -1;
};

// SimpleBoard: column-major. board[x][y], where board[x] is a column string and
// y=0 is the bottom row (matches the game). North=+y, East=+x, South=-y, West=-x.
using SimpleBoard = std::vector<std::string>;

struct GameState {
  SimpleBoard board;
  int size = 0;
  Color previousPlayer = Color::White;  // meaningful only when !gameOver
  bool gameOver = false;
  std::vector<std::string> previousBoards;  // front = most recent (matches unshift)
  Opponent ai = Opponent::Netburners;
  int passCount = 0;
  int cheatCount = 0;
  int cheatCountForWhite = 0;
  double komiOverride = 0;
  bool hasKomiOverride = false;
};

struct Score {
  double whitePieces = 0;
  double whiteTerritory = 0;
  double komi = 0;
  double whiteSum = 0;
  double blackPieces = 0;
  double blackTerritory = 0;
  double blackSum = 0;
};

// A chain's cells or liberties: a view into the ChainSet's flat storage. Cheap
// to copy, does not own memory, and keeps the flat arrays cache friendly.
struct ChainSpan {
  const int* first = nullptr;
  int count = 0;
  const int* begin() const { return first; }
  const int* end() const { return first + count; }
  int size() const { return count; }
  bool empty() const { return count == 0; }
  int operator[](int i) const { return first[i]; }
};

// Connected-component data for a board. Chains include empty regions as well as
// stone groups (mirrors getAllChains). Liberties are the unique empty neighbors
// of a chain. Offline cells have id -1.
//
// Members and liberties live in flat CSR arrays (offsets + data) instead of a
// vector<vector<int>>: a board-wide flood fill happens on every legality test,
// move application and policy query, and the per-chain heap vectors were the
// single largest source of allocations.
struct ChainSet {
  int N = 0;
  int count = 0;
  std::vector<int> id;           // size N*N, -1 for offline
  std::vector<char> chainColor;  // per chain
  std::vector<int> memberOffsets;  // count + 1 offsets into memberData
  std::vector<int> memberData;     // per chain, flat indices
  std::vector<int> libertyOffsets;  // count + 1 offsets into libertyData
  std::vector<int> libertyData;     // per chain, flat indices (unique empty neighbors)

  ChainSpan members(int c) const {
    if (c < 0 || static_cast<size_t>(c) + 1 >= memberOffsets.size()) return {};
    return {memberData.data() + memberOffsets[c], memberOffsets[c + 1] - memberOffsets[c]};
  }
  ChainSpan liberties(int c) const {
    if (c < 0 || static_cast<size_t>(c) + 1 >= libertyOffsets.size()) return {};
    return {libertyData.data() + libertyOffsets[c], libertyOffsets[c + 1] - libertyOffsets[c]};
  }
  int libertyCount(int c) const {
    if (c < 0 || static_cast<size_t>(c) + 1 >= libertyOffsets.size()) return 0;
    return libertyOffsets[c + 1] - libertyOffsets[c];
  }
};

// ---- Basic helpers -------------------------------------------------------

inline char colorChar(Color c) { return static_cast<char>(c); }
inline Color oppositeColor(Color c) { return c == Color::Black ? Color::White : Color::Black; }
inline int flatIndex(int size, int x, int y) { return x * size + y; }

std::string boardString(const SimpleBoard& board);
SimpleBoard simpleBoardFromString(const std::string& s);
double opponentKomi(Opponent ai);

// ---- Chains / captures ---------------------------------------------------

ChainSet computeChains(const SimpleBoard& board);
void updateCaptures(SimpleBoard& board, Color playerWhoMoved);
SimpleBoard evaluateMoveResult(const SimpleBoard& board, int x, int y, Color player);

// ---- Rules ---------------------------------------------------------------

Validity evaluateIfMoveIsValid(const GameState& state, int x, int y, Color player,
                               SimpleBoard* resultBoard = nullptr);
bool makeMove(GameState& state, int x, int y, Color player);
void passTurn(GameState& state, Color player, bool allowEndGame = true);

Color whoseTurn(const GameState& state);  // returns Empty if game over
std::vector<std::pair<int, int>> getEmptySpaces(const SimpleBoard& board);
std::vector<std::pair<int, int>> getAllValidMoves(const GameState& state, Color player);

// ---- Scoring -------------------------------------------------------------

double getKomi(const GameState& state);
Score getScore(const GameState& state);
// Same scoring, reusing an already computed chain set (search hot path).
Score getScore(const GameState& state, const ChainSet& chains);
inline bool blackWins(const Score& s) { return s.blackSum >= s.whiteSum; }

}  // namespace ipvgo::game
