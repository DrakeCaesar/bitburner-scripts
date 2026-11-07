#include "opponents.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <optional>
#include <unordered_map>
#include <unordered_set>

#include "analysis.hpp"
#include "patterns.hpp"

namespace ipvgo::game {

namespace {

struct AiMove {
  bool valid = false;
  int x = -1;
  int y = -1;
  int oldLibertyCount = 0;
  int newLibertyCount = 0;
  bool createsLife = false;
};

struct GrowthCandidate {
  int x, y;
  int oldLibertyCount;
  int newLibertyCount;
};

int floorIndex(double rng, size_t size) { return static_cast<int>(std::floor(rng * static_cast<double>(size))); }

// ---- Liberty growth / defend ----------------------------------------------

std::vector<GrowthCandidate> getLibertyGrowthMoves(const SimpleBoard& board, Color player,
                                                   const PointMask& availableSet) {
  const ChainSet& cs = chainsCached(board);
  const int N = cs.N;
  const char me = colorChar(player);

  std::vector<GrowthCandidate> result;
  bool anyFriendly = false;
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] != me) continue;
    anyFriendly = true;
    for (const int lib : cs.liberties(c)) {
      if (!availableSet.count(lib)) continue;
      const int lx = lib / N;
      const int ly = lib % N;
      const int newLib = chainEffectiveLiberties(cs, lx, ly, player);
      const int oldLib = chainMinAdjacentLiberties(cs, lx, ly, player);
      if (newLib > 1 && newLib >= oldLib) result.push_back({lx, ly, oldLib, newLib});
    }
  }
  if (!anyFriendly) return {};
  return result;
}

AiMove getGrowthMove(const std::vector<GrowthCandidate>& growthMoves, double rng) {
  if (growthMoves.empty()) return {};
  int maxDelta = growthMoves[0].newLibertyCount - growthMoves[0].oldLibertyCount;
  for (const auto& m : growthMoves) maxDelta = std::max(maxDelta, m.newLibertyCount - m.oldLibertyCount);

  int count = 0;
  for (const auto& m : growthMoves)
    if (m.newLibertyCount - m.oldLibertyCount == maxDelta) ++count;

  const int idx = floorIndex(rng, count);
  if (idx < 0 || idx >= count) return {};
  int seen = 0;
  for (const auto& m : growthMoves) {
    if (m.newLibertyCount - m.oldLibertyCount != maxDelta) continue;
    if (seen++ != idx) continue;
    AiMove mv;
    mv.valid = true;
    mv.x = m.x;
    mv.y = m.y;
    mv.oldLibertyCount = m.oldLibertyCount;
    mv.newLibertyCount = m.newLibertyCount;
    return mv;
  }
  return {};
}

AiMove getDefendMove(const std::vector<GrowthCandidate>& growthMoves, MathRandom& mathRng) {
  bool anyIncrease = false;
  int maxDelta = 0;
  for (const auto& m : growthMoves) {
    if (m.oldLibertyCount > 1) continue;
    const int delta = m.newLibertyCount - m.oldLibertyCount;
    if (delta <= 0) continue;
    anyIncrease = true;
    maxDelta = std::max(maxDelta, delta);
  }
  if (!anyIncrease || maxDelta < 1) return {};

  int count = 0;
  for (const auto& m : growthMoves) {
    if (m.oldLibertyCount > 1) continue;
    if (m.newLibertyCount - m.oldLibertyCount == maxDelta) ++count;
  }

  const int idx = floorIndex(mathRng.random(), count);
  if (idx < 0 || idx >= count) return {};
  int seen = 0;
  for (const auto& m : growthMoves) {
    if (m.oldLibertyCount > 1) continue;
    if (m.newLibertyCount - m.oldLibertyCount != maxDelta) continue;
    if (seen++ != idx) continue;
    AiMove mv;
    mv.valid = true;
    mv.x = m.x;
    mv.y = m.y;
    mv.oldLibertyCount = m.oldLibertyCount;
    mv.newLibertyCount = m.newLibertyCount;
    return mv;
  }
  return {};
}

// ---- Surround / capture ----------------------------------------------------

AiMove getSurroundMove(const SimpleBoard& board, Color player, const PointMask& availableSet, bool smart) {
  const Color opposing = oppositeColor(player);
  const ChainSet& cs = chainsCached(board);
  const int N = cs.N;
  const char oppChar = colorChar(opposing);

  bool anyEnemy = false;
  for (int c = 0; c < cs.count; ++c)
    if (cs.chainColor[c] == oppChar) anyEnemy = true;
  if (!anyEnemy || availableSet.empty()) return {};

  // Only the first move of each kind is ever returned, so track those instead of
  // collecting three lists. The scan order (chain, then liberty) is the order the
  // flattened enemyLiberties list used to have, so the choice is unchanged.
  AiMove firstCapture;
  AiMove firstAtari;
  AiMove firstSurround;

  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] != oppChar) continue;
    for (const int lib : cs.liberties(c)) {
      if (!availableSet.count(lib)) continue;
      const int mx = lib / N;
      const int my = lib % N;
      const int newLibertyCount = chainEffectiveLiberties(cs, mx, my, player);

      const WeakestAdjacent weakest = chainWeakestAdjacent(cs, mx, my, opposing);
      const int weakestLength = weakest.found ? weakest.stones : 99;
      const int enemyChainLibertyCount = weakest.found ? weakest.liberties : 99;
      const int libertyGroups = weakest.libertyGroups;

      if (newLibertyCount <= 2 && enemyChainLibertyCount > 2) continue;

      AiMove mv;
      mv.valid = true;
      mv.x = mx;
      mv.y = my;
      mv.oldLibertyCount = enemyChainLibertyCount;
      mv.newLibertyCount = enemyChainLibertyCount - 1;

      if (enemyChainLibertyCount <= 1) {
        if (!firstCapture.valid) firstCapture = mv;
      } else if (enemyChainLibertyCount == 2 &&
                 (newLibertyCount >= 2 || (libertyGroups == 1 && weakestLength > 3) || !smart)) {
        if (!firstAtari.valid) firstAtari = mv;
      } else if (newLibertyCount >= 2) {
        if (!firstSurround.valid) firstSurround = mv;
      }
    }
  }

  if (firstCapture.valid) return firstCapture;
  if (firstAtari.valid) return firstAtari;
  if (firstSurround.valid) return firstSurround;
  return {};
}

// ---- Eyes ------------------------------------------------------------------

