#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <initializer_list>
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

// SimpleBoard: column-major, board[x][y], where board[x] is a column and y=0 is
// the bottom row (matches the game). North=+y, East=+x, South=-y, West=-x.
//
// The game hands us a string[] (one string per column). We keep the exact same
// indexing but store the cells in one inline buffer: no heap, no per-column
// strings, and a board copy is a single memcpy.
class SimpleBoard {
 public:
  static constexpr int kMaxSize = 19;  // 19x19 is the largest subnet

  // board[x] yields one column; board[x][y] is a single cell.
  class Column {
   public:
    Column(char* data, int length) : data_(data), length_(length) {}
    char& operator[](int y) const { return data_[y]; }
    int size() const { return length_; }
    const char* data() const { return data_; }
    Column& operator=(const char* text) {
      std::memcpy(data_, text, static_cast<size_t>(length_));
      return *this;
    }
    Column& operator=(const std::string& text) {
      std::memcpy(data_, text.data(), static_cast<size_t>(length_));
      return *this;
    }

   private:
    char* data_;
    int length_;
  };

  class ConstColumn {
   public:
    ConstColumn(const char* data, int length) : data_(data), length_(length) {}
    char operator[](int y) const { return data_[y]; }
    int size() const { return length_; }
    const char* data() const { return data_; }

   private:
    const char* data_;
    int length_;
  };

  SimpleBoard() = default;
  explicit SimpleBoard(int size, char fill = '.') { reset(size, fill); }
  SimpleBoard(int size, const std::string& filler) { reset(size, filler.empty() ? '.' : filler[0]); }
  SimpleBoard(std::initializer_list<const char*> columns) {
    reset(static_cast<int>(columns.size()));
    int x = 0;
    for (const char* text : columns) {
      Column column(columnPtr(x++), size_);
      column = text;
    }
  }

  void reset(int size, char fill = '.') {
    size_ = size < 0 ? 0 : (size > kMaxSize ? kMaxSize : size);
    cells_.fill(fill);
  }
  void assign(int size, const std::string& filler) { reset(size, filler.empty() ? '.' : filler[0]); }

  int size() const { return size_; }
  bool empty() const { return size_ == 0; }
  void clear() { size_ = 0; }

  Column operator[](int x) { return Column(columnPtr(x), size_); }
  ConstColumn operator[](int x) const { return ConstColumn(column(x), size_); }

  char* column(int x) { return columnPtr(x); }
  const char* column(int x) const { return cells_.data() + static_cast<ptrdiff_t>(x) * size_; }

  bool operator==(const SimpleBoard& other) const {
    if (size_ != other.size_) return false;
    const size_t bytes = static_cast<size_t>(size_) * static_cast<size_t>(size_);
    return std::memcmp(cells_.data(), other.cells_.data(), bytes) == 0;
  }
  bool operator!=(const SimpleBoard& other) const { return !(*this == other); }

 private:
  char* columnPtr(int x) { return cells_.data() + static_cast<ptrdiff_t>(x) * size_; }

  std::array<char, kMaxSize * kMaxSize> cells_{};
  int size_ = 0;
};

// Packs a board at 2 bits per cell in the game's column-major order:
// '.' = 0, 'X' = 1, 'O' = 2, '#' = 3. Unused high bits of the last word are 0.
inline void packBoard(const SimpleBoard& board, uint64_t* out, int stride) {
  for (int i = 0; i < stride; ++i) out[i] = 0;
  const int n = board.size();
  int bit = 0;
  for (int x = 0; x < n; ++x) {
    const char* col = board.column(x);
    for (int y = 0; y < n; ++y) {
      uint64_t code = 0;
      switch (col[y]) {
        case 'X': code = 1; break;
        case 'O': code = 2; break;
        case '#': code = 3; break;
        default: break;
      }
      out[bit >> 6] |= code << (bit & 63);
      bit += 2;
    }
  }
}

// Packed superko history. Each entry is a board packed at 2 bits per cell, so a
// whole history is one allocation, a comparison is a few word compares, and the
// count of entries a search copies is one memcpy instead of one string each.
class BoardHistory {
 public:
  BoardHistory() = default;
  // A copy is made for every candidate move and is then immediately appended to,
  // so leave a little headroom: otherwise the copy's buffer is always exactly
  // full and the next append always reallocates.
  BoardHistory(const BoardHistory& other) : words_(other.words_), stride_(other.stride_), count_(other.count_) {
    if (count_ > 0) words_.reserve(static_cast<size_t>(count_ + 8) * static_cast<size_t>(stride_));
  }
  BoardHistory& operator=(const BoardHistory& other) {
    if (this == &other) return *this;
    words_ = other.words_;
    stride_ = other.stride_;
    count_ = other.count_;
    if (count_ > 0) words_.reserve(static_cast<size_t>(count_ + 8) * static_cast<size_t>(stride_));
    return *this;
  }
  BoardHistory(BoardHistory&&) noexcept = default;
  BoardHistory& operator=(BoardHistory&&) noexcept = default;

  static int strideFor(int n) { return (n * n * 2 + 63) / 64; }

  void clear() {
    words_.clear();
    count_ = 0;
  }
  int size() const { return count_; }
  bool empty() const { return count_ == 0; }
  void reserve(int boards) {
    if (stride_ > 0) words_.reserve(static_cast<size_t>(boards) * static_cast<size_t>(stride_));
  }

