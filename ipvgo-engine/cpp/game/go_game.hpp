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

// Connected-component data for a board. Chains include empty regions as well as
// stone groups (mirrors getAllChains). Liberties are the unique empty neighbors
// of a chain. Offline cells have id -1.
struct ChainSet {
  int N = 0;
  int count = 0;
  std::vector<int> id;                        // size N*N, -1 for offline
  std::vector<char> chainColor;               // per chain
  std::vector<std::vector<int>> members;      // per chain, flat indices
  std::vector<std::vector<int>> liberties;    // per chain, flat indices (unique empty neighbors)

  int libertyCount(int c) const { return static_cast<int>(liberties[c].size()); }
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

Validity evaluateIfMoveIsValid(const GameState& state, int x, int y, Color player);
bool makeMove(GameState& state, int x, int y, Color player);
void passTurn(GameState& state, Color player, bool allowEndGame = true);

Color whoseTurn(const GameState& state);  // returns Empty if game over
std::vector<std::pair<int, int>> getEmptySpaces(const SimpleBoard& board);
std::vector<std::pair<int, int>> getAllValidMoves(const GameState& state, Color player);

// ---- Scoring -------------------------------------------------------------

double getKomi(const GameState& state);
Score getScore(const GameState& state);
inline bool blackWins(const Score& s) { return s.blackSum >= s.whiteSum; }

}  // namespace ipvgo::game