// The eye points a position offers, without materialising the list. Both callers
// only need "how many, and which was first" for each of the two kinds, which is
// what the stable sort to the front used to hand them.
struct EyeMoveSet {
  int count = 0;      // qualifying points, in scan order
  int lifeCount = 0;  // ... of which create life
  AiMove first;       // first qualifying point
  AiMove firstLife;   // first point that creates life
};

EyeMoveSet getEyeCreationMoves(const SimpleBoard& board, Color player, const PointMask& availableSet,
                               int maxLiberties) {
  // A copy: chainsCached() hands out a reference into a small ring that the
  // candidate evaluations below would evict.
  const ChainSet cs = chainsCached(board);
  const EyeBoardSummary base = summarizeEyes(board, cs, player);
  const int N = cs.N;
  const char me = colorChar(player);
  const double maxSize = eyeCandidateMaxSize(board);

  PointMask livingGroupChains;
  const int currentLivingGroups = base.totals.livingGroups;
  const int currentEyeCount = base.totals.eyeCount;
  for (int c = 0; c < cs.count; ++c) {
    if (base.perChain[static_cast<size_t>(c)] >= 2) livingGroupChains.insert(c);
  }

  // friendly liberties of chains (length>1, liberties<=maxLiberties, not already living)
  std::vector<int> friendlyLiberties;  // flat idxs (with duplicates), preserving order
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] != me) continue;
    if (cs.members(c).size() <= 1) continue;
    if (static_cast<int>(cs.liberties(c).size()) > maxLiberties) continue;
    if (livingGroupChains.count(c)) continue;
    for (const int lib : cs.liberties(c)) {
      if (!availableSet.count(lib)) continue;
      const int px = lib / N;
      const int py = lib % N;
      // >=2 neighbors that are friendly-or-wall, and at least one empty neighbor.
      int friendlyOrWall = 0;
      bool anyEmpty = false;
      for (const auto& [dx, dy] : {std::pair<int, int>{0, 1}, {1, 0}, {0, -1}, {-1, 0}}) {
        const int nx = px + dx;
        const int ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) {
          friendlyOrWall++;  // off-board counts as wall (!p)
          continue;
        }
        const char nc = board[nx][ny];
        if (nc == '#') friendlyOrWall++;  // offline counts as wall (!p)
        else if (nc == me) friendlyOrWall++;
        if (nc == '.') anyEmpty = true;
      }
      if (friendlyOrWall >= 2 && anyEmpty) friendlyLiberties.push_back(lib);
    }
  }

  // The candidate list keeps duplicates on purpose (a point touching two weak
  // chains appears twice) and each candidate would otherwise cost a board copy
  // plus a board-wide eye analysis. Remembering the verdict per point keeps the
  // output identical - the same point always evaluates the same way - while
  // halving the analysis when duplicates occur.
  EyeMoveSet result;
  std::vector<int8_t> verdict(static_cast<size_t>(N * N), -1);  // -1 unknown, 0 no, 1 life, 2 eyes
  auto evaluateCandidate = [&](int lib, bool& createsLife) {
    const int px = lib / N;
    const int py = lib % N;
    // One stone changes only the region it lands in, so the totals after the
    // move follow from the summary of the board before it. The cases that
    // reasoning does not cover (a capture, an encirclement verdict) fall back to
    // the board-wide analysis.
    EyeTotals after;
    if (!eyeTotalsAfterMove(board, cs, base, player, px, py, maxSize, after)) {
      const SimpleBoard eval = evaluateMoveResult(board, px, py, player);
      after = summarizeEyes(eval, chainsCached(eval), player).totals;
    }
    createsLife = after.livingGroups > currentLivingGroups;
    return createsLife || (after.eyeCount > currentEyeCount && after.livingGroups == currentLivingGroups);
  };

  for (const int lib : friendlyLiberties) {
    bool createsLife = false;
    int8_t& cached = verdict[static_cast<size_t>(lib)];
    if (cached < 0) {
      const bool qualifies = evaluateCandidate(lib, createsLife);
      cached = static_cast<int8_t>(qualifies ? (createsLife ? 1 : 2) : 0);
    } else {
      createsLife = cached == 1;
    }
    if (cached == 0) continue;
    AiMove mv;
    mv.valid = true;
    mv.x = lib / N;
    mv.y = lib % N;
    mv.createsLife = createsLife;
    if (result.count++ == 0) result.first = mv;
    if (createsLife) {
      if (result.lifeCount++ == 0) result.firstLife = mv;
    }
  }
  return result;
}

AiMove getEyeCreationMove(const SimpleBoard& board, Color player, const PointMask& availableSet) {
  const EyeMoveSet moves = getEyeCreationMoves(board, player, availableSet, 99);
  if (moves.lifeCount > 0) return moves.firstLife;
  return moves.count > 0 ? moves.first : AiMove{};
}

AiMove getEyeBlockingMove(const SimpleBoard& board, Color player, const PointMask& availableSet) {
  const Color opposing = oppositeColor(player);
  const EyeMoveSet opponentEyeMoves = getEyeCreationMoves(board, opposing, availableSet, 5);
  const int twoEye = opponentEyeMoves.lifeCount;
  const int oneEye = opponentEyeMoves.count - opponentEyeMoves.lifeCount;
  if (twoEye == 1) return opponentEyeMoves.firstLife;
  if (twoEye == 0 && oneEye == 1) return opponentEyeMoves.first;
  return {};
}

// ---- Corner ----------------------------------------------------------------

bool isCornerAvailableForMove(const SimpleBoard& board, int x1, int y1, int x2, int y2) {
  const int N = static_cast<int>(board.size());
  int found = 0;
  int pieces = 0;
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      if (board[x][y] == '#') continue;
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        found++;
        if (board[x][y] != '.') pieces++;
      }
    }
  }
  return found >= 7 ? pieces == 0 : false;
}

AiMove getCornerMove(const SimpleBoard& board) {
  const int N = static_cast<int>(board.size());
  const int boardEdge = N - 1;
  const int cornerMax = boardEdge - 2;
  auto make = [&](int x, int y) {
    AiMove mv;
    if (board[x][y] != '#') {
      mv.valid = true;
      mv.x = x;
      mv.y = y;
    }
    return mv;
  };
  if (isCornerAvailableForMove(board, cornerMax, cornerMax, boardEdge, boardEdge)) return make(cornerMax, cornerMax);
  if (isCornerAvailableForMove(board, 0, cornerMax, 2, boardEdge)) return make(2, cornerMax);
  if (isCornerAvailableForMove(board, 0, 0, 2, 2)) return make(2, 2);
  if (isCornerAvailableForMove(board, cornerMax, 0, boardEdge, 2)) return make(cornerMax, 2);
  return {};
}