  void append(const SimpleBoard& board) {
    const int n = board.size();
    const int stride = strideFor(n);
    if (stride != stride_) {
      // A different board size invalidates the packed layout; histories never
      // mix sizes, so restart cleanly.
      words_.clear();
      count_ = 0;
      stride_ = stride;
    }
    words_.resize(static_cast<size_t>(count_ + 1) * static_cast<size_t>(stride));
    packBoard(board, words_.data() + static_cast<size_t>(count_) * static_cast<size_t>(stride), stride);
    ++count_;
  }

  bool contains(const SimpleBoard& board) const {
    if (count_ == 0) return false;
    const int n = board.size();
    if (strideFor(n) != stride_) return false;
    uint64_t probe[12];
    packBoard(board, probe, stride_);
    for (int i = 0; i < count_; ++i) {
      const uint64_t* entry = words_.data() + static_cast<size_t>(i) * static_cast<size_t>(stride_);
      if (std::memcmp(entry, probe, sizeof(uint64_t) * static_cast<size_t>(stride_)) == 0) return true;
    }
    return false;
  }

  // Drops the most recent entry; keeps the buffer so append/undo pairs do not
  // allocate.
  void pop() {
    if (count_ == 0) return;
    --count_;
    words_.resize(static_cast<size_t>(count_) * static_cast<size_t>(stride_));
  }

  // Word view of entry i, for hashing.
  const uint64_t* entryWords(int i) const {
    return words_.data() + static_cast<size_t>(i) * static_cast<size_t>(stride_);
  }
  int stride() const { return stride_; }

 private:
  std::vector<uint64_t> words_;
  int stride_ = 0;
  int count_ = 0;
};

// Membership mask over board points (x*N+y). Replaces std::unordered_set<int>
// for "have I seen this point" checks, which were a top allocation site and
// only ever needed a bit test.
class PointMask {
 public:
  void clear() { words_.fill(0); }
  void insert(int idx) { words_[static_cast<size_t>(idx) >> 6] |= 1ULL << (idx & 63); }
  bool count(int idx) const { return ((words_[static_cast<size_t>(idx) >> 6] >> (idx & 63)) & 1ULL) != 0; }
  bool empty() const {
    for (const uint64_t word : words_) {
      if (word != 0) return false;
    }
    return true;
  }

 private:
  std::array<uint64_t, 6> words_{};  // 6 x 64 covers 19x19 = 361
};

struct GameState {
  SimpleBoard board;
  int size = 0;
  Color previousPlayer = Color::White;  // meaningful only when !gameOver
  bool gameOver = false;
  BoardHistory previousBoards;  // superko history (packed, see BoardHistory)
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
// Storage is inline and fixed capacity (19x19 = 361 points is the largest
// subnet), so building one allocates nothing at all: this runs on every
// legality test, move application and policy query.
struct ChainSet {
  static constexpr int kMaxPoints = 361;

  int N = 0;
  int count = 0;
  std::array<int, kMaxPoints> id;           // size N*N, -1 for offline
  std::array<char, kMaxPoints> chainColor;  // per chain
  std::array<int, kMaxPoints + 1> memberOffsets;   // count + 1 offsets into memberData
  std::array<int, kMaxPoints> memberData;          // per chain, flat indices
  std::array<int, kMaxPoints + 1> libertyOffsets;  // count + 1 offsets into libertyData
  std::array<int, kMaxPoints> libertyData;         // per chain, flat indices (unique empty neighbors)

  ChainSpan members(int c) const {
    if (c < 0 || c + 1 >= count + 1) return {};
    return {memberData.data() + memberOffsets[c], memberOffsets[c + 1] - memberOffsets[c]};
  }
  ChainSpan liberties(int c) const {
    if (c < 0 || c + 1 >= count + 1) return {};
    return {libertyData.data() + libertyOffsets[c], libertyOffsets[c + 1] - libertyOffsets[c]};
  }
  int libertyCount(int c) const {
    if (c < 0 || c + 1 >= count + 1) return 0;
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
// Reference implementation: a full-board ChainSet flood fill. updateCaptures()
// uses the bitwise sweep; this stays as the oracle the tests compare against.
void updateCapturesFloodFill(SimpleBoard& board, Color playerWhoMoved);
SimpleBoard evaluateMoveResult(const SimpleBoard& board, int x, int y, Color player);

// ---- Rules ---------------------------------------------------------------

Validity evaluateIfMoveIsValid(const GameState& state, int x, int y, Color player,
                               SimpleBoard* resultBoard = nullptr);
bool makeMove(GameState& state, int x, int y, Color player);
void passTurn(GameState& state, Color player, bool allowEndGame = true);

// Undo record for one applied move or pass, so a search can mutate a single
// GameState instead of copying it for every candidate move.
struct MoveUndo {
  SimpleBoard board;  // cells before the move; only meaningful when `moved`
  Color previousPlayer = Color::White;
  int passCount = 0;
  bool gameOver = false;
  bool moved = false;
};

// Applies the move in place. On an illegal move the state is left untouched and
// false is returned.
bool applyMove(GameState& state, int x, int y, Color player, MoveUndo& undo);
void applyPass(GameState& state, Color player, MoveUndo& undo);
void undoMove(GameState& state, const MoveUndo& undo);

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