// ---- Expansion / jump ------------------------------------------------------

AiMove pickFromPoints(const std::vector<Pt>& points, double rng) {
  if (points.empty()) return {};
  const int idx = floorIndex(rng, points.size());
  if (idx < 0 || idx >= static_cast<int>(points.size())) return {};
  AiMove mv;
  mv.valid = true;
  mv.x = points[idx].first;
  mv.y = points[idx].second;
  return mv;
}

AiMove getJumpMove(const SimpleBoard& board, Color player, const std::vector<Pt>& expansionMoves, double rng) {
  const int N = static_cast<int>(board.size());
  const char me = colorChar(player);
  std::vector<Pt> options;
  for (const auto& [x, y] : expansionMoves) {
    const bool nearFriend =
        (y + 2 < N && board[x][y + 2] == me) || (x + 2 < N && board[x + 2][y] == me) ||
        (y - 2 >= 0 && board[x][y - 2] == me) || (x - 2 >= 0 && board[x - 2][y] == me);
    if (nearFriend) options.emplace_back(x, y);
  }
  return pickFromPoints(options, rng);
}

// ---- Move option provider (with caching) -----------------------------------

class MoveGen {
 public:
  MoveGen(const GameState& state, Color player, double rng, bool smart, MathRandom& mathRng,
          const std::vector<Pt>* knownValidMoves = nullptr)
      : state_(state),
        board_(state.board),
        player_(player),
        rng_(rng),
        smart_(smart),
        mathRng_(mathRng) {
    availableSpaces_ = findDisputedTerritory(state, player, smart, knownValidMoves);
    for (const auto& [x, y] : availableSpaces_) availableSet_.insert(flatIndex(state.size, x, y));
    contestedPoints_ = getDisputedTerritoryMoves(board_, availableSpaces_);
    expansionMoves_ = getExpansionMoveArray(board_, availableSpaces_);
    endGameAvailable_ = contestedPoints_.empty() && state.passCount > 0;
  }

  AiMove surround() { return cached(kSurround, [&] { return getSurroundMove(board_, player_, availableSet_, smart_); }); }

  AiMove capture() {
    const AiMove s = surround();
    return (s.valid && s.newLibertyCount == 0) ? s : AiMove{};
  }

  AiMove defend() { return cached(kDefend, [&] { return getDefendMove(growthList(), mathRng_); }); }

  AiMove defendCapture() {
    const AiMove d = defend();
    return (d.valid && d.oldLibertyCount == 1 && d.newLibertyCount > 1) ? d : AiMove{};
  }

  AiMove eyeMove() {
    return cached(kEyeMove, [&] {
      return endGameAvailable_ ? AiMove{} : getEyeCreationMove(board_, player_, availableSet_);
    });
  }

  AiMove eyeBlock() {
    return cached(kEyeBlock, [&] {
      return endGameAvailable_ ? AiMove{} : getEyeBlockingMove(board_, player_, availableSet_);
    });
  }

  AiMove pattern() {
    return cached(kPattern, [&] {
      if (endGameAvailable_) return AiMove{};
      // The pool patternPoints() builds is exactly the list this used to rebuild by
      // scanning every point a second time with the same board, set and smartness.
      return pickFromPoints(patternPoints(), rng_);
    });
  }

  AiMove growth() {
    return cached(kGrowth, [&] {
      if (endGameAvailable_) return AiMove{};
      return getGrowthMove(growthList(), rng_);
    });
  }

  AiMove expansion() { return cached(kExpansion, [&] { return pickFromPoints(expansionMoves_, rng_); }); }

  AiMove jump() { return cached(kJump, [&] { return getJumpMove(board_, player_, expansionMoves_, rng_); }); }

  AiMove corner() { return cached(kCorner, [&] { return getCornerMove(board_); }); }

  AiMove random() {
    return cached(kRandom, [&] {
      if (contestedPoints_.empty()) return AiMove{};
      return pickFromPoints(availableSpaces_, rng_);
    });
  }

  const std::vector<Pt>& availableSpaces() const { return availableSpaces_; }
  const std::vector<Pt>& expansionMoves() const { return expansionMoves_; }

  std::vector<Pt> growthMaxDeltaPoints() const {
    if (endGameAvailable_) return {};
    const std::vector<GrowthCandidate>& growthMoves = growthList();
    if (growthMoves.empty()) return {};
    int maxDelta = growthMoves[0].newLibertyCount - growthMoves[0].oldLibertyCount;
    for (const auto& m : growthMoves) maxDelta = std::max(maxDelta, m.newLibertyCount - m.oldLibertyCount);
    std::vector<Pt> out;
    for (const auto& m : growthMoves) {
      if (m.newLibertyCount - m.oldLibertyCount == maxDelta) out.emplace_back(m.x, m.y);
    }
    return out;
  }

  // The pattern pool, computed at most once per position: the policy model wants it,
  // the faction tables draw from it, and the Illuminati fallback adds its points, so
  // it used to be rebuilt three or four times per position.
  const std::vector<Pt>& patternPoints() const {
    if (patternCacheReady_) return patternCache_;
    patternCacheReady_ = true;
    patternCache_.clear();
    if (endGameAvailable_) return patternCache_;
    const int N = static_cast<int>(board_.size());
    // The smart filter needs the liberty count of the chain the stone would join,
    // which the cached chain set already knows.
    const ChainSet& cs = chainsCached(board_);
    // Membership first: the available set is a small subset of the board, and both
    // tests are pure, so this keeps the points and their order while skipping the
    // pattern match for most of them.
    for (int x = 0; x < N; ++x) {
      for (int y = 0; y < N; ++y) {
        if (!availableSet_.count(flatIndex(N, x, y))) continue;
        if (!matchesAnyPattern(board_, x, y, player_)) continue;
        if (smart_ && chainEffectiveLiberties(cs, x, y, player_) <= 1) continue;
        patternCache_.emplace_back(x, y);
      }
    }
    return patternCache_;
  }

  // The liberty-growth candidates, computed at most once per position. growth(),
  // growthMaxDeltaPoints(), defendPoints() and defendCapturePoints() all derive
  // from this same list.
  const std::vector<GrowthCandidate>& growthList() const {
    if (!growthCacheReady_) {
      growthCache_ = getLibertyGrowthMoves(board_, player_, availableSet_);
      growthCacheReady_ = true;
    }
    return growthCache_;
  }

  std::vector<Pt> jumpOptions() const {
    const int N = static_cast<int>(board_.size());
    const char me = colorChar(player_);
    std::vector<Pt> options;
    for (const auto& [x, y] : expansionMoves_) {
      const bool nearFriend =
          (y + 2 < N && board_[x][y + 2] == me) || (x + 2 < N && board_[x + 2][y] == me) ||
          (y - 2 >= 0 && board_[x][y - 2] == me) || (x - 2 >= 0 && board_[x - 2][y] == me);
      if (nearFriend) options.emplace_back(x, y);
    }
    return options;
  }

  // Every point getDefendMove() can return for this position.
  std::vector<Pt> defendPoints() const { return defendPointList(false); }

  // The defendCapture() subset: chains going from one liberty to safety.
  std::vector<Pt> defendCapturePoints() const { return defendPointList(true); }

  bool hasContested() const { return !contestedPoints_.empty(); }

  void addFallbackCandidates(const GameState& state, Color player, PointMask& seen,
                             std::vector<Pt>& out) {
    const int N = state.size;
    auto consider = [&](const AiMove& m) {
      if (!m.valid || evaluateIfMoveIsValid(state, m.x, m.y, player) != Validity::Valid) return;
      const int idx = flatIndex(N, m.x, m.y);
      if (seen.count(idx)) return;
      seen.insert(idx);
      out.emplace_back(m.x, m.y);
    };
    consider(growth());
    consider(surround());
    consider(defend());
    consider(expansion());
    consider(pattern());
    consider(eyeMove());
    consider(eyeBlock());
  }

 private:
  enum Kind { kSurround, kDefend, kEyeMove, kEyeBlock, kPattern, kGrowth, kExpansion, kJump, kCorner, kRandom, kCount };

  // Mirrors getDefendMove(): max liberty gain among chains already in atari.
  std::vector<Pt> defendPointList(bool captureOnly) const {
    const std::vector<GrowthCandidate>& growthMoves = growthList();
    std::vector<GrowthCandidate> increases;
    for (const auto& m : growthMoves)
      if (m.oldLibertyCount <= 1 && m.newLibertyCount > m.oldLibertyCount) increases.push_back(m);
    if (increases.empty()) return {};

    int maxDelta = increases[0].newLibertyCount - increases[0].oldLibertyCount;
    for (const auto& m : increases) maxDelta = std::max(maxDelta, m.newLibertyCount - m.oldLibertyCount);

    std::vector<Pt> out;
    for (const auto& m : increases) {
      if (m.newLibertyCount - m.oldLibertyCount != maxDelta) continue;
      if (captureOnly && !(m.oldLibertyCount == 1 && m.newLibertyCount > 1)) continue;
      out.emplace_back(m.x, m.y);
    }
    return out;
  }

  template <typename F>
  AiMove cached(Kind k, F&& compute) {
    if (!computed_[k]) {
      cache_[k] = compute();
      computed_[k] = true;
    }
    return cache_[k];
  }

  const GameState& state_;
  const SimpleBoard& board_;
  Color player_;
  double rng_;
  bool smart_;
  MathRandom& mathRng_;

  std::vector<Pt> availableSpaces_;
  PointMask availableSet_;
  std::vector<Pt> contestedPoints_;
  std::vector<Pt> expansionMoves_;
  bool endGameAvailable_ = false;

  mutable std::vector<GrowthCandidate> growthCache_;
  mutable bool growthCacheReady_ = false;
  mutable std::vector<Pt> patternCache_;
  mutable bool patternCacheReady_ = false;

  std::array<AiMove, kCount> cache_{};
  std::array<bool, kCount> computed_{};
};

void addIlluminatiCandidates(MoveGen& gen, const GameState& state, Color player, PointMask& seen,
                             std::vector<Pt>& out) {
  const int N = state.size;
  auto addValid = [&](int x, int y) {
    if (evaluateIfMoveIsValid(state, x, y, player) != Validity::Valid) return;
    const int idx = flatIndex(N, x, y);
    if (seen.count(idx)) return;
    seen.insert(idx);
    out.emplace_back(x, y);
  };
  auto addAi = [&](const AiMove& m) {
    if (m.valid) addValid(m.x, m.y);
  };

  addAi(gen.capture());
  addAi(gen.defendCapture());
  addAi(gen.eyeMove());
  const AiMove surround = gen.surround();
  if (surround.valid && surround.newLibertyCount <= 1) addValid(surround.x, surround.y);
  addAi(gen.eyeBlock());
  addAi(gen.corner());
  for (const auto& [x, y] : gen.patternPoints()) addValid(x, y);
  for (const auto& [x, y] : gen.jumpOptions()) addValid(x, y);
  if (surround.valid && surround.newLibertyCount <= 2) addValid(surround.x, surround.y);
}

std::vector<Pt> enumerateFactionMovesImpl(const GameState& state, Color player, Opponent opponent,
                                          MathRandom& mathRng) {
  WHRNG rng(0.0);
  const bool smart = isSmart(opponent, rng.random());
  MoveGen gen(state, player, 0.0, smart, mathRng);

  PointMask seen;
  std::vector<Pt> out;
  const int N = state.size;

  auto addValid = [&](int x, int y) {
    if (evaluateIfMoveIsValid(state, x, y, player) != Validity::Valid) return;
    const int idx = flatIndex(N, x, y);
    if (seen.count(idx)) return;
    seen.insert(idx);
    out.emplace_back(x, y);
  };

  auto addAi = [&](const AiMove& m) {
    if (m.valid) addValid(m.x, m.y);
  };

  addAi(gen.surround());
  addAi(gen.defend());
  addAi(gen.eyeMove());
  addAi(gen.eyeBlock());
  for (const auto& [x, y] : gen.patternPoints()) addValid(x, y);
  for (const auto& [x, y] : gen.growthMaxDeltaPoints()) addValid(x, y);
  for (const auto& [x, y] : gen.expansionMoves()) addValid(x, y);
  for (const auto& [x, y] : gen.jumpOptions()) addValid(x, y);
  addAi(gen.corner());
  for (const auto& [x, y] : gen.availableSpaces()) addValid(x, y);
  gen.addFallbackCandidates(state, player, seen, out);

  return out;
}

std::vector<Pt> enumerateNetburnersMovesImpl(const GameState& state, Color player, MathRandom& mathRng) {
  MoveGen gen(state, player, 0.0, false, mathRng);

  PointMask seen;
  std::vector<Pt> out;
  const int N = state.size;

  auto addValid = [&](int x, int y) {
    if (evaluateIfMoveIsValid(state, x, y, player) != Validity::Valid) return;
    const int idx = flatIndex(N, x, y);
    if (seen.count(idx)) return;
    seen.insert(idx);
    out.emplace_back(x, y);
  };

  // 20% branch: any move Illuminati priority could return.
  addIlluminatiCandidates(gen, state, player, seen, out);
  // 20% expansion, 20% growth, 15% random-from-contested pools.
  for (const auto& [x, y] : gen.expansionMoves()) addValid(x, y);
  for (const auto& [x, y] : gen.growthMaxDeltaPoints()) addValid(x, y);
  for (const auto& [x, y] : gen.availableSpaces()) addValid(x, y);
  // getMove fallback when netburnersMove returns null.
  gen.addFallbackCandidates(state, player, seen, out);

  return out;
}

// ---- Faction priority tables ----------------------------------------------

std::optional<Pt> asPt(const AiMove& m) {
  if (!m.valid) return std::nullopt;
  return Pt{m.x, m.y};
}

std::optional<Pt> illuminatiMove(MoveGen& moves, double rng) {
  if (auto m = moves.capture(); m.valid) return asPt(m);
  if (auto m = moves.defendCapture(); m.valid) return asPt(m);
  if (auto m = moves.eyeMove(); m.valid) return asPt(m);

  const AiMove surround = moves.surround();
  if (surround.valid && surround.newLibertyCount <= 1) return Pt{surround.x, surround.y};

  if (auto m = moves.eyeBlock(); m.valid) return asPt(m);
  if (auto m = moves.corner(); m.valid) return asPt(m);

  const int hasMoves = (moves.eyeMove().valid ? 1 : 0) + (moves.eyeBlock().valid ? 1 : 0) +
                       (moves.growth().valid ? 1 : 0) + (moves.defend().valid ? 1 : 0) + (surround.valid ? 1 : 0);
  const bool usePattern = rng > 0.25 || hasMoves == 0;
  if (auto m = moves.pattern(); m.valid && usePattern) return asPt(m);

  if (rng > 0.4) {
    if (auto m = moves.jump(); m.valid) return asPt(m);
  }
  if (rng < 0.6 && surround.valid && surround.newLibertyCount <= 2) return Pt{surround.x, surround.y};
  return std::nullopt;
}

std::optional<Pt> netburnersMove(MoveGen& moves, double rng) {
  if (rng < 0.2) return illuminatiMove(moves, rng);
  if (rng < 0.4) {
    if (auto m = moves.expansion(); m.valid) return asPt(m);
  } else if (rng < 0.6) {
    if (auto m = moves.growth(); m.valid) return asPt(m);
  } else if (rng < 0.75) {
    return asPt(moves.random());
  }
  return std::nullopt;
}

std::optional<Pt> slumSnakesMove(MoveGen& moves, double rng) {
  if (auto m = moves.defendCapture(); m.valid) return asPt(m);
  if (rng < 0.2) return illuminatiMove(moves, rng);
  if (rng < 0.6) {
    if (auto m = moves.growth(); m.valid) return asPt(m);
  } else if (rng < 0.65) {
    return asPt(moves.random());
  }
  return std::nullopt;
}

std::optional<Pt> blackHandMove(MoveGen& moves, double rng) {
  if (auto m = moves.capture(); m.valid) return asPt(m);
  const AiMove surround = moves.surround();
  if (surround.valid && surround.newLibertyCount <= 1) return Pt{surround.x, surround.y};
  if (auto m = moves.defendCapture(); m.valid) return asPt(m);
  if (surround.valid && surround.newLibertyCount <= 2) return Pt{surround.x, surround.y};
  if (rng < 0.3) return illuminatiMove(moves, rng);
  if (rng < 0.75 && surround.valid) return Pt{surround.x, surround.y};
  if (rng < 0.8) return asPt(moves.random());
  return std::nullopt;
}

std::optional<Pt> tetradMove(MoveGen& moves, double rng) {
  if (auto m = moves.capture(); m.valid) return asPt(m);
  if (auto m = moves.defendCapture(); m.valid) return asPt(m);
  if (auto m = moves.pattern(); m.valid) return asPt(m);
  const AiMove surround = moves.surround();
  if (surround.valid && surround.newLibertyCount <= 1) return Pt{surround.x, surround.y};
  if (rng < 0.4) return illuminatiMove(moves, rng);
  return std::nullopt;
}

std::optional<Pt> daedalusMove(MoveGen& moves, double rng) {
  if (rng < 0.9) return illuminatiMove(moves, rng);
  return std::nullopt;
}

std::optional<Pt> factionMove(MoveGen& moves, Opponent faction, double rng) {
  switch (faction) {
    case Opponent::Netburners: return netburnersMove(moves, rng);
    case Opponent::SlumSnakes: return slumSnakesMove(moves, rng);
    case Opponent::TheBlackHand: return blackHandMove(moves, rng);
    case Opponent::Tetrads: return tetradMove(moves, rng);
    case Opponent::Daedalus: return daedalusMove(moves, rng);
    default: return illuminatiMove(moves, rng);
  }
}

// ---- Policy reply distribution ---------------------------------------------
//
// The tables above are pure functions of the third WHRNG draw (the faction
// branch rng) plus per-position move pools. To exploit the opponent we need the
// mass of every branch instead of a single sample, so each policy is restated
// here as "draw interval -> action". Pool picks inside a branch are uniform
// floorIndex() picks over pools whose contents do not depend on the draw, so
// the resulting distribution is exact.

enum class ActKind {
  Pin,            // one forced point
  GrowthPool,     // uniform over max-liberty-gain growth points
  ExpansionPool,  // uniform over expansionMoves
  PatternPool,    // uniform over matching pattern points
  JumpPool,       // uniform over expansion points two stones from a friend
  RandomPool,     // uniform over availableSpaces (moves.random())
  DefendPool,     // uniform over the defendCapture() subset
  Fallback,       // getMove()'s uniform pick over its seven fallback slots
};

struct Act {
  ActKind kind = ActKind::Fallback;
  Pt point{0, 0};
};

struct ActMass {
  double share = 0.0;
  Act act;
};

// Per-position pools, shared by every branch of one smart/dumb variant.
struct PolicyModel {
  std::vector<Pt> growth;
  std::vector<Pt> expansion;
  std::vector<Pt> pattern;
  std::vector<Pt> jump;
  std::vector<Pt> random;
  std::vector<Pt> defend;
  std::vector<Pt> defendCapture;
  bool hasSurround = false;
  Pt surround{0, 0};
  bool hasEye = false;
  Pt eye{0, 0};
  bool hasBlock = false;
  Pt block{0, 0};
  bool hasCorner = false;
  Pt corner{0, 0};
};

// Every branch threshold used by the faction tables. Evaluating the union for
// all factions is harmless because the decision is constant per interval.
constexpr double kPolicyThresholds[] = {0.2, 0.25, 0.3, 0.4, 0.6, 0.65, 0.75, 0.8, 0.9};

double smartProbability(Opponent faction) {
  switch (faction) {
    case Opponent::Netburners: return 0.0;
    case Opponent::SlumSnakes: return 0.3;
    case Opponent::TheBlackHand: return 0.8;
    default: return 1.0;
  }
}

PolicyModel buildPolicyModel(MoveGen& gen) {
  PolicyModel model;
  model.growth = gen.growthMaxDeltaPoints();
  model.expansion = gen.expansionMoves();
  model.pattern = gen.patternPoints();
  model.jump = gen.jumpOptions();
  if (gen.hasContested()) model.random = gen.availableSpaces();
  model.defend = gen.defendPoints();
  model.defendCapture = gen.defendCapturePoints();

  const AiMove surround = gen.surround();
  model.hasSurround = surround.valid;
  model.surround = {surround.x, surround.y};
  const AiMove eye = gen.eyeMove();
  model.hasEye = eye.valid;
  model.eye = {eye.x, eye.y};
  const AiMove block = gen.eyeBlock();
  model.hasBlock = block.valid;
  model.block = {block.x, block.y};
  const AiMove corner = gen.corner();
  model.hasCorner = corner.valid;
  model.corner = {corner.x, corner.y};
  return model;
}

// One branch of a faction table, holding the mass not yet assigned.
class PolicyWalker {
 public:
  PolicyWalker(const PolicyModel& model, MoveGen& gen) : model_(model), gen_(gen) {}

  const std::vector<ActMass>& resolve(Opponent opponent, double factionRng) {
    out_.clear();
    switch (opponent) {
      case Opponent::Netburners: netburners(1.0, factionRng); break;
      case Opponent::SlumSnakes: slumSnakes(1.0, factionRng); break;
      case Opponent::TheBlackHand: blackHand(1.0, factionRng); break;
      case Opponent::Tetrads: tetrads(1.0, factionRng); break;
      case Opponent::Daedalus: daedalus(1.0, factionRng); break;
      default: illuminati(1.0, factionRng); break;
    }
    return out_;
  }

 private:
  void push(double share, const Act& act) {
    if (share > 1e-12) out_.push_back({share, act});
  }
  void pushPin(double share, const AiMove& m) { push(share, Act{ActKind::Pin, {m.x, m.y}}); }
  void pushFallback(double share) { push(share, Act{ActKind::Fallback, {0, 0}}); }
  void pushPoolOrFallback(double share, const std::vector<Pt>& pool, ActKind kind) {
    if (pool.empty()) return pushFallback(share);
    push(share, Act{kind, {0, 0}});
  }

  // defendCapture() fires only when the uniform defend() pick lands on a chain
  // going from one liberty to safety, so it carries |subset|/|candidates| of the
  // branch and the rest falls through the priority list.
  double defendCaptureShare() const {
    if (model_.defend.empty()) return 0.0;
    return static_cast<double>(model_.defendCapture.size()) / static_cast<double>(model_.defend.size());
  }

  int hasMoves() const {
    return (gen_.eyeMove().valid ? 1 : 0) + (gen_.eyeBlock().valid ? 1 : 0) +
           (model_.growth.empty() ? 0 : 1) + (model_.defend.empty() ? 0 : 1) +
           (gen_.surround().valid ? 1 : 0);
  }

  void illuminati(double share, double rng) {
    if (share <= 0.0) return;
    if (gen_.capture().valid) return pushPin(share, gen_.capture());

    const double captureShare = defendCaptureShare();
    if (captureShare > 0.0) push(share * captureShare, Act{ActKind::DefendPool, {0, 0}});
    share *= (1.0 - captureShare);
    if (share <= 1e-12) return;

    if (gen_.eyeMove().valid) return pushPin(share, gen_.eyeMove());
    const AiMove surround = gen_.surround();
    if (surround.valid && surround.newLibertyCount <= 1) return pushPin(share, surround);
    if (gen_.eyeBlock().valid) return pushPin(share, gen_.eyeBlock());
    if (gen_.corner().valid) return pushPin(share, gen_.corner());

    const bool usePattern = rng > 0.25 || hasMoves() == 0;
    if (usePattern && !model_.pattern.empty()) return push(share, Act{ActKind::PatternPool, {0, 0}});
    if (rng > 0.4 && !model_.jump.empty()) return push(share, Act{ActKind::JumpPool, {0, 0}});
    if (rng < 0.6 && surround.valid && surround.newLibertyCount <= 2) return pushPin(share, surround);
    pushFallback(share);
  }

  void netburners(double share, double rng) {
    if (rng < 0.2) return illuminati(share, rng);
    if (rng < 0.4) return pushPoolOrFallback(share, model_.expansion, ActKind::ExpansionPool);
    if (rng < 0.6) return pushPoolOrFallback(share, model_.growth, ActKind::GrowthPool);
    if (rng < 0.75) return pushPoolOrFallback(share, model_.random, ActKind::RandomPool);
    pushFallback(share);
  }

  void slumSnakes(double share, double rng) {
    const double captureShare = defendCaptureShare();
    if (captureShare > 0.0) push(share * captureShare, Act{ActKind::DefendPool, {0, 0}});
    share *= (1.0 - captureShare);
    if (share <= 1e-12) return;

    if (rng < 0.2) return illuminati(share, rng);
    if (rng < 0.6) return pushPoolOrFallback(share, model_.growth, ActKind::GrowthPool);
    if (rng < 0.65) return pushPoolOrFallback(share, model_.random, ActKind::RandomPool);
    pushFallback(share);
  }

  void blackHand(double share, double rng) {
    if (gen_.capture().valid) return pushPin(share, gen_.capture());
    const AiMove surround = gen_.surround();
    if (surround.valid && surround.newLibertyCount <= 1) return pushPin(share, surround);

    const double captureShare = defendCaptureShare();
    if (captureShare > 0.0) push(share * captureShare, Act{ActKind::DefendPool, {0, 0}});
    share *= (1.0 - captureShare);
    if (share <= 1e-12) return;

    if (surround.valid && surround.newLibertyCount <= 2) return pushPin(share, surround);
    if (rng < 0.3) return illuminati(share, rng);
    if (rng < 0.75 && surround.valid) return pushPin(share, surround);
    if (rng < 0.8) return pushPoolOrFallback(share, model_.random, ActKind::RandomPool);
    pushFallback(share);
  }

  void tetrads(double share, double rng) {
    if (gen_.capture().valid) return pushPin(share, gen_.capture());

    const double captureShare = defendCaptureShare();
    if (captureShare > 0.0) push(share * captureShare, Act{ActKind::DefendPool, {0, 0}});
    share *= (1.0 - captureShare);
    if (share <= 1e-12) return;

    if (!model_.pattern.empty()) return push(share, Act{ActKind::PatternPool, {0, 0}});
    const AiMove surround = gen_.surround();
    if (surround.valid && surround.newLibertyCount <= 1) return pushPin(share, surround);
    if (rng < 0.4) return illuminati(share, rng);
    pushFallback(share);
  }

  void daedalus(double share, double rng) {
    if (rng < 0.9) return illuminati(share, rng);
    pushFallback(share);
  }

  const PolicyModel& model_;
  MoveGen& gen_;
  std::vector<ActMass> out_;
};

// Dense per-board mass accumulator; the backing storage is reused across calls.
class MassMap {
 public:
  explicit MassMap(int cells) : values_(scratchValues()), touched_(scratchTouched()) {
    if (static_cast<int>(values_.size()) < cells) values_.assign(static_cast<size_t>(cells), 0.0);
    touched_.clear();
  }
  ~MassMap() {
    for (const int idx : touched_) values_[static_cast<size_t>(idx)] = 0.0;
  }
  MassMap(const MassMap&) = delete;
  MassMap& operator=(const MassMap&) = delete;

  void add(int idx, double m) {
    double& slot = values_[static_cast<size_t>(idx)];
    if (slot == 0.0) touched_.push_back(idx);
    slot += m;
  }
  const std::vector<int>& indices() const { return touched_; }
  double at(int idx) const { return values_[static_cast<size_t>(idx)]; }

 private:
  static std::vector<double>& scratchValues() {
    thread_local std::vector<double> v;
    return v;
  }
  static std::vector<int>& scratchTouched() {
    thread_local std::vector<int> t;
    return t;
  }
  std::vector<double>& values_;
  std::vector<int>& touched_;
};

void spreadUniform(MassMap& mass, int N, const std::vector<Pt>& points, double m) {
  if (points.empty() || m <= 0.0) return;
  const double each = m / static_cast<double>(points.size());
  for (const auto& [x, y] : points) mass.add(flatIndex(N, x, y), each);
}

// getMove()'s post-priority fallback: one uniform index over the valid slots of
// [growth, surround, defend, expansion, pattern, eyeMove, eyeBlock], where the
// pool slots still pick uniformly inside their pool.
void accumulateFallback(MassMap& mass, double& passMass, const PolicyModel& model, int N, double m) {
  const int slots = (model.growth.empty() ? 0 : 1) + (model.hasSurround ? 1 : 0) + (model.defend.empty() ? 0 : 1) +
                    (model.expansion.empty() ? 0 : 1) + (model.pattern.empty() ? 0 : 1) + (model.hasEye ? 1 : 0) +
                    (model.hasBlock ? 1 : 0);
  if (slots == 0) {
    passMass += m;
    return;
  }
  const double perSlot = m / static_cast<double>(slots);
  if (!model.growth.empty()) spreadUniform(mass, N, model.growth, perSlot);
  if (model.hasSurround) mass.add(flatIndex(N, model.surround.first, model.surround.second), perSlot);
  if (!model.defend.empty()) spreadUniform(mass, N, model.defend, perSlot);
  if (!model.expansion.empty()) spreadUniform(mass, N, model.expansion, perSlot);
  if (!model.pattern.empty()) spreadUniform(mass, N, model.pattern, perSlot);
  if (model.hasEye) mass.add(flatIndex(N, model.eye.first, model.eye.second), perSlot);
  if (model.hasBlock) mass.add(flatIndex(N, model.block.first, model.block.second), perSlot);
}

void accumulateActs(MassMap& mass, double& passMass, const std::vector<ActMass>& acts,
                    const PolicyModel& model, int N, double weight) {
  for (const ActMass& am : acts) {
    const double m = am.share * weight;
    if (m <= 0.0) continue;
    switch (am.act.kind) {
      case ActKind::Pin: mass.add(flatIndex(N, am.act.point.first, am.act.point.second), m); break;
      case ActKind::GrowthPool: spreadUniform(mass, N, model.growth, m); break;
      case ActKind::ExpansionPool: spreadUniform(mass, N, model.expansion, m); break;
      case ActKind::PatternPool: spreadUniform(mass, N, model.pattern, m); break;
      case ActKind::JumpPool: spreadUniform(mass, N, model.jump, m); break;
      case ActKind::RandomPool: spreadUniform(mass, N, model.random, m); break;
      case ActKind::DefendPool: spreadUniform(mass, N, model.defendCapture, m); break;
      case ActKind::Fallback: accumulateFallback(mass, passMass, model, N, m); break;
    }
  }
}

}  // namespace

std::vector<Pt> factionConsideredSpaces(const GameState& state, Color player, Opponent opponent,
                                        double seedMs) {
  WHRNG rng(seedMs);
  const bool smart = isSmart(opponent, rng.random());
  return findDisputedTerritory(state, player, smart);
}

std::vector<std::pair<int, int>> blackExploitMoves(const GameState& state, Opponent opponent,
                                                   double seedMs) {
  const int N = state.size;
  PointMask points;

  auto add = [&](int x, int y) {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    points.insert(flatIndex(N, x, y));
  };

  for (const auto& [x, y] : factionConsideredSpaces(state, Color::White, opponent, seedMs)) add(x, y);
  for (const auto& [x, y] : findDisputedTerritory(state, Color::Black, true)) add(x, y);

  // Neighbors of white stones — AI defends/captures here.
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      if (state.board[x][y] != 'O') continue;
      for (const int nIdx : onBoardNeighbors(N, x, y)) {
        const int nx = nIdx / N;
        const int ny = nIdx % N;
        if (state.board[nx][ny] == '.') add(nx, ny);
      }
    }
  }

  std::vector<std::pair<int, int>> out;
  for (const auto& [x, y] : getAllValidMoves(state, Color::Black)) {
    const int idx = flatIndex(N, x, y);
    if (points.count(idx)) {
      out.emplace_back(x, y);
      continue;
    }
    const SimpleBoard after = evaluateMoveResult(state.board, x, y, Color::Black);
    const ChainSet cs = computeChains(after);
    bool capture = false;
    for (int c = 0; c < cs.count; ++c) {
      if (cs.chainColor[c] == 'O' && cs.liberties(c).empty()) capture = true;
    }
  if (capture) out.emplace_back(x, y);
  }

  if (out.size() < 2) return getAllValidMoves(state, Color::Black);
  return out;
}

std::vector<Pt> enumerateOpponentMoves(const GameState& state, Color player, Opponent opponent,
                                       MathRandom& mathRng) {
  if (opponent == Opponent::Netburners) return enumerateNetburnersMovesImpl(state, player, mathRng);
  return enumerateFactionMovesImpl(state, player, opponent, mathRng);
}

ReplyDist opponentReplyDistribution(const GameState& state, Color player, Opponent opponent) {
  ReplyDist dist;
  if (state.gameOver || whoseTurn(state) == Color::Empty) return dist;

  const int N = state.size;
  MathRandom mathRng(1ULL);

  // The policy builder needs one MoveGen per smartness variant; build each at
  // most once so the forced-reply check can inspect them without redoing work.
  const double smartShare = smartProbability(opponent);
  std::optional<MoveGen> genDumb;
  std::optional<MoveGen> genSmart;
  // Both variants start from the same legal-move list; compute it once.
  std::vector<Pt> sharedValid;
  const std::vector<Pt>* shared = nullptr;
  if (smartShare > 0.0 && smartShare < 1.0) {
    sharedValid = getAllValidMoves(state, player);
    shared = &sharedValid;
  }
  if (smartShare < 1.0) genDumb.emplace(state, player, 0.0, false, mathRng, shared);
  if (smartShare > 0.0) genSmart.emplace(state, player, 0.0, true, mathRng, shared);

  // Fast path: factions whose priority table always opens with a capture make
  // that capture the entire distribution when every variant agrees on it. The
  // pools then never need to be built (~400us saved per position).
  {
    const bool captureFirst =
        opponent == Opponent::TheBlackHand || opponent == Opponent::Tetrads ||
        opponent == Opponent::Illuminati || opponent == Opponent::WorldDaemon;
    if (captureFirst) {
      bool resolved = true;
      int cx = -1;
      int cy = -1;
      for (MoveGen* gen : {genDumb ? &*genDumb : nullptr, genSmart ? &*genSmart : nullptr}) {
        if (gen == nullptr) continue;
        const AiMove capture = gen->capture();
        if (!capture.valid || (cx >= 0 && (capture.x != cx || capture.y != cy))) {
          resolved = false;
          break;
        }
        cx = capture.x;
        cy = capture.y;
      }
      if (resolved && cx >= 0) {
        WeightedReply only;
        only.x = cx;
        only.y = cy;
        only.prob = 1.0;
        dist.replies.push_back(only);
        return dist;
      }
    }
  }

  MassMap mass(N * N);
  double passMass = 0.0;

  for (int variant = 0; variant < 2; ++variant) {
    const bool smart = variant == 1;
    // Both variants are mixed by the probability of the leading isSmart draw.
    const double variantWeight = smart ? smartShare : 1.0 - smartShare;
    if (variantWeight <= 0.0) continue;

    MoveGen& gen = smart ? *genSmart : *genDumb;
    const PolicyModel model = buildPolicyModel(gen);

    double lo = 0.0;
    PolicyWalker walker(model, gen);
    for (const double hi : kPolicyThresholds) {
      if (hi <= lo) continue;
      accumulateActs(mass, passMass, walker.resolve(opponent, 0.5 * (lo + hi)), model, N,
                     (hi - lo) * variantWeight);
      lo = hi;
    }
    accumulateActs(mass, passMass, walker.resolve(opponent, 0.5 * (lo + 1.0)), model, N,
                   (1.0 - lo) * variantWeight);
  }

  double total = passMass;
  std::vector<WeightedReply> replies;
  replies.reserve(mass.indices().size() + 1);
  // Policy candidates are legal by construction (MoveGen draws them from valid
  // points), and getMove() does not re-validate priority moves either, so no
  // extra legality pass is needed here.
  for (const int idx : mass.indices()) {
    const double m = mass.at(idx);
    if (m <= 0.0) continue;
    total += m;
    WeightedReply reply;
    reply.x = idx / N;
    reply.y = idx % N;
    reply.prob = m;
    replies.push_back(reply);
  }
  if (passMass > 0.0) {
    WeightedReply reply;
    reply.passMove = true;
    reply.prob = passMass;
    replies.push_back(reply);
  }
  if (total <= 0.0) {
    WeightedReply reply;
    reply.passMove = true;
    reply.prob = 1.0;
    dist.replies.push_back(reply);
    return dist;
  }

  for (auto& reply : replies) reply.prob /= total;
  std::sort(replies.begin(), replies.end(),
            [](const WeightedReply& a, const WeightedReply& b) { return a.prob > b.prob; });
  dist.replies = std::move(replies);
  return dist;
}

bool isSmart(Opponent faction, double rng) {
  if (faction == Opponent::Netburners) return false;
  if (faction == Opponent::SlumSnakes) return rng < 0.3;
  if (faction == Opponent::TheBlackHand) return rng < 0.8;
  return true;
}

Play getMove(const GameState& state, Color player, Opponent opponent, double seedMs, MathRandom& mathRng) {
  WHRNG rng(seedMs);
  const bool smart = isSmart(opponent, rng.random());  // draw 1
  const double moveRng = rng.random();                 // draw 2
  MoveGen moves(state, player, moveRng, smart, mathRng);
  const double factionRng = rng.random();              // draw 3

  const std::optional<Pt> priority = factionMove(moves, opponent, factionRng);
  if (priority) return Play{PlayType::Move, priority->first, priority->second};

  // Fallback: pick a random valid move from the reasonable options.
  std::vector<Pt> options;
  auto consider = [&](const AiMove& m) {
    if (m.valid && evaluateIfMoveIsValid(state, m.x, m.y, player) == Validity::Valid) options.emplace_back(m.x, m.y);
  };
  consider(moves.growth());
  consider(moves.surround());
  consider(moves.defend());
  consider(moves.expansion());
  consider(moves.pattern());
  consider(moves.eyeMove());
  consider(moves.eyeBlock());

  const double fallbackRng = rng.random();  // draw 4
  if (!options.empty()) {
    const int idx = floorIndex(fallbackRng, options.size());
    if (idx >= 0 && idx < static_cast<int>(options.size())) {
      return Play{PlayType::Move, options[idx].first, options[idx].second};
    }
  }
  return Play{PlayType::Pass, -1, -1};
}

}  // namespace ipvgo::game
